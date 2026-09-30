"""Repair legacy backfills to match the ORM's enum-name storage."""
from alembic import op
import sqlalchemy as sa

revision = "20260928_04"
down_revision = "20260928_03"
branch_labels = None
depends_on = None


def upgrade():
    # Older migrations backfilled lowercase values, but portable_enum stores
    # Python enum names. Preserve the meaning of every existing record.
    for table, column, default, values in (
        ("shipment", "priority", "MEDIUM", ("low", "medium", "high")),
        ("shipment_document", "document_type", "OTHER", ("other",)),
    ):
        for value in values:
            op.execute(sa.text(f"UPDATE {table} SET {column} = :new WHERE {column} = :old")
                       .bindparams(new=value.upper(), old=value))
        with op.batch_alter_table(table) as batch:
            batch.alter_column(column, existing_type=sa.String(30), existing_nullable=False,
                               server_default=default)


def downgrade():
    # Corrected values and defaults remain compatible with the previous ORM.
    pass
