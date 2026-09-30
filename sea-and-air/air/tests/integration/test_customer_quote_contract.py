from datetime import date
from decimal import Decimal

from factories import make_customer_with_portal, make_inquiry
from models.quote import Quote, QuoteLineItem
from models.enums import ChargeKind, QuoteStatus
from utils.security import create_access_token


def test_customer_quote_contains_commercial_details_without_internal_costs(client, db_session):
    customer = make_customer_with_portal(db_session)
    inquiry = make_inquiry(db_session, customer, dimensions="10 X 20 X 30 CM", description="FRAGILE")
    quote = Quote(inquiry_id=inquiry.id, status=QuoteStatus.SENT, currency="USD", carrier="EMIRATES",
                  valid_until=date(2030, 1, 1), subtotal=Decimal("250"), markup_amount=Decimal("50"),
                  total=Decimal("300"), clauses="SUBJECT TO SPACE")
    quote.line_items.append(QuoteLineItem(kind=ChargeKind.FREIGHT, description="AIR FREIGHT", quantity=100,
                            unit_price=1, calculated_total=100, final_total=250, markup_amount=50,
                            is_manual_override=True))
    db_session.add(quote)
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(customer.id, 'customer')}"}
    response = client.get(f"/customer/quotes/{quote.id}", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dimensions"] == "10 X 20 X 30 CM"
    assert body["clauses"] == "SUBJECT TO SPACE"
    assert Decimal(body["service_charge_amount"]) == 50
    assert Decimal(body["line_items"][0]["unit_price"]) == Decimal("2.5")
    assert not {"markup_amount", "rejected_by", "rejected_reason", "email_recipient"} & body.keys()
    assert not {"calculated_total", "markup_amount", "is_manual_override"} & body["line_items"][0].keys()
