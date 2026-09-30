from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from models.enums import ChargeKind, InvoiceStatus


class InvoiceLineItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: ChargeKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


class InvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_number: str
    quote_id: int
    shipment_id: int
    customer_id: int
    company_id: int
    replaces_invoice_id: int | None
    status: InvoiceStatus
    cancelled_reason: str | None
    cancelled_by: str | None
    cancelled_at: datetime | None
    payment_date: date | None
    amount_paid: Decimal | None
    payment_method: str | None
    payment_reference: str | None
    issued_date: date
    currency: str
    subtotal: Decimal
    markup_amount: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    customer_name_snapshot: str
    customer_address_snapshot: str | None
    supplier_name_snapshot: str | None
    supplier_address_snapshot: str | None
    origin_snapshot: str
    destination_snapshot: str
    mode_snapshot: str
    cargo_type_snapshot: str | None
    incoterm_snapshot: str
    hs_code_snapshot: str | None
    pieces_snapshot: int | None
    weight_kg_snapshot: Decimal
    volume_cbm_snapshot: Decimal
    chargeable_weight_kg_snapshot: Decimal
    carrier_snapshot: str | None
    voyage_flight_number_snapshot: str | None
    job_number_snapshot: str | None
    remarks: str | None
    clauses_snapshot: str | None
    quote_reference_snapshot: str | None
    quote_date_snapshot: date | None
    quote_valid_until_snapshot: date | None
    dimensions_snapshot: str | None
    description_snapshot: str | None
    ready_date_snapshot: date | None
    schedule_snapshot: list[dict] | None
    email_status: str
    email_recipient: str | None
    email_error: str | None
    emailed_at: datetime | None
    created_at: datetime
    line_items: list[InvoiceLineItemRead]


class InvoiceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company_id: int
    replaces_invoice_id: int | None = None
    remarks: str | None = Field(default=None, max_length=2000)


class InvoiceCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1)
