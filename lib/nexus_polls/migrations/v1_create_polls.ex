defmodule NexusPolls.Migrations.V1CreatePolls do
  use Ecto.Migration

  def change do
    create table(:nexus_polls_polls) do
      add :post_id,          :bigint,  null: false
      add :question,         :string,  null: false
      add :allow_multiple,   :boolean, null: false, default: false
      add :show_before_vote, :boolean, null: false, default: false
      add :public_votes,     :boolean, null: false, default: false
      add :closes_at,        :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:nexus_polls_polls, [:post_id])
    create index(:nexus_polls_polls, [:closes_at])
  end
end
