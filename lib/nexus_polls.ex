defmodule NexusPolls do
  @moduledoc """
  Nexus Polls extension.

  Allows forum members to attach polls to posts. Voters cast ballots
  inline from the post footer. Results display with bar charts.
  Permissions are fully configurable by the admin.
  """

  use Nexus.Extensions.Behaviour

  require Logger

  alias NexusPolls.Polls

  # ---------------------------------------------------------------------------
  # migrations/0
  # Simple sequential names — the loader hashes "nexus-polls:N" to produce
  # a collision-free schema_migrations version integer.
  # ---------------------------------------------------------------------------

  @impl true
  def migrations do
    [
      NexusPolls.Migrations.V1CreatePolls,
      NexusPolls.Migrations.V2CreateOptions,
      NexusPolls.Migrations.V3CreateVotes
    ]
  end

  # ---------------------------------------------------------------------------
  # routes/0
  # Mounts our Plug router at /ext/nexus-polls/api/...
  # ---------------------------------------------------------------------------

  @impl true
  def routes do
    [{"/api", NexusPolls.ApiRouter, []}]
  end

  # ---------------------------------------------------------------------------
  # persist_attachment/3
  # Called after a post is committed when the composer had a polls_poll
  # attachment queued. Creates the poll and its options.
  # ---------------------------------------------------------------------------

  @impl true
  def persist_attachment("post", post_id, %{"kind" => "polls_poll", "data" => data}) do
    case Polls.create_poll(post_id, data) do
      {:ok, _poll} ->
        :ok

      {:error, reason} ->
        Logger.error("NexusPolls: failed to create poll for post #{post_id}: #{inspect(reason)}")
        :error
    end
  end

  def persist_attachment(_entity, _entity_id, _attachment), do: :ok

  # ---------------------------------------------------------------------------
  # handle_event/3
  # Cleans up poll data when a post is deleted. The poll row's cascade
  # delete handles options and votes, but we call delete_poll_for_post/1
  # explicitly so the log is clear.
  # ---------------------------------------------------------------------------

  @impl true
  def handle_event("post_deleted", %{"post_id" => post_id}, _settings) do
    Polls.delete_poll_for_post(post_id)
    :ok
  end

  def handle_event(_event, _payload, _settings), do: :ok
end
