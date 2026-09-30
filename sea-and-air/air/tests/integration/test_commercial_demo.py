import importlib.util
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select
from models import AirlineSchedule, Invoice, Quote, RateCard


def test_commercial_demo_is_repeatable_and_never_emails(db_session):
    path = Path(__file__).resolve().parents[2] / "database/seeds/seed.py"
    spec = importlib.util.spec_from_file_location("demo_seed", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with patch("services.email.send_pdf_email") as email:
        module.run(db_session)
        counts = [db_session.scalar(select(func.count()).select_from(model))
                  for model in (RateCard, AirlineSchedule, Quote, Invoice)]
        module.run(db_session)
        assert counts == [db_session.scalar(select(func.count()).select_from(model))
                          for model in (RateCard, AirlineSchedule, Quote, Invoice)]
        email.assert_not_called()
    assert db_session.scalars(select(AirlineSchedule)).first().notes.startswith("DEMO")
    invoice = db_session.scalars(select(Invoice).where(Invoice.remarks == "DEMO INVOICE - NOT PAYABLE")).one()
    assert invoice.carrier_snapshot == "EMIRATES"
    assert invoice.schedule_snapshot
    assert "DEMO ONLY" in invoice.clauses_snapshot
