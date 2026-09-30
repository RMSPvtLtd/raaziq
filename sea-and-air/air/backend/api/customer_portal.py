"""The customer-facing surface: a logged-in customer's own shipments and
quotes. Every route requires `get_current_customer`, and every query is
scoped to that customer's id via `services.customers` -- there is no
route here that accepts a customer_id from the request, so one customer can
never address another customer's data by guessing an id.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_db
from utils import rate_limit, security_log
from utils.errors import NotFound, TooManyAttempts, Unauthorized
from models.customer import Customer
from models.invoice import Invoice
from models.quote import Quote
from models.shipment import Shipment
from schemas.auth import LoginRequest
from schemas.customer_portal import (
    CustomerInvoiceDetail,
    CustomerInvoiceSummary,
    CustomerLoginResponse,
    CustomerShipmentSummary,
    customer_invoice_detail,
    customer_invoice_summary,
    shipment_summary,
)
from schemas.customers import CustomerRead
from schemas.customer_quotes import CustomerQuoteRead, customer_quote
from schemas.tracking import TrackingResult, from_shipment
from utils.security import create_access_token, get_current_customer
from services.customers import authenticate_customer, customer_quotes, customer_shipments
from services.quotes import accept_quote

router = APIRouter(prefix="/customer", tags=["customer-portal"])

SURFACE = "customer"


@router.post("/login", response_model=CustomerLoginResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> CustomerLoginResponse:
    ip = rate_limit.client_ip(request)
    try:
        rate_limit.check_not_locked_out(SURFACE, payload.username, request)
    except TooManyAttempts:
        security_log.auth_lockout(surface=SURFACE, username=payload.username, ip=ip)
        raise

    try:
        customer = authenticate_customer(db, payload.username, payload.password)
    except Unauthorized:
        rate_limit.record_failure(SURFACE, payload.username, request)
        security_log.auth_failure(
            surface=SURFACE, username=payload.username, ip=ip, reason="invalid_credentials"
        )
        raise

    rate_limit.record_success(SURFACE, payload.username, request)
    security_log.auth_success(surface=SURFACE, username=customer.username or "", ip=ip)
    token = create_access_token(customer.id, "customer")
    return CustomerLoginResponse(access_token=token, customer=customer)


@router.get("/me", response_model=CustomerRead)
def me(customer: Customer = Depends(get_current_customer)) -> Customer:
    return customer


@router.get("/shipments", response_model=list[CustomerShipmentSummary])
def list_shipments(
    completed: bool | None = None,
    customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
) -> list[CustomerShipmentSummary]:
    return [shipment_summary(s) for s in customer_shipments(db, customer, completed=completed)]


@router.get("/shipments/{shipment_id}", response_model=TrackingResult)
def get_shipment(
    shipment_id: int,
    customer: Customer = Depends(get_current_customer),
    db: Session = Depends(get_db),
) -> TrackingResult:
    shipment = db.get(Shipment, shipment_id)
    if shipment is None or shipment.customer_id != customer.id:
        # Same response for "doesn't exist" and "isn't yours" -- never
        # confirms another customer's shipment id is valid.
        raise NotFound(f"Shipment {shipment_id} not found")
    return from_shipment(shipment)


@router.get("/quotes", response_model=list[CustomerQuoteRead])
def list_quotes(
    customer: Customer = Depends(get_current_customer), db: Session = Depends(get_db)
) -> list[CustomerQuoteRead]:
    return [customer_quote(quote) for quote in customer_quotes(db, customer)]


@router.get("/quotes/{quote_id}", response_model=CustomerQuoteRead)
def get_quote(
    quote_id: int, customer: Customer = Depends(get_current_customer), db: Session = Depends(get_db)
) -> CustomerQuoteRead:
    quote = db.get(Quote, quote_id)
    if quote is None or quote.inquiry.customer_id != customer.id:
        raise NotFound(f"Quote {quote_id} not found")
    return customer_quote(quote)


@router.post("/quotes/{quote_id}/accept", response_model=CustomerShipmentSummary)
def accept_quote_route(
    quote_id: int, customer: Customer = Depends(get_current_customer), db: Session = Depends(get_db)
) -> CustomerShipmentSummary:
    """Lets the customer pick one of the (possibly several, one per carrier)
    quotes offered on their inquiry -- see services.quotes.accept_quote,
    which supersedes every other still-open sibling once one is accepted.
    Reuses the same service function ops uses (POST /quotes/{id}/accept);
    only the authorization scoping and the response shape differ, matching
    every other read route in this router.
    """
    quote = db.get(Quote, quote_id)
    if quote is None or quote.inquiry.customer_id != customer.id:
        raise NotFound(f"Quote {quote_id} not found")
    # actor is stored in a 120-char audit column -- customer.id (not email,
    # unbounded up to 320 chars) keeps this always well within that limit.
    shipment = accept_quote(db, quote_id, actor=f"customer#{customer.id}")
    return shipment_summary(shipment)


@router.get("/invoices", response_model=list[CustomerInvoiceSummary])
def list_invoices(
    customer: Customer = Depends(get_current_customer), db: Session = Depends(get_db)
) -> list[CustomerInvoiceSummary]:
    stmt = select(Invoice).where(Invoice.customer_id == customer.id).order_by(Invoice.id)
    return [customer_invoice_summary(inv) for inv in db.execute(stmt).scalars()]


@router.get("/invoices/{invoice_id}", response_model=CustomerInvoiceDetail)
def get_invoice(
    invoice_id: int, customer: Customer = Depends(get_current_customer), db: Session = Depends(get_db)
) -> CustomerInvoiceDetail:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None or invoice.customer_id != customer.id:
        # Same 404-for-both-cases pattern as get_shipment/get_quote above --
        # never confirms another customer's invoice id is valid.
        raise NotFound(f"Invoice {invoice_id} not found")
    return customer_invoice_detail(invoice)
