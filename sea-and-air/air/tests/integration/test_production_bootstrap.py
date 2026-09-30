from sqlalchemy import select

from config import Settings
from database.seeds.bootstrap_production import run
from models import Company, OpsUser
from utils.security import verify_password


def test_production_bootstrap_is_safe_and_idempotent(db_session):
    settings = Settings(
        environment="production",
        jwt_secret_key="production-test-secret-at-least-32-characters",
        ops_admin_username="first.operator",
        ops_admin_password="unique-bootstrap-test-password",
        notification_email="accounts@example.com",
    )
    run(db_session, settings)
    db_session.commit()

    operator = db_session.scalar(select(OpsUser))
    company = db_session.scalar(select(Company))
    assert operator.username == "first.operator"
    assert verify_password("unique-bootstrap-test-password", operator.password_hash)
    assert company.name == "Raaziq International (Pvt) Ltd"
    assert company.is_default
    assert company.notification_email == "accounts@example.com"
    assert company.tax_id is None and company.bank_account_number is None

    original_hash = operator.password_hash
    company.notification_email = "changed@example.com"
    db_session.commit()
    run(db_session, settings)
    db_session.commit()
    assert len(db_session.scalars(select(OpsUser)).all()) == 1
    assert len(db_session.scalars(select(Company)).all()) == 1
    assert operator.password_hash == original_hash
    assert company.notification_email == "changed@example.com"


def test_production_bootstrap_rejects_development(db_session):
    settings = Settings(environment="development")
    try:
        run(db_session, settings)
    except RuntimeError as exc:
        assert "ENVIRONMENT=production" in str(exc)
    else:
        raise AssertionError("Development settings must be rejected")
