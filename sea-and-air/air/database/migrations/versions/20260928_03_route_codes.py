"""Normalize recognized legacy air lane names without rewriting invoice snapshots."""
from alembic import op
import sqlalchemy as sa

revision = "20260928_03"
down_revision = "20260928_02"
branch_labels = None
depends_on = None


def upgrade():
    aliases = {
        "LAHORE": "LHE", "DUBAI": "DXB", "LONDON": "LHR", "LONDON HEATHROW": "LHR",
        "HEATHROW": "LHR", "KARACHI": "KHI", "ISLAMABAD": "ISB", "DOHA": "DOH",
        "ISTANBUL": "IST", "COLOMBO": "CMB", "HANOI": "HAN", "ABU DHABI": "AUH",
        "SINGAPORE": "SIN", "FRANKFURT": "FRA", "MANCHESTER": "MAN",
        "LAHORE, PAKISTAN": "LHE", "KARACHI, PAKISTAN": "KHI",
        "DUBAI, UNITED ARAB EMIRATES": "DXB", "LONDON, UNITED KINGDOM": "LHR",
    }
    for name in ("inquiry", "rate_card", "airline_schedule"):
        table = sa.table(name, sa.column("origin"), sa.column("destination"), sa.column("mode"))
        for field in ("origin", "destination"):
            column = table.c[field]
            for legacy, code in aliases.items():
                op.execute(table.update().where(
                    sa.func.upper(table.c.mode) == "AIR", sa.func.upper(sa.func.trim(column)) == legacy,
                ).values({field: code}))
            op.execute(table.update().where(
                sa.func.upper(table.c.mode) == "AIR", sa.func.length(sa.func.trim(column)) == 3,
            ).values({field: sa.func.upper(sa.func.trim(column))}))


def downgrade():
    # Codes are valid values under the old schema too. The original spelling
    # cannot be reconstructed; leave canonical business data intact.
    pass
