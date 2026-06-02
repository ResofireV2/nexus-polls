defmodule NexusPolls.Poll do
  use Ecto.Schema
  import Ecto.Changeset

  schema "nexus_polls_polls" do
    field :post_id,          :integer
    field :question,         :string
    field :allow_multiple,   :boolean, default: false
    field :show_before_vote, :boolean, default: false
    field :public_votes,     :boolean, default: false
    field :closes_at,        :utc_datetime

    has_many :options, NexusPolls.Option
    has_many :votes,   NexusPolls.Vote

    timestamps(type: :utc_datetime)
  end

  @required ~w(post_id question)a
  @optional ~w(allow_multiple show_before_vote public_votes closes_at)a

  def changeset(poll, attrs) do
    poll
    |> cast(attrs, @required ++ @optional)
    |> validate_required(@required)
    |> validate_length(:question, min: 1, max: 200)
    |> unique_constraint(:post_id)
  end
end
