import pytest
from pydantic import ValidationError

from schemas.inquiries import InquiryCreate
from schemas.rate_cards import RateCardCreate


def test_air_inquiries_normalize_known_city_names_and_standard_codes():
    payload = dict(customer_id=1, origin=" Lahore ", destination="lhr", mode="air",
                   cargo_type="CARGO", weight_kg=100, volume_cbm=1, incoterm="dap")
    inquiry = InquiryCreate(**payload)
    assert (inquiry.origin, inquiry.destination, inquiry.incoterm) == ("LHE", "LHR", "DAP")
    with pytest.raises(ValidationError, match="airport code"):
        InquiryCreate(**{**payload, "destination": "Unknown airport"})


def test_rates_use_same_lane_codes_and_canonical_airlines():
    card = RateCardCreate(origin="Lahore", destination="Dubai", mode="air",
                          carrier=" Emirates Airline ", currency="usd", valid_from="2026-09-28",
                          valid_until="2026-09-28", minimum_charge=0,
                          breaks=[dict(unit="per_kg", rate=5)])
    assert (card.origin, card.destination, card.carrier, card.currency) == ("LHE", "DXB", "EMIRATES", "USD")
