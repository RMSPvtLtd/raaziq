"""Wire shapes for the airline weekly-schedule reference list. Reference-only
data (see models.airline_schedule.AirlineSchedule) -- no cross-field pricing
validation needed here, just shape checks."""

import json
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.enums import TransportMode
from utils.locations import carrier_name, location_code, validate_location

DayOfWeek = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class AirlineScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    airline_name: str = Field(min_length=1, max_length=120)
    origin: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=1, max_length=120)
    mode: TransportMode
    days_of_week: list[DayOfWeek] = Field(min_length=1)
    notes: str | None = Field(default=None, max_length=2000)
    flight_number: str | None = Field(default=None, max_length=40)
    routing: str | None = Field(default=None, max_length=200)
    departure_time: str | None = Field(default=None, pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    transit_time: str | None = Field(default=None, max_length=120)
    valid_from: date | None = None
    valid_until: date | None = None

    @model_validator(mode="after")
    def _validate_schedule(self):
        self.origin = validate_location(self.origin, self.mode)
        self.destination = validate_location(self.destination, self.mode)
        self.airline_name = carrier_name(self.airline_name)
        if not self.airline_name:
            raise ValueError("Airline name is required")
        if self.routing:
            self.routing = "-".join(validate_location(part, self.mode) for part in self.routing.split("-"))
        if self.flight_number:
            self.flight_number = self.flight_number.strip().upper()
        if self.transit_time:
            self.transit_time = self.transit_time.strip().upper()
        if self.valid_from and self.valid_until and self.valid_until < self.valid_from:
            raise ValueError("Valid until must be on or after valid from")
        return self


class AirlineScheduleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    airline_name: str
    origin: str
    destination: str
    mode: TransportMode
    days_of_week: list[DayOfWeek]
    notes: str | None
    flight_number: str | None = None
    routing: str | None = None
    departure_time: str | None = None
    transit_time: str | None = None
    valid_from: date | None = None
    valid_until: date | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("origin", "destination")
    @classmethod
    def _location_code(cls, value: str) -> str:
        return location_code(value)

    @field_validator("airline_name")
    @classmethod
    def _carrier_name(cls, value: str) -> str:
        return carrier_name(value) or ""

    @field_validator("days_of_week", mode="before")
    @classmethod
    def _decode_days(cls, value: object) -> object:
        # Stored as a JSON-encoded string (models.airline_schedule.AirlineSchedule
        # .days_of_week) -- decode it back into a list for the API response.
        return json.loads(value) if isinstance(value, str) else value
