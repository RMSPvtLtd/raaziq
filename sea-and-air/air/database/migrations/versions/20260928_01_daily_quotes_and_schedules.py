"""Preserve quotation schedules and expand the weekly schedule reference."""

from alembic import op
import sqlalchemy as sa


revision = "20260928_01"
down_revision = "4a25908fa918"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("quote", sa.Column("schedule_snapshot", sa.JSON(), nullable=True))
    op.add_column("airline_schedule", sa.Column("flight_number", sa.String(40), nullable=True))
    op.add_column("airline_schedule", sa.Column("routing", sa.String(200), nullable=True))
    op.add_column("airline_schedule", sa.Column("departure_time", sa.String(5), nullable=True))
    op.add_column("airline_schedule", sa.Column("transit_time", sa.String(120), nullable=True))
    op.add_column("airline_schedule", sa.Column("valid_from", sa.Date(), nullable=True))
    op.add_column("airline_schedule", sa.Column("valid_until", sa.Date(), nullable=True))


def downgrade() -> None:
    for column in ("valid_until", "valid_from", "transit_time", "departure_time", "routing", "flight_number"):
        op.drop_column("airline_schedule", column)
    op.drop_column("quote", "schedule_snapshot")
