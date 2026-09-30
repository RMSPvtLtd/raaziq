from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import select

import models as m
from utils.errors import InvalidQuoteState, QuoteExpired
from models.enums import EventSource, OPERATIONAL_STAGE_ORDER, QuoteStatus, ShipmentStage
from services.quotes import (
    LineItemOverride,
    ManualLineItem,
    accept_quote,
    create_manual_quote,
    generate_quote,
    generate_quotes,
    list_revisions,
    override_line_items,
    reject_quote,
    send_quote,
    set_quote_adjustments,
    set_quote_clauses,
)
from services.transitions import advance_stage
from factories import add_break, make_customer, make_inquiry, make_rate_card, simple_rate_card

TODAY = date(2026, 6, 1)


def _quote(db_session, **inquiry_overrides):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer, **inquiry_overrides)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()
    return quote


# --- lifecycle ---


def test_generated_quote_starts_draft(db_session):
    from config import get_settings

    quote = _quote(db_session)
    assert quote.status == QuoteStatus.DRAFT
    assert quote.valid_until == TODAY + timedelta(days=get_settings().quote_validity_days)


def test_editing_sent_quote_is_still_allowed(db_session):
    # Line-item editing is gated on the shipment's stage, not the quote's own
    # status (see services.quotes.override_line_items) -- a sent quote whose
    # shipment hasn't been invoiced yet stays editable.
    quote = _quote(db_session)
    send_quote(db_session, quote.id, today=TODAY)

    line_item_id = quote.line_items[0].id
    updated = override_line_items(db_session, quote.id, [LineItemOverride(line_item_id, Decimal("1"))], today=TODAY)

    updated_line = next(li for li in updated.line_items if li.id == line_item_id)
    assert updated_line.final_total == Decimal("1.00")
    assert updated_line.is_manual_override is True


def test_sending_accepted_quote_is_rejected(db_session):
    quote = _quote(db_session)
    send_quote(db_session, quote.id, today=TODAY)
    accept_quote(db_session, quote.id, "ops", today=TODAY)

    with pytest.raises(InvalidQuoteState):
        send_quote(db_session, quote.id, today=TODAY)


def test_resending_draft_after_send_is_rejected(db_session):
    quote = _quote(db_session)
    send_quote(db_session, quote.id, today=TODAY)

    with pytest.raises(InvalidQuoteState):
        send_quote(db_session, quote.id, today=TODAY)


def test_accepting_expired_quote_is_rejected_and_status_persisted(db_session):
    quote = _quote(db_session)
    much_later = TODAY + timedelta(days=365)

    with pytest.raises(QuoteExpired):
        accept_quote(db_session, quote.id, "ops", today=much_later)
    assert quote.status == QuoteStatus.EXPIRED


def test_lazy_expiry_does_not_block_edit(db_session):
    # Expiry is still evaluated and persisted as a status-bookkeeping side
    # effect, but (like send/accept status) it no longer blocks editing --
    # only the shipment reaching invoice_to_customer does.
    quote = _quote(db_session)
    much_later = TODAY + timedelta(days=365)
    line_item_id = quote.line_items[0].id

    updated = override_line_items(
        db_session, quote.id, [LineItemOverride(line_item_id, Decimal("1"))], today=much_later
    )

    assert quote.status == QuoteStatus.EXPIRED
    updated_line = next(li for li in updated.line_items if li.id == line_item_id)
    assert updated_line.final_total == Decimal("1.00")


def test_edit_blocked_once_shipment_invoiced(db_session):
    quote = _quote(db_session)
    shipment = accept_quote(db_session, quote.id, "ops", today=TODAY)
    start = OPERATIONAL_STAGE_ORDER.index(ShipmentStage.JOB_OPENING) + 1
    for stage in OPERATIONAL_STAGE_ORDER[start:]:
        advance_stage(db_session, shipment, stage, actor="ops", note=None, source=EventSource.MANUAL)
    assert shipment.stage == ShipmentStage.INVOICE_TO_CUSTOMER

    line_item_id = quote.line_items[0].id
    with pytest.raises(InvalidQuoteState):
        override_line_items(db_session, quote.id, [LineItemOverride(line_item_id, Decimal("1"))], today=TODAY)


# --- override ---


def test_override_preserves_calculated_total_and_changes_final_total(db_session):
    quote = _quote(db_session, weight_kg=Decimal("100"), volume_cbm=Decimal("0.01"))
    line_item = quote.line_items[0]
    original_calculated = line_item.calculated_total
    original_quantity = line_item.quantity
    original_unit_price = line_item.unit_price

    updated = override_line_items(
        db_session, quote.id, [LineItemOverride(line_item.id, Decimal("1"))], today=TODAY
    )

    updated_line = next(li for li in updated.line_items if li.id == line_item.id)
    assert updated_line.final_total == Decimal("1.00")
    assert updated_line.calculated_total == original_calculated
    assert updated_line.quantity == original_quantity
    assert updated_line.unit_price == original_unit_price
    assert updated_line.is_manual_override is True


def test_override_recalculates_quote_total(db_session):
    quote = _quote(db_session)
    original_total = quote.total
    line_item = quote.line_items[0]

    updated = override_line_items(
        db_session, quote.id, [LineItemOverride(line_item.id, Decimal("1"))], today=TODAY
    )

    assert updated.total != original_total
    expected_subtotal = sum((li.final_total for li in updated.line_items), Decimal("0"))
    assert updated.subtotal == expected_subtotal


# --- tax/discount adjustments ---


def test_default_tax_and_discount_are_zero(db_session):
    quote = _quote(db_session)
    assert quote.tax_amount == Decimal("0")
    assert quote.discount_amount == Decimal("0")


def test_set_quote_adjustments_recalculates_total(db_session):
    quote = _quote(db_session)
    subtotal_plus_markup = quote.subtotal + quote.markup_amount

    updated = set_quote_adjustments(
        db_session, quote.id, tax_amount=Decimal("10.00"), discount_amount=Decimal("5.00"), today=TODAY
    )

    assert updated.tax_amount == Decimal("10.00")
    assert updated.discount_amount == Decimal("5.00")
    assert updated.total == subtotal_plus_markup + Decimal("10.00") - Decimal("5.00")


def test_set_quote_adjustments_blocked_once_shipment_invoiced(db_session):
    quote = _quote(db_session)
    shipment = accept_quote(db_session, quote.id, "ops", today=TODAY)
    start = OPERATIONAL_STAGE_ORDER.index(ShipmentStage.JOB_OPENING) + 1
    for stage in OPERATIONAL_STAGE_ORDER[start:]:
        advance_stage(db_session, shipment, stage, actor="ops", note=None, source=EventSource.MANUAL)
    assert shipment.stage == ShipmentStage.INVOICE_TO_CUSTOMER

    with pytest.raises(InvalidQuoteState):
        set_quote_adjustments(db_session, quote.id, tax_amount=Decimal("1"), discount_amount=Decimal("0"), today=TODAY)


def test_quote_adjustments_endpoint(client, db_session, ops_headers):
    quote = _quote(db_session)
    db_session.commit()

    r = client.patch(
        f"/quotes/{quote.id}/adjustments",
        json={"tax_amount": "12.50", "discount_amount": "2.50"},
        headers=ops_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tax_amount"] == "12.50"
    assert body["discount_amount"] == "2.50"


def test_set_quote_clauses(db_session):
    quote = _quote(db_session)

    updated = set_quote_clauses(db_session, quote.id, clauses="Payment due within 15 days.", today=TODAY)

    assert updated.clauses == "Payment due within 15 days."


def test_set_quote_clauses_blocked_once_shipment_invoiced(db_session):
    quote = _quote(db_session)
    shipment = accept_quote(db_session, quote.id, "ops", today=TODAY)
    start = OPERATIONAL_STAGE_ORDER.index(ShipmentStage.JOB_OPENING) + 1
    for stage in OPERATIONAL_STAGE_ORDER[start:]:
        advance_stage(db_session, shipment, stage, actor="ops", note=None, source=EventSource.MANUAL)
    assert shipment.stage == ShipmentStage.INVOICE_TO_CUSTOMER

    with pytest.raises(InvalidQuoteState):
        set_quote_clauses(db_session, quote.id, clauses="Too late", today=TODAY)


def test_quote_clauses_endpoint(client, db_session, ops_headers):
    quote = _quote(db_session)
    db_session.commit()

    r = client.patch(f"/quotes/{quote.id}/clauses", json={"clauses": "Standard trading terms apply."}, headers=ops_headers)
    assert r.status_code == 200, r.text
    assert r.json()["clauses"] == "Standard trading terms apply."


# --- acceptance ---


def test_accept_sets_status_and_creates_shipment_with_relationships(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()

    shipment = accept_quote(db_session, quote.id, "ops", today=TODAY)

    assert quote.status == QuoteStatus.ACCEPTED
    assert shipment.customer_id == customer.id
    assert shipment.inquiry_id == inquiry.id
    assert shipment.quote_id == quote.id
    assert shipment.stage == ShipmentStage.JOB_OPENING


def test_accept_generates_correctly_formatted_job_number(db_session):
    quote = _quote(db_session)
    shipment = accept_quote(db_session, quote.id, "ops", today=TODAY)
    assert shipment.job_number == "RAZ-2026-00001"


def test_accept_job_number_increments_across_quotes(db_session):
    q1 = _quote(db_session)
    q2 = _quote(db_session)
    s1 = accept_quote(db_session, q1.id, "ops", today=TODAY)
    s2 = accept_quote(db_session, q2.id, "ops", today=TODAY)
    assert s1.job_number == "RAZ-2026-00001"
    assert s2.job_number == "RAZ-2026-00002"


def test_accept_creates_initial_job_opening_event(db_session):
    quote = _quote(db_session)
    shipment = accept_quote(db_session, quote.id, "ops", today=TODAY)

    # inquiry -> quotation events already exist from create_inquiry /
    # generate_quote; accept_quote adds the job_opening stage-change event,
    # plus a non-stage-change "accepted" audit note naming the quote (see
    # services.quotes.accept_quote).
    assert [e.stage for e in shipment.status_events] == [
        ShipmentStage.INQUIRY, ShipmentStage.QUOTATION, ShipmentStage.JOB_OPENING, ShipmentStage.JOB_OPENING,
    ]
    event = shipment.status_events[-2]
    assert event.stage == ShipmentStage.JOB_OPENING
    assert event.source == EventSource.SYSTEM
    assert event.is_stage_change is True

    audit_note = shipment.status_events[-1]
    assert audit_note.is_stage_change is False
    assert audit_note.is_internal is True
    assert "accepted" in audit_note.note


def test_repeated_acceptance_is_idempotent(db_session):
    quote = _quote(db_session)
    first = accept_quote(db_session, quote.id, "ops", today=TODAY)
    second = accept_quote(db_session, quote.id, "ops", today=TODAY)

    assert first.id == second.id
    shipments = db_session.execute(select(m.Shipment)).scalars().all()
    assert len(shipments) == 1


def test_already_accepted_without_job_number_is_rejected(db_session):
    # Inconsistent state: quote says accepted, but its shipment was never
    # actually advanced to job_opening (no job_number assigned).
    quote = _quote(db_session)
    quote.status = QuoteStatus.ACCEPTED
    db_session.flush()

    with pytest.raises(InvalidQuoteState):
        accept_quote(db_session, quote.id, "ops", today=TODAY)


def test_forced_failure_rolls_back_and_preserves_job_number_sequence(db_session, session_factory):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.commit()  # quote + shipment-at-quotation creation is durable, as it would be from a prior request
    quote_id = quote.id
    shipment_id = inquiry.shipment.id

    # accept_quote's stage transition happens inside advance_stage
    # (services.transitions), which is where the StatusEvent for
    # job_opening actually gets constructed.
    with patch("services.transitions.StatusEvent", side_effect=RuntimeError("forced failure")):
        with pytest.raises(RuntimeError):
            accept_quote(db_session, quote_id, "ops", today=TODAY)
    db_session.rollback()

    reloaded_quote = db_session.get(m.Quote, quote_id)
    assert reloaded_quote.status == QuoteStatus.DRAFT
    reloaded_shipment = db_session.get(m.Shipment, shipment_id)
    assert reloaded_shipment.job_number is None
    assert reloaded_shipment.stage == ShipmentStage.QUOTATION
    counters = db_session.execute(select(m.JobNumberCounter)).scalars().all()
    assert counters == [] or counters[0].last_value == 0

    shipment = accept_quote(db_session, quote_id, "ops", today=TODAY)
    assert shipment.job_number == "RAZ-2026-00001", "failed attempt must not consume a sequence number"


# --- rejection ---


def test_reject_from_draft(db_session):
    quote = _quote(db_session)
    rejected = reject_quote(db_session, quote.id, reason="Price too high", actor="ops", today=TODAY)

    assert rejected.status == QuoteStatus.REJECTED
    assert rejected.rejected_reason == "Price too high"
    assert rejected.rejected_by == "ops"
    assert rejected.rejected_at is not None


def test_reject_from_sent(db_session):
    quote = _quote(db_session)
    send_quote(db_session, quote.id, today=TODAY)
    rejected = reject_quote(db_session, quote.id, reason="Customer declined", actor="ops", today=TODAY)
    assert rejected.status == QuoteStatus.REJECTED


def test_reject_requires_a_reason(db_session):
    quote = _quote(db_session)
    with pytest.raises(InvalidQuoteState):
        reject_quote(db_session, quote.id, reason="   ", actor="ops", today=TODAY)


def test_cannot_reject_an_accepted_quote(db_session):
    quote = _quote(db_session)
    accept_quote(db_session, quote.id, "ops", today=TODAY)
    with pytest.raises(InvalidQuoteState):
        reject_quote(db_session, quote.id, reason="too late", actor="ops", today=TODAY)


def test_cannot_accept_a_rejected_quote(db_session):
    quote = _quote(db_session)
    reject_quote(db_session, quote.id, reason="Customer declined", actor="ops", today=TODAY)
    with pytest.raises(InvalidQuoteState):
        accept_quote(db_session, quote.id, "ops", today=TODAY)


def test_cannot_reject_an_already_rejected_quote(db_session):
    quote = _quote(db_session)
    reject_quote(db_session, quote.id, reason="First reason", actor="ops", today=TODAY)
    with pytest.raises(InvalidQuoteState):
        reject_quote(db_session, quote.id, reason="Second reason", actor="ops", today=TODAY)


def test_cannot_reject_an_expired_quote(db_session):
    quote = _quote(db_session)
    # Lazy expiry runs inside reject_quote itself before the status check,
    # so an expired quote is rejected with InvalidQuoteState (same as any
    # other non-draft/sent status), not QuoteExpired -- that's specific to
    # accept_quote.
    with pytest.raises(InvalidQuoteState):
        reject_quote(db_session, quote.id, reason="too late", actor="ops", today=TODAY + timedelta(days=365))


def test_reject_endpoint(client, db_session, ops_headers):
    # Built through the client (not the _quote(db_session) helper, which
    # pins generation to the fixed TODAY constant) so valid_until is 14 days
    # from the real clock -- reject_quote's own status check would otherwise
    # see it as already expired relative to whenever this test actually runs.
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    db_session.commit()

    r = client.post(
        "/inquiries",
        json={
            "customer_id": customer.id, "origin": "Lahore", "destination": "Dubai", "mode": "air",
            "cargo_type": "general", "weight_kg": "100", "volume_cbm": "0.2", "incoterm": "DAP",
        },
        headers=ops_headers,
    )
    inquiry_id = r.json()["id"]
    quote_id = client.post("/quotes/generate", json={"inquiry_id": inquiry_id}, headers=ops_headers).json()[0]["id"]

    r = client.post(f"/quotes/{quote_id}/reject", json={"reason": "Customer found a cheaper rate"}, headers=ops_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"
    assert r.json()["rejected_reason"] == "Customer found a cheaper rate"

    # A rejected quote can no longer be accepted.
    r = client.post(f"/quotes/{quote_id}/accept", headers=ops_headers)
    assert r.status_code == 409, r.text


# --- revisions ---


def test_generating_a_new_quote_for_a_draft_inquiry_creates_a_revision(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)

    rev1 = generate_quote(db_session, inquiry.id, today=TODAY)
    rev2 = generate_quote(db_session, inquiry.id, today=TODAY)

    assert rev1.revision_number == 1
    assert rev1.root_quote_id is None
    assert rev2.revision_number == 2
    assert rev2.root_quote_id == rev1.id
    assert rev1.superseded_at is not None
    assert rev1.is_current is False
    assert rev2.is_current is True


def test_revision_chain_keeps_growing(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)

    rev1 = generate_quote(db_session, inquiry.id, today=TODAY)
    rev2 = generate_quote(db_session, inquiry.id, today=TODAY)
    rev3 = generate_quote(db_session, inquiry.id, today=TODAY)

    assert rev3.revision_number == 3
    assert rev3.root_quote_id == rev1.id
    assert rev2.root_quote_id == rev1.id


def test_cannot_generate_a_new_quote_once_the_current_one_is_accepted(db_session):
    quote = _quote(db_session)
    accept_quote(db_session, quote.id, "ops", today=TODAY)

    with pytest.raises(InvalidQuoteState):
        generate_quote(db_session, quote.inquiry_id, today=TODAY)


def test_superseded_quote_cannot_be_sent(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    rev1 = generate_quote(db_session, inquiry.id, today=TODAY)
    generate_quote(db_session, inquiry.id, today=TODAY)  # supersedes rev1

    with pytest.raises(InvalidQuoteState):
        send_quote(db_session, rev1.id, today=TODAY)


def test_superseded_quote_cannot_be_accepted(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    rev1 = generate_quote(db_session, inquiry.id, today=TODAY)
    generate_quote(db_session, inquiry.id, today=TODAY)

    with pytest.raises(InvalidQuoteState):
        accept_quote(db_session, rev1.id, "ops", today=TODAY)


def test_superseded_quote_cannot_be_edited(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    rev1 = generate_quote(db_session, inquiry.id, today=TODAY)
    generate_quote(db_session, inquiry.id, today=TODAY)

    with pytest.raises(InvalidQuoteState):
        set_quote_adjustments(db_session, rev1.id, tax_amount=Decimal("1"), discount_amount=Decimal("0"), today=TODAY)


def test_the_correct_revision_can_still_be_accepted(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    generate_quote(db_session, inquiry.id, today=TODAY)
    rev2 = generate_quote(db_session, inquiry.id, today=TODAY)

    shipment = accept_quote(db_session, rev2.id, "ops", today=TODAY)
    assert shipment.quote_id == rev2.id


def test_list_revisions_returns_the_whole_family_oldest_first(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    rev1 = generate_quote(db_session, inquiry.id, today=TODAY)
    rev2 = generate_quote(db_session, inquiry.id, today=TODAY)
    rev3 = generate_quote(db_session, inquiry.id, today=TODAY)

    revisions = list_revisions(db_session, rev2.id)
    assert [q.id for q in revisions] == [rev1.id, rev2.id, rev3.id]


def test_revisions_endpoint(client, db_session, ops_headers):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    rev1 = generate_quote(db_session, inquiry.id, today=TODAY)
    rev2 = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.commit()

    r = client.get(f"/quotes/{rev1.id}/revisions", headers=ops_headers)
    assert r.status_code == 200, r.text
    ids = [q["id"] for q in r.json()]
    assert ids == [rev1.id, rev2.id]


# --- parallel (multi-carrier) quotes ---


def _two_carrier_rate_cards(db_session, **inquiry_overrides):
    customer = make_customer(db_session)
    simple_rate_card(db_session, carrier="PIA", rate=Decimal("5.00"))
    simple_rate_card(db_session, carrier="Emirates SkyCargo", rate=Decimal("7.00"))
    inquiry = make_inquiry(db_session, customer, **inquiry_overrides)
    return inquiry


def test_generate_quotes_returns_one_per_carrier(db_session):
    inquiry = _two_carrier_rate_cards(db_session)

    quotes = generate_quotes(db_session, inquiry.id, today=TODAY)

    assert len(quotes) == 2
    carriers = {q.carrier for q in quotes}
    assert carriers == {"PIA", "EMIRATES"}
    assert all(not q.is_manual for q in quotes)
    assert all(q.revision_number == 1 and q.root_quote_id is None for q in quotes)


def test_regenerating_supersedes_the_correct_per_carrier_lineage(db_session):
    inquiry = _two_carrier_rate_cards(db_session)
    first_batch = generate_quotes(db_session, inquiry.id, today=TODAY)
    pia_1 = next(q for q in first_batch if q.carrier == "PIA")
    emirates_1 = next(q for q in first_batch if q.carrier == "EMIRATES")

    second_batch = generate_quotes(db_session, inquiry.id, today=TODAY)
    pia_2 = next(q for q in second_batch if q.carrier == "PIA")
    emirates_2 = next(q for q in second_batch if q.carrier == "EMIRATES")

    assert pia_2.revision_number == 2
    assert pia_2.root_quote_id == pia_1.id
    assert pia_1.superseded_at is not None
    assert emirates_2.revision_number == 2
    assert emirates_2.root_quote_id == emirates_1.id
    assert emirates_1.superseded_at is not None
    # Each carrier's lineage stays independent -- PIA's revision doesn't
    # touch Emirates' root_quote_id or vice versa.
    assert pia_2.root_quote_id != emirates_2.root_quote_id


@pytest.mark.parametrize("carrier_expired", [False, True])
def test_regeneration_closes_all_legacy_alias_offers(db_session, carrier_expired):
    inquiry = _two_carrier_rate_cards(db_session)
    original = next(q for q in generate_quotes(db_session, inquiry.id, today=TODAY) if q.carrier == "EMIRATES")
    original.carrier = "EK"
    newer_alias = m.Quote(
        inquiry_id=inquiry.id, status=QuoteStatus.DRAFT, currency="USD", carrier="Emirates SkyCargo",
        is_manual=False, valid_until=TODAY, subtotal=Decimal("100"), markup_amount=Decimal("20"),
        total=Decimal("120"), clauses="LATEST AIRLINE TERMS",
    )
    db_session.add(newer_alias)
    db_session.flush()
    manual = create_manual_quote(db_session, inquiry.id, carrier="EK", currency="USD", line_items=_manual_line_items(), today=TODAY)
    if carrier_expired:
        for card in db_session.scalars(select(m.RateCard)).all():
            if card.carrier == "Emirates SkyCargo":
                card.valid_until = TODAY - timedelta(days=1)
        db_session.flush()

    revised = generate_quotes(db_session, inquiry.id, today=TODAY)

    assert not original.is_current
    assert not newer_alias.is_current
    assert manual.is_current  # independent manual offers must remain intact
    if not carrier_expired:
        emirates = next(q for q in revised if q.carrier == "EMIRATES")
        assert emirates.root_quote_id == newer_alias.id
        assert emirates.clauses == "LATEST AIRLINE TERMS"
    for stale in (original, newer_alias):
        with pytest.raises(InvalidQuoteState):
            accept_quote(db_session, stale.id, "ops", today=TODAY)


def test_a_new_carrier_added_between_generations_starts_a_fresh_lineage(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session, carrier="PIA", rate=Decimal("5.00"))
    inquiry = make_inquiry(db_session, customer)
    first_batch = generate_quotes(db_session, inquiry.id, today=TODAY)
    assert len(first_batch) == 1

    # A second carrier's rate card is added after the first generation.
    simple_rate_card(db_session, carrier="Emirates SkyCargo", rate=Decimal("7.00"))
    second_batch = generate_quotes(db_session, inquiry.id, today=TODAY)

    assert len(second_batch) == 2
    emirates = next(q for q in second_batch if q.carrier == "EMIRATES")
    assert emirates.revision_number == 1
    assert emirates.root_quote_id is None


def test_a_carrier_dropping_out_gets_superseded_with_no_successor(db_session):
    customer = make_customer(db_session)
    pia_card = simple_rate_card(db_session, carrier="PIA", rate=Decimal("5.00"))
    simple_rate_card(db_session, carrier="Emirates SkyCargo", rate=Decimal("7.00"))
    inquiry = make_inquiry(db_session, customer)
    first_batch = generate_quotes(db_session, inquiry.id, today=TODAY)
    pia_1 = next(q for q in first_batch if q.carrier == "PIA")

    # PIA's rate card expires before the lane is re-quoted.
    pia_card.valid_until = date(2026, 1, 1)
    db_session.flush()

    second_batch = generate_quotes(db_session, inquiry.id, today=TODAY)

    assert len(second_batch) == 1
    assert second_batch[0].carrier == "EMIRATES"
    assert pia_1.superseded_at is not None
    assert pia_1.is_current is False


def test_accepting_one_sibling_supersedes_the_other_carriers(db_session):
    inquiry = _two_carrier_rate_cards(db_session)
    quotes = generate_quotes(db_session, inquiry.id, today=TODAY)
    pia = next(q for q in quotes if q.carrier == "PIA")
    emirates = next(q for q in quotes if q.carrier == "EMIRATES")

    accept_quote(db_session, pia.id, "ops", today=TODAY)

    assert pia.status == QuoteStatus.ACCEPTED
    assert pia.superseded_at is None
    assert emirates.superseded_at is not None
    assert emirates.is_current is False


def test_generate_quotes_blocked_once_any_sibling_is_accepted(db_session):
    inquiry = _two_carrier_rate_cards(db_session)
    quotes = generate_quotes(db_session, inquiry.id, today=TODAY)
    pia = next(q for q in quotes if q.carrier == "PIA")
    accept_quote(db_session, pia.id, "ops", today=TODAY)

    with pytest.raises(InvalidQuoteState):
        generate_quotes(db_session, inquiry.id, today=TODAY)


# --- manual quotes ---


def _manual_line_items():
    return [
        ManualLineItem(
            kind=m.ChargeKind.FREIGHT, description="Freight (manual)",
            quantity=Decimal("100"), unit_price=Decimal("4.5000"), amount=Decimal("450.00"),
        ),
        ManualLineItem(
            kind=m.ChargeKind.DOCUMENTATION, description="AWB fee",
            quantity=Decimal("1"), unit_price=Decimal("25.0000"), amount=Decimal("25.00"),
        ),
    ]


def test_create_manual_quote(db_session):
    customer = make_customer(db_session)
    inquiry = make_inquiry(db_session, customer)

    quote = create_manual_quote(
        db_session, inquiry.id, carrier="Qatar Airways Cargo", currency="USD",
        line_items=_manual_line_items(), today=TODAY,
    )

    assert quote.carrier == "QATAR AIRWAYS CARGO"
    assert quote.is_manual is True
    assert quote.revision_number == 1
    assert quote.root_quote_id is None
    assert quote.subtotal == Decimal("475.00")
    assert quote.total > quote.subtotal  # standard markup still applied
    assert quote.shipment_stage == ShipmentStage.QUOTATION


def test_create_manual_quote_requires_at_least_one_line_item(db_session):
    customer = make_customer(db_session)
    inquiry = make_inquiry(db_session, customer)

    with pytest.raises(InvalidQuoteState):
        create_manual_quote(db_session, inquiry.id, carrier="X", currency="USD", line_items=[], today=TODAY)


def test_create_manual_quote_is_independent_of_auto_regeneration(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session, carrier="PIA", rate=Decimal("5.00"))
    inquiry = make_inquiry(db_session, customer)

    manual = create_manual_quote(
        db_session, inquiry.id, carrier="Qatar Airways Cargo", currency="USD",
        line_items=_manual_line_items(), today=TODAY,
    )
    auto_batch = generate_quotes(db_session, inquiry.id, today=TODAY)

    # The manual quote is untouched by generate_quotes -- still current,
    # not superseded, and not part of the auto batch.
    assert manual.superseded_at is None
    assert manual.is_current is True
    assert manual.id not in [q.id for q in auto_batch]

    # Regenerating the auto batch again doesn't touch the manual quote either.
    generate_quotes(db_session, inquiry.id, today=TODAY)
    assert manual.superseded_at is None


def test_create_manual_quote_blocked_once_inquiry_already_won(db_session):
    inquiry = _two_carrier_rate_cards(db_session)
    quotes = generate_quotes(db_session, inquiry.id, today=TODAY)
    accept_quote(db_session, quotes[0].id, "ops", today=TODAY)

    with pytest.raises(InvalidQuoteState):
        create_manual_quote(
            db_session, inquiry.id, carrier="Late Offer", currency="USD",
            line_items=_manual_line_items(), today=TODAY,
        )


def test_manual_quote_endpoint(client, db_session, ops_headers):
    customer = make_customer(db_session)
    inquiry = make_inquiry(db_session, customer)
    db_session.commit()

    r = client.post(
        "/quotes/manual",
        json={
            "inquiry_id": inquiry.id,
            "carrier": "Qatar Airways Cargo",
            "currency": "USD",
            "line_items": [
                {"kind": "freight", "description": "Freight (manual)", "quantity": "100", "unit_price": "4.5000", "amount": "450.00"},
            ],
        },
        headers=ops_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["carrier"] == "QATAR AIRWAYS CARGO"
    assert body["is_manual"] is True


def test_generate_endpoint_returns_a_list(client, db_session, ops_headers):
    customer = make_customer(db_session)
    simple_rate_card(db_session, carrier="PIA")
    simple_rate_card(db_session, carrier="Emirates SkyCargo")
    inquiry = make_inquiry(db_session, customer)
    db_session.commit()

    r = client.post("/quotes/generate", json={"inquiry_id": inquiry.id}, headers=ops_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) == 2
    assert {q["carrier"] for q in body} == {"PIA", "EMIRATES"}
