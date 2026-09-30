from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base
from models._mixins import TimestampMixin
from models._types import portable_enum
from models.enums import ChargeKind, InvoiceStatus


class Invoice(TimestampMixin, Base):
    """A financial snapshot generated from an accepted Quote --
    `services.invoices.create_invoice_from_quote` is the only writer of this
    table's header fields and `InvoiceLineItem` rows, and it copies every
    printed value at creation time rather than storing live references to
    Quote/Inquiry/Shipment/Customer. This is deliberate: once an invoice is
    issued, editing the quote, the customer's address, or the shipment's
    routing afterward must never retroactively change a historical invoice.

    `quote_id` is NOT plainly unique -- a cancelled invoice can be replaced by
    a new one for the same quote (`replaces_invoice_id`), so more than one
    Invoice row can share a quote_id over time. What's actually enforced at
    the database level is "at most one *active* (non-cancelled) invoice per
    quote", via the partial unique index below -- not by application logic
    alone, and not just by `Quote.active_invoice`'s in-Python filtering.
    """

    __tablename__ = "invoice"
    __table_args__ = (
        Index(
            "uq_invoice_quote_id_active",
            "quote_id",
            unique=True,
            postgresql_where=text("status <> 'CANCELLED'"),
            sqlite_where=text("status <> 'CANCELLED'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("quote.id"), nullable=False, index=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipment.id"), nullable=False, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False, index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("company.id"), nullable=False)
    # Set only when this invoice was created via services.invoices.cancel_invoice
    # + a follow-up create_invoice_from_quote(replaces_invoice_id=...) -- the
    # cancelled invoice this one corrects, if any.
    replaces_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoice.id"), index=True)

    status: Mapped[InvoiceStatus] = mapped_column(
        portable_enum(InvoiceStatus), nullable=False, default=InvoiceStatus.ISSUED
    )
    issued_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    markup_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    # --- cancellation -- set only by services.invoices.cancel_invoice ---
    cancelled_reason: Mapped[str | None] = mapped_column(Text)
    cancelled_by: Mapped[str | None] = mapped_column(String(120))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- payment-ready, not wired to any endpoint or UI yet (see plan) ---
    payment_date: Mapped[date | None] = mapped_column(Date)
    amount_paid: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    payment_method: Mapped[str | None] = mapped_column(String(60))
    payment_reference: Mapped[str | None] = mapped_column(String(120))

    # --- everything below is a snapshot, copied once at creation time ---
    customer_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_address_snapshot: Mapped[str | None] = mapped_column(Text)
    supplier_name_snapshot: Mapped[str | None] = mapped_column(String(200))
    supplier_address_snapshot: Mapped[str | None] = mapped_column(Text)
    origin_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    destination_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    mode_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    cargo_type_snapshot: Mapped[str | None] = mapped_column(String(120))
    incoterm_snapshot: Mapped[str] = mapped_column(String(10), nullable=False)
    hs_code_snapshot: Mapped[str | None] = mapped_column(String(20))
    pieces_snapshot: Mapped[int | None] = mapped_column()
    weight_kg_snapshot: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    volume_cbm_snapshot: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    chargeable_weight_kg_snapshot: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    carrier_snapshot: Mapped[str | None] = mapped_column(String(120))
    voyage_flight_number_snapshot: Mapped[str | None] = mapped_column(String(60))
    job_number_snapshot: Mapped[str | None] = mapped_column(String(40))
    # JSON-encoded list of {"type": ..., "value": ...} -- the shipment's
    # references (MAWB/HAWB/MBL/HBL/Form E/LC/...) as they stood at creation.
    references_snapshot: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    clauses_snapshot: Mapped[str | None] = mapped_column(Text)
    quote_reference_snapshot: Mapped[str | None] = mapped_column(String(80))
    quote_date_snapshot: Mapped[date | None] = mapped_column(Date)
    quote_valid_until_snapshot: Mapped[date | None] = mapped_column(Date)
    dimensions_snapshot: Mapped[str | None] = mapped_column(String(200))
    description_snapshot: Mapped[str | None] = mapped_column(Text)
    ready_date_snapshot: Mapped[date | None] = mapped_column(Date)
    schedule_snapshot: Mapped[list[dict] | None] = mapped_column(JSON)
    email_status: Mapped[str] = mapped_column(String(30), nullable=False, default="not_sent")
    email_recipient: Mapped[str | None] = mapped_column(String(320))
    email_error: Mapped[str | None] = mapped_column(Text)
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    quote: Mapped["Quote"] = relationship(back_populates="invoices")  # noqa: F821
    company: Mapped["Company"] = relationship()  # noqa: F821
    line_items: Mapped[list["InvoiceLineItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan", order_by="InvoiceLineItem.id"
    )
    replaces_invoice: Mapped["Invoice | None"] = relationship(remote_side=[id], uselist=False)


class InvoiceLineItem(Base):
    """One snapshotted charge line. Kept as rich as QuoteLineItem (quantity,
    unit_price, not just the final amount) so the full financial detail is
    preserved even though the printed invoice only shows description+amount,
    matching the real reference invoice's simpler customer-facing columns.
    """

    __tablename__ = "invoice_line_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoice.id", ondelete="CASCADE"), nullable=False, index=True
    )

    kind: Mapped[ChargeKind] = mapped_column(portable_enum(ChargeKind), nullable=False)
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    invoice: Mapped["Invoice"] = relationship(back_populates="line_items")


class InvoiceNumberCounter(Base):
    """Row-locked allocator for invoice numbers, one row per year -- mirrors
    JobNumberCounter (models.shipment) exactly, including why: a plain
    counter table rather than a database sequence keeps the same allocation
    code working unchanged on SQLite (tests) and PostgreSQL (production).
    """

    __tablename__ = "invoice_number_counter"

    year: Mapped[int] = mapped_column(primary_key=True)
    last_value: Mapped[int] = mapped_column(nullable=False, default=0)
