from datetime import date
from decimal import Decimal

import pytest

from utils.errors import NoApplicableRate
from models.enums import ChargeBasis, ChargeKind, TransportMode, UnitOfMeasure
from services.pricing import applicable_charges, price_all_matching, price_inquiry
from factories import add_break, add_charge, make_customer, make_inquiry, make_rate_card, simple_rate_card

TODAY = date(2026, 6, 1)


def test_valid_rate_card_match(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)

    priced = price_inquiry(db_session, inquiry, today=TODAY)

    assert priced.total > 0
    assert any(li.kind == ChargeKind.FREIGHT for li in priced.line_items)


def test_no_rate_card_raises(db_session):
    customer = make_customer(db_session)
    inquiry = make_inquiry(db_session, customer)

    with pytest.raises(NoApplicableRate):
        price_inquiry(db_session, inquiry, today=TODAY)


def test_expired_rate_card_raises(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session, valid_from=date(2020, 1, 1), valid_until=date(2021, 1, 1))
    inquiry = make_inquiry(db_session, customer)

    with pytest.raises(NoApplicableRate):
        price_inquiry(db_session, inquiry, today=TODAY)


def test_overlapping_rate_cards_most_recent_valid_from_wins(db_session):
    customer = make_customer(db_session)
    older = make_rate_card(db_session, carrier="OlderCarrier", valid_from=date(2024, 1, 1), valid_until=date(2030, 1, 1))
    add_break(db_session, older, min_weight=Decimal("0"), max_weight=None, rate=Decimal("9.00"))

    newer = make_rate_card(db_session, carrier="NewerCarrier", valid_from=date(2025, 6, 1), valid_until=date(2030, 1, 1))
    add_break(db_session, newer, min_weight=Decimal("0"), max_weight=None, rate=Decimal("3.00"))

    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("10"), volume_cbm=Decimal("0.01"))

    priced = price_inquiry(db_session, inquiry, today=TODAY)

    assert priced.rate_card_id == newer.id
    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    assert freight.unit_price == Decimal("3.00")


@pytest.mark.parametrize(
    "weight,expected_rate",
    [
        (Decimal("99.999"), Decimal("6.00")),   # just under 100 -> first break
        (Decimal("100"), Decimal("4.00")),      # exactly 100 -> second break (lower bound inclusive)
        (Decimal("499.999"), Decimal("4.00")),  # just under 500 -> second break
        (Decimal("500"), Decimal("2.00")),      # exactly 500 -> third break (open-ended)
    ],
)
def test_break_boundaries_half_open(db_session, weight, expected_rate):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session)
    add_break(db_session, rate_card, min_weight=Decimal("0"), max_weight=Decimal("100"), rate=Decimal("6.00"))
    add_break(db_session, rate_card, min_weight=Decimal("100"), max_weight=Decimal("500"), rate=Decimal("4.00"))
    add_break(db_session, rate_card, min_weight=Decimal("500"), max_weight=None, rate=Decimal("2.00"))

    inquiry = make_inquiry(db_session, customer, weight_kg=weight, volume_cbm=Decimal("0.001"))
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    assert freight.unit_price == expected_rate


def test_volume_break_boundary_half_open(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session, mode=TransportMode.SEA)
    add_break(
        db_session, rate_card, unit=UnitOfMeasure.PER_CBM,
        min_volume=Decimal("0"), max_volume=Decimal("100"), rate=Decimal("40.00"),
    )
    add_break(
        db_session, rate_card, unit=UnitOfMeasure.PER_CBM,
        min_volume=Decimal("100"), max_volume=None, rate=Decimal("30.00"),
    )

    inquiry = make_inquiry(
        db_session, customer, mode=TransportMode.SEA, weight_kg=Decimal("1"), volume_cbm=Decimal("100")
    )
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    assert freight.unit_price == Decimal("30.00")


def test_weight_only_break_ignores_volume(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session)
    add_break(db_session, rate_card, min_weight=Decimal("0"), max_weight=None, rate=Decimal("5.00"))

    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("50"), volume_cbm=Decimal("999"))
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    assert priced.line_items  # matches regardless of volume since the break has no volume bound


def test_volume_only_break_ignores_weight(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session, mode=TransportMode.SEA)
    add_break(
        db_session, rate_card, unit=UnitOfMeasure.PER_CBM,
        min_volume=Decimal("0"), max_volume=None, rate=Decimal("30.00"),
    )

    inquiry = make_inquiry(
        db_session, customer, mode=TransportMode.SEA, weight_kg=Decimal("99999"), volume_cbm=Decimal("5")
    )
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    assert priced.line_items


def test_break_requires_both_dimensions_when_both_configured(db_session):
    customer = make_customer(db_session)
    # Weight bound is deliberately wide so the volumetric-weight contribution
    # (volume * VOLUMETRIC_FACTOR_AIR) still falls inside it -- this isolates
    # the volume bound as the one dimension that fails to match.
    rate_card = make_rate_card(db_session, mode=TransportMode.AIR)
    add_break(
        db_session, rate_card,
        min_weight=Decimal("0"), max_weight=Decimal("100000"),
        min_volume=Decimal("0"), max_volume=Decimal("10"),
        rate=Decimal("30.00"),
    )

    inquiry = make_inquiry(
        db_session, customer, mode=TransportMode.AIR, weight_kg=Decimal("500"), volume_cbm=Decimal("15")
    )
    with pytest.raises(NoApplicableRate):
        price_inquiry(db_session, inquiry, today=TODAY)


def test_no_matching_break_raises(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session)
    add_break(db_session, rate_card, min_weight=Decimal("0"), max_weight=Decimal("10"), rate=Decimal("5.00"))

    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("500"), volume_cbm=Decimal("0.01"))
    with pytest.raises(NoApplicableRate):
        price_inquiry(db_session, inquiry, today=TODAY)


def test_volumetric_weight_used_when_greater_than_actual(db_session):
    from config import get_settings

    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session)
    add_break(db_session, rate_card, min_weight=Decimal("0"), max_weight=Decimal("100"), rate=Decimal("5.00"))
    add_break(db_session, rate_card, min_weight=Decimal("100"), max_weight=None, rate=Decimal("3.00"))

    # Actual weight (10kg) alone stays in the first break, but 1 CBM at the
    # air volumetric factor (167 kg/CBM by default) is a chargeable weight
    # over 100kg, which must push this into the second break instead.
    factor = get_settings().volumetric_factor_air
    assert factor > Decimal("100"), "test assumes the default air volumetric factor exceeds 100kg/CBM"
    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("10"), volume_cbm=Decimal("1"))

    priced = price_inquiry(db_session, inquiry, today=TODAY)
    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    assert freight.unit_price == Decimal("3.00")


def test_minimum_charge_floor_applied(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session, minimum_charge=Decimal("500"))
    add_break(db_session, rate_card, min_weight=Decimal("0"), max_weight=None, rate=Decimal("1.00"))

    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("10"), volume_cbm=Decimal("0.01"))
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    assert freight.calculated_total == Decimal("500.00")


def test_per_kg_charge(db_session):
    customer = make_customer(db_session)
    rate_card = simple_rate_card(db_session)
    add_charge(db_session, rate_card, kind=ChargeKind.HANDLING, description="Handling", basis=ChargeBasis.PER_KG, amount=Decimal("0.50"))

    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("100"), volume_cbm=Decimal("0.01"))
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    handling = next(li for li in priced.line_items if li.kind == ChargeKind.HANDLING)
    assert handling.calculated_total == Decimal("50.00")


def test_per_cbm_freight(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session, mode=TransportMode.SEA)
    add_break(db_session, rate_card, unit=UnitOfMeasure.PER_CBM, min_volume=Decimal("0"), max_volume=None, rate=Decimal("40.00"))

    inquiry = make_inquiry(db_session, customer, mode=TransportMode.SEA, weight_kg=Decimal("1"), volume_cbm=Decimal("5"))
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    assert freight.quantity == Decimal("5")
    assert freight.calculated_total == Decimal("200.00")


def test_flat_charge(db_session):
    customer = make_customer(db_session)
    rate_card = simple_rate_card(db_session)
    add_charge(db_session, rate_card, kind=ChargeKind.DOCUMENTATION, description="Docs", basis=ChargeBasis.FLAT, amount=Decimal("75"))

    inquiry = make_inquiry(db_session, customer)
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    docs = next(li for li in priced.line_items if li.kind == ChargeKind.DOCUMENTATION)
    assert docs.quantity == Decimal("1")
    assert docs.calculated_total == Decimal("75.00")


def test_percent_of_freight_charge(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session)
    add_break(db_session, rate_card, min_weight=Decimal("0"), max_weight=None, rate=Decimal("10.00"))
    add_charge(
        db_session, rate_card, kind=ChargeKind.CUSTOMS, description="Customs 5%",
        basis=ChargeBasis.PERCENT_OF_FREIGHT, amount=Decimal("5.00"),
    )

    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("100"), volume_cbm=Decimal("0.01"))
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    customs = next(li for li in priced.line_items if li.kind == ChargeKind.CUSTOMS)
    assert freight.calculated_total == Decimal("1000.00")
    assert customs.calculated_total == Decimal("50.00")  # 5% of 1000


def test_markup_applied_uniformly(db_session):
    from config import get_settings

    customer = make_customer(db_session)
    simple_rate_card(db_session, rate=Decimal("5.00"))
    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("100"), volume_cbm=Decimal("0.01"))

    priced = price_inquiry(db_session, inquiry, today=TODAY)
    settings = get_settings()

    assert priced.markup_amount == (priced.subtotal * settings.default_markup_percent / Decimal("100")).quantize(Decimal("0.01"))
    assert priced.total == priced.subtotal + priced.markup_amount


def test_decimal_precision_no_float_drift(db_session):
    customer = make_customer(db_session)
    rate_card = make_rate_card(db_session)
    add_break(db_session, rate_card, min_weight=Decimal("0"), max_weight=None, rate=Decimal("3.33"))

    inquiry = make_inquiry(db_session, customer, weight_kg=Decimal("33.33"), volume_cbm=Decimal("0.01"))
    priced = price_inquiry(db_session, inquiry, today=TODAY)

    freight = next(li for li in priced.line_items if li.kind == ChargeKind.FREIGHT)
    assert isinstance(freight.calculated_total, Decimal)
    assert freight.calculated_total == (Decimal("33.33") * Decimal("3.33")).quantize(Decimal("0.01"))


# --- Incoterm applicable_charges ---


def _charges():
    class FakeCharge:
        def __init__(self, kind):
            self.kind = kind

    return [FakeCharge(ChargeKind.PICKUP), FakeCharge(ChargeKind.CUSTOMS), FakeCharge(ChargeKind.DOCUMENTATION)]


def test_incoterm_exw_excludes_pickup():
    result = applicable_charges("EXW", _charges())
    kinds = {c.kind for c in result}
    assert ChargeKind.PICKUP not in kinds
    assert ChargeKind.CUSTOMS in kinds
    assert ChargeKind.DOCUMENTATION in kinds


def test_incoterm_dap_includes_customs():
    result = applicable_charges("DAP", _charges())
    kinds = {c.kind for c in result}
    assert ChargeKind.CUSTOMS in kinds
    assert ChargeKind.PICKUP in kinds


def test_incoterm_ddp_includes_customs():
    result = applicable_charges("DDP", _charges())
    kinds = {c.kind for c in result}
    assert ChargeKind.CUSTOMS in kinds


def test_incoterm_fob_excludes_customs():
    result = applicable_charges("FOB", _charges())
    kinds = {c.kind for c in result}
    assert ChargeKind.CUSTOMS not in kinds
    assert ChargeKind.PICKUP in kinds


def test_incoterm_cfr_excludes_customs():
    result = applicable_charges("CFR", _charges())
    kinds = {c.kind for c in result}
    assert ChargeKind.CUSTOMS not in kinds


def test_incoterm_unknown_includes_everything():
    result = applicable_charges("XXX", _charges())
    assert len(result) == 3


# --- price_all_matching / multi-carrier selection ---


def test_price_all_matching_single_carrier_still_returns_one(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session, carrier="TestAir")
    inquiry = make_inquiry(db_session, customer)

    priced_list = price_all_matching(db_session, inquiry, today=TODAY)

    assert len(priced_list) == 1
    assert priced_list[0].carrier == "TESTAIR"


def test_price_all_matching_one_quote_per_carrier(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session, carrier="PIA", rate=Decimal("5.00"))
    simple_rate_card(db_session, carrier="Emirates SkyCargo", rate=Decimal("7.00"))
    inquiry = make_inquiry(db_session, customer)

    priced_list = price_all_matching(db_session, inquiry, today=TODAY)

    carriers = {p.carrier for p in priced_list}
    assert carriers == {"PIA", "EMIRATES"}
    assert len(priced_list) == 2


def test_price_all_matching_same_carrier_overlapping_cards_collapse_to_latest(db_session):
    customer = make_customer(db_session)
    simple_rate_card(
        db_session, carrier="PIA", rate=Decimal("5.00"), valid_from=date(2020, 1, 1), valid_until=date(2035, 1, 1)
    )
    # A more recent card for the SAME carrier, also valid today -- should win.
    simple_rate_card(
        db_session, carrier="PIA", rate=Decimal("6.00"), valid_from=date(2026, 1, 1), valid_until=date(2035, 1, 1)
    )
    inquiry = make_inquiry(db_session, customer)

    priced_list = price_all_matching(db_session, inquiry, today=TODAY)

    assert len(priced_list) == 1
    freight_line = next(li for li in priced_list[0].line_items if li.kind == ChargeKind.FREIGHT)
    assert freight_line.unit_price == Decimal("6.00")


def test_price_all_matching_no_carrier_collapses_to_one_unspecified_quote(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session, carrier=None)
    inquiry = make_inquiry(db_session, customer)

    priced_list = price_all_matching(db_session, inquiry, today=TODAY)

    assert len(priced_list) == 1
    assert priced_list[0].carrier is None


def test_price_all_matching_raises_when_zero_carriers_match(db_session):
    customer = make_customer(db_session)
    inquiry = make_inquiry(db_session, customer)

    with pytest.raises(NoApplicableRate):
        price_all_matching(db_session, inquiry, today=TODAY)
