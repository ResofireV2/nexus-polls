defmodule NexusPolls.ApiRouter do
  use Plug.Router

  alias NexusPolls.Polls
  alias Nexus.Extensions.Permissions

  plug :match
  plug :dispatch

  # ---------------------------------------------------------------------------
  # GET /ext/nexus-polls/api/polls/:post_id
  #
  # Returns the poll for a post along with resolved permissions for the
  # current user. The JS bundle reads `permissions` to decide which UI
  # states to render — no client-side permission logic.
  # ---------------------------------------------------------------------------
  get "/polls/:post_id" do
    user = conn.assigns[:current_user]

    resolved = %{
      can_vote:         Permissions.check("nexus-polls", "can_vote",         user) == :ok,
      can_view_results: Permissions.check("nexus-polls", "can_view_results", user) == :ok,
      can_view_voters:  Permissions.check("nexus-polls", "can_view_voters",  user) == :ok,
      can_create_poll:  Permissions.check("nexus-polls", "can_create_poll",  user) == :ok
    }

    post_id = parse_id(post_id)

    case post_id do
      nil ->
        send_json(conn, 400, %{error: "Invalid post id"})

      id ->
        user_id = user && user.id
        result  = Polls.get_poll_for_post(id, user_id)

        if is_nil(result) do
          send_json(conn, 200, %{poll: nil, permissions: resolved})
        else
          send_json(conn, 200, Map.put(result, :permissions, resolved))
        end
    end
  end

  # ---------------------------------------------------------------------------
  # POST /ext/nexus-polls/api/polls/:post_id/vote
  #
  # Casts a vote. Returns the full updated poll state so the JS bundle can
  # update local state without a re-fetch.
  # ---------------------------------------------------------------------------
  post "/polls/:post_id/vote" do
    user = conn.assigns[:current_user]

    case Permissions.check("nexus-polls", "can_vote", user) do
      :error ->
        send_json(conn, 403, %{error: "You don't have permission to vote"})

      :ok ->
        params     = conn.body_params
        option_ids = params["option_ids"] || []
        post_id    = parse_id(post_id)

        cond do
          is_nil(post_id) ->
            send_json(conn, 400, %{error: "Invalid post id"})

          not is_list(option_ids) or option_ids == [] ->
            send_json(conn, 400, %{error: "option_ids must be a non-empty array"})

          not Enum.all?(option_ids, &is_integer/1) ->
            send_json(conn, 400, %{error: "option_ids must be integers"})

          true ->
            user_id = user && user.id

            case Polls.cast_vote(post_id, option_ids, user_id) do
              {:ok, result}          -> send_json(conn, 200, result)
              {:error, :not_found}   -> send_json(conn, 404, %{error: "Poll not found"})
              {:error, :poll_closed} -> send_json(conn, 422, %{error: "This poll is closed"})
              {:error, :invalid_options} ->
                send_json(conn, 422, %{error: "One or more options do not belong to this poll"})
              {:error, :multiple_votes_not_allowed} ->
                send_json(conn, 422, %{error: "This poll only allows one vote"})
              {:error, _} ->
                send_json(conn, 500, %{error: "Could not record vote"})
            end
        end
    end
  end

  # ---------------------------------------------------------------------------
  # PATCH /ext/nexus-polls/api/polls/:post_id
  #
  # Edits a poll. Access rules:
  #   - Mods and admins: always allowed.
  #   - Post author: only if the poll has zero votes.
  # The JS bundle enforces the same rule visually, but this is the gate.
  # ---------------------------------------------------------------------------
  patch "/polls/:post_id" do
    user = conn.assigns[:current_user]

    case user do
      nil ->
        send_json(conn, 401, %{error: "Login required"})

      _ ->
        post_id = parse_id(post_id)

        case post_id do
          nil ->
            send_json(conn, 400, %{error: "Invalid post id"})

          id ->
            can_edit = can_edit_poll?(user, id)

            if not can_edit do
              send_json(conn, 403, %{error: "You don't have permission to edit this poll"})
            else
              attrs = conn.body_params
              case Polls.update_poll(id, attrs) do
                {:ok, result}        -> send_json(conn, 200, result)
                {:error, :not_found} -> send_json(conn, 404, %{error: "Poll not found"})
                {:error, _}          -> send_json(conn, 500, %{error: "Could not update poll"})
              end
            end
        end
    end
  end

  # ---------------------------------------------------------------------------
  # DELETE /ext/nexus-polls/api/polls/:post_id/close
  #
  # Closes a poll immediately. Mods and admins only.
  # ---------------------------------------------------------------------------
  delete "/polls/:post_id/close" do
    user = conn.assigns[:current_user]

    case user do
      nil ->
        send_json(conn, 401, %{error: "Login required"})

      _ ->
        if not moderator_or_admin?(user) do
          send_json(conn, 403, %{error: "Only moderators and admins can close polls"})
        else
          post_id = parse_id(post_id)

          case post_id do
            nil ->
              send_json(conn, 400, %{error: "Invalid post id"})

            id ->
              case Polls.close_poll(id) do
                {:ok, result}        -> send_json(conn, 200, result)
                {:error, :not_found} -> send_json(conn, 404, %{error: "Poll not found"})
                {:error, _}          -> send_json(conn, 500, %{error: "Could not close poll"})
              end
          end
        end
    end
  end

  # ---------------------------------------------------------------------------
  # GET /ext/nexus-polls/api/polls/:post_id/voters/:option_id
  #
  # Returns paginated voter list for a specific option.
  # Only available when the poll has public_votes: true and the requesting
  # user passes can_view_voters.
  # ---------------------------------------------------------------------------
  get "/polls/:post_id/voters/:option_id" do
    user = conn.assigns[:current_user]

    case Permissions.check("nexus-polls", "can_view_voters", user) do
      :error ->
        send_json(conn, 403, %{error: "You don't have permission to view voters"})

      :ok ->
        option_id = parse_id(option_id)

        case option_id do
          nil ->
            send_json(conn, 400, %{error: "Invalid option id"})

          id ->
            {voters, total} = Polls.list_voters(id)
            send_json(conn, 200, %{voters: voters, total: total})
        end
    end
  end

  match _ do
    send_json(conn, 404, %{error: "Not found"})
  end

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp send_json(conn, status, body) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
  end

  # Parse a string post/option id to integer. Returns nil on failure.
  defp parse_id(str) when is_binary(str) do
    case Integer.parse(str) do
      {n, ""} when n > 0 -> n
      _                  -> nil
    end
  end
  defp parse_id(_), do: nil

  # A user can edit a poll if they are a mod/admin, or if they are the
  # post author AND the poll has zero votes.
  # We look up the post author via the posts table by string name (not by
  # aliasing Nexus internal schemas — per the extension guide).
  defp can_edit_poll?(user, post_id) do
    if moderator_or_admin?(user) do
      true
    else
      import Ecto.Query
      post_user_id =
        from(p in "posts", where: p.id == ^post_id, select: p.user_id)
        |> Nexus.Repo.one()

      is_author = post_user_id == user.id
      is_author and Polls.vote_count_for_post(post_id) == 0
    end
  end

  defp moderator_or_admin?(%{role: role}) when role in ["moderator", "admin"], do: true
  defp moderator_or_admin?(_), do: false
end
