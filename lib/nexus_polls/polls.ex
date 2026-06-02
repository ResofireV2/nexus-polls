defmodule NexusPolls.Polls do
  @moduledoc """
  Context module for all poll database operations.
  Called from the API router and from persist_attachment/3.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias NexusPolls.{Poll, Option, Vote}

  # ---------------------------------------------------------------------------
  # Poll creation (called from persist_attachment/3)
  # ---------------------------------------------------------------------------

  @doc """
  Creates a poll and its options from attachment data.
  Called by persist_attachment/3 after a post is committed.
  """
  def create_poll(post_id, attrs) do
    Repo.transaction(fn ->
      poll_attrs = %{
        post_id:          post_id,
        question:         attrs["question"],
        allow_multiple:   attrs["allow_multiple"]   || false,
        show_before_vote: attrs["show_before_vote"] || false,
        public_votes:     attrs["public_votes"]     || false,
        closes_at:        parse_closes_at(attrs["duration_days"])
      }

      poll =
        %Poll{}
        |> Poll.changeset(poll_attrs)
        |> Repo.insert!()

      options = attrs["options"] || []

      options
      |> Enum.with_index()
      |> Enum.each(fn {text, position} ->
        %Option{}
        |> Option.changeset(%{poll_id: poll.id, text: text, position: position})
        |> Repo.insert!()
      end)

      poll
    end)
  end

  # ---------------------------------------------------------------------------
  # Poll retrieval
  # ---------------------------------------------------------------------------

  @doc """
  Returns poll data for a given post_id, with vote counts per option and
  the current user's vote(s).

  Returns nil when no poll exists for the post.
  """
  def get_poll_for_post(post_id, user_id \\ nil) do
    poll = Repo.one(
      from p in Poll,
        where: p.post_id == ^post_id,
        preload: [options: ^from(o in Option, order_by: o.position)]
    )

    case poll do
      nil  -> nil
      poll ->
        now = DateTime.utc_now()
        closed = not is_nil(poll.closes_at) and DateTime.compare(poll.closes_at, now) == :lt

        # Vote counts per option
        vote_counts =
          from(v in Vote,
            where: v.poll_id == ^poll.id,
            group_by: v.option_id,
            select: {v.option_id, count(v.id)}
          )
          |> Repo.all()
          |> Map.new()

        total_votes = vote_counts |> Map.values() |> Enum.sum()

        options_with_counts =
          Enum.map(poll.options, fn opt ->
            %{
              id:         opt.id,
              text:       opt.text,
              position:   opt.position,
              vote_count: Map.get(vote_counts, opt.id, 0)
            }
          end)

        # Which option ids did this user vote for?
        user_vote_ids =
          if user_id do
            from(v in Vote,
              where: v.poll_id == ^poll.id and v.user_id == ^user_id,
              select: v.option_id
            )
            |> Repo.all()
          else
            []
          end

        %{
          poll: %{
            id:               poll.id,
            post_id:          poll.post_id,
            question:         poll.question,
            allow_multiple:   poll.allow_multiple,
            show_before_vote: poll.show_before_vote,
            public_votes:     poll.public_votes,
            closes_at:        poll.closes_at,
            closed:           closed,
            total_votes:      total_votes
          },
          options:       options_with_counts,
          user_vote_ids: user_vote_ids
        }
    end
  end

  # ---------------------------------------------------------------------------
  # Voting
  # ---------------------------------------------------------------------------

  @doc """
  Records a vote. Enforces single-vote constraint for non-allow_multiple polls.
  Returns {:ok, updated_poll_data} or {:error, reason}.

  user_id may be nil for guest votes (when can_vote is "everyone").
  """
  def cast_vote(post_id, option_ids, user_id) when is_list(option_ids) do
    poll = Repo.one(
      from p in Poll,
        where: p.post_id == ^post_id,
        preload: [options: ^from(o in Option, order_by: o.position)]
    )

    cond do
      is_nil(poll) ->
        {:error, :not_found}

      poll_closed?(poll) ->
        {:error, :poll_closed}

      not all_options_belong_to_poll?(option_ids, poll) ->
        {:error, :invalid_options}

      not poll.allow_multiple and length(option_ids) > 1 ->
        {:error, :multiple_votes_not_allowed}

      true ->
        do_cast_vote(poll, option_ids, user_id)
    end
  end

  defp do_cast_vote(poll, option_ids, user_id) do
    Repo.transaction(fn ->
      if user_id do
        # Delete existing votes for this user on this poll (change vote)
        from(v in Vote,
          where: v.poll_id == ^poll.id and v.user_id == ^user_id
        )
        |> Repo.delete_all()
      end

      Enum.each(option_ids, fn option_id ->
        %Vote{}
        |> Vote.changeset(%{poll_id: poll.id, option_id: option_id, user_id: user_id})
        |> Repo.insert!()
      end)
    end)
    |> case do
      {:ok, _} -> {:ok, get_poll_for_post(poll.post_id, user_id)}
      {:error, reason} -> {:error, reason}
    end
  end

  # ---------------------------------------------------------------------------
  # Poll editing
  # ---------------------------------------------------------------------------

  @doc """
  Updates a poll. No field locks — callers are responsible for
  enforcing who may edit (mods/admins always, author only if zero votes).
  """
  def update_poll(post_id, attrs) do
    case Repo.one(from p in Poll, where: p.post_id == ^post_id, preload: :options) do
      nil  -> {:error, :not_found}
      poll ->
        Repo.transaction(fn ->
          poll_attrs = %{}
          poll_attrs = if Map.has_key?(attrs, "question"),         do: Map.put(poll_attrs, :question,         attrs["question"]),         else: poll_attrs
          poll_attrs = if Map.has_key?(attrs, "allow_multiple"),   do: Map.put(poll_attrs, :allow_multiple,   attrs["allow_multiple"]),   else: poll_attrs
          poll_attrs = if Map.has_key?(attrs, "show_before_vote"), do: Map.put(poll_attrs, :show_before_vote, attrs["show_before_vote"]), else: poll_attrs
          poll_attrs = if Map.has_key?(attrs, "public_votes"),     do: Map.put(poll_attrs, :public_votes,     attrs["public_votes"]),     else: poll_attrs
          poll_attrs = if Map.has_key?(attrs, "duration_days"),    do: Map.put(poll_attrs, :closes_at,        parse_closes_at(attrs["duration_days"])), else: poll_attrs

          updated_poll =
            poll
            |> Poll.changeset(poll_attrs)
            |> Repo.update!()

          # Apply option updates if provided.
          # Each entry: {"id": existing_id, "text": "..."} for existing options
          # or {"text": "..."} (no id) for new options to add.
          # Options not mentioned are left as-is.
          # Deletion is not performed here — callers remove options by
          # omitting them and providing a separate "delete_option_ids" list.
          if Map.has_key?(attrs, "options") do
            Enum.each(attrs["options"], fn opt ->
              case opt["id"] do
                nil ->
                  # New option — append after the current last position
                  next_position = length(updated_poll |> Map.get(:options, []))
                  %Option{}
                  |> Option.changeset(%{poll_id: poll.id, text: opt["text"], position: next_position})
                  |> Repo.insert!()

                existing_id ->
                  case Repo.get(Option, existing_id) do
                    nil    -> :skip
                    option ->
                      option
                      |> Option.changeset(%{text: opt["text"]})
                      |> Repo.update!()
                  end
              end
            end)
          end

          if Map.has_key?(attrs, "delete_option_ids") do
            from(o in Option,
              where: o.poll_id == ^poll.id and o.id in ^attrs["delete_option_ids"]
            )
            |> Repo.delete_all()
          end

          updated_poll
        end)
        |> case do
          {:ok, _}         -> {:ok, get_poll_for_post(post_id)}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  @doc """
  Closes a poll immediately. Used by mods/admins via the modal.
  """
  def close_poll(post_id) do
    case Repo.one(from p in Poll, where: p.post_id == ^post_id) do
      nil  -> {:error, :not_found}
      poll ->
        poll
        |> Poll.changeset(%{closes_at: DateTime.utc_now()})
        |> Repo.update()
        |> case do
          {:ok, _}         -> {:ok, get_poll_for_post(post_id)}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  # ---------------------------------------------------------------------------
  # Voter list
  # ---------------------------------------------------------------------------

  @doc """
  Returns the list of members who voted for a specific option, paginated.
  Guest votes (user_id IS NULL) are excluded — they have no identity to display.
  Returns {voters, total} where total includes only identifiable voters.
  """
  def list_voters(option_id, limit \\ 5, offset \\ 0) do
    total =
      from(v in Vote,
        where: v.option_id == ^option_id and not is_nil(v.user_id),
        select: count(v.id)
      )
      |> Repo.one()

    voters =
      from(v in Vote,
        join: u in "users", on: u.id == v.user_id,
        where: v.option_id == ^option_id and not is_nil(v.user_id),
        order_by: [asc: v.inserted_at],
        limit:  ^limit,
        offset: ^offset,
        select: %{
          id:         u.id,
          username:   u.username,
          avatar_url: u.avatar_url
        }
      )
      |> Repo.all()

    {voters, total}
  end

  # ---------------------------------------------------------------------------
  # Vote count for a post (used by registerPostAction visible check via API)
  # ---------------------------------------------------------------------------

  @doc """
  Returns the total vote count for the poll attached to a post, or 0 if
  no poll exists. Used by the JS bundle's module-level cache to determine
  whether the edit action should be shown to the post author.
  """
  def vote_count_for_post(post_id) do
    case Repo.one(from p in Poll, where: p.post_id == ^post_id, select: p.id) do
      nil     -> 0
      poll_id ->
        from(v in Vote, where: v.poll_id == ^poll_id, select: count(v.id))
        |> Repo.one()
    end
  end

  # ---------------------------------------------------------------------------
  # Cleanup (called from handle_event "post_deleted")
  # ---------------------------------------------------------------------------

  @doc """
  Deletes the poll and all associated options and votes for a post.
  Cascade deletes handle options and votes via foreign key constraints,
  so deleting the poll row is sufficient.
  """
  def delete_poll_for_post(post_id) do
    from(p in Poll, where: p.post_id == ^post_id)
    |> Repo.delete_all()
    :ok
  end

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp poll_closed?(%Poll{closes_at: nil}), do: false
  defp poll_closed?(%Poll{closes_at: closes_at}) do
    DateTime.compare(closes_at, DateTime.utc_now()) == :lt
  end

  defp all_options_belong_to_poll?(option_ids, poll) do
    valid_ids = Enum.map(poll.options, & &1.id) |> MapSet.new()
    Enum.all?(option_ids, &MapSet.member?(valid_ids, &1))
  end

  # Converts duration_days (integer or nil) to a UTC closes_at datetime.
  # nil or "never" → nil (poll never closes).
  defp parse_closes_at(nil), do: nil
  defp parse_closes_at("never"), do: nil
  defp parse_closes_at(days) when is_integer(days) and days > 0 do
    DateTime.add(DateTime.utc_now(), days * 86_400, :second)
    |> DateTime.truncate(:second)
  end
  defp parse_closes_at(_), do: nil
end
