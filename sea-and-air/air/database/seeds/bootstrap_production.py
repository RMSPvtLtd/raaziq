"""Create the first production operator and issuing company after migrations.

Run with ENVIRONMENT=production and the production DATABASE_URL and secrets set:

    python database/seeds/bootstrap_production.py

Safe to repeat: existing accounts, passwords, and company settings are untouched.
This intentionally does not import or run the demo seed.
"""

import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from config import Settings, get_settings  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import Company, OpsUser  # noqa: E402
from utils.security import hash_password  # noqa: E402


def run(session: Session, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if not settings.is_production:
        raise RuntimeError("Production bootstrap requires ENVIRONMENT=production")
    settings.assert_production_ready()
    if not settings.ops_admin_username.strip() or not settings.ops_admin_password:
        raise RuntimeError("OPS_ADMIN_USERNAME and OPS_ADMIN_PASSWORD are required")

    if session.scalar(select(OpsUser).where(OpsUser.username == settings.ops_admin_username)) is None:
        session.add(OpsUser(
            name="Admin",
            username=settings.ops_admin_username,
            password_hash=hash_password(settings.ops_admin_password),
        ))

    company_name = "Raaziq International (Pvt) Ltd"
    if session.scalar(select(Company).where(Company.name == company_name)) is None:
        session.add(Company(
            name=company_name,
            address="The Enterprise, Building 2, 4th Floor, 15-KM Multan Road, Lahore, Pakistan",
            phone="+92-42-37516307-20",
            email="info@raaziq.com",
            website="www.raaziq.com",
            is_default=True,
            notification_email=settings.notification_email,
        ))
    session.flush()


def main() -> None:
    settings = get_settings()
    if not settings.is_production:
        raise RuntimeError("Production bootstrap requires ENVIRONMENT=production")
    settings.assert_production_ready()
    with SessionLocal.begin() as session:
        run(session, settings)
    print("Production bootstrap complete.")


if __name__ == "__main__":
    main()
