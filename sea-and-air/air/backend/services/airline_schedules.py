"""Airline weekly-schedule CRUD -- a flat reference list, no owned child rows
to diff (unlike rate cards' breaks/charges), so this is even simpler than
services.rate_cards."""

import json
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.airline_schedule import AirlineSchedule
from models.inquiry import Inquiry
from schemas.airline_schedules import AirlineScheduleCreate, AirlineScheduleRead
from utils.errors import NotFound
from utils.locations import carrier_name, location_aliases


def _apply(schedule: AirlineSchedule, payload: AirlineScheduleCreate) -> None:
    schedule.airline_name = payload.airline_name
    schedule.origin = payload.origin
    schedule.destination = payload.destination
    schedule.mode = payload.mode
    schedule.days_of_week = json.dumps(payload.days_of_week)
    schedule.notes = payload.notes
    schedule.flight_number = payload.flight_number
    schedule.routing = payload.routing
    schedule.departure_time = payload.departure_time
    schedule.transit_time = payload.transit_time
    schedule.valid_from = payload.valid_from
    schedule.valid_until = payload.valid_until


def snapshot_schedules(session: Session, inquiry: Inquiry, carrier: str | None, today: date) -> list[dict] | None:
    if not carrier:
        return None
    schedules = session.scalars(
        select(AirlineSchedule).where(
            func.upper(AirlineSchedule.origin).in_(location_aliases(inquiry.origin)),
            func.upper(AirlineSchedule.destination).in_(location_aliases(inquiry.destination)),
            AirlineSchedule.mode == inquiry.mode,
            (AirlineSchedule.valid_from.is_(None)) | (AirlineSchedule.valid_from <= today),
            (AirlineSchedule.valid_until.is_(None)) | (AirlineSchedule.valid_until >= today),
        ).order_by(AirlineSchedule.id)
    )
    return [
        AirlineScheduleRead.model_validate(schedule).model_dump(mode="json", exclude={"id", "created_at", "updated_at"})
        for schedule in schedules
        if carrier_name(schedule.airline_name) == carrier_name(carrier)
    ] or None


def create_airline_schedule(session: Session, payload: AirlineScheduleCreate) -> AirlineSchedule:
    schedule = AirlineSchedule()
    _apply(schedule, payload)
    session.add(schedule)
    session.flush()
    return schedule


def get_airline_schedule(session: Session, schedule_id: int) -> AirlineSchedule:
    schedule = session.get(AirlineSchedule, schedule_id)
    if schedule is None:
        raise NotFound(f"Airline schedule {schedule_id} not found")
    return schedule


def update_airline_schedule(session: Session, schedule_id: int, payload: AirlineScheduleCreate) -> AirlineSchedule:
    schedule = get_airline_schedule(session, schedule_id)
    _apply(schedule, payload)
    session.flush()
    return schedule


def delete_airline_schedule(session: Session, schedule_id: int) -> None:
    schedule = get_airline_schedule(session, schedule_id)
    session.delete(schedule)
    session.flush()
