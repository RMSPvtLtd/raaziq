from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

from factories import make_company, make_customer, make_inquiry, simple_rate_card
from services.email import send_pdf_email
from services.invoices import create_invoice_from_quote
from services.pdf_documents import _invoice_to_document_data, _quote_to_document_data, render_invoice_pdf
from services.quotes import accept_quote, generate_quote


def prepared_quote(db_session):
    company = make_company(db_session)
    customer = make_customer(db_session)
    simple_rate_card(db_session, origin="LHE", destination="DXB")
    inquiry = make_inquiry(db_session, customer, dimensions="20 X 30 X 40 CM", description="Cotton garments", ready_date=date.today())
    quote = generate_quote(db_session, inquiry.id)
    return company, quote


def test_gmail_uses_tls_and_pdf_attachment(db_session):
    settings = SimpleNamespace(smtp_username="sender@example.com", smtp_password="app-secret", smtp_from_email=None, smtp_host="smtp.gmail.com", smtp_port=587, resend_api_key=None)
    connection = Mock()
    connection.send_message.return_value = {}
    with patch("services.email.get_settings", return_value=settings), patch("services.email.smtplib.SMTP") as smtp:
        smtp.return_value.__enter__.return_value = connection
        send_pdf_email(to_email="recipient@example.com", subject="Invoice", body_text="Attached", pdf_bytes=b"%PDF-test", pdf_filename="invoice.pdf")
    connection.starttls.assert_called_once()
    connection.login.assert_called_once_with("sender@example.com", "app-secret")
    message = connection.send_message.call_args.args[0]
    assert message["To"] == "recipient@example.com"
    assert message["From"] == "sender@example.com"
    attachment = list(message.iter_attachments())[0]
    assert attachment.get_filename() == "invoice.pdf"
    assert attachment.get_payload(decode=True) == b"%PDF-test"


def test_quote_invoice_preserve_commercial_details(db_session):
    company, quote = prepared_quote(db_session)
    quote.clauses = "Freight subject to space."
    quote.schedule_snapshot = [{"airline_name": "TESTAIR", "flight_number": "TA123", "days_of_week": [1, 3], "routing": "LHE-DXB", "departure_time": "09:30", "transit_time": "2 HOURS"}]
    assert _quote_to_document_data(db_session, quote).carrier == quote.carrier
    accept_quote(db_session, quote.id, "ops")
    invoice = create_invoice_from_quote(db_session, quote.id, company_id=company.id)
    assert invoice.carrier_snapshot == quote.carrier
    assert invoice.quote_valid_until_snapshot == quote.valid_until
    assert invoice.dimensions_snapshot == "20 X 30 X 40 CM"
    assert invoice.description_snapshot == "Cotton garments"
    assert invoice.ready_date_snapshot == date.today()
    assert invoice.schedule_snapshot == quote.schedule_snapshot
    quote.schedule_snapshot = []
    quote.clauses = "Changed later"
    quote.inquiry.description = "Changed later"
    db_session.flush()
    db_session.expire(invoice)
    assert invoice.schedule_snapshot[0]["flight_number"] == "TA123"
    assert invoice.clauses_snapshot == "Freight subject to space."
    assert invoice.description_snapshot == "Cotton garments"
    document = _invoice_to_document_data(invoice)
    assert document.line_items[0][2:4] == (invoice.line_items[0].quantity, invoice.line_items[0].unit_price)
    assert render_invoice_pdf(invoice).startswith(b"%PDF")


def test_legacy_quote_without_carrier_keeps_booked_shipment_carrier(db_session):
    company, quote = prepared_quote(db_session)
    shipment = accept_quote(db_session, quote.id, "ops")
    quote.carrier = None  # Quotes created before the carrier column existed.
    shipment.carrier = "EMIRATES"
    db_session.flush()
    assert _quote_to_document_data(db_session, quote).carrier == "EMIRATES"
    invoice = create_invoice_from_quote(db_session, quote.id, company_id=company.id)
    assert invoice.carrier_snapshot == "EMIRATES"


def test_send_auto_delivery_failure_persists_quote_and_retry(client, db_session, ops_headers):
    company, quote = prepared_quote(db_session)
    company.notification_email = "billing@example.com"
    db_session.commit()
    from utils.errors import EmailSendFailed
    with patch("services.email.send_pdf_email", side_effect=EmailSendFailed("Provider unavailable")):
        response = client.post(f"/quotes/{quote.id}/send", headers=ops_headers)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "sent"
    assert response.json()["email_status"] == "failed"
    assert response.json()["email_recipient"] == "billing@example.com"
    with patch("services.email.send_pdf_email") as send:
        repeated = client.post(f"/quotes/{quote.id}/send", headers=ops_headers)
        assert repeated.status_code == 409
        send.assert_not_called()
        retry = client.post(f"/quotes/{quote.id}/email", headers=ops_headers)
    assert retry.json()["sent"] is True
    assert send.call_args.kwargs["to_email"] == "billing@example.com"
    assert client.get(f"/quotes/{quote.id}", headers=ops_headers).json()["email_status"] == "sent"


def test_invoice_created_when_email_unconfigured(client, db_session, ops_headers):
    company, quote = prepared_quote(db_session)
    accept_quote(db_session, quote.id, "ops")
    db_session.commit()
    response = client.post(f"/quotes/{quote.id}/invoice", json={"company_id": company.id}, headers=ops_headers)
    assert response.status_code == 201, response.text
    assert response.json()["email_status"] == "not_configured"
    assert response.json()["id"]
    assert response.json()["email_error"]


def test_auto_delivery_disabled_and_company_settings_validated(client, db_session, ops_headers):
    company, quote = prepared_quote(db_session)
    db_session.commit()
    response = client.patch(f"/companies/{company.id}", json={"notification_email": "billing@example.com", "automatic_email_enabled": False}, headers=ops_headers)
    assert response.status_code == 200, response.text
    with patch("services.email.send_pdf_email") as send:
        response = client.post(f"/quotes/{quote.id}/send", headers=ops_headers)
    assert response.json()["email_status"] == "disabled"
    send.assert_not_called()
    assert client.patch(f"/companies/{company.id}", json={"notification_email": "bad\r\nBcc: other@example.com"}, headers=ops_headers).status_code == 422
    assert client.patch(f"/companies/{company.id}", json={"notification_email": "billing@example.com"}).status_code == 401
