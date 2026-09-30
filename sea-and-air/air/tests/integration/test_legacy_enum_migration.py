"""Exercise backfilled rows, which create_all-based API tests cannot cover."""
import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_legacy_defaults_keep_the_same_priority_and_document_type():
    path = Path(__file__).parents[2] / "database/migrations/versions/20260928_04_legacy_enum_defaults.py"
    spec = importlib.util.spec_from_file_location("legacy_enum_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE shipment (id INTEGER PRIMARY KEY, priority VARCHAR(30) NOT NULL DEFAULT 'medium')"))
        connection.execute(text("CREATE TABLE shipment_document (id INTEGER PRIMARY KEY, document_type VARCHAR(30) NOT NULL DEFAULT 'other')"))
        connection.execute(text("INSERT INTO shipment (id, priority) VALUES (1, 'medium'), (2, 'HIGH')"))
        connection.execute(text("INSERT INTO shipment_document (id) VALUES (1)"))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(text("INSERT INTO shipment (id) VALUES (3)"))
        connection.execute(text("INSERT INTO shipment_document (id) VALUES (2)"))
        assert connection.execute(text("SELECT priority FROM shipment ORDER BY id")).scalars().all() == ["MEDIUM", "HIGH", "MEDIUM"]
        assert connection.execute(text("SELECT document_type FROM shipment_document ORDER BY id")).scalars().all() == ["OTHER", "OTHER"]
    engine.dispose()
