"""Turns an accepted Quote into a durable, independent financial record.
`allocate_invoice_number` is the only place that touches
`InvoiceNumberCounter` (mirrors `services.shipments.allocate_job_number`
exactly). `create_invoice_from_quote` is the only writer of `Invoice` and
`InvoiceLineItem` -- everything it copies from the quote/inquiry/shipment/
customer is snapshotted at that moment and never re-read from those tables
again, so editing any of them afterward can't retroactively change a
historical invoice (see `models.invoice.Invoice`'s docstring).

`cancel_invoice` never edits a financial field -- it only ever flips status
and records who/when/why. A cancelled invoice's quote_id is freed up by the
partial unique index on `invoice` (active invoices only), which is what lets
`create_invoice_from_quote` issue a replacement for the same quote afterward.

Every audit note this module writes names the concrete invoice_number
involved (never just "an invoice") -- a shipment can accumulate more than
one Invoice row over its life (original + replacement), so a generic note
would make the audit trail ambiguous exactly where it matters most.
"""

import json
from copy import deepcopy
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import get_settings
from utils.errors import InvalidCancellation, InvalidQuoteState, NotFound
from models.customer import Customer
from models.enums import EventSource, InvoiceStatus, QuoteStatus
from models.invoice import Invoice, InvoiceLineItem, InvoiceNumberCounter
from models.quote import Quote
from services.companies import get_company
from services.email import deliver_document_email
from services.pdf_documents import render_invoice_pdf
from services.pricing import compute_chargeable_weight
from services.transitions import record_note


def _lock_counter_row(session: Session, year: int) -> InvoiceNumberCounter | None:
    stmt = select(InvoiceNumberCounter).where(InvoiceNumberCounter.year == year)
    if session.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    return session.execute(stmt).scalar_one_or_none()


def allocate_invoice_number(session: Session, year: int) -> str:
    settings = get_settings()
    counter = _lock_counter_row(session, year)
    if counter is None:
        counter = InvoiceNumberCounter(year=year, last_value=0)
        session.add(counter)
        session.flush()

    counter.last_value += 1
    session.flush()

    sequence = str(counter.last_value).zfill(settings.invoice_number_padding)
    return f"{settings.invoice_number_prefix}-{year}-{sequence}"


def create_invoice_from_quote(
    session: Session,
    quote_id: int,
    *,
    company_id: int,
    replaces_invoice_id: int | None = None,
    remarks: str | None = None,
    today: date | None = None,
) -> Invoice:
    today = today or date.today()
    settings = get_settings()

    quote = session.get(Quote, quote_id)
    if quote is None:
        raise NotFound(f"Quote {quote_id} not found")
    if quote.status != QuoteStatus.ACCEPTED:
        raise InvalidQuoteState(f"Quote {quote.id} must be accepted before an invoice can be created (status={quote.status.value})")
    active = quote.active_invoice
    if active is not None:
        # Also enforced at the database level by invoice's partial unique
        # index (active invoices only) -- this check just gives a clean,
        # specific error instead of a generic integrity-conflict one on the
        # (rare) race.
        raise InvalidQuoteState(f"Quote {quote.id} already has an active invoice ({active.invoice_number})")

    replaced: Invoice | None = None
    if replaces_invoice_id is not None:
        replaced = session.get(Invoice, replaces_invoice_id)
        if replaced is None or replaced.quote_id != quote.id:
            raise NotFound(f"Invoice {replaces_invoice_id} not found on quote {quote.id}")
        if replaced.status != InvoiceStatus.CANCELLED:
            raise InvalidQuoteState(
                f"Invoice {replaced.invoice_number} must be cancelled before it can be replaced"
            )

    shipment = quote.shipment
    if shipment is None:
        raise NotFound(f"Quote {quote.id} has no shipment to invoice")
    inquiry = quote.inquiry
    customer = shipment.customer

    company = get_company(session, company_id)

    references_snapshot = json.dumps(
        [{"type": ref.type.value, "value": ref.value} for ref in shipment.references]
    )

    invoice = Invoice(
        invoice_number=allocate_invoice_number(session, today.year),
        quote=quote,  # sets quote_id via the relationship (not the raw FK)
        # so quote.invoices is kept in sync at the Python object level too --
        # a plain quote_id=quote.id wouldn't populate the back_populates side,
        # leaving a stale quote.invoices list for the rest of this session.
        shipment_id=shipment.id,
        customer_id=customer.id,
        company_id=company.id,
        replaces_invoice_id=replaced.id if replaced else None,
        issued_date=today,
        currency=quote.currency,
        subtotal=quote.subtotal,
        markup_amount=quote.markup_amount,
        tax_amount=quote.tax_amount,
        discount_amount=quote.discount_amount,
        total=quote.total,
        customer_name_snapshot=customer.name,
        customer_address_snapshot=customer.address,
        supplier_name_snapshot=inquiry.supplier_name,
        supplier_address_snapshot=inquiry.supplier_address,
        origin_snapshot=inquiry.origin,
        destination_snapshot=inquiry.destination,
        mode_snapshot=inquiry.mode.value,
        cargo_type_snapshot=inquiry.cargo_type,
        incoterm_snapshot=inquiry.incoterm,
        hs_code_snapshot=inquiry.hs_code,
        pieces_snapshot=inquiry.pieces,
        weight_kg_snapshot=inquiry.weight_kg,
        volume_cbm_snapshot=inquiry.volume_cbm,
        chargeable_weight_kg_snapshot=compute_chargeable_weight(inquiry, settings),
        carrier_snapshot=quote.carrier or shipment.carrier,
        voyage_flight_number_snapshot=shipment.voyage_flight_number,
        job_number_snapshot=shipment.job_number,
        references_snapshot=references_snapshot,
        remarks=remarks,
        clauses_snapshot=quote.clauses,
        quote_reference_snapshot=f"Q-{quote.root_quote_id or quote.id} REV {quote.revision_number}",
        quote_date_snapshot=quote.created_at.date(),
        quote_valid_until_snapshot=quote.valid_until,
        dimensions_snapshot=inquiry.dimensions,
        description_snapshot=inquiry.description,
        ready_date_snapshot=inquiry.ready_date,
        schedule_snapshot=deepcopy(quote.schedule_snapshot),
    )
    # Added to the session before appending line items / setting the
    # quote<->invoice back-populate, so autoflush doesn't warn about a
    # transient object being referenced mid-construction.
    session.add(invoice)
    for line in quote.line_items:
        invoice.line_items.append(
            InvoiceLineItem(
                kind=line.kind,
                description=line.description,
                quantity=line.quantity,
                unit_price=line.unit_price,
                amount=line.final_total,
            )
        )

    session.flush()

    note = f"Invoice {invoice.invoice_number} created from quote {quote.id}"
    if replaced is not None:
        note += f", replacing {replaced.invoice_number}"
    record_note(session, shipment, actor="system", note=note + ".", source=EventSource.SYSTEM, is_internal=True)
    session.flush()
    return invoice


def cancel_invoice(session: Session, invoice_id: int, *, reason: str, actor: str) -> Invoice:
    """Controlled cancellation, never a delete and never a financial edit --
    every snapshot/line-item field is left exactly as it was, so a
    previously-downloaded PDF's content is unaffected. Only ISSUED invoices
    can be cancelled (not already-cancelled, not some future PAID state).
    """
    if not reason or not reason.strip():
        raise InvalidCancellation("A cancellation reason is required")

    invoice = get_invoice(session, invoice_id)
    if invoice.status != InvoiceStatus.ISSUED:
        raise InvalidCancellation(f"Invoice {invoice.invoice_number} cannot be cancelled from status {invoice.status.value}")

    invoice.status = InvoiceStatus.CANCELLED
    invoice.cancelled_reason = reason
    invoice.cancelled_by = actor
    invoice.cancelled_at = datetime.now(timezone.utc)
    session.flush()

    shipment = invoice.quote.shipment if invoice.quote else None
    if shipment is not None:
        record_note(
            session, shipment, actor=actor,
            note=f"Invoice {invoice.invoice_number} cancelled: {reason}", source=EventSource.SYSTEM, is_internal=True,
        )
    session.flush()
    return invoice


def email_invoice(session: Session, invoice_id: int, *, automatic: bool = False) -> Invoice:
    """Emails the invoice's PDF to the customer's current address on file
    (not a snapshot -- if the customer's email changed since the invoice
    was issued, the correspondence should still reach them)."""
    invoice = get_invoice(session, invoice_id)
    customer = session.get(Customer, invoice.customer_id)
    if customer is None:
        raise NotFound(f"Customer {invoice.customer_id} not found")

    return deliver_document_email(
        session, invoice, company=invoice.company, automatic=automatic,
        to_email=customer.email,
        subject=f"Invoice {invoice.invoice_number} - Raaziq International",
        body_text=(
            f"Dear {customer.name},\n\nPlease find attached invoice {invoice.invoice_number} "
            f"for {invoice.origin_snapshot} to {invoice.destination_snapshot}.\n\nRegards,\nRaaziq International"
        ),
        pdf_factory=lambda: render_invoice_pdf(invoice, customer_safe=True),
        pdf_filename=f"{invoice.invoice_number}.pdf",
    )


def get_invoice(session: Session, invoice_id: int) -> Invoice:
    invoice = session.get(Invoice, invoice_id)
    if invoice is None:
        raise NotFound(f"Invoice {invoice_id} not found")
    return invoice


def list_invoices(session: Session) -> list[Invoice]:
    return list(session.execute(select(Invoice).order_by(Invoice.id)).scalars())
