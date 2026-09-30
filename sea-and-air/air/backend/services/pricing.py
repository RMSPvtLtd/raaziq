"""Deterministic freight pricing. This module calculates a price; it never
writes to the database — `services.quotes.generate_quote` is what persists a
`PricedQuote` as a `Quote` + `QuoteLineItem` rows. Keeping the two separated
means the pricing rules can be unit-tested without a database at all, and
re-priced (e.g. for a "what would this cost today" preview) without side
effects.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import Settings, get_settings
from utils.errors import NoApplicableRate
from utils.locations import carrier_name, location_aliases
from models.enums import ChargeBasis, ChargeKind, TransportMode, UnitOfMeasure
from models.inquiry import Inquiry
from models.rate_card import RateCard, RateCardBreak, RateCardCharge

CENTS = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class PricedLineItem:
    kind: ChargeKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    calculated_total: Decimal
    markup_amount: Decimal


@dataclass(frozen=True)
class PricedQuote:
    currency: str
    rate_card_id: int
    valid_until: date
    carrier: str | None = None
    line_items: list[PricedLineItem] = field(default_factory=list)
    subtotal: Decimal = Decimal("0")
    markup_amount: Decimal = Decimal("0")
    total: Decimal = Decimal("0")


_VOLUMETRIC_FACTOR_BY_MODE = {
    TransportMode.AIR: "volumetric_factor_air",
    TransportMode.SEA: "volumetric_factor_sea",
    TransportMode.ROAD: "volumetric_factor_road",
}


def _volumetric_factor(mode: TransportMode, settings: Settings) -> Decimal:
    return getattr(settings, _VOLUMETRIC_FACTOR_BY_MODE[mode])


def compute_chargeable_weight(inquiry: Inquiry, settings: Settings) -> Decimal:
    """The greater of actual and volumetric weight -- exported (not just an
    internal helper) so document generation can print it without
    re-deriving or persisting a redundant column."""
    volumetric_weight = Decimal(inquiry.volume_cbm) * _volumetric_factor(inquiry.mode, settings)
    return max(Decimal(inquiry.weight_kg), volumetric_weight)


def _matching_rate_cards_stmt(inquiry: Inquiry, today: date):
    # When overlapping valid cards match, the card with the most recent valid_from wins.
    return (
        select(RateCard)
        .where(
            func.upper(RateCard.origin).in_(location_aliases(inquiry.origin)),
            func.upper(RateCard.destination).in_(location_aliases(inquiry.destination)),
            RateCard.mode == inquiry.mode,
            RateCard.valid_from <= today,
            RateCard.valid_until >= today,
        )
        .order_by(RateCard.valid_from.desc(), RateCard.id.desc())
    )


def _select_rate_card(session: Session, inquiry: Inquiry, today: date) -> RateCard:
    rate_card = session.execute(_matching_rate_cards_stmt(inquiry, today)).scalars().first()
    if rate_card is None:
        raise NoApplicableRate(
            f"No valid rate card for {inquiry.origin} -> {inquiry.destination} ({inquiry.mode.value})"
        )
    return rate_card


def _select_rate_cards(session: Session, inquiry: Inquiry, today: date) -> list[RateCard]:
    """Every carrier with a currently-valid rate card for this lane/mode --
    one card per carrier. When several valid cards share a carrier (e.g. ops
    entered a corrected rate), only the one with the most recent valid_from
    is kept, exactly like `_select_rate_card`'s single-card tie-break.
    Cards with no carrier set collapse into a single `None`-keyed group, so
    a lane with one anonymous card still yields exactly one quote.

    Sorted by carrier name (case-insensitive), with the carrier-less group
    last, so the resulting quotes always list in a stable, predictable order.
    """
    all_matches = list(session.execute(_matching_rate_cards_stmt(inquiry, today)).scalars())
    if not all_matches:
        raise NoApplicableRate(
            f"No valid rate card for {inquiry.origin} -> {inquiry.destination} ({inquiry.mode.value})"
        )

    best_by_carrier: dict[str | None, RateCard] = {}
    for card in all_matches:
        # all_matches is already valid_from-desc, so the first card seen per
        # carrier is that carrier's most recent one -- nothing to compare.
        best_by_carrier.setdefault(carrier_name(card.carrier), card)

    return sorted(best_by_carrier.values(), key=lambda c: (carrier_name(c.carrier) is None, carrier_name(c.carrier) or ""))


def _bound_matches(value: Decimal, lower: Decimal | None, upper: Decimal | None) -> bool:
    # Half-open range [lower, upper): lower inclusive, upper exclusive. A
    # missing bound means that dimension imposes no restriction. An
    # open-ended final break (upper is None) matches anything at or above
    # lower.
    if lower is not None and value < lower:
        return False
    if upper is not None and value >= upper:
        return False
    return True


def _break_specificity(brk: RateCardBreak) -> int:
    return sum(
        bound is not None for bound in (brk.min_weight, brk.max_weight, brk.min_volume, brk.max_volume)
    )


def _select_break(rate_card: RateCard, chargeable_weight: Decimal, volume_cbm: Decimal) -> RateCardBreak:
    matches = [
        brk
        for brk in rate_card.breaks
        if _bound_matches(chargeable_weight, brk.min_weight, brk.max_weight)
        and _bound_matches(volume_cbm, brk.min_volume, brk.max_volume)
    ]
    if not matches:
        raise NoApplicableRate(
            f"No rate break on card {rate_card.id} covers weight={chargeable_weight} volume={volume_cbm}"
        )
    # Prefer the most specific match (most bounds configured); fall back to
    # the lowest id for a deterministic result among equally specific breaks.
    matches.sort(key=lambda brk: (-_break_specificity(brk), brk.id))
    return matches[0]


def applicable_charges(incoterm: str, charges: list[RateCardCharge]) -> list[RateCardCharge]:
    """Owns all Incoterm-driven charge filtering for the MVP. These are
    deliberately simplified Raaziq pricing heuristics, not a full
    implementation of Incoterms:

    EXW           -> exclude pickup charges
    DAP, DDP      -> include customs charges (no exclusion — same as default)
    FOB, CFR      -> exclude customs charges
    other/unknown -> include all configured charges

    No behavior beyond these six cases is inferred.
    """
    code = (incoterm or "").strip().upper()
    if code == "EXW":
        return [c for c in charges if c.kind != ChargeKind.PICKUP]
    if code in ("FOB", "CFR"):
        return [c for c in charges if c.kind != ChargeKind.CUSTOMS]
    return list(charges)


def _quantity_and_unit_price(unit: UnitOfMeasure, rate: Decimal, chargeable_weight: Decimal, volume_cbm: Decimal):
    if unit == UnitOfMeasure.PER_KG:
        return chargeable_weight, rate
    if unit == UnitOfMeasure.PER_CBM:
        return volume_cbm, rate
    return Decimal("1"), rate  # flat


def _price_freight(
    brk: RateCardBreak, minimum_charge: Decimal, chargeable_weight: Decimal, volume_cbm: Decimal, markup_percent: Decimal
) -> PricedLineItem:
    quantity, unit_price = _quantity_and_unit_price(brk.unit, brk.rate, chargeable_weight, volume_cbm)
    calculated_total = _money(max(quantity * unit_price, minimum_charge))
    return PricedLineItem(
        kind=ChargeKind.FREIGHT,
        description=brk.description or "Freight",
        quantity=quantity,
        unit_price=unit_price,
        calculated_total=calculated_total,
        markup_amount=_money(calculated_total * markup_percent / Decimal("100")),
    )


def _price_charge(
    charge: RateCardCharge, freight_total: Decimal, chargeable_weight: Decimal, markup_percent: Decimal
) -> PricedLineItem:
    if charge.basis == ChargeBasis.FLAT:
        quantity, unit_price = Decimal("1"), charge.amount
        calculated_total = _money(charge.amount)
    elif charge.basis == ChargeBasis.PER_KG:
        quantity, unit_price = chargeable_weight, charge.amount
        calculated_total = _money(chargeable_weight * charge.amount)
    else:  # PERCENT_OF_FREIGHT — amount is a whole percent, e.g. 5.00 == 5%.
        calculated_total = _money(freight_total * charge.amount / Decimal("100"))
        quantity, unit_price = Decimal("1"), calculated_total

    return PricedLineItem(
        kind=charge.kind,
        description=charge.description,
        quantity=quantity,
        unit_price=unit_price,
        calculated_total=calculated_total,
        markup_amount=_money(calculated_total * markup_percent / Decimal("100")),
    )


def _price_with_rate_card(rate_card: RateCard, inquiry: Inquiry, settings: Settings) -> PricedQuote:
    """The actual pricing math, independent of how `rate_card` was chosen --
    shared by `price_inquiry` (one best-matching card) and
    `price_all_matching` (one card per carrier), so there's exactly one
    implementation of the freight/charges/markup calculation."""
    chargeable_weight = compute_chargeable_weight(inquiry, settings)
    volume_cbm = Decimal(inquiry.volume_cbm)

    brk = _select_break(rate_card, chargeable_weight, volume_cbm)
    markup_percent = settings.default_markup_percent

    freight_line = _price_freight(brk, rate_card.minimum_charge, chargeable_weight, volume_cbm, markup_percent)
    line_items = [freight_line]

    for charge in applicable_charges(inquiry.incoterm, rate_card.charges):
        line_items.append(_price_charge(charge, freight_line.calculated_total, chargeable_weight, markup_percent))

    subtotal = _money(sum((li.calculated_total for li in line_items), Decimal("0")))
    markup_amount = _money(sum((li.markup_amount for li in line_items), Decimal("0")))
    total = _money(subtotal + markup_amount)

    return PricedQuote(
        currency=rate_card.currency,
        rate_card_id=rate_card.id,
        valid_until=rate_card.valid_until,
        carrier=carrier_name(rate_card.carrier),
        line_items=line_items,
        subtotal=subtotal,
        markup_amount=markup_amount,
        total=total,
    )


def price_inquiry(session: Session, inquiry: Inquiry, *, today: date | None = None) -> PricedQuote:
    settings = get_settings()
    today = today or date.today()
    rate_card = _select_rate_card(session, inquiry, today)
    return _price_with_rate_card(rate_card, inquiry, settings)


def price_all_matching(session: Session, inquiry: Inquiry, *, today: date | None = None) -> list[PricedQuote]:
    """One PricedQuote per carrier with a currently-valid rate card for this
    lane/mode -- lets the customer compare offers from different airlines.
    Raises NoApplicableRate (same as price_inquiry) only when NO carrier has
    a matching card at all; a single carrier still returns a one-item list.
    """
    settings = get_settings()
    today = today or date.today()
    rate_cards = _select_rate_cards(session, inquiry, today)
    priced = []
    for rate_card in rate_cards:
        try:
            priced.append(_price_with_rate_card(rate_card, inquiry, settings))
        except NoApplicableRate:
            # A carrier with no weight/volume tier must not hide other offers.
            continue
    if not priced:
        raise NoApplicableRate("No carrier has an applicable rate break for this shipment")
    return priced
