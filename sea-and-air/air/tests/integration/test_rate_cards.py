from datetime import date

import pytest

from utils.errors import NoApplicableRate
from services.pricing import price_inquiry
from services.quotes import generate_quote
from factories import add_break, make_customer, make_inquiry, make_rate_card

VALID_PAYLOAD = {
    "origin": "Lahore",
    "destination": "London",
    "mode": "air",
    "carrier": "British Airways Cargo",
    "currency": "USD",
    "valid_from": "2020-01-01",
    "valid_until": "2035-01-01",
    "minimum_charge": "100.00",
    "breaks": [
        {"min_weight": "0", "max_weight": "100", "unit": "per_kg", "rate": "7.5000", "description": "0-100kg"},
        {"min_weight": "100", "max_weight": None, "unit": "per_kg", "rate": "6.0000", "description": "100kg+"},
    ],
    "charges": [
        {"kind": "documentation", "description": "Documentation fee", "basis": "flat", "amount": "45.0000"},
    ],
}


def test_create_rate_card(client, ops_headers):
    r = client.post("/rate-cards", json=VALID_PAYLOAD, headers=ops_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["origin"] == "LHE"
    assert body["destination"] == "LHR"
    assert len(body["breaks"]) == 2
    assert len(body["charges"]) == 1


def test_create_rate_card_requires_ops_auth(client):
    r = client.post("/rate-cards", json=VALID_PAYLOAD)
    assert r.status_code == 401


def test_create_rate_card_rejects_empty_breaks(client, ops_headers):
    payload = {**VALID_PAYLOAD, "breaks": []}
    r = client.post("/rate-cards", json=payload, headers=ops_headers)
    assert r.status_code == 422


def test_create_rate_card_rejects_inverted_validity_window(client, ops_headers):
    payload = {**VALID_PAYLOAD, "valid_from": "2030-01-01", "valid_until": "2020-01-01"}
    r = client.post("/rate-cards", json=payload, headers=ops_headers)
    assert r.status_code == 422


def test_create_rate_card_rejects_inverted_break_bounds(client, ops_headers):
    payload = {
        **VALID_PAYLOAD,
        "breaks": [{"min_weight": "100", "max_weight": "50", "unit": "per_kg", "rate": "5.0000"}],
    }
    r = client.post("/rate-cards", json=payload, headers=ops_headers)
    assert r.status_code == 422


def test_list_and_get_rate_card(client, ops_headers):
    created = client.post("/rate-cards", json=VALID_PAYLOAD, headers=ops_headers).json()

    listed = client.get("/rate-cards", headers=ops_headers)
    assert listed.status_code == 200
    assert any(rc["id"] == created["id"] for rc in listed.json())

    fetched = client.get(f"/rate-cards/{created['id']}", headers=ops_headers)
    assert fetched.status_code == 200
    assert fetched.json()["id"] == created["id"]


def test_get_rate_card_not_found(client, ops_headers):
    r = client.get("/rate-cards/999999", headers=ops_headers)
    assert r.status_code == 404


def test_update_rate_card_replaces_breaks_and_charges(client, ops_headers):
    created = client.post("/rate-cards", json=VALID_PAYLOAD, headers=ops_headers).json()

    updated_payload = {
        **VALID_PAYLOAD,
        "minimum_charge": "150.00",
        "breaks": [{"min_weight": "0", "max_weight": None, "unit": "per_kg", "rate": "6.5000"}],
        "charges": [],
    }
    r = client.patch(f"/rate-cards/{created['id']}", json=updated_payload, headers=ops_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["minimum_charge"] == "150.00"
    assert len(body["breaks"]) == 1
    assert len(body["charges"]) == 0


def test_delete_rate_card(client, ops_headers):
    created = client.post("/rate-cards", json=VALID_PAYLOAD, headers=ops_headers).json()

    r = client.delete(f"/rate-cards/{created['id']}", headers=ops_headers)
    assert r.status_code == 204

    r = client.get(f"/rate-cards/{created['id']}", headers=ops_headers)
    assert r.status_code == 404


def test_generate_quote_fails_without_a_rate_card_for_the_lane(db_session):
    """Reproduces the real-world bug this feature fixes: an inquiry on a
    lane with no rate card leaves the caller with NoApplicableRate, not a
    generated quote."""
    customer = make_customer(db_session)
    inquiry = make_inquiry(db_session, customer, origin="Lahore", destination="London")

    with pytest.raises(NoApplicableRate):
        generate_quote(db_session, inquiry.id, today=date(2026, 6, 1))


def test_generate_quote_succeeds_once_a_rate_card_is_added_for_the_lane(db_session):
    customer = make_customer(db_session)
    inquiry = make_inquiry(db_session, customer, origin="Lahore", destination="London")

    with pytest.raises(NoApplicableRate):
        price_inquiry(db_session, inquiry, today=date(2026, 6, 1))

    rate_card = make_rate_card(db_session, origin="Lahore", destination="London")
    add_break(db_session, rate_card, min_weight=0, max_weight=None, rate=5)
    db_session.flush()

    quote = generate_quote(db_session, inquiry.id, today=date(2026, 6, 1))
    assert quote.id is not None
