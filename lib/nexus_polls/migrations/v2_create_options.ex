defmodule NexusPolls.Migrations.V2CreateOptions do
  use Ecto.Migration

  def change do
    create table(:nexus_polls_options) do
      add :poll_id,  references(:nexus_polls_polls, on_delete: :delete_all), null: false
      add :text,     :string,  null: false
      add :position, :integer, null: false

      timestamps(type: :utc_datetime)
    end

    create index(:nexus_polls_options, [:poll_id])
    create index(:nexus_polls_options, [:poll_id, :position])
  end
end
