"""The customer-facing views of their own shipments/quotes/invoices/account.
The shipment list here is a lightweight summary (job number, route, stage,
risk) for the dashboard; shipment *detail* reuses `schemas.tracking.
TrackingResult` directly -- it's already the customer-safe shape (no
pricing, no internal notes, no risk_reason), so there's no reason to
redeclare it. Quotes use the explicit commercial allowlist in
`schemas.customer_quotes`, excluding internal costs and audit details.

Invoices do NOT reuse `schemas.invoices.InvoiceRead` -- that schema includes
`supplier_name_snapshot`/`supplier_address_snapshot`, which must not
automatically reach a customer (a real freight-forwarder concern: revealing
the actual shipper lets a customer route around Raaziq directly) and
`cancelled_reason`, which is internal/audit-only. `CustomerInvoiceDetail` is
a hand-built, independent schema, the same pattern `schemas.tracking.
TrackingResult` already uses for the same reason.
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from models.enums import ChargeKind, InvoiceStatus, ShipmentStage
from models.invoice import Invoice
from models.shipment import Shipment
from schemas.customers import CustomerRead


class CustomerLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    customer: CustomerRead


class CustomerShipmentSummary(BaseModel):
    id: int
    job_number: str | None
    origin: str
    destination: str
    stage: ShipmentStage
    is_at_risk: bool
    is_cancelled: bool
    is_on_hold: bool
    updated_at: datetime


def shipment_summary(shipment: Shipment) -> CustomerShipmentSummary:
    return CustomerShipmentSummary(
        id=shipment.id,
        job_number=shipment.job_number,
        origin=shipment.inquiry.origin,
        destination=shipment.inquiry.destination,
        stage=shipment.stage,
        is_at_risk=shipment.is_at_risk,
        is_cancelled=shipment.is_cancelled,
        is_on_hold=shipment.is_on_hold,
        updated_at=shipment.updated_at,
    )


class CustomerInvoiceLineItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: ChargeKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


class CustomerInvoiceSummary(BaseModel):
    id: int
    invoice_number: str
    status: InvoiceStatus
    issued_date: date
    currency: str
    total: Decimal


class CustomerInvoiceDetail(BaseModel):
    id: int
    invoice_number: str
    status: InvoiceStatus
    issued_date: date
    currency: str
    subtotal: Decimal
    service_charge_amount: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    origin: str
    destination: str
    incoterm: str
    job_number: str | None
    quote_reference: str | None
    quote_date: date | None
    quote_valid_until: date | None
    dimensions: str | None
    description: str | None
    ready_date: date | None
    schedule: list[dict] | None
    carrier: str | None
    cargo_type: str | None
    mode: str
    hs_code: str | None
    pieces: int | None
    weight_kg: Decimal
    volume_cbm: Decimal
    chargeable_weight_kg: Decimal
    voyage_flight_number: str | None
    clauses: str | None
    remarks: str | None
    line_items: list[CustomerInvoiceLineItemRead]


def customer_invoice_summary(invoice: Invoice) -> CustomerInvoiceSummary:
    return CustomerInvoiceSummary(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        status=invoice.status,
        issued_date=invoice.issued_date,
        currency=invoice.currency,
        total=invoice.total,
    )


def customer_invoice_detail(invoice: Invoice) -> CustomerInvoiceDetail:
    return CustomerInvoiceDetail(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        status=invoice.status,
        issued_date=invoice.issued_date,
        currency=invoice.currency,
        subtotal=invoice.subtotal,
        service_charge_amount=invoice.markup_amount,
        tax_amount=invoice.tax_amount,
        discount_amount=invoice.discount_amount,
        total=invoice.total,
        origin=invoice.origin_snapshot,
        destination=invoice.destination_snapshot,
        incoterm=invoice.incoterm_snapshot,
        job_number=invoice.job_number_snapshot,
        quote_reference=invoice.quote_reference_snapshot,
        quote_date=invoice.quote_date_snapshot,
        quote_valid_until=invoice.quote_valid_until_snapshot,
        dimensions=invoice.dimensions_snapshot,
        description=invoice.description_snapshot,
        ready_date=invoice.ready_date_snapshot,
        schedule=invoice.schedule_snapshot,
        carrier=invoice.carrier_snapshot,
        cargo_type=invoice.cargo_type_snapshot,
        mode=invoice.mode_snapshot,
        hs_code=invoice.hs_code_snapshot,
        pieces=invoice.pieces_snapshot,
        weight_kg=invoice.weight_kg_snapshot,
        volume_cbm=invoice.volume_cbm_snapshot,
        chargeable_weight_kg=invoice.chargeable_weight_kg_snapshot,
        voyage_flight_number=invoice.voyage_flight_number_snapshot,
        clauses=invoice.clauses_snapshot,
        remarks=invoice.remarks,
        line_items=[CustomerInvoiceLineItemRead(id=li.id, kind=li.kind, description=li.description,
                    quantity=li.quantity, unit_price=(li.amount / li.quantity).quantize(Decimal("0.0001")) if li.quantity else Decimal("0"),
                    amount=li.amount) for li in invoice.line_items],
    )
