"""Owns the database engine, session factory, and declarative base. Every other
module gets its session through `get_db` (FastAPI dependency) or by constructing
a `SessionLocal()` directly in scripts (seed, tests) — nobody builds their own
engine.
"""

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from config import get_settings


class Base(DeclarativeBase):
    pass


def normalize_database_url(url: str) -> str:
    """Use the installed psycopg 3 driver for provider-issued PostgreSQL URLs."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def make_engine(database_url: str | None = None):
    url = normalize_database_url(database_url or get_settings().database_url)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    options = {}
    if url.startswith("postgresql+psycopg://") and make_url(url).port == 6543:
        connect_args["prepare_threshold"] = None
        options["poolclass"] = NullPool
    return create_engine(url, connect_args=connect_args, future=True, **options)


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    """FastAPI dependency yielding a request-scoped session. Commits once,
    after the route handler returns successfully; rolls back on any
    exception. This is what makes a service function's writes (e.g.
    `services.quotes.accept_quote`) atomic across an HTTP request without
    each service needing to manage its own transaction boundary.
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
