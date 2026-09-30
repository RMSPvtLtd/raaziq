"""Owns the Quote lifecycle: generation/revisioning, manual overrides,
sending, acceptance, and rejection. `recalculate_totals` is the only place a
Quote's subtotal, markup_amount, and total are derived from its line items —
nothing else computes those fields.

Status lifecycle (send/accept/reject only, not line-item editing):

    draft     -> may be sent, accepted, or rejected (if not expired)
    sent      -> may be accepted or rejected (if not expired); may not be re-sent
    accepted  -> terminal (repeated acceptance stays idempotent, see accept_quote)
    expired   -> terminal
    rejected  -> terminal

A draft/sent quote whose valid_until has passed is treated as expired the
next time it is touched by one of these operations (`_apply_lazy_expiry`).
There is no scheduler; expiry is evaluated lazily, on demand.

Revisions: re-generating a quote for an inquiry that already has a
draft/sent/rejected/expired quote does not touch that old row -- it marks it
`superseded_at` and creates a new Quote sharing the same `root_quote_id` with
`revision_number + 1` (see `generate_quote`). A superseded quote is
permanently frozen: `send_quote`/`accept_quote`/`reject_quote`/
`override_line_items`/`set_quote_adjustments` all refuse to act on one. An
inquiry whose current quote is already `accepted` cannot be re-quoted at all
(see `generate_quote`) -- a job is already open from it.

Line-item editing (`override_line_items`) is independent of quote status --
it's gated on the *shipment's* stage instead (see that function's
docstring): pricing can be corrected any time up until the shipment is
invoiced to the customer, not just while the quote is still a draft.

Parallel (multi-carrier) quotes: `generate_quotes` prices EVERY carrier with
a currently-valid rate card for the inquiry's lane/mode (`services.pricing
.price_all_matching`), not just the single best match -- one sibling Quote
per carrier, so a customer can compare offers and pick one. This is a
different kind of multiplicity from the revision chain above: a revision
replaces one offer with a re-priced version of itself (same carrier, same
`root_quote_id` lineage); siblings are competing offers from different
carriers that happen to exist at the same time. Both mechanisms reuse the
same `superseded_at` field for "no longer a live option" -- a revision
supersedes its own predecessor, and `accept_quote` supersedes every OTHER
still-open sibling the moment one is accepted (a job is open now; the rest
are moot). `Quote.carrier` distinguishes siblings; `revision_number`/
`root_quote_id` still track each carrier's own re-quote history independently.
`generate_quotes` only ever manages quotes it created itself (`is_manual=
False`) -- a quote created by `create_manual_quote` (ops typed a rate in by
hand, e.g. when no rate card matches) is a fully independent, additional
sibling that auto-regeneration never touches or supersedes.

`Shipment.quote_id` (unique) is set in exactly one place: `accept_quote`.
Before acceptance it stays null even once quotes exist -- there can be
several live sibling offers and no "the" quote yet, so nothing before
acceptance can meaningfully own that single-valued pointer. Every place that
used to read `quote.shipment` to find the shipment now goes through
`quote.inquiry.shipment` instead, which exists from the moment the inquiry
was filed and doesn't depend on any quote being the accepted one.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import get_settings
from utils.errors import InvalidMoneyAmount, InvalidQuoteState, NotFound, QuoteExpired
from utils.locations import carrier_name
from models.enums import ChargeKind, EventSource, QuoteStatus, ReferenceType, ShipmentStage
from models.inquiry import Inquiry
from models.quote import Quote, QuoteLineItem
from models.shipment import Shipment, ShipmentReference
from schemas.money import MAX_MONEY
from services.airline_schedules import snapshot_schedules
from services.email import send_pdf_email
from services.pdf_documents import render_quote_pdf
from services.pricing import price_all_matching
from services.shipments import allocate_job_number
from services.transitions import advance_stage, record_note

CENTS = Decimal("0.01")


def _quote_ref(quote: Quote) -> str:
    """Human-readable revision reference for audit notes and PDFs, e.g.
    'Q-12 Rev 2'. root_quote_id is null on the root quote itself."""
    return f"Q-{quote.root_quote_id or quote.id} Rev {quote.revision_number}"


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _get_quote(session: Session, quote_id: int) -> Quote:
    quote = session.get(Quote, quote_id)
    if quote is None:
        raise NotFound(f"Quote {quote_id} not found")
    return quote


def _apply_lazy_expiry(quote: Quote, today: date) -> None:
    if quote.status in (QuoteStatus.DRAFT, QuoteStatus.SENT) and quote.valid_until < today:
        quote.status = QuoteStatus.EXPIRED


def _assert_not_superseded(quote: Quote) -> None:
    """A superseded revision (see `generate_quote`) is permanently frozen --
    its `status` field may still read draft/sent from before it was
    superseded, so this is a separate check, not implied by status alone."""
    if quote.superseded_at is not None:
        raise InvalidQuoteState(
            f"{_quote_ref(quote)} has been superseded by a later revision and can no longer be acted on"
        )


def list_revisions(session: Session, quote_id: int) -> list[Quote]:
    """Every quote sharing `quote`'s revision family (including itself),
    oldest first -- the full, permanently auditable history of an inquiry's
    quote."""
    quote = _get_quote(session, quote_id)
    root_id = quote.root_quote_id or quote.id
    stmt = (
        select(Quote)
        .where((Quote.id == root_id) | (Quote.root_quote_id == root_id))
        .order_by(Quote.revision_number)
    )
    return list(session.execute(stmt).scalars())


def recalculate_totals(quote: Quote) -> None:
    """The only place Quote.subtotal / markup_amount / total are computed.
    Uses each line item's final_total — which equals calculated_total unless
    a pricing user overrode it — as the authoritative line amount.
    tax_amount/discount_amount are flat, ops-entered amounts (default zero,
    untouched here) rather than derived, so they're simply folded into total.

    Never trusts a client-supplied total: nothing here reads a total off a
    request, and no caller is able to set one — the value is always derived
    from stored line items. Raises rather than producing a negative total
    (see `_assert_total_is_sane`).
    """
    settings = get_settings()
    subtotal = _money(sum((li.final_total for li in quote.line_items), Decimal("0")))
    markup_amount = _money(subtotal * settings.default_markup_percent / Decimal("100"))
    total = _money(subtotal + markup_amount + quote.tax_amount - quote.discount_amount)
    _assert_total_is_sane(total)

    quote.subtotal = subtotal
    quote.markup_amount = markup_amount
    quote.total = total


def _assert_total_is_sane(total: Decimal) -> None:
    """A discount larger than the quote's value would otherwise produce a
    negative total -- an invoice that owes the customer money. Per-field
    validation can't catch this: each individual amount is within range, it's
    only their combination that's invalid, so the check has to live here
    where the arithmetic actually happens (and therefore covers every caller,
    including the seed script and any future one).
    """
    if total < 0:
        raise InvalidMoneyAmount(
            "Adjustments would make the quote total negative; "
            "the discount cannot exceed the quote's subtotal, markup and tax combined."
        )
    if total > MAX_MONEY:
        raise InvalidMoneyAmount(f"Quote total would exceed the maximum supported amount ({MAX_MONEY}).")


def _build_quote_line_items(quote: Quote, line_items) -> None:
    for line in line_items:
        quote.line_items.append(
            QuoteLineItem(
                kind=line.kind,
                description=line.description,
                quantity=line.quantity,
                unit_price=line.unit_price,
                calculated_total=line.calculated_total,
                final_total=line.calculated_total,
                markup_amount=line.markup_amount,
                is_manual_override=False,
            )
        )


def _assert_inquiry_not_already_won(session: Session, inquiry_id: int) -> None:
    """Shared guard for generate_quotes and create_manual_quote: once ANY
    quote for this inquiry (auto or manual, whichever carrier) has been
    accepted, a job is already open from it -- the inquiry can never be
    re-quoted at all, auto or manual. File a new inquiry instead."""
    accepted = session.execute(
        select(Quote).where(
            Quote.inquiry_id == inquiry_id,
            Quote.superseded_at.is_(None),
            Quote.status == QuoteStatus.ACCEPTED,
        )
    ).scalar_one_or_none()
    if accepted is not None:
        raise InvalidQuoteState(
            f"Inquiry {inquiry_id} already has an accepted quote ({_quote_ref(accepted)}) "
            "with an open job; it cannot be re-quoted"
        )


def _locked_shipment_for_inquiry(session: Session, inquiry_id: int) -> Shipment:
    # All siblings share this lock. Reload after waiting: an identity-map
    # copy can predate another request's acceptance or regeneration.
    stmt = select(Shipment).where(Shipment.inquiry_id == inquiry_id).execution_options(populate_existing=True)
    if session.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    shipment = session.execute(stmt).scalar_one_or_none()
    if shipment is None:
        raise NotFound(f"Inquiry {inquiry_id} has no tracking record")
    return shipment


def _locked_quote_for_action(session: Session, quote_id: int) -> tuple[Quote, Shipment]:
    quote = _get_quote(session, quote_id)
    shipment = _locked_shipment_for_inquiry(session, quote.inquiry_id)
    stmt = select(Quote).where(Quote.id == quote_id).execution_options(populate_existing=True)
    if session.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    return session.execute(stmt).scalar_one(), shipment


def generate_quotes(session: Session, inquiry_id: int, *, today: date | None = None) -> list[Quote]:
    """Prices every carrier with a currently-valid rate card for this
    inquiry's lane/mode (`services.pricing.price_all_matching`) and returns
    one sibling Quote per carrier -- see the module docstring's "Parallel
    (multi-carrier) quotes" section for how this interacts with the
    per-carrier revision chain, manual quotes, and acceptance.

    Raises NoApplicableRate (unchanged from the single-card days) only when
    NO carrier has a matching rate card at all -- the caller's fallback in
    that case is `create_manual_quote`, not a retry here.
    """
    today = today or date.today()
    inquiry = session.get(Inquiry, inquiry_id)
    if inquiry is None:
        raise NotFound(f"Inquiry {inquiry_id} not found")
    if inquiry.shipment is None:
        # Every Inquiry gets a Shipment row at creation (services.inquiries) --
        # this would only be missing for data created before that existed.
        raise NotFound(f"Inquiry {inquiry_id} has no tracking record")

    shipment = _locked_shipment_for_inquiry(session, inquiry.id)
    _assert_inquiry_not_already_won(session, inquiry_id)

    settings = get_settings()
    priced_list = price_all_matching(session, inquiry, today=today)

    # Only this function's own past output is eligible to be superseded by
    # this function -- a manual quote (is_manual=True) is a fully separate
    # sibling that auto-regeneration never touches (see module docstring).
    current_auto = list(
        session.execute(
            select(Quote).where(
                Quote.inquiry_id == inquiry_id,
                Quote.superseded_at.is_(None),
                Quote.is_manual.is_(False),
            ).order_by(Quote.id).execution_options(populate_existing=True)
        ).scalars()
    )
    current_by_carrier = {carrier_name(q.carrier): q for q in current_auto}

    pairs: list[tuple[Quote, Quote | None]] = []
    for priced in priced_list:
        old = current_by_carrier.pop(priced.carrier, None)
        quote = Quote(
            inquiry_id=inquiry.id,
            status=QuoteStatus.DRAFT,
            currency=priced.currency,
            carrier=priced.carrier,
            is_manual=False,
            valid_until=min(today + timedelta(days=settings.quote_validity_days), priced.valid_until),
            clauses=old.clauses if old else None,
            schedule_snapshot=snapshot_schedules(session, inquiry, priced.carrier, today),
            tax_amount=Decimal("0"),
            discount_amount=Decimal("0"),
            revision_number=(old.revision_number + 1) if old else 1,
            root_quote_id=(old.root_quote_id or old.id) if old else None,
        )
        _build_quote_line_items(quote, priced.line_items)
        recalculate_totals(quote)
        session.add(quote)
        pairs.append((quote, old))

    session.flush()  # assigns ids -- _quote_ref below needs them

    now = datetime.now(timezone.utc)
    for quote, old in pairs:
        if old is not None:
            old.superseded_at = now
            record_note(
                session, shipment, actor="system",
                note=f"{_quote_ref(quote)} created, superseding {_quote_ref(old)}.",
                source=EventSource.SYSTEM, is_internal=True,
            )
    replaced_carriers = {quote.carrier for quote, _ in pairs}
    for dropped in current_auto:
        if dropped.superseded_at is not None:
            continue
        # Visit all originals: legacy aliases can share one dictionary key.
        dropped.superseded_at = now
        reason = (
            "replaced by the latest offer for its airline"
            if carrier_name(dropped.carrier) in replaced_carriers
            else "no matching rate card for its carrier"
        )
        record_note(
            session, shipment, actor="system",
            note=f"{_quote_ref(dropped)} is no longer offered: {reason}.",
            source=EventSource.SYSTEM, is_internal=True,
        )

    if shipment.stage == ShipmentStage.INQUIRY:
        # First batch for this inquiry -> advance the tracking record.
        # Regenerating later just supersedes/replaces siblings above without
        # moving the stage again.
        carriers = ", ".join(quote.carrier or "unspecified carrier" for quote, _ in pairs)
        advance_stage(
            session, shipment, ShipmentStage.QUOTATION,
            actor="system", note=f"{len(pairs)} quote(s) generated ({carriers}).", source=EventSource.SYSTEM,
        )
    session.flush()
    return [quote for quote, _ in pairs]


def generate_quote(session: Session, inquiry_id: int, *, today: date | None = None) -> Quote:
    """Back-compat convenience for the common single-carrier case (still the
    overwhelming majority of this codebase's tests and the seed script):
    generates the full carrier batch and returns just the first quote. New
    code that needs to show every carrier option should call
    `generate_quotes` directly instead."""
    return generate_quotes(session, inquiry_id, today=today)[0]


@dataclass(frozen=True)
class ManualLineItem:
    kind: ChargeKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


def create_manual_quote(
    session: Session,
    inquiry_id: int,
    *,
    carrier: str,
    currency: str,
    line_items: list[ManualLineItem],
    today: date | None = None,
    valid_until: date | None = None,
    clauses: str | None = None,
) -> Quote:
    """Lets ops price a quote by hand -- typing in today's rate directly,
    the way filling in one rate-card break by hand would -- for a carrier
    with no matching rate card, or just another offer ops wants to add
    alongside the auto-priced ones. The standard markup is still applied on
    top via `recalculate_totals` (same as every other quote in this app --
    ops enters base rates, not the final marked-up customer price, exactly
    like a rate card break); `amount` here plays the role `calculated_total`
    plays for an engine-priced line.

    Always a fresh, independent lineage (revision_number=1, root_quote_id=
    None, is_manual=True): never supersedes and is never superseded by
    `generate_quotes`'s auto-regeneration -- ops manages it entirely by hand
    (edit via `override_line_items`, remove via `reject_quote`).
    """
    today = today or date.today()
    if not line_items:
        raise InvalidQuoteState("A manual quote needs at least one line item")
    if valid_until is not None and valid_until < today:
        raise InvalidQuoteState("Quote validity cannot end before today")
    carrier = carrier_name(carrier)
    if not carrier:
        raise InvalidQuoteState("A manual quote needs an airline")

    inquiry = session.get(Inquiry, inquiry_id)
    if inquiry is None:
        raise NotFound(f"Inquiry {inquiry_id} not found")
    if inquiry.shipment is None:
        raise NotFound(f"Inquiry {inquiry_id} has no tracking record")

    shipment = _locked_shipment_for_inquiry(session, inquiry.id)
    _assert_inquiry_not_already_won(session, inquiry_id)

    settings = get_settings()
    quote = Quote(
        inquiry_id=inquiry.id,
        status=QuoteStatus.DRAFT,
        currency=currency,
        carrier=carrier,
        is_manual=True,
        valid_until=valid_until or today + timedelta(days=settings.quote_validity_days),
        clauses=clauses,
        schedule_snapshot=snapshot_schedules(session, inquiry, carrier, today),
        tax_amount=Decimal("0"),
        discount_amount=Decimal("0"),
        revision_number=1,
        root_quote_id=None,
    )
    for li in line_items:
        amount = _money(li.amount)
        quote.line_items.append(
            QuoteLineItem(
                kind=li.kind,
                description=li.description,
                quantity=li.quantity,
                unit_price=li.unit_price,
                calculated_total=amount,
                final_total=amount,
                markup_amount=_money(amount * settings.default_markup_percent / Decimal("100")),
                is_manual_override=False,
            )
        )
    recalculate_totals(quote)
    session.add(quote)
    session.flush()

    if shipment.stage == ShipmentStage.INQUIRY:
        advance_stage(
            session, shipment, ShipmentStage.QUOTATION,
            actor="system", note=f"{_quote_ref(quote)} (manual, {carrier}) generated.", source=EventSource.SYSTEM,
        )
    record_note(
        session, shipment, actor="ops",
        note=f"{_quote_ref(quote)} added manually for carrier {carrier}.",
        source=EventSource.SYSTEM, is_internal=True,
    )
    session.flush()
    return quote


@dataclass(frozen=True)
class LineItemOverride:
    line_item_id: int
    final_total: Decimal


def override_line_items(
    session: Session, quote_id: int, overrides: list[LineItemOverride], *, today: date | None = None
) -> Quote:
    """Editable regardless of quote status (draft/sent/accepted/expired) --
    only blocked once the quote's shipment has reached its terminal stage,
    invoice_to_customer. A quote with no shipment reference (superseded by a
    later re-quote, see `generate_quote`) has nothing that can have "ended",
    so it stays editable.
    """
    today = today or date.today()
    quote = _get_quote(session, quote_id)
    _apply_lazy_expiry(quote, today)
    _assert_not_superseded(quote)

    if quote.shipment is not None and quote.shipment.stage == ShipmentStage.INVOICE_TO_CUSTOMER:
        raise InvalidQuoteState(f"Quote {quote.id} cannot be edited: its shipment has already been invoiced")

    line_items_by_id = {li.id: li for li in quote.line_items}
    for override in overrides:
        line_item = line_items_by_id.get(override.line_item_id)
        if line_item is None:
            raise NotFound(f"Line item {override.line_item_id} not found on quote {quote_id}")
        # quantity, unit_price, and calculated_total are untouched — the
        # original pricing calculation is preserved for reference.
        line_item.final_total = _money(override.final_total)
        line_item.is_manual_override = True

    recalculate_totals(quote)
    session.flush()
    return quote


def set_quote_adjustments(
    session: Session, quote_id: int, *, tax_amount: Decimal, discount_amount: Decimal, today: date | None = None
) -> Quote:
    """Set the quote's flat tax/discount amounts. Same editability rule as
    override_line_items -- blocked only once the shipment has been invoiced.
    """
    today = today or date.today()
    quote = _get_quote(session, quote_id)
    _apply_lazy_expiry(quote, today)
    _assert_not_superseded(quote)

    if quote.shipment is not None and quote.shipment.stage == ShipmentStage.INVOICE_TO_CUSTOMER:
        raise InvalidQuoteState(f"Quote {quote.id} cannot be edited: its shipment has already been invoiced")

    quote.tax_amount = _money(tax_amount)
    quote.discount_amount = _money(discount_amount)
    recalculate_totals(quote)
    session.flush()
    return quote


def set_quote_clauses(session: Session, quote_id: int, *, clauses: str | None, today: date | None = None) -> Quote:
    """Set the quote's free-text trading terms/clauses, printed on the quote
    PDF and copied onto any invoice generated from it afterward
    (Invoice.clauses_snapshot). Same editability rule as set_quote_adjustments
    -- blocked only once the shipment has been invoiced. Doesn't touch
    totals, so no recalculate_totals call."""
    today = today or date.today()
    quote = _get_quote(session, quote_id)
    _apply_lazy_expiry(quote, today)
    _assert_not_superseded(quote)

    if quote.shipment is not None and quote.shipment.stage == ShipmentStage.INVOICE_TO_CUSTOMER:
        raise InvalidQuoteState(f"Quote {quote.id} cannot be edited: its shipment has already been invoiced")

    quote.clauses = clauses
    session.flush()
    return quote


def email_quote(session: Session, quote_id: int, *, automatic: bool = False) -> Quote:
    """Emails the quote's PDF to the inquiry's customer."""
    quote = _get_quote(session, quote_id)
    customer = quote.inquiry.customer

    from services.companies import list_companies
    from services.email import deliver_document_email
    companies = list_companies(session)
    company = next((c for c in companies if c.is_default), companies[0] if companies else None)
    return deliver_document_email(
        session, quote, company=company, automatic=automatic,
        to_email=customer.email,
        subject=f"Quotation {_quote_ref(quote)} - Raaziq International",
        body_text=(
            f"Dear {customer.name},\n\nPlease find attached our quotation {_quote_ref(quote)} "
            f"for {quote.inquiry.origin} to {quote.inquiry.destination}.\n\nRegards,\nRaaziq International"
        ),
        pdf_factory=lambda: render_quote_pdf(session, quote, customer_safe=True),
        pdf_filename=f"quote-{quote.id}.pdf",
    )


def send_quote(session: Session, quote_id: int, *, today: date | None = None) -> Quote:
    """Publish once; API delivery happens after this transaction commits."""
    today = today or date.today()
    quote, _ = _locked_quote_for_action(session, quote_id)
    _apply_lazy_expiry(quote, today)
    _assert_not_superseded(quote)

    if quote.status != QuoteStatus.DRAFT:
        raise InvalidQuoteState(f"Quote {quote.id} cannot be sent from status {quote.status.value}")

    quote.status = QuoteStatus.SENT
    session.flush()
    return quote


def accept_quote(session: Session, quote_id: int, actor: str, *, today: date | None = None) -> Shipment:
    """Transactional and idempotent. Raises without mutating anything on an
    expired or inconsistent quote. Does not commit — the caller's
    transaction boundary decides when this becomes durable, which is what
    lets a failure anywhere in this function roll back the quote status
    change, the job number counter increment, and the shipment stage
    transition together.

    The Shipment already exists (created with the Inquiry — see
    services.inquiries.create_inquiry) and was moved to QUOTATION when this
    quote was generated; accepting advances that same row to JOB_OPENING and
    assigns its job number, rather than creating a new row.
    """
    today = today or date.today()

    quote, shipment = _locked_quote_for_action(session, quote_id)

    if shipment.job_number is not None:
        # Idempotent: a quote already accepted (job number already assigned)
        # returns the existing shipment rather than re-processing.
        if shipment.quote_id == quote.id:
            return shipment
        raise InvalidQuoteState(
            f"Inquiry {quote.inquiry_id} already has an open job from a different quote"
        )

    _apply_lazy_expiry(quote, today)
    _assert_not_superseded(quote)

    if quote.status == QuoteStatus.EXPIRED:
        raise QuoteExpired(f"Quote {quote.id} expired on {quote.valid_until}")
    if quote.status == QuoteStatus.ACCEPTED:
        # status=accepted but the shipment has no job number: an inconsistent
        # state that must be rejected rather than silently opening a job.
        raise InvalidQuoteState(f"Quote {quote.id} is already accepted but its shipment has no job number")
    if quote.status not in (QuoteStatus.DRAFT, QuoteStatus.SENT):
        raise InvalidQuoteState(f"Quote {quote.id} cannot be accepted from status {quote.status.value}")

    quote.status = QuoteStatus.ACCEPTED

    job_number = allocate_job_number(session, today.year)
    shipment.quote_id = quote.id
    shipment.job_number = job_number
    shipment.carrier = carrier_name(quote.carrier)

    advance_stage(
        session, shipment, ShipmentStage.JOB_OPENING,
        actor=actor, note="Job opened from accepted quote.", source=EventSource.SYSTEM,
    )
    shipment.references.append(ShipmentReference(type=ReferenceType.JOB_NUMBER, value=job_number))
    record_note(
        session, shipment, actor=actor,
        note=f"{_quote_ref(quote)} accepted.", source=EventSource.SYSTEM, is_internal=True,
    )

    # Every other still-open sibling for this inquiry (a different carrier,
    # or a manual quote) is now moot -- a job is open from this one instead.
    # Reuses superseded_at for that meaning too (see module docstring).
    siblings_stmt = select(Quote).where(
        Quote.inquiry_id == quote.inquiry_id, Quote.id != quote.id, Quote.superseded_at.is_(None)
    )
    superseded_at = datetime.now(timezone.utc)
    for sibling in session.execute(siblings_stmt).scalars():
        sibling.superseded_at = superseded_at
        record_note(
            session, shipment, actor=actor,
            note=f"{_quote_ref(sibling)} superseded: {_quote_ref(quote)} was accepted instead.",
            source=EventSource.SYSTEM, is_internal=True,
        )

    session.flush()
    return shipment


def reject_quote(
    session: Session, quote_id: int, *, reason: str, actor: str, today: date | None = None
) -> Quote:
    """Ops-only rejection -- the customer portal can accept a sibling quote
    (see api/customer_portal.py) but never rejects one directly; declining
    an offer there just means picking a different sibling or not accepting
    any. Same row-locking and lazy-expiry pattern as accept_quote, so a
    quote can't be rejected and accepted by two concurrent requests. Only
    valid from draft/sent -- an accepted quote can never "silently become
    rejected", and an already-rejected/expired quote is terminal (the way
    forward is a new revision via generate_quotes, or a manual quote, not
    un-rejecting this row).
    """
    today = today or date.today()
    if not reason or not reason.strip():
        raise InvalidQuoteState("A rejection reason is required")

    quote, shipment = _locked_quote_for_action(session, quote_id)

    _apply_lazy_expiry(quote, today)
    _assert_not_superseded(quote)

    if quote.status not in (QuoteStatus.DRAFT, QuoteStatus.SENT):
        raise InvalidQuoteState(f"Quote {quote.id} cannot be rejected from status {quote.status.value}")

    quote.status = QuoteStatus.REJECTED
    quote.rejected_reason = reason
    quote.rejected_by = actor
    quote.rejected_at = datetime.now(timezone.utc)

    # Not quote.shipment -- see Quote.shipment_stage's docstring: that FK is
    # only set once a quote is accepted, so it would be None here for the
    # ordinary case of rejecting an offer that was never accepted, silently
    # dropping the audit note. The inquiry's shipment always exists.
    if shipment is not None:
        record_note(
            session, shipment, actor=actor,
            note=f"{_quote_ref(quote)} rejected: {reason}", source=EventSource.SYSTEM, is_internal=True,
        )
    session.flush()
    return quote
