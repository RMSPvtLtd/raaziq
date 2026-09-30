"""Gmail SMTP / existing Resend delivery, with durable document outcomes."""

import base64
import logging
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage

import httpx

from config import get_settings
from utils.errors import EmailNotConfigured, EmailSendFailed


def email_is_configured() -> bool:
    settings = get_settings()
    return bool((getattr(settings, "smtp_username", None) and getattr(settings, "smtp_password", None)) or settings.resend_api_key)


def send_pdf_email(*, to_email: str, subject: str, body_text: str, pdf_bytes: bytes, pdf_filename: str) -> None:
    settings = get_settings()
    if getattr(settings, "smtp_username", None) and getattr(settings, "smtp_password", None):
        message = EmailMessage()
        message["From"] = settings.smtp_from_email or settings.smtp_username
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content(body_text)
        message.add_attachment(pdf_bytes, maintype="application", subtype="pdf", filename=pdf_filename)
        try:
            context = ssl.create_default_context()
            if settings.smtp_port == 465:
                connection = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15, context=context)
            else:
                connection = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
            with connection as smtp:
                if settings.smtp_port != 465:
                    smtp.ehlo()
                    smtp.starttls(context=context)
                    smtp.ehlo()
                smtp.login(settings.smtp_username, settings.smtp_password)
                refused = smtp.send_message(message)
                if refused:
                    raise EmailSendFailed("The email provider rejected the recipient.")
        except (smtplib.SMTPException, OSError) as exc:
            raise EmailSendFailed("Gmail delivery failed. Check the sender credentials and connection, then retry.") from exc
        return

    if not settings.resend_api_key:
        raise EmailNotConfigured("Email is not configured. Configure the Gmail sender account and app password.")
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.resend_from_email, "to": [to_email], "subject": subject, "text": body_text,
                "attachments": [{"filename": pdf_filename, "content": base64.b64encode(pdf_bytes).decode("ascii")}],
            },
            timeout=15.0,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise EmailSendFailed(f"The email provider rejected the request ({exc.response.status_code}).") from exc
    except httpx.RequestError as exc:
        raise EmailSendFailed("Could not reach the email provider.") from exc


def deliver_document_email(session, document, *, company, to_email, pdf_factory, subject, body_text, pdf_filename, automatic=False):
    """Commit before contacting a provider; delivery failure never undoes issuance."""
    recipient = (company.notification_email if company else None) or get_settings().notification_email or to_email
    document.email_recipient = recipient
    document.email_error = None
    document.emailed_at = None
    document.email_status = "disabled" if automatic and company and not company.automatic_email_enabled else "not_sent"
    session.commit()
    if document.email_status == "disabled":
        return document
    try:
        send_pdf_email(to_email=recipient, subject=subject, body_text=body_text, pdf_bytes=pdf_factory(), pdf_filename=pdf_filename)
    except EmailNotConfigured as exc:
        document.email_status, document.email_error = "not_configured", str(exc)
    except EmailSendFailed as exc:
        document.email_status, document.email_error = "failed", str(exc)
    except Exception:
        logging.getLogger(__name__).exception("Document email preparation failed")
        document.email_status, document.email_error = "failed", "The document could not be prepared for email. Retry or contact support."
    else:
        document.email_status = "sent"
        document.emailed_at = datetime.now(timezone.utc)
    session.commit()
    if not automatic and document.email_status == "not_configured":
        raise EmailNotConfigured(document.email_error)
    if not automatic and document.email_status == "failed":
        raise EmailSendFailed(document.email_error)
    return document


def delivery_result(document) -> dict:
    return {"sent": document.email_status == "sent", "status": document.email_status, "recipient": document.email_recipient, "error": document.email_error}
