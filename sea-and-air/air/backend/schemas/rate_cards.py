"""Wire shapes for rate card management. Bounds mirror the database columns
they land in (see schemas.money's MoneyAmount for why this matters: a value
that passes validation here can always be stored, instead of reaching the
driver and failing at flush time as an opaque 500)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.enums import ChargeBasis, ChargeKind, TransportMode, UnitOfMeasure
from schemas.money import MoneyAmount
from utils.locations import carrier_name, validate_location

# RateCardBreak.min_weight/max_weight/min_volume/max_volume are NUMERIC(12,3).
BreakBound = Annotated[Decimal, Field(ge=Decimal("0"), max_digits=12, decimal_places=3)]
# RateCardBreak.rate and RateCardCharge.amount are NUMERIC(12,4).
RateAmount = Annotated[Decimal, Field(ge=Decimal("0"), max_digits=12, decimal_places=4)]


class RateCardBreakCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_weight: BreakBound | None = None
    max_weight: BreakBound | None = None
    min_volume: BreakBound | None = None
    max_volume: BreakBound | None = None
    unit: UnitOfMeasure
    rate: RateAmount
    description: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _bounds_make_sense(self) -> "RateCardBreakCreate":
        if self.max_weight is not None and self.min_weight is not None and self.max_weight <= self.min_weight:
            raise ValueError("max_weight must be greater than min_weight")
        if self.max_volume is not None and self.min_volume is not None and self.max_volume <= self.min_volume:
            raise ValueError("max_volume must be greater than min_volume")
        return self


class RateCardBreakRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    min_weight: Decimal | None
    max_weight: Decimal | None
    min_volume: Decimal | None
    max_volume: Decimal | None
    unit: UnitOfMeasure
    rate: Decimal
    description: str | None


class RateCardChargeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ChargeKind
    description: str = Field(min_length=1, max_length=200)
    basis: ChargeBasis
    amount: RateAmount


class RateCardChargeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: ChargeKind
    description: str
    basis: ChargeBasis
    amount: Decimal


class RateCardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=1, max_length=120)
    mode: TransportMode
    carrier: str | None = Field(default=None, max_length=120)
    currency: str = Field(min_length=3, max_length=3)
    valid_from: date
    valid_until: date
    minimum_charge: MoneyAmount
    breaks: list[RateCardBreakCreate] = Field(min_length=1)
    charges: list[RateCardChargeCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validity_window(self) -> "RateCardCreate":
        self.origin = validate_location(self.origin, self.mode)
        self.destination = validate_location(self.destination, self.mode)
        self.carrier = carrier_name(self.carrier)
        self.currency = self.currency.strip().upper()
        if self.valid_until < self.valid_from:
            raise ValueError("valid_until must not be before valid_from")
        return self


class RateCardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    origin: str
    destination: str
    mode: TransportMode
    carrier: str | None
    currency: str
    valid_from: date
    valid_until: date
    minimum_charge: Decimal
    breaks: list[RateCardBreakRead]
    charges: list[RateCardChargeRead]
    created_at: datetime
    updated_at: datetime
