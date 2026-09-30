"""Every test gets a fresh in-memory SQLite schema. `db_session` is for
exercising service functions directly; `client` is for exercising the API
through FastAPI's TestClient with `get_db` overridden onto the same engine.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models  # noqa: F401  (populates Base.metadata)
from db import Base, get_db
from main import app as fastapi_app


@pytest.fixture(autouse=True)
def no_live_email(monkeypatch):
    """Tests never inherit local mail credentials or contact email providers."""
    from config import get_settings

    for name in ("SMTP_USERNAME", "SMTP_PASSWORD", "RESEND_API_KEY", "NOTIFICATION_EMAIL"):
        monkeypatch.setenv(name, "")
    get_settings.cache_clear()
    with (
        patch("services.email.smtplib.SMTP", side_effect=AssertionError("Unmocked SMTP in test")),
        patch("services.email.smtplib.SMTP_SSL", side_effect=AssertionError("Unmocked SMTP in test")),
        patch("services.email.httpx.post", side_effect=AssertionError("Unmocked email API in test")),
    ):
        yield
    get_settings.cache_clear()


@pytest.fixture()
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine)


@pytest.fixture()
def db_session(session_factory):
    session = session_factory()
    yield session
    session.close()


@pytest.fixture()
def client(session_factory):
    def override_get_db():
        db = session_factory()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db
    with TestClient(fastapi_app) as test_client:
        yield test_client
    fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def ops_headers(client, db_session):
    """Authorization header for an authenticated ops user -- every ops-facing
    router now requires one (see utils.security.get_current_ops_user).
    Creates the account directly via the factory rather than going through
    an ops signup flow, since there isn't one (ops accounts are created by
    the seed script or another ops user, never self-service).
    """
    from factories import make_ops_user

    password = "OpsTest123!"
    ops_user = make_ops_user(db_session, password=password)
    db_session.commit()

    response = client.post("/ops/login", json={"username": ops_user.username, "password": password})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
