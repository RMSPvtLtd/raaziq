"""Immutable quotation particulars on invoices and document delivery outcomes."""
from alembic import op
import sqlalchemy as sa

revision = "20260928_02"
down_revision = "20260928_01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("company", sa.Column("notification_email", sa.String(320), nullable=True))
    op.add_column("company", sa.Column("automatic_email_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    for table in ("quote", "invoice"):
        op.add_column(table, sa.Column("email_status", sa.String(30), nullable=False, server_default="not_sent"))
        op.add_column(table, sa.Column("email_recipient", sa.String(320), nullable=True))
        op.add_column(table, sa.Column("email_error", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True))
    for name, kind in (
        ("quote_reference_snapshot", sa.String(80)), ("quote_date_snapshot", sa.Date()),
        ("quote_valid_until_snapshot", sa.Date()), ("dimensions_snapshot", sa.String(200)),
        ("description_snapshot", sa.Text()), ("ready_date_snapshot", sa.Date()),
        ("schedule_snapshot", sa.JSON()),
    ):
        op.add_column("invoice", sa.Column(name, kind, nullable=True))
    # Historical invoices remain as originally issued; these particulars were
    # not captured then, so do not invent them from today's mutable inquiry.


def downgrade():
    for name in ("quote_reference_snapshot", "quote_date_snapshot", "quote_valid_until_snapshot",
                 "dimensions_snapshot", "description_snapshot", "ready_date_snapshot", "schedule_snapshot"):
        op.drop_column("invoice", name)
    for table in ("quote", "invoice"):
        for name in ("email_status", "email_recipient", "email_error", "emailed_at"):
            op.drop_column(table, name)
    op.drop_column("company", "automatic_email_enabled")
    op.drop_column("company", "notification_email")
