defmodule NexusPolls.Migrations.V3CreateVotes do
  use Ecto.Migration

  def change do
    create table(:nexus_polls_votes) do
      # user_id is nullable — guests can vote when can_vote is set to "everyone"
      # and guest browsing is enabled. Null user_id = anonymous guest vote.
      add :poll_id,   references(:nexus_polls_polls, on_delete: :delete_all),   null: false
      add :option_id, references(:nexus_polls_options, on_delete: :delete_all), null: false
      add :user_id,   :bigint

      timestamps(type: :utc_datetime)
    end

    create index(:nexus_polls_votes, [:poll_id])
    create index(:nexus_polls_votes, [:option_id])
    create index(:nexus_polls_votes, [:user_id])

    # For single-vote polls: one row per (poll, user).
    # This index is used for the uniqueness check in the context module.
    # Guest votes (user_id IS NULL) are excluded via the WHERE clause —
    # Postgres partial unique indexes skip NULL values by default, so
    # multiple guest votes on the same poll are permitted (no identity to
    # deduplicate against).
    create unique_index(:nexus_polls_votes, [:poll_id, :user_id],
      where: "user_id IS NOT NULL",
      name:  :nexus_polls_votes_poll_user_unique
    )

    # For allow_multiple polls: one row per (poll, option, user).
    # This prevents a user from voting for the same option twice.
    create unique_index(:nexus_polls_votes, [:poll_id, :option_id, :user_id],
      where: "user_id IS NOT NULL",
      name:  :nexus_polls_votes_poll_option_user_unique
    )
  end
end
