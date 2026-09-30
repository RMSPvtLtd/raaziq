from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from factories import add_break, make_customer, make_inquiry, make_rate_card, simple_rate_card
from models.enums import ChargeKind
from schemas.airline_schedules import AirlineScheduleCreate, AirlineScheduleRead
from schemas.quotes import QuoteRead
from services.airline_schedules import create_airline_schedule, update_airline_schedule
from services.pricing import price_all_matching, price_inquiry
from services.quotes import (
    ManualLineItem, accept_quote, create_manual_quote, generate_quotes, set_quote_clauses,
)
from utils.errors import InvalidQuoteState, NoApplicableRate

TODAY = date(2026, 6, 1)
LANE = {"origin": "LHE", "destination": "DXB"}


def test_latest_same_day_rate_wins_for_single_and_multiple_offers(db_session):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    simple_rate_card(db_session, **LANE, carrier="EMIRATES", valid_from=TODAY, rate=Decimal("8"))
    latest = simple_rate_card(db_session, **LANE, carrier="EMIRATES", valid_from=TODAY, valid_until=TODAY, rate=Decimal("3"))
    assert price_inquiry(db_session, inquiry, today=TODAY).rate_card_id == latest.id
    assert price_all_matching(db_session, inquiry, today=TODAY)[0].rate_card_id == latest.id


def test_daily_rate_expiry_and_existing_quote_amounts_are_preserved(db_session):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    rate = simple_rate_card(db_session, **LANE, carrier="EMIRATES", valid_until=TODAY, rate=Decimal("3"))
    original = generate_quotes(db_session, inquiry.id, today=TODAY)[0]
    assert original.valid_until == TODAY
    rate.breaks[0].rate = Decimal("9")
    db_session.flush()
    revised = generate_quotes(db_session, inquiry.id, today=TODAY)[0]
    db_session.expire_all()
    assert original.line_items[0].unit_price == Decimal("3")
    assert original.subtotal == Decimal("300")
    assert revised.line_items[0].unit_price == Decimal("9")
    assert revised.subtotal == Decimal("900")


def test_unavailable_weight_break_does_not_hide_other_airlines(db_session):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    unavailable = make_rate_card(db_session, **LANE, carrier="EMIRATES")
    add_break(db_session, unavailable, min_weight=Decimal("200"), rate=Decimal("3"))
    simple_rate_card(db_session, **LANE, carrier="QATAR AIRWAYS")
    assert [p.carrier for p in price_all_matching(db_session, inquiry, today=TODAY)] == ["QATAR AIRWAYS"]


def test_all_unavailable_weight_breaks_raise(db_session):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    unavailable = make_rate_card(db_session, **LANE)
    add_break(db_session, unavailable, min_weight=Decimal("200"), rate=Decimal("3"))
    with pytest.raises(NoApplicableRate):
        generate_quotes(db_session, inquiry.id, today=TODAY)
    assert not inquiry.quotes


def test_regeneration_preserves_carrier_clauses_and_acceptance_sets_shipment_carrier(db_session):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    simple_rate_card(db_session, **LANE, carrier="EMIRATES")
    simple_rate_card(db_session, **LANE, carrier="QATAR AIRWAYS")
    original = generate_quotes(db_session, inquiry.id, today=TODAY)
    set_quote_clauses(db_session, original[0].id, clauses="SPACE SUBJECT TO CONFIRMATION", today=TODAY)
    revised = generate_quotes(db_session, inquiry.id, today=TODAY)
    assert revised[0].clauses == "SPACE SUBJECT TO CONFIRMATION"
    assert revised[1].clauses is None
    shipment = accept_quote(db_session, revised[1].id, "ops", today=TODAY)
    assert shipment.carrier == "QATAR AIRWAYS"
    assert revised[0].superseded_at is not None


def _schedule(**overrides):
    return AirlineScheduleCreate(**{
        **LANE, "airline_name": "EMIRATES", "mode": "air", "days_of_week": ["mon", "wed"],
        "flight_number": "EK623", "routing": "LHE-DXB", "departure_time": "03:30",
        "transit_time": "3H 20M", "valid_from": TODAY, "valid_until": TODAY,
        "notes": "SUBJECT TO SPACE", **overrides,
    })


def test_schedule_optional_fields_roundtrip_and_validate(db_session):
    schedule = create_airline_schedule(db_session, _schedule())
    result = AirlineScheduleRead.model_validate(schedule).model_dump(mode="json")
    assert result["flight_number"] == "EK623"
    assert result["departure_time"] == "03:30"
    assert result["valid_from"] == "2026-06-01"
    for overrides in ({"departure_time": "24:00"}, {"departure_time": "3:30"},
                      {"valid_until": date(2026, 5, 31)}):
        with pytest.raises(ValidationError):
            _schedule(**overrides)


def test_quotes_snapshot_all_effective_matching_schedules_and_remain_unchanged(db_session):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    simple_rate_card(db_session, **LANE, carrier="EMIRATES")
    first = create_airline_schedule(db_session, _schedule())
    create_airline_schedule(db_session, _schedule(flight_number="EK625", days_of_week=["fri"]))
    create_airline_schedule(db_session, _schedule(airline_name="QATAR AIRWAYS"))
    create_airline_schedule(db_session, _schedule(destination="LHR", routing="LHE-LHR"))
    create_airline_schedule(db_session, _schedule(valid_from=date(2026, 5, 1), valid_until=date(2026, 5, 31)))
    create_airline_schedule(db_session, _schedule(valid_from=date(2026, 6, 2), valid_until=None))
    quote = generate_quotes(db_session, inquiry.id, today=TODAY)[0]
    snapshot = QuoteRead.model_validate(quote).model_dump(mode="json")["schedule_snapshot"]
    assert [entry["flight_number"] for entry in snapshot] == ["EK623", "EK625"]
    assert snapshot[0]["days_of_week"] == ["mon", "wed"]
    assert snapshot[0]["valid_until"] == "2026-06-01"
    update_airline_schedule(db_session, first.id, _schedule(departure_time="10:00"))
    db_session.expire_all()
    assert quote.schedule_snapshot[0]["departure_time"] == "03:30"


def test_manual_quote_expiry_clauses_and_schedule_snapshot(db_session):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    create_airline_schedule(db_session, _schedule())
    kwargs = dict(carrier="EMIRATES", currency="USD", today=TODAY, clauses="CASH BEFORE DEPARTURE",
                  line_items=[ManualLineItem(ChargeKind.FREIGHT, "FREIGHT", Decimal("1"), Decimal("50"), Decimal("50"))])
    quote = create_manual_quote(db_session, inquiry.id, valid_until=TODAY, **kwargs)
    assert quote.valid_until == TODAY
    assert quote.clauses == "CASH BEFORE DEPARTURE"
    assert quote.schedule_snapshot[0]["flight_number"] == "EK623"
    with pytest.raises(InvalidQuoteState):
        create_manual_quote(db_session, inquiry.id, valid_until=date(2026, 5, 31), **kwargs)


def test_acceptance_reloads_cached_shipment_after_another_sibling_wins(db_session, session_factory):
    inquiry = make_inquiry(db_session, make_customer(db_session), **LANE)
    simple_rate_card(db_session, **LANE, carrier="EMIRATES")
    simple_rate_card(db_session, **LANE, carrier="QATAR AIRWAYS")
    first, second = generate_quotes(db_session, inquiry.id, today=TODAY)
    db_session.commit()
    first_id, second_id = first.id, second.id
    cached_shipment = inquiry.shipment
    assert cached_shipment.job_number is None
    with session_factory() as competing_session:
        winner = accept_quote(competing_session, first_id, "ops", today=TODAY)
        winner_job = winner.job_number
        competing_session.commit()
    with pytest.raises(InvalidQuoteState):
        accept_quote(db_session, second_id, "ops", today=TODAY)
    db_session.refresh(cached_shipment)
    assert cached_shipment.quote_id == first_id
    assert cached_shipment.job_number == winner_job
