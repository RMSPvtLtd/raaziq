from unittest.mock import patch

from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from db import make_engine, normalize_database_url


def test_provider_postgres_urls_use_psycopg3_without_changing_other_urls():
    assert normalize_database_url("postgres://user:pass@host/db?sslmode=require") == (
        "postgresql+psycopg://user:pass@host/db?sslmode=require"
    )
    assert normalize_database_url("postgresql://user:pass@host/db") == (
        "postgresql+psycopg://user:pass@host/db"
    )
    assert normalize_database_url("postgresql+psycopg://user:pass@host/db") == (
        "postgresql+psycopg://user:pass@host/db"
    )
    assert normalize_database_url("sqlite://") == "sqlite://"

    engine = make_engine("postgres://user:pass@localhost/example")
    assert engine.dialect.driver == "psycopg"
    engine.dispose()

    with patch("db.create_engine", wraps=create_engine) as build_engine:
        pooler = make_engine("postgres://user:pass@localhost:6543/example")
    assert build_engine.call_args.kwargs["connect_args"]["prepare_threshold"] is None
    assert isinstance(pooler.pool, NullPool)
    pooler.dispose()

    config = Config()
    url = normalize_database_url("postgres://user:p%40ss@host/db")
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    assert config.get_main_option("sqlalchemy.url") == "postgresql+psycopg://user:p%40ss@host/db"
