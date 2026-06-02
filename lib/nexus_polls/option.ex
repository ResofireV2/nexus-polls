defmodule NexusPolls.Option do
  use Ecto.Schema
  import Ecto.Changeset

  schema "nexus_polls_options" do
    field :text,     :string
    field :position, :integer

    belongs_to :poll, NexusPolls.Poll

    timestamps(type: :utc_datetime)
  end

  @required ~w(poll_id text position)a

  def changeset(option, attrs) do
    option
    |> cast(attrs, @required)
    |> validate_required(@required)
    |> validate_length(:text, min: 1, max: 200)
  end
end
