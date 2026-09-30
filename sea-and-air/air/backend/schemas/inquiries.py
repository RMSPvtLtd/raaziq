from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.enums import TransportMode
from utils.locations import validate_location


class InquiryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: int
    origin: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=1, max_length=120)
    mode: TransportMode
    cargo_type: str = Field(min_length=1, max_length=120)
    weight_kg: Decimal = Field(gt=0)
    volume_cbm: Decimal = Field(gt=0)
    dimensions: str | None = Field(default=None, max_length=200)
    ready_date: date | None = None
    incoterm: str = Field(min_length=1, max_length=10)
    description: str | None = None
    hs_code: str | None = Field(default=None, max_length=20)
    pieces: int | None = Field(default=None, gt=0)
    supplier_name: str | None = Field(default=None, max_length=200)
    supplier_address: str | None = None

    @model_validator(mode="after")
    def normalize_route(self) -> "InquiryCreate":
        self.origin = validate_location(self.origin, self.mode)
        self.destination = validate_location(self.destination, self.mode)
        self.incoterm = self.incoterm.strip().upper()
        return self


class InquiryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    origin: str
    destination: str
    mode: TransportMode
    cargo_type: str
    weight_kg: Decimal
    volume_cbm: Decimal
    dimensions: str | None
    ready_date: date | None
    incoterm: str
    description: str | None
    hs_code: str | None
    pieces: int | None
    supplier_name: str | None
    supplier_address: str | None
    created_at: datetime
    updated_at: datetime
