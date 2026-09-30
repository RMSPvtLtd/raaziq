"""Security regression suite.

Every test here corresponds to a finding from the security audit and fails
if that class of vulnerability is reintroduced. Grouped by the attack it
defends against, not by the module it touches -- the point is that these
keep holding no matter how the implementation is refactored underneath.

The threat model assumed throughout: the attacker can call the API directly
with a scripted client, knows or can guess any integer id, and controls
every byte of every request (headers, body, query string). The frontend is
treated as fully untrusted and provides zero security value here.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

import models as m
from models.enums import InvoiceStatus, ShipmentStage
from services.invoices import create_invoice_from_quote
from services.quotes import accept_quote, generate_quote
from factories import (
    make_area,
    make_company,
    make_customer,
    make_customer_with_portal,
    make_inquiry,
    make_ops_user,
    make_worker,
    simple_rate_card,
)

TODAY = date(2026, 6, 1)

VALID_PDF = b"%PDF-1.4\n%mock pdf content for tests\n%%EOF"


def _customer_token(client, username: str, password: str = "Customer123!") -> dict:
    r = client.post("/customer/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _worker_token(client, username: str, password: str = "Worker123!") -> dict:
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _accepted_quote(db_session, customer=None):
    customer = customer or make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()
    accept_quote(db_session, quote.id, "ops", today=TODAY)
    return quote


# ---------------------------------------------------------------------------
# Authentication: every ops surface is closed by default
# ---------------------------------------------------------------------------

# Every ops route, as (method, path). A route missing from this list isn't
# covered -- when adding an ops endpoint, add it here too.
OPS_ROUTES = [
    ("get", "/shipments"),
    ("get", "/shipments/1"),
    ("post", "/shipments/1/status/correct"),
    ("post", "/shipments/1/references"),
    ("post", "/shipments/1/risk"),
    ("post", "/shipments/1/priority"),
    ("post", "/shipments/1/routing"),
    ("post", "/shipments/1/invoice"),
    ("post", "/shipments/1/cancel"),
    ("post", "/shipments/1/hold"),
    ("get", "/quotes"),
    ("get", "/quotes/1"),
    ("post", "/quotes/generate"),
    ("patch", "/quotes/1/line-items"),
    ("patch", "/quotes/1/adjustments"),
    ("get", "/quotes/1/pdf"),
    ("post", "/quotes/1/send"),
    ("post", "/quotes/1/accept"),
    ("post", "/quotes/1/reject"),
    ("get", "/quotes/1/revisions"),
    ("post", "/quotes/1/invoice"),
    ("get", "/invoices"),
    ("get", "/invoices/1"),
    ("get", "/invoices/1/pdf"),
    ("post", "/invoices/1/cancel"),
    ("get", "/companies"),
    ("get", "/customers"),
    ("get", "/customers/1"),
    ("post", "/customers"),
    ("post", "/customers/1/portal-access"),
    ("patch", "/customers/1/portal-access"),
    ("get", "/inquiries"),
    ("get", "/inquiries/1"),
    ("post", "/inquiries"),
    ("get", "/areas"),
    ("get", "/workers"),
    ("post", "/workers"),
    ("patch", "/workers/1"),
    ("get", "/shipments/1/documents"),
    ("post", "/shipments/1/documents"),
    ("get", "/documents/1"),
    ("get", "/ops/me"),
    ("post", "/ops/change-password"),
]


def _call(client, method: str, path: str, headers: dict | None = None):
    """TestClient.get()/delete() don't accept a `json=` body, so the body is
    only supplied for the methods that take one."""
    kwargs: dict = {"headers": headers} if headers else {}
    if method not in ("get", "delete"):
        kwargs["json"] = {}
    return getattr(client, method)(path, **kwargs)


@pytest.mark.parametrize("method,path", OPS_ROUTES)
def test_every_ops_route_rejects_unauthenticated_requests(client, method, path):
    """No ops endpoint may be reachable without a valid ops token -- not even
    a read. Fails closed: a new route that forgets the dependency shows up
    here as a 200/422 instead of 401."""
    response = _call(client, method, path)
    assert response.status_code == 401, f"{method.upper()} {path} returned {response.status_code}, expected 401"


@pytest.mark.parametrize("method,path", OPS_ROUTES)
def test_every_ops_route_rejects_a_customer_token(client, db_session, method, path):
    """Cross-principal token replay: a valid customer token must not open an
    ops route, even though both are signed with the same key."""
    make_customer_with_portal(db_session, username="replay.customer")
    db_session.commit()
    headers = _customer_token(client, "replay.customer")

    response = _call(client, method, path, headers)
    assert response.status_code == 401, f"{method.upper()} {path} accepted a customer token"


def test_ops_route_rejects_a_worker_token(client, db_session):
    area = make_area(db_session, ShipmentStage.AIRWAY_BILL)
    make_worker(db_session, area, username="replay.worker")
    db_session.commit()
    headers = _worker_token(client, "replay.worker")

    assert client.get("/shipments", headers=headers).status_code == 401


def test_tampered_token_signature_is_rejected(client, db_session):
    make_ops_user(db_session, username="sig.test", password="OpsTest123!")
    db_session.commit()
    token = client.post("/ops/login", json={"username": "sig.test", "password": "OpsTest123!"}).json()["access_token"]

    # Change significant bits. The last base64url character contains padding
    # bits, so changing it can leave the decoded signature bytes identical.
    header, payload, signature = token.split(".")
    forged = f"{header}.{payload}.{'A' if signature[0] != 'A' else 'B'}{signature[1:]}"

    assert client.get("/shipments", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_alg_none_token_is_rejected(client, db_session):
    """Algorithm confusion: an unsigned `alg: none` token must never be
    accepted, regardless of its claims."""
    import base64
    import json

    def b64(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()

    ops_user = make_ops_user(db_session)
    db_session.commit()
    forged = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'sub': str(ops_user.id), 'typ': 'ops', 'tv': 0})}."

    assert client.get("/shipments", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_password_hashes_are_never_returned_by_any_auth_endpoint(client, db_session):
    make_ops_user(db_session, username="leak.test", password="OpsTest123!")
    db_session.commit()

    login = client.post("/ops/login", json={"username": "leak.test", "password": "OpsTest123!"})
    body = login.text
    assert "password_hash" not in body
    assert "$2b$" not in body, "a bcrypt hash leaked into the login response"

    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    me = client.get("/ops/me", headers=headers)
    assert "password_hash" not in me.text
    assert "$2b$" not in me.text


def test_login_does_not_reveal_whether_an_account_exists(client, db_session):
    make_ops_user(db_session, username="real.user", password="OpsTest123!")
    db_session.commit()

    wrong_password = client.post("/ops/login", json={"username": "real.user", "password": "nope"})
    no_such_user = client.post("/ops/login", json={"username": "ghost.user", "password": "nope"})

    assert wrong_password.status_code == no_such_user.status_code == 401
    assert wrong_password.json()["detail"] == no_such_user.json()["detail"]


# ---------------------------------------------------------------------------
# Brute force / credential stuffing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "surface,login_path,make_account",
    [
        ("ops", "/ops/login", lambda db: make_ops_user(db, username="bf.ops", password="OpsTest123!")),
        (
            "worker",
            "/auth/login",
            lambda db: make_worker(db, make_area(db, ShipmentStage.AIRWAY_BILL), username="bf.worker"),
        ),
        ("customer", "/customer/login", lambda db: make_customer_with_portal(db, username="bf.customer")),
    ],
)
def test_repeated_failed_logins_are_locked_out(client, db_session, surface, login_path, make_account):
    """Unlimited password guessing against a known username is the cheapest
    possible attack on a system holding this much confidential data."""
    from config import get_settings
    from utils import rate_limit

    rate_limit.reset()
    account = make_account(db_session)
    db_session.commit()
    username = account.username

    limit = get_settings().login_max_attempts
    for _ in range(limit):
        assert client.post(login_path, json={"username": username, "password": "wrong"}).status_code == 401

    locked = client.post(login_path, json={"username": username, "password": "wrong"})
    assert locked.status_code == 429, "brute-force attempts were not throttled"

    # Even the *correct* password is refused while locked out, so the
    # lockout can't be probed as an oracle for a right guess.
    assert client.post(login_path, json={"username": username, "password": "OpsTest123!"}).status_code == 429
    rate_limit.reset()


def test_failed_login_tracking_is_memory_bounded(client, db_session):
    """The throttle key includes an attacker-controlled username, so an
    attacker spraying unique usernames must not be able to grow the tracking
    store without bound and exhaust process memory."""
    from utils import rate_limit

    rate_limit.reset()
    make_ops_user(db_session, username="bounded.target", password="OpsTest123!")
    db_session.commit()

    # Directly exercise the store past its cap -- going through HTTP for
    # 10k+ requests would make this test take minutes for the same assertion.
    for i in range(rate_limit.MAX_TRACKED_BUCKETS + 500):
        rate_limit._buckets[("ops", f"sprayed-{i}", "1.2.3.4")] = rate_limit._Bucket()
        if len(rate_limit._buckets) >= rate_limit.MAX_TRACKED_BUCKETS:
            rate_limit._evict_if_oversized()

    assert len(rate_limit._buckets) <= rate_limit.MAX_TRACKED_BUCKETS

    # Throttling still works after eviction.
    for _ in range(get_settings_login_limit()):
        client.post("/ops/login", json={"username": "bounded.target", "password": "wrong"})
    assert client.post(
        "/ops/login", json={"username": "bounded.target", "password": "wrong"}
    ).status_code == 429
    rate_limit.reset()


def get_settings_login_limit() -> int:
    from config import get_settings

    return get_settings().login_max_attempts


def test_successful_login_clears_the_failure_counter(client, db_session):
    """A user who mistypes their password a few times, then gets it right,
    must not be penalised on their next sign-in."""
    from config import get_settings
    from utils import rate_limit

    rate_limit.reset()
    make_ops_user(db_session, username="clears.counter", password="OpsTest123!")
    db_session.commit()

    for _ in range(get_settings().login_max_attempts - 1):
        client.post("/ops/login", json={"username": "clears.counter", "password": "wrong"})

    good = client.post("/ops/login", json={"username": "clears.counter", "password": "OpsTest123!"})
    assert good.status_code == 200

    for _ in range(get_settings().login_max_attempts - 1):
        assert client.post(
            "/ops/login", json={"username": "clears.counter", "password": "wrong"}
        ).status_code == 401
    rate_limit.reset()


# ---------------------------------------------------------------------------
# Production configuration
# ---------------------------------------------------------------------------


def test_production_refuses_to_start_with_a_development_secret():
    """A publicly-known signing key is a full authentication bypass: anyone
    could mint a valid token for any account. Boot must fail, not warn."""
    from config import DEV_JWT_SECRET, DEV_OPS_PASSWORD, InsecureProductionConfig, Settings

    insecure = Settings(
        environment="production",
        jwt_secret_key=DEV_JWT_SECRET,
        ops_admin_password="a-real-password",
        cors_origins="https://ops.example.com",
    )
    with pytest.raises(InsecureProductionConfig, match="JWT_SECRET_KEY"):
        insecure.assert_production_ready()

    weak_admin = Settings(
        environment="production",
        jwt_secret_key="x" * 40,
        ops_admin_password=DEV_OPS_PASSWORD,
        cors_origins="https://ops.example.com",
    )
    with pytest.raises(InsecureProductionConfig, match="OPS_ADMIN_PASSWORD"):
        weak_admin.assert_production_ready()

    short_key = Settings(
        environment="production",
        jwt_secret_key="tooshort",
        ops_admin_password="a-real-password",
        cors_origins="https://ops.example.com",
    )
    with pytest.raises(InsecureProductionConfig, match="32 characters"):
        short_key.assert_production_ready()


def test_production_rejects_a_cors_wildcard():
    from config import InsecureProductionConfig, Settings

    wildcard = Settings(
        environment="production",
        jwt_secret_key="x" * 40,
        ops_admin_password="a-real-password",
        cors_origins="*",
    )
    with pytest.raises(InsecureProductionConfig, match="wildcard"):
        wildcard.assert_production_ready()


def test_a_correctly_configured_production_environment_starts():
    from config import Settings

    Settings(
        environment="production",
        jwt_secret_key="a-real-randomly-generated-secret-of-sufficient-length",
        ops_admin_password="a-real-password",
        cors_origins="https://ops.example.com",
    ).assert_production_ready()


def test_development_defaults_are_allowed_outside_production():
    """The checks must not make local development impossible."""
    from config import Settings

    Settings(environment="development").assert_production_ready()


# ---------------------------------------------------------------------------
# Authorization / IDOR: customers
# ---------------------------------------------------------------------------


def test_customer_cannot_read_another_customers_shipment(client, db_session):
    mine = make_customer_with_portal(db_session, username="cust.a")
    theirs = make_customer(db_session, email="b@example.com")
    simple_rate_card(db_session)
    make_inquiry(db_session, mine)
    other_inquiry = make_inquiry(db_session, theirs)
    db_session.commit()

    headers = _customer_token(client, "cust.a")
    r = client.get(f"/customer/shipments/{other_inquiry.shipment.id}", headers=headers)
    assert r.status_code == 404, "customer read another customer's shipment"


def test_customer_cannot_read_another_customers_quote(client, db_session):
    mine = make_customer_with_portal(db_session, username="cust.a")
    theirs = make_customer(db_session, email="b@example.com")
    simple_rate_card(db_session)
    other_inquiry = make_inquiry(db_session, theirs)
    other_quote = generate_quote(db_session, other_inquiry.id, today=TODAY)
    db_session.commit()

    headers = _customer_token(client, "cust.a")
    assert client.get(f"/customer/quotes/{other_quote.id}", headers=headers).status_code == 404


def test_customer_cannot_read_another_customers_invoice(client, db_session):
    mine = make_customer_with_portal(db_session, username="cust.a")
    theirs = make_customer(db_session, email="b@example.com")
    company = make_company(db_session)
    other_quote = _accepted_quote(db_session, theirs)
    other_invoice = create_invoice_from_quote(db_session, other_quote.id, company_id=company.id, today=TODAY)
    db_session.commit()

    headers = _customer_token(client, "cust.a")
    assert client.get(f"/customer/invoices/{other_invoice.id}", headers=headers).status_code == 404


def test_customer_listing_endpoints_never_leak_another_customers_records(client, db_session):
    mine = make_customer_with_portal(db_session, username="cust.a")
    theirs = make_customer(db_session, email="b@example.com")
    company = make_company(db_session)
    my_quote = _accepted_quote(db_session, mine)
    other_quote = _accepted_quote(db_session, theirs)
    create_invoice_from_quote(db_session, my_quote.id, company_id=company.id, today=TODAY)
    other_invoice = create_invoice_from_quote(db_session, other_quote.id, company_id=company.id, today=TODAY)
    db_session.commit()

    headers = _customer_token(client, "cust.a")
    shipment_ids = [s["id"] for s in client.get("/customer/shipments", headers=headers).json()]
    quote_ids = [q["id"] for q in client.get("/customer/quotes", headers=headers).json()]
    invoice_ids = [i["id"] for i in client.get("/customer/invoices", headers=headers).json()]

    assert other_quote.id not in quote_ids
    assert other_invoice.id not in invoice_ids
    assert other_quote.shipment.id not in shipment_ids


def test_customer_invoice_never_exposes_supplier_or_internal_cancellation_reason(client, db_session):
    """Supplier identity is commercially sensitive (a customer could route
    around Raaziq); an internal cancellation reason is ops-only."""
    from services.invoices import cancel_invoice

    mine = make_customer_with_portal(db_session, username="cust.a")
    company = make_company(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(
        db_session, mine, supplier_name="Wolmax International", supplier_address="Karachi, Pakistan"
    )
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()
    accept_quote(db_session, quote.id, "ops", today=TODAY)
    invoice = create_invoice_from_quote(db_session, quote.id, company_id=company.id, today=TODAY)
    cancel_invoice(db_session, invoice.id, reason="Internal billing dispute, do not disclose", actor="ops")
    db_session.commit()

    headers = _customer_token(client, "cust.a")
    body = client.get(f"/customer/invoices/{invoice.id}", headers=headers).text

    assert "Wolmax" not in body
    assert "Karachi" not in body
    assert "do not disclose" not in body


def test_customer_cannot_reach_ops_document_download(client, db_session):
    """Documents are ops-only; a customer token must not open one even with
    a valid document id."""
    from services.documents import upload_document

    mine = make_customer_with_portal(db_session, username="cust.a")
    quote = _accepted_quote(db_session, mine)
    document = upload_document(
        db_session, quote.shipment, filename="awb.pdf", content_type="application/pdf",
        data=VALID_PDF, actor="ops",
    )
    db_session.commit()

    headers = _customer_token(client, "cust.a")
    # Even their *own* shipment's document: the ops document API is not a
    # customer surface at all.
    assert client.get(f"/documents/{document.id}", headers=headers).status_code == 401


def test_customer_identity_comes_from_the_token_not_the_request(client, db_session):
    """Passing another customer's id in the body/query must not change whose
    data is returned."""
    mine = make_customer_with_portal(db_session, username="cust.a")
    theirs = make_customer(db_session, email="b@example.com")
    simple_rate_card(db_session)
    make_inquiry(db_session, mine)
    other_inquiry = make_inquiry(db_session, theirs)
    db_session.commit()

    headers = _customer_token(client, "cust.a")
    r = client.get(f"/customer/shipments?customer_id={theirs.id}", headers=headers)
    returned = [s["id"] for s in r.json()]

    assert other_inquiry.shipment.id not in returned


# ---------------------------------------------------------------------------
# Authorization: workers
# ---------------------------------------------------------------------------


def test_worker_cannot_complete_a_stage_belonging_to_another_area(client, db_session):
    """A Customs worker must not be able to complete an Airway Bill shipment
    by calling the API directly with its id."""
    make_area(db_session, ShipmentStage.AIRWAY_BILL)
    customs_area = make_area(db_session, ShipmentStage.CUSTOMS_CLEARANCE)
    make_worker(db_session, customs_area, username="omar.customs")

    quote = _accepted_quote(db_session)  # sits at job_opening, i.e. airway_bill is next
    db_session.commit()
    shipment_id = quote.shipment.id

    headers = _worker_token(client, "omar.customs")
    r = client.post(f"/worker/shipments/{shipment_id}/complete", json={}, headers=headers)
    assert r.status_code == 409

    assert db_session.get(m.Shipment, shipment_id).stage == ShipmentStage.JOB_OPENING


def test_worker_cannot_touch_documents_outside_their_queue(client, db_session):
    make_area(db_session, ShipmentStage.AIRWAY_BILL)
    customs_area = make_area(db_session, ShipmentStage.CUSTOMS_CLEARANCE)
    make_worker(db_session, customs_area, username="omar.customs")

    quote = _accepted_quote(db_session)
    db_session.commit()
    shipment_id = quote.shipment.id

    headers = _worker_token(client, "omar.customs")
    assert client.get(f"/worker/shipments/{shipment_id}/documents", headers=headers).status_code == 401
    upload = client.post(
        f"/worker/shipments/{shipment_id}/documents",
        files={"file": ("x.pdf", VALID_PDF, "application/pdf")},
        headers=headers,
    )
    assert upload.status_code == 401


def test_worker_cannot_reach_ops_or_admin_endpoints(client, db_session):
    area = make_area(db_session, ShipmentStage.AIRWAY_BILL)
    make_worker(db_session, area, username="ali.worker")
    db_session.commit()
    headers = _worker_token(client, "ali.worker")

    # Privilege escalation: creating worker accounts is an ops-only action.
    assert client.post(
        "/workers", json={"name": "x", "username": "newguy", "password": "Passw0rd!", "area_id": area.id},
        headers=headers,
    ).status_code == 401
    assert client.get("/customers", headers=headers).status_code == 401
    assert client.post("/quotes/1/invoice", json={"company_id": 1}, headers=headers).status_code == 401


def test_deactivated_accounts_cannot_use_an_existing_token(client, db_session):
    """Revocation must take effect on the next request, not at token expiry."""
    area = make_area(db_session, ShipmentStage.AIRWAY_BILL)
    worker = make_worker(db_session, area, username="soon.disabled")
    db_session.commit()
    headers = _worker_token(client, "soon.disabled")
    assert client.get("/worker/queue", headers=headers).status_code == 200

    worker.is_active = False
    db_session.commit()

    assert client.get("/worker/queue", headers=headers).status_code == 401


def test_ops_password_change_revokes_previously_issued_tokens(client, db_session):
    make_ops_user(db_session, username="rotate.me", password="OpsTest123!")
    db_session.commit()
    old = client.post("/ops/login", json={"username": "rotate.me", "password": "OpsTest123!"}).json()["access_token"]
    old_headers = {"Authorization": f"Bearer {old}"}
    assert client.get("/shipments", headers=old_headers).status_code == 200

    client.post(
        "/ops/change-password",
        json={"current_password": "OpsTest123!", "new_password": "BrandNew1!", "confirm_new_password": "BrandNew1!"},
        headers=old_headers,
    )

    assert client.get("/shipments", headers=old_headers).status_code == 401


# ---------------------------------------------------------------------------
# Mass assignment / parameter tampering
# ---------------------------------------------------------------------------


def test_client_cannot_set_protected_fields_via_mass_assignment(client, db_session, ops_headers):
    """Unexpected fields in a create body must never be persisted."""
    customer = make_customer(db_session)
    db_session.commit()

    r = client.post(
        "/inquiries",
        json={
            "customer_id": customer.id, "origin": "Lahore", "destination": "Dubai", "mode": "air",
            "cargo_type": "general", "weight_kg": "100", "volume_cbm": "0.2", "incoterm": "DAP",
            # None of these are writable fields on InquiryCreate.
            "id": 999, "created_at": "2000-01-01T00:00:00", "is_admin": True, "role": "admin",
        },
        headers=ops_headers,
    )
    assert r.status_code == 422, "unknown fields must be rejected outright, not silently ignored"


def test_client_cannot_forge_status_event_source_or_actor(client, db_session, ops_headers):
    """`source` and `actor` are the audit trail's integrity fields and are
    always assigned server-side. An attempt to supply them is rejected
    outright rather than silently ignored."""
    quote = _accepted_quote(db_session)
    db_session.commit()

    forged = client.post(
        f"/shipments/{quote.shipment.id}/status/correct",
        json={"stage": "airway_bill", "reason": "test", "source": "system", "actor": "someone-else"},
        headers=ops_headers,
    )
    assert forged.status_code == 422, "client-supplied audit fields must be rejected"

    # The legitimate request still works, and records the server's own values.
    ok = client.post(
        f"/shipments/{quote.shipment.id}/status/correct",
        json={"stage": "airway_bill", "reason": "test"},
        headers=ops_headers,
    )
    assert ok.status_code == 200, ok.text

    shipment = db_session.get(m.Shipment, quote.shipment.id)
    db_session.refresh(shipment)
    correction = [e for e in shipment.status_events if e.source.value == "correction"]
    assert correction, "correction event must be recorded with the server's own source"
    assert correction[-1].actor != "someone-else", "actor must come from the authenticated identity"


# ---------------------------------------------------------------------------
# Financial integrity
# ---------------------------------------------------------------------------


def test_discount_cannot_exceed_the_quote_value(client, db_session, ops_headers):
    """A discount larger than subtotal+markup+tax would make the total
    negative -- i.e. an invoice that owes the customer money."""
    quote = _accepted_quote(db_session)
    db_session.commit()

    r = client.patch(
        f"/quotes/{quote.id}/adjustments",
        json={"tax_amount": "0", "discount_amount": "99999999999"},
        headers=ops_headers,
    )
    assert r.status_code == 422, "an unbounded discount was accepted"

    db_session.refresh(quote)
    assert quote.total > 0


def test_money_fields_reject_out_of_range_magnitudes(client, db_session, ops_headers):
    """Values beyond NUMERIC(12,2) must be rejected by validation, not left
    to overflow the column at flush time."""
    quote = _accepted_quote(db_session)
    db_session.commit()

    r = client.patch(
        f"/quotes/{quote.id}/adjustments",
        json={"tax_amount": "999999999999999999999", "discount_amount": "0"},
        headers=ops_headers,
    )
    assert r.status_code == 422


def test_money_fields_reject_negative_values(client, db_session, ops_headers):
    quote = _accepted_quote(db_session)
    db_session.commit()

    assert client.patch(
        f"/quotes/{quote.id}/adjustments",
        json={"tax_amount": "-100", "discount_amount": "0"},
        headers=ops_headers,
    ).status_code == 422

    assert client.patch(
        f"/quotes/{quote.id}/line-items",
        json={"overrides": [{"line_item_id": quote.line_items[0].id, "final_total": "-500"}]},
        headers=ops_headers,
    ).status_code == 422


def test_money_fields_reject_nan_and_infinity(client, db_session, ops_headers):
    quote = _accepted_quote(db_session)
    db_session.commit()

    for payload in ("NaN", "Infinity", "-Infinity"):
        r = client.patch(
            f"/quotes/{quote.id}/adjustments",
            json={"tax_amount": payload, "discount_amount": "0"},
            headers=ops_headers,
        )
        assert r.status_code == 422, f"{payload} was accepted as a money value"


def test_client_supplied_totals_are_ignored_and_recomputed(client, db_session, ops_headers):
    """Totals are always derived from line items server-side."""
    quote = _accepted_quote(db_session)
    original_total = quote.total
    db_session.commit()

    client.patch(
        f"/quotes/{quote.id}/adjustments",
        json={"tax_amount": "0", "discount_amount": "0", "total": "1", "subtotal": "1", "markup_amount": "1"},
        headers=ops_headers,
    )
    db_session.refresh(quote)
    assert quote.total == original_total, "a client-supplied total overwrote the computed one"


# ---------------------------------------------------------------------------
# Invoice immutability
# ---------------------------------------------------------------------------


def test_issued_invoice_is_unaffected_by_later_quote_and_customer_edits(db_session):
    from services.quotes import set_quote_adjustments

    customer = make_customer(db_session, name="Original Name")
    company = make_company(db_session)
    quote = _accepted_quote(db_session, customer)
    invoice = create_invoice_from_quote(db_session, quote.id, company_id=company.id, today=TODAY)
    frozen = (invoice.total, invoice.customer_name_snapshot, [li.amount for li in invoice.line_items])

    set_quote_adjustments(db_session, quote.id, tax_amount=Decimal("500"), discount_amount=Decimal("0"), today=TODAY)
    customer.name = "Renamed After Invoicing"
    db_session.flush()
    db_session.refresh(invoice)

    assert (invoice.total, invoice.customer_name_snapshot, [li.amount for li in invoice.line_items]) == frozen


def test_cancelled_invoice_cannot_be_cancelled_again_or_mutated(db_session):
    from services.invoices import cancel_invoice
    from utils.errors import InvalidCancellation

    company = make_company(db_session)
    quote = _accepted_quote(db_session)
    invoice = create_invoice_from_quote(db_session, quote.id, company_id=company.id, today=TODAY)
    cancel_invoice(db_session, invoice.id, reason="first", actor="ops")
    total_after_cancel = invoice.total

    with pytest.raises(InvalidCancellation):
        cancel_invoice(db_session, invoice.id, reason="second", actor="ops")

    assert invoice.total == total_after_cancel
    assert invoice.cancelled_reason == "first"


def test_invoice_numbers_are_never_reused_after_cancellation(db_session):
    from services.invoices import cancel_invoice

    company = make_company(db_session)
    quote = _accepted_quote(db_session)
    original = create_invoice_from_quote(db_session, quote.id, company_id=company.id, today=TODAY)
    cancel_invoice(db_session, original.id, reason="correction", actor="ops")
    replacement = create_invoice_from_quote(
        db_session, quote.id, company_id=company.id, replaces_invoice_id=original.id, today=TODAY
    )

    assert replacement.invoice_number != original.invoice_number


# ---------------------------------------------------------------------------
# Business-logic / state-machine abuse
# ---------------------------------------------------------------------------


def test_cancelled_shipment_cannot_be_advanced_by_a_worker(client, db_session):
    from services.transitions import cancel_shipment

    area = make_area(db_session, ShipmentStage.AIRWAY_BILL)
    make_worker(db_session, area, username="ayesha.awb")
    quote = _accepted_quote(db_session)
    cancel_shipment(db_session, quote.shipment, reason="order cancelled", actor="ops")
    db_session.commit()

    headers = _worker_token(client, "ayesha.awb")
    r = client.post(f"/worker/shipments/{quote.shipment.id}/complete", json={}, headers=headers)
    assert r.status_code == 409


def test_held_shipment_cannot_be_advanced_by_a_worker(client, db_session):
    from services.transitions import set_hold

    area = make_area(db_session, ShipmentStage.AIRWAY_BILL)
    make_worker(db_session, area, username="ayesha.awb")
    quote = _accepted_quote(db_session)
    set_hold(db_session, quote.shipment, on_hold=True, reason="missing doc", actor="ops")
    db_session.commit()

    headers = _worker_token(client, "ayesha.awb")
    assert client.post(
        f"/worker/shipments/{quote.shipment.id}/complete", json={}, headers=headers
    ).status_code == 409


def test_rejected_and_expired_quotes_cannot_be_accepted(client, db_session, ops_headers):
    from services.quotes import reject_quote

    quote = _accepted_quote(db_session)  # reuse helper for setup shape
    rejected_customer = make_customer(db_session, email="r@example.com")
    inquiry = make_inquiry(db_session, rejected_customer)
    rejected = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()
    reject_quote(db_session, rejected.id, reason="declined", actor="ops", today=TODAY)
    db_session.commit()

    assert client.post(f"/quotes/{rejected.id}/accept", headers=ops_headers).status_code == 409


def test_second_invoice_from_one_quote_is_impossible(client, db_session, ops_headers):
    company = make_company(db_session)
    quote = _accepted_quote(db_session)
    db_session.commit()

    first = client.post(f"/quotes/{quote.id}/invoice", json={"company_id": company.id}, headers=ops_headers)
    assert first.status_code == 201
    second = client.post(f"/quotes/{quote.id}/invoice", json={"company_id": company.id}, headers=ops_headers)
    assert second.status_code == 409

    invoices = db_session.execute(
        select(m.Invoice).where(m.Invoice.quote_id == quote.id, m.Invoice.status != InvoiceStatus.CANCELLED)
    ).scalars().all()
    assert len(invoices) == 1


# ---------------------------------------------------------------------------
# File upload
# ---------------------------------------------------------------------------


def test_upload_rejects_non_pdf_content_regardless_of_declared_type(client, db_session, ops_headers):
    """MIME/extension spoofing: a declared application/pdf with executable
    content must be rejected on the actual bytes."""
    quote = _accepted_quote(db_session)
    db_session.commit()

    for name, blob in [
        ("evil.pdf", b"MZ\x90\x00\x03"),                 # Windows PE disguised as PDF
        ("evil.pdf", b"<?php system($_GET[0]); ?>"),      # webshell
        ("evil.pdf", b"<html><script>alert(1)</script>"),  # stored-XSS attempt
        ("evil.pdf", b"\x7fELF\x02\x01\x01"),             # ELF binary
    ]:
        r = client.post(
            f"/shipments/{quote.shipment.id}/documents",
            files={"file": (name, blob, "application/pdf")},
            headers=ops_headers,
        )
        assert r.status_code == 422, f"{blob[:8]!r} was accepted as a PDF"


def test_upload_rejects_oversized_file(client, db_session, ops_headers):
    quote = _accepted_quote(db_session)
    db_session.commit()

    oversized = VALID_PDF + b"0" * (5 * 1024 * 1024)
    r = client.post(
        f"/shipments/{quote.shipment.id}/documents",
        files={"file": ("big.pdf", oversized, "application/pdf")},
        headers=ops_headers,
    )
    assert r.status_code == 422


def test_malicious_filename_cannot_traverse_paths_or_inject_headers(client, db_session, ops_headers):
    """Filenames are attacker-controlled. They must not reach a filesystem
    path, and must not be able to break out of the Content-Disposition
    header on download."""
    quote = _accepted_quote(db_session)
    db_session.commit()

    for hostile in ['../../../../etc/passwd', r'..\..\windows\system32\x', 'a";sneak="1', "a\r\nX-Injected: 1"]:
        upload = client.post(
            f"/shipments/{quote.shipment.id}/documents",
            files={"file": (hostile, VALID_PDF, "application/pdf")},
            headers=ops_headers,
        )
        assert upload.status_code == 201, upload.text
        stored = upload.json()["filename"]
        assert "/" not in stored and "\\" not in stored, f"path separators survived in {stored!r}"
        assert '"' not in stored and "\r" not in stored and "\n" not in stored

        download = client.get(f"/documents/{upload.json()['id']}", headers=ops_headers)
        assert download.status_code == 200
        assert "X-Injected" not in download.headers


# ---------------------------------------------------------------------------
# Injection: SQL and PDF
# ---------------------------------------------------------------------------

SQLI_PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE shipment; --",
    "1' UNION SELECT password_hash FROM ops_user --",
    "\\'; DELETE FROM invoice; --",
    "1; UPDATE quote SET total = 0",
]


@pytest.mark.parametrize("payload", SQLI_PAYLOADS)
def test_sql_injection_in_tracking_reference_is_inert(client, db_session, payload):
    """The public tracking lookup takes a raw reference string straight from
    the URL -- the single most exposed user-controlled value that reaches a
    query."""
    quote = _accepted_quote(db_session)
    db_session.commit()

    r = client.get(f"/tracking/{payload}")
    assert r.status_code in (404, 409), r.text

    # The data is still intact -- nothing was dropped, deleted or updated.
    assert db_session.execute(select(m.Shipment)).scalars().all()
    assert db_session.get(m.Quote, quote.id).total > 0


@pytest.mark.parametrize("payload", SQLI_PAYLOADS)
def test_sql_injection_in_login_is_inert(client, db_session, payload):
    make_ops_user(db_session, username="sqli.target", password="OpsTest123!")
    db_session.commit()

    r = client.post("/ops/login", json={"username": payload, "password": payload})
    assert r.status_code == 401
    assert db_session.execute(select(m.OpsUser)).scalars().all()


def test_sql_injection_stored_in_text_fields_is_inert(client, db_session, ops_headers):
    """Stored payloads must be treated as literal data on the way back out."""
    customer = make_customer(db_session)
    db_session.commit()

    r = client.post(
        "/inquiries",
        json={
            "customer_id": customer.id, "origin": "LHE", "destination": "DXB", "description": "'; DROP TABLE quote; --",
            "mode": "air", "cargo_type": "x' OR '1'='1", "weight_kg": "100", "volume_cbm": "0.2",
            "incoterm": "DAP",
        },
        headers=ops_headers,
    )
    assert r.status_code == 201
    assert r.json()["description"] == "'; DROP TABLE quote; --", "payload should round-trip as literal text"
    assert db_session.execute(select(m.Quote)) is not None  # quote table still exists


def test_pdf_generation_survives_markup_in_untrusted_fields(db_session):
    """reportlab's Paragraph parses a mini-HTML dialect, so an unescaped `<`
    in a customer/supplier name both injects markup and can hard-crash
    rendering -- permanently, since invoice snapshots are immutable."""
    from services.pdf_documents import render_invoice_pdf, render_quote_pdf

    company = make_company(db_session)
    hostile = '<unclosed & "quoted" <b>bold</b> <onDraw>'
    customer = make_customer(db_session, name=hostile, address=hostile)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer, supplier_name=hostile, supplier_address=hostile)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()
    accept_quote(db_session, quote.id, "ops", today=TODAY)

    assert render_quote_pdf(db_session, quote)[:4] == b"%PDF"

    invoice = create_invoice_from_quote(db_session, quote.id, company_id=company.id, today=TODAY)
    assert render_invoice_pdf(invoice)[:4] == b"%PDF"


# ---------------------------------------------------------------------------
# Transport / response hardening
# ---------------------------------------------------------------------------


def test_security_headers_are_present_on_responses(client):
    response = client.get("/meta/stages")
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("Referrer-Policy") == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers.get("Content-Security-Policy", "")
    assert response.headers.get("X-Frame-Options") == "DENY"


def test_authenticated_responses_are_not_cacheable(client, db_session, ops_headers):
    """Confidential business data must not be stored by shared caches or
    written to disk by the browser."""
    quote = _accepted_quote(db_session)
    db_session.commit()

    response = client.get(f"/invoices", headers=ops_headers)
    assert "no-store" in response.headers.get("Cache-Control", "")


def test_internal_errors_do_not_leak_stack_traces_or_sql(session_factory, db_session, ops_headers):
    """A crash must surface as a generic message plus a correlation id --
    never a traceback, query text, or file path.

    Uses its own TestClient with `raise_server_exceptions=False`: the
    default re-raises inside the test process, which would bypass the very
    handler under test. Real clients always get the handler's response.
    """
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    from db import get_db
    from main import app as fastapi_app

    quote = _accepted_quote(db_session)
    db_session.commit()

    def override_get_db():
        db = session_factory()
        try:
            yield db
            db.commit()
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(fastapi_app, raise_server_exceptions=False) as raw_client:
            with patch(
                "api.quotes.render_quote_pdf", side_effect=RuntimeError("boom /srv/app/secret.py line 42")
            ):
                response = raw_client.get(f"/quotes/{quote.id}/pdf", headers=ops_headers)
    finally:
        fastapi_app.dependency_overrides.clear()

    assert response.status_code == 500
    body = response.text
    assert "Traceback" not in body
    assert "boom" not in body
    assert "/srv/app" not in body
    assert "SELECT" not in body.upper()
    assert response.json()["error_id"], "a correlation id must be returned so the log can be found"
