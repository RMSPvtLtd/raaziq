from datetime import date
from decimal import Decimal

from models.enums import EventSource, ShipmentStage, next_stage
from services.invoices import create_invoice_from_quote
from services.quotes import accept_quote, generate_quote, generate_quotes
from services.transitions import advance_stage
from factories import make_company, make_customer, make_customer_with_portal, make_inquiry, simple_rate_card

TODAY = date(2026, 6, 1)


def _accepted_shipment(db_session, customer, **inquiry_overrides):
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer, **inquiry_overrides)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()
    return accept_quote(db_session, quote.id, "ops", today=TODAY)


def _walk_to(db_session, shipment, target: ShipmentStage) -> None:
    while shipment.stage != target:
        advance_stage(
            db_session, shipment, next_stage(shipment.stage), actor="ops", note=None, source=EventSource.MANUAL
        )


def _login(client, username: str, password: str = "Customer123!") -> str:
    r = client.post("/customer/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_login_succeeds_for_portal_enabled_customer(client, db_session):
    make_customer_with_portal(db_session, username="orient.traders")
    db_session.commit()

    r = client.post("/customer/login", json={"username": "orient.traders", "password": "Customer123!"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["customer"]["username"] == "orient.traders"
    assert "access_token" in body


def test_login_rejected_for_customer_without_portal_access(client, db_session):
    make_customer(db_session, email="no-portal@example.com")
    db_session.commit()

    r = client.post("/customer/login", json={"username": "no-portal@example.com", "password": "anything"})
    assert r.status_code == 401


def test_login_rejected_when_portal_deactivated(client, db_session):
    customer = make_customer_with_portal(db_session, username="deactivated.customer")
    customer.portal_active = False
    db_session.commit()

    r = client.post("/customer/login", json={"username": "deactivated.customer", "password": "Customer123!"})
    assert r.status_code == 401


def test_me_returns_the_authenticated_customer(client, db_session):
    make_customer_with_portal(db_session, username="orient.traders", name="Orient Traders")
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.get("/customer/me", headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Orient Traders"


def test_shipments_are_scoped_to_the_logged_in_customer(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    someone_else = make_customer(db_session, email="other@example.com")
    my_shipment = _accepted_shipment(db_session, mine)
    other_shipment = _accepted_shipment(db_session, someone_else)
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.get("/customer/shipments", headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    ids = [item["id"] for item in r.json()]
    assert my_shipment.id in ids
    assert other_shipment.id not in ids


def test_completed_filter_splits_active_and_invoiced_shipments(client, db_session):
    customer = make_customer_with_portal(db_session, username="zainab.enterprises")
    active = _accepted_shipment(db_session, customer, description="active")
    invoiced = _accepted_shipment(db_session, customer, description="invoiced")
    _walk_to(db_session, invoiced, ShipmentStage.INVOICE_TO_CUSTOMER)
    db_session.commit()

    token = _login(client, "zainab.enterprises")

    r_completed = client.get("/customer/shipments", params={"completed": "true"}, headers=_auth_headers(token))
    completed_ids = [item["id"] for item in r_completed.json()]
    assert invoiced.id in completed_ids
    assert active.id not in completed_ids

    r_active = client.get("/customer/shipments", params={"completed": "false"}, headers=_auth_headers(token))
    active_ids = [item["id"] for item in r_active.json()]
    assert active.id in active_ids
    assert invoiced.id not in active_ids


def test_get_shipment_rejects_another_customers_shipment(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    someone_else = make_customer(db_session, email="other@example.com")
    other_shipment = _accepted_shipment(db_session, someone_else)
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.get(f"/customer/shipments/{other_shipment.id}", headers=_auth_headers(token))
    assert r.status_code == 404


def test_get_shipment_returns_tracking_safe_fields_for_own_shipment(client, db_session):
    customer = make_customer_with_portal(db_session, username="orient.traders")
    shipment = _accepted_shipment(db_session, customer)
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.get(f"/customer/shipments/{shipment.id}", headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_number"] == shipment.job_number
    assert "checklist" in body and "status_history" in body
    assert "risk_reason" not in body  # customer-safe: never exposed


def test_quotes_are_scoped_to_the_logged_in_customer(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    someone_else = make_customer(db_session, email="other@example.com")
    simple_rate_card(db_session)
    my_inquiry = make_inquiry(db_session, mine)
    other_inquiry = make_inquiry(db_session, someone_else)
    my_quote = generate_quote(db_session, my_inquiry.id, today=TODAY)
    other_quote = generate_quote(db_session, other_inquiry.id, today=TODAY)
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.get("/customer/quotes", headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    ids = [q["id"] for q in r.json()]
    assert my_quote.id in ids
    assert other_quote.id not in ids

    r_detail = client.get(f"/customer/quotes/{other_quote.id}", headers=_auth_headers(token))
    assert r_detail.status_code == 404


def test_customer_can_accept_their_own_quote(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, mine)
    # No today= override here -- this quote is accepted through the HTTP
    # endpoint, which has no today parameter and always checks expiry
    # against the real current date, so its valid_until must be relative to
    # that (unlike the direct-service-call tests elsewhere, which use the
    # fixed TODAY throughout and never cross the real clock).
    quote = generate_quote(db_session, inquiry.id)
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.post(f"/customer/quotes/{quote.id}/accept", headers=_auth_headers(token))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_number"] is not None
    assert body["stage"] == "job_opening"


def test_customer_cannot_accept_another_customers_quote(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    someone_else = make_customer(db_session, email="other@example.com")
    simple_rate_card(db_session)
    other_inquiry = make_inquiry(db_session, someone_else)
    other_quote = generate_quote(db_session, other_inquiry.id, today=TODAY)
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.post(f"/customer/quotes/{other_quote.id}/accept", headers=_auth_headers(token))

    assert r.status_code == 404


def test_customer_accepting_one_sibling_quote_supersedes_the_others(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    simple_rate_card(db_session, carrier="PIA", rate=Decimal("5.00"))
    simple_rate_card(db_session, carrier="Emirates SkyCargo", rate=Decimal("7.00"))
    inquiry = make_inquiry(db_session, mine)
    quotes = generate_quotes(db_session, inquiry.id)  # no today= override, see note above
    pia = next(q for q in quotes if q.carrier == "PIA")
    emirates = next(q for q in quotes if q.carrier == "EMIRATES")
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.post(f"/customer/quotes/{pia.id}/accept", headers=_auth_headers(token))
    assert r.status_code == 200, r.text

    db_session.refresh(emirates)
    assert emirates.superseded_at is not None


def test_customer_cannot_accept_an_already_accepted_quote_twice_from_a_different_quote(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    simple_rate_card(db_session, carrier="PIA", rate=Decimal("5.00"))
    simple_rate_card(db_session, carrier="Emirates SkyCargo", rate=Decimal("7.00"))
    inquiry = make_inquiry(db_session, mine)
    quotes = generate_quotes(db_session, inquiry.id)  # no today= override, see note above
    pia = next(q for q in quotes if q.carrier == "PIA")
    emirates = next(q for q in quotes if q.carrier == "EMIRATES")
    db_session.commit()

    token = _login(client, "orient.traders")
    r1 = client.post(f"/customer/quotes/{pia.id}/accept", headers=_auth_headers(token))
    assert r1.status_code == 200, r1.text

    # Emirates is now superseded -- accepting it should fail, not silently
    # open a second job for the same inquiry.
    r2 = client.post(f"/customer/quotes/{emirates.id}/accept", headers=_auth_headers(token))
    assert r2.status_code == 409, r2.text


def test_invoices_are_scoped_to_the_logged_in_customer(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    someone_else = make_customer(db_session, email="other@example.com")
    company = make_company(db_session)

    my_shipment = _accepted_shipment(db_session, mine)
    other_shipment = _accepted_shipment(db_session, someone_else)
    my_invoice = create_invoice_from_quote(db_session, my_shipment.quote_id, company_id=company.id, today=TODAY)
    other_invoice = create_invoice_from_quote(
        db_session, other_shipment.quote_id, company_id=company.id, today=TODAY
    )
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.get("/customer/invoices", headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()]
    assert my_invoice.id in ids
    assert other_invoice.id not in ids

    r_own = client.get(f"/customer/invoices/{my_invoice.id}", headers=_auth_headers(token))
    assert r_own.status_code == 200, r_own.text

    # A customer can never address another customer's invoice by guessing an id.
    r_other = client.get(f"/customer/invoices/{other_invoice.id}", headers=_auth_headers(token))
    assert r_other.status_code == 404


def test_customer_invoice_detail_never_exposes_supplier_info(client, db_session):
    mine = make_customer_with_portal(db_session, username="orient.traders")
    company = make_company(db_session)
    shipment = _accepted_shipment(
        db_session, mine, supplier_name="Wolmax International", supplier_address="Karachi, Pakistan"
    )
    invoice = create_invoice_from_quote(db_session, shipment.quote_id, company_id=company.id, today=TODAY)
    db_session.commit()

    token = _login(client, "orient.traders")
    r = client.get(f"/customer/invoices/{invoice.id}", headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    body_text = str(r.json())
    assert "Wolmax" not in body_text
    assert "supplier" not in body_text.lower()


def test_worker_token_is_rejected_on_customer_routes(client, db_session):
    from utils.security import create_access_token

    customer = make_customer_with_portal(db_session, username="orient.traders")
    db_session.commit()

    fake_worker_token = create_access_token(customer.id, "worker")
    r = client.get("/customer/shipments", headers=_auth_headers(fake_worker_token))
    assert r.status_code == 401


def test_customer_token_is_rejected_on_worker_routes(client, db_session):
    from utils.security import create_access_token

    customer = make_customer_with_portal(db_session, username="orient.traders")
    db_session.commit()

    fake_customer_token_used_as_worker = create_access_token(customer.id, "customer")
    r = client.get("/worker/queue", headers=_auth_headers(fake_customer_token_used_as_worker))
    assert r.status_code == 401


def test_shipments_requires_authentication(client):
    r = client.get("/customer/shipments")
    assert r.status_code == 401


def test_ops_can_grant_portal_access_and_customer_can_then_log_in(client, db_session, ops_headers):
    customer = make_customer(db_session, email="new-portal@example.com")
    db_session.commit()

    r = client.post(
        f"/customers/{customer.id}/portal-access",
        json={"username": "new.portal.customer", "password": "Customer123!"},
        headers=ops_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["username"] == "new.portal.customer"
    assert r.json()["portal_active"] is True

    login = client.post(
        "/customer/login", json={"username": "new.portal.customer", "password": "Customer123!"}
    )
    assert login.status_code == 200, login.text


def test_ops_can_deactivate_portal_access(client, db_session, ops_headers):
    customer = make_customer_with_portal(db_session, username="orient.traders")
    db_session.commit()

    r = client.patch(f"/customers/{customer.id}/portal-access", json={"is_active": False}, headers=ops_headers)
    assert r.status_code == 200, r.text
    assert r.json()["portal_active"] is False

    login = client.post("/customer/login", json={"username": "orient.traders", "password": "Customer123!"})
    assert login.status_code == 401
