from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base
from models._mixins import TimestampMixin
from models._types import portable_enum
from models.enums import ChargeKind, InvoiceStatus, QuoteStatus
from utils.locations import location_code


class Quote(TimestampMixin, Base):
    """A priced quotation for one Inquiry. Totals are always derived from its
    QuoteLineItems by `services.quotes.recalculate_totals` — this table never
    stores a total that wasn't computed from line items.
    """

    __tablename__ = "quote"

    id: Mapped[int] = mapped_column(primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiry.id"), nullable=False, index=True)

    status: Mapped[QuoteStatus] = mapped_column(
        portable_enum(QuoteStatus), nullable=False, default=QuoteStatus.DRAFT
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    # Which airline/carrier this quote is priced from -- snapshotted from
    # RateCard.carrier at generation time for an auto-generated quote, or
    # typed in directly for a manual one (services.quotes.create_manual_quote).
    # Not the same thing as Shipment.carrier, which is only known once the
    # job is actually booked; this is "which offer is this", not "who is
    # physically carrying the cargo" (though normally they end up the same).
    carrier: Mapped[str | None] = mapped_column(String(120))
    # True for a quote created via services.quotes.create_manual_quote (ops
    # typed the rate in directly, no matching RateCard). Lets
    # generate_quotes tell "one of my own auto-priced siblings, safe to
    # supersede on regeneration" apart from "an admin's manual quote,
    # never touched by regeneration" without guessing from carrier name.
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    markup_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    # Optional, default zero -- no real Raaziq document seen so far shows a
    # tax or discount line (Pakistan exports are zero-rated; the UK invoice
    # shows no VAT line either), but the capability is here for when one is
    # needed. Flat amounts, not rates -- ops enters the actual figure.
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    valid_until: Mapped[date] = mapped_column(Date, nullable=False)
    # Free-text trading terms/legal clauses, printed on the quote PDF and
    # copied onto any invoice generated from this quote (Invoice.clauses_snapshot)
    # -- see services.quotes.set_quote_clauses.
    clauses: Mapped[str | None] = mapped_column(Text)
    schedule_snapshot: Mapped[list[dict] | None] = mapped_column(JSON)
    email_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_sent")
    email_recipient: Mapped[str | None] = mapped_column(String(254))
    email_error: Mapped[str | None] = mapped_column(Text)
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- rejection -- set only by services.quotes.reject_quote ---
    rejected_reason: Mapped[str | None] = mapped_column(Text)
    rejected_by: Mapped[str | None] = mapped_column(String(120))
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- revisioning -- see services.quotes.generate_quote ---
    # revision_number/root_quote_id together identify a quote's place in its
    # revision family; root_quote_id is null on the root quote itself (its own
    # id IS the root). superseded_at is set the moment a later revision is
    # created for the same inquiry -- a superseded quote is permanently frozen
    # (see the guards in send_quote/accept_quote/reject_quote/override_line_items/
    # set_quote_adjustments), never mutated back.
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    root_quote_id: Mapped[int | None] = mapped_column(ForeignKey("quote.id"), index=True)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    inquiry: Mapped["Inquiry"] = relationship(back_populates="quotes")  # noqa: F821
    line_items: Mapped[list["QuoteLineItem"]] = relationship(
        back_populates="quote", cascade="all, delete-orphan", order_by="QuoteLineItem.id"
    )
    shipment: Mapped["Shipment | None"] = relationship(back_populates="quote", uselist=False)  # noqa: F821
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="quote", order_by="Invoice.id")  # noqa: F821

    @property
    def shipment_stage(self) -> "ShipmentStage | None":  # noqa: F821
        """The current stage of this quote's inquiry's shipment.

        Goes through `self.inquiry.shipment`, NOT `self.shipment` --
        `Shipment.quote_id` is only ever set once a quote is actually
        accepted (see `services.quotes.accept_quote`), so `self.shipment`
        reads None for every quote that's merely one of several pending
        carrier offers, which is the common case before acceptance. The
        inquiry's shipment row exists from the moment the inquiry was filed,
        independent of which (if any) quote has been accepted yet.

        Read by `services.quotes.override_line_items` to gate editing, and
        exposed on `QuoteRead` so the frontend doesn't need a second request
        to know whether editing is still allowed."""
        return self.inquiry.shipment.stage if self.inquiry.shipment else None

    @property
    def origin(self) -> str:
        """Convenience passthrough so QuoteRead can show the lane without a
        second request for the inquiry -- used on the sibling-quote
        comparison view (multiple quotes for one inquiry)."""
        return location_code(self.inquiry.origin)

    @property
    def destination(self) -> str:
        return location_code(self.inquiry.destination)

    @property
    def is_current(self) -> bool:
        """False once a later revision has been generated for this inquiry."""
        return self.superseded_at is None

    @property
    def active_invoice(self) -> "Invoice | None":
        """The one non-cancelled invoice for this quote, if any. A quote can
        accumulate more than one Invoice row over time (an original plus a
        replacement after cancellation, see services.invoices.cancel_invoice),
        but at most one is ever active -- enforced at the database level by a
        partial unique index on (quote_id) WHERE status <> 'cancelled', not
        just by this property.
        """
        return next((inv for inv in self.invoices if inv.status != InvoiceStatus.CANCELLED), None)

    @property
    def invoice_id(self) -> "int | None":
        """The id of this quote's active invoice, if any -- lets the frontend
        show "Invoice: INV-XXXX" / disable "Create Invoice" without a second
        request."""
        active = self.active_invoice
        return active.id if active else None


class QuoteLineItem(Base):
    """One priced component of a quote (freight, documentation, customs, ...).
    `calculated_total` is what the pricing engine produced and is never
    modified afterward. `final_total` is what the quote actually charges —
    equal to `calculated_total` unless a pricing user overrides it, in which
    case `is_manual_override` is set. `recalculate_totals` treats
    `final_total` as authoritative when an override exists, `calculated_total`
    otherwise.
    """

    __tablename__ = "quote_line_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("quote.id", ondelete="CASCADE"), nullable=False, index=True)

    kind: Mapped[ChargeKind] = mapped_column(portable_enum(ChargeKind), nullable=False)
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    calculated_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    final_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    markup_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    is_manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    quote: Mapped["Quote"] = relationship(back_populates="line_items")
