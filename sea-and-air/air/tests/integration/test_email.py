"""Email sending (services.email, and the /quotes/{id}/email and
/invoices/{id}/email routes) is optional and feature-gated -- see
config.Settings.resend_api_key. These tests never make a real network call:
`httpx.post` is always mocked."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest

from utils.errors import EmailNotConfigured, EmailSendFailed
from services.email import send_pdf_email
from services.invoices import create_invoice_from_quote
from services.quotes import accept_quote, generate_quote
from factories import make_company, make_customer, make_inquiry, simple_rate_card

TODAY = date(2026, 6, 1)


def _accepted_quote(db_session):
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.flush()
    accept_quote(db_session, quote.id, "ops", today=TODAY)
    return quote


def test_send_pdf_email_raises_when_not_configured(db_session):
    with pytest.raises(EmailNotConfigured):
        send_pdf_email(
            to_email="customer@example.com", subject="Test", body_text="Body",
            pdf_bytes=b"%PDF-fake", pdf_filename="test.pdf",
        )


def test_send_pdf_email_success(db_session):
    fake_settings = SimpleNamespace(resend_api_key="re_fake_key", resend_from_email="noreply@example.com", notification_email=None)
    mock_response = Mock()
    mock_response.raise_for_status = Mock()

    with patch("services.email.get_settings", return_value=fake_settings), \
         patch("services.email.httpx.post", return_value=mock_response) as mock_post:
        send_pdf_email(
            to_email="customer@example.com", subject="Test", body_text="Body",
            pdf_bytes=b"%PDF-fake", pdf_filename="test.pdf",
        )

    assert mock_post.call_count == 1
    _, kwargs = mock_post.call_args
    assert kwargs["json"]["to"] == ["customer@example.com"]
    assert kwargs["json"]["from"] == "noreply@example.com"
    assert kwargs["json"]["attachments"][0]["filename"] == "test.pdf"


def test_send_pdf_email_wraps_provider_error(db_session):
    fake_settings = SimpleNamespace(resend_api_key="re_fake_key", resend_from_email="noreply@example.com", notification_email=None)
    bad_response = httpx.Response(status_code=422, request=httpx.Request("POST", "https://api.resend.com/emails"))

    with patch("services.email.get_settings", return_value=fake_settings), \
         patch("services.email.httpx.post", side_effect=httpx.HTTPStatusError("bad", request=bad_response.request, response=bad_response)):
        with pytest.raises(EmailSendFailed):
            send_pdf_email(
                to_email="customer@example.com", subject="Test", body_text="Body",
                pdf_bytes=b"%PDF-fake", pdf_filename="test.pdf",
            )


def test_email_quote_endpoint_422_when_not_configured(client, db_session, ops_headers):
    make_company(db_session, is_default=True)
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.commit()

    r = client.post(f"/quotes/{quote.id}/email", headers=ops_headers)

    assert r.status_code == 422


def test_email_invoice_endpoint_422_when_not_configured(client, db_session, ops_headers):
    company = make_company(db_session)
    quote = _accepted_quote(db_session)
    invoice = create_invoice_from_quote(db_session, quote.id, company_id=company.id, today=TODAY)
    db_session.commit()

    r = client.post(f"/invoices/{invoice.id}/email", headers=ops_headers)

    assert r.status_code == 422


def test_email_quote_endpoint_sends_when_configured(client, db_session, ops_headers):
    make_company(db_session, is_default=True)
    customer = make_customer(db_session)
    simple_rate_card(db_session)
    inquiry = make_inquiry(db_session, customer)
    quote = generate_quote(db_session, inquiry.id, today=TODAY)
    db_session.commit()

    fake_settings = SimpleNamespace(resend_api_key="re_fake_key", resend_from_email="noreply@example.com", notification_email=None)
    mock_response = Mock()
    mock_response.raise_for_status = Mock()

    with patch("services.email.get_settings", return_value=fake_settings), \
         patch("services.email.httpx.post", return_value=mock_response) as mock_post:
        r = client.post(f"/quotes/{quote.id}/email", headers=ops_headers)

    assert r.status_code == 200, r.text
    assert r.json()["sent"] is True
    assert r.json()["status"] == "sent"
    assert r.json()["recipient"] == customer.email
    assert mock_post.call_count == 1
