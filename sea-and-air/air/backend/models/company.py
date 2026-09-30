from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db import Base
from models._mixins import TimestampMixin


class Company(TimestampMixin, Base):
    """One of Raaziq's own issuing legal entities -- the letterhead a quote
    or invoice is printed under. Raaziq operates as more than one legal
    entity (e.g. a Pakistan company and a UK company), each with its own
    address, tax/registration numbers, and bank details for receiving
    payment, so this is a small settings-style table rather than a single
    hardcoded identity. `is_default` picks which one a new quote defaults
    to; ops can still choose a different one per quote.
    """

    __tablename__ = "company"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(320))
    website: Mapped[str | None] = mapped_column(String(200))

    # Whatever this entity's own tax/registration identifiers are called
    # locally (VAT No / Company Reg No in the UK, NTN in Pakistan, ...) --
    # kept as a label + value pair rather than fixed columns per country.
    tax_id_label: Mapped[str | None] = mapped_column(String(60))
    tax_id: Mapped[str | None] = mapped_column(String(100))
    company_reg_no: Mapped[str | None] = mapped_column(String(100))

    bank_name: Mapped[str | None] = mapped_column(String(200))
    bank_account_title: Mapped[str | None] = mapped_column(String(200))
    bank_account_number: Mapped[str | None] = mapped_column(String(100))
    bank_sort_code: Mapped[str | None] = mapped_column(String(100))

    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notification_email: Mapped[str | None] = mapped_column(String(320))
    automatic_email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    @property
    def email_configured(self) -> bool:
        from services.email import email_is_configured
        return email_is_configured()
