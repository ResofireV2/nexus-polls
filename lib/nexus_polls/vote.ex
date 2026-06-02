defmodule NexusPolls.Vote do
  use Ecto.Schema
  import Ecto.Changeset

  schema "nexus_polls_votes" do
    field :user_id, :integer

    belongs_to :poll,   NexusPolls.Poll
    belongs_to :option, NexusPolls.Option

    timestamps(type: :utc_datetime)
  end

  @required ~w(poll_id option_id)a
  @optional ~w(user_id)a

  def changeset(vote, attrs) do
    vote
    |> cast(attrs, @required ++ @optional)
    |> validate_required(@required)
  end
end
