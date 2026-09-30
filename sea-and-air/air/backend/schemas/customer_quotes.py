"""Customer quotation contract: commercial charges, never pricing audit fields."""
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from pydantic import BaseModel

from config import get_settings
from models.enums import ChargeKind, QuoteStatus
from models.quote import Quote
from services.pricing import compute_chargeable_weight
from utils.locations import carrier_name, location_code


class CustomerQuoteLine(BaseModel):
    id: int
    kind: ChargeKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    final_total: Decimal


class CustomerQuoteRead(BaseModel):
    id: int
    inquiry_id: int
    origin: str
    destination: str
    status: QuoteStatus
    invoice_id: int | None
    currency: str
    carrier: str | None
    subtotal: Decimal
    service_charge_amount: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    valid_until: date
    clauses: str | None
    revision_number: int
    root_quote_id: int | None
    is_current: bool
    created_at: datetime
    updated_at: datetime
    mode: str
    cargo_type: str
    weight_kg: Decimal
    volume_cbm: Decimal
    chargeable_weight_kg: Decimal
    dimensions: str | None
    description: str | None
    ready_date: date | None
    incoterm: str
    hs_code: str | None
    pieces: int | None
    schedule_snapshot: list[dict] | None
    line_items: list[CustomerQuoteLine]


def customer_quote(quote: Quote) -> CustomerQuoteRead:
    fields = {name: getattr(quote, name) for name in (
        "id", "inquiry_id", "status", "invoice_id", "currency", "subtotal", "tax_amount",
        "discount_amount", "total", "valid_until", "clauses", "revision_number", "root_quote_id",
        "is_current", "created_at", "updated_at",
    )}
    inquiry = quote.inquiry
    fields.update({name: getattr(inquiry, name) for name in (
        "mode", "cargo_type", "weight_kg", "volume_cbm", "dimensions", "description", "ready_date",
        "incoterm", "hs_code", "pieces",
    )})
    return CustomerQuoteRead(
        **fields, origin=location_code(inquiry.origin), destination=location_code(inquiry.destination),
        carrier=carrier_name(quote.carrier), service_charge_amount=quote.markup_amount,
        chargeable_weight_kg=compute_chargeable_weight(inquiry, get_settings()),
        schedule_snapshot=getattr(quote, "schedule_snapshot", None),
        line_items=[CustomerQuoteLine(
            id=line.id, kind=line.kind, description=line.description, quantity=line.quantity,
            unit_price=(line.final_total / line.quantity).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            if line.quantity else Decimal("0"), final_total=line.final_total,
        ) for line in quote.line_items],
    )
