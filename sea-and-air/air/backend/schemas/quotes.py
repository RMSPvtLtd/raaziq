from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from models.enums import ChargeKind, QuoteStatus, ShipmentStage
from schemas.money import MoneyAmount

# QuoteLineItem.quantity/unit_price are NUMERIC(12,3)/NUMERIC(12,4) -- same
# rationale as schemas.rate_cards' BreakBound/RateAmount: bounds mirror the
# database columns so a value that passes validation can always be stored.
ManualQuantity = Annotated[Decimal, Field(gt=Decimal("0"), max_digits=12, decimal_places=3)]
ManualUnitPrice = Annotated[Decimal, Field(ge=Decimal("0"), max_digits=12, decimal_places=4)]


class QuoteGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inquiry_id: int


class QuoteLineItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: ChargeKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    calculated_total: Decimal
    final_total: Decimal
    markup_amount: Decimal
    is_manual_override: bool


class QuoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inquiry_id: int
    origin: str
    destination: str
    status: QuoteStatus
    shipment_stage: ShipmentStage | None
    invoice_id: int | None
    currency: str
    carrier: str | None
    is_manual: bool
    subtotal: Decimal
    markup_amount: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    valid_until: date
    clauses: str | None
    schedule_snapshot: list[dict] | None = None
    email_status: str = "not_sent"
    email_recipient: str | None = None
    email_error: str | None = None
    emailed_at: datetime | None = None
    revision_number: int
    root_quote_id: int | None
    is_current: bool
    superseded_at: datetime | None
    rejected_reason: str | None
    rejected_by: str | None
    rejected_at: datetime | None
    created_at: datetime
    updated_at: datetime
    line_items: list[QuoteLineItemRead]


class LineItemOverrideRequest(BaseModel):
    # Unknown fields are rejected rather than silently dropped, so a client
    # attempting to set e.g. `calculated_total` or `markup_amount` gets a
    # 422 instead of a false success. Same rationale on every write schema.
    model_config = ConfigDict(extra="forbid")

    line_item_id: int
    final_total: MoneyAmount


class QuoteLineItemsOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overrides: list[LineItemOverrideRequest] = Field(min_length=1, max_length=100)


class QuoteAdjustmentsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tax_amount: MoneyAmount
    discount_amount: MoneyAmount


class QuoteRejectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)


class QuoteClausesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clauses: str | None = Field(default=None, max_length=4000)


class ManualLineItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ChargeKind
    description: str = Field(min_length=1, max_length=200)
    quantity: ManualQuantity
    unit_price: ManualUnitPrice
    amount: MoneyAmount


class QuoteManualCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inquiry_id: int
    carrier: str = Field(min_length=1, max_length=120)
    currency: str = Field(min_length=3, max_length=3)
    line_items: list[ManualLineItemRequest] = Field(min_length=1, max_length=50)
    valid_until: date | None = None
    clauses: str | None = Field(default=None, max_length=4000)
