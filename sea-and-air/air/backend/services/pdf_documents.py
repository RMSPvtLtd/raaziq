"""Renders Quote and Invoice documents as PDF bytes, using reportlab (pure
Python, no system libraries -- the right choice for Vercel's serverless
Python functions; weasyprint needs Pango/Cairo and wouldn't run there, and a
browser-based HTML-to-PDF approach is far too heavy for a serverless
function). Named separately from `services.documents`, which handles
uploaded PDF *attachments* -- this module generates documents, it doesn't
store them.

Layout follows the real Raaziq UK invoice directly (see the session's
reference documents): letterhead -> title -> customer/supplier block ->
metadata -> particulars-of-consignment block -> grouped charges with quantity,
effective unit rate and amount -> totals -> amount in words -> signature -> remarks -> bank
details (invoice only) -> footer legal/registration text.

Quotes don't carry their own `company_id` (that's an invoice-time decision,
via the "Create Invoice from Quote" company selector) -- a quote PDF always
prints under the default Company. Airline schedules are frozen quotation
references; they do not imply a confirmed booking.

SECURITY: reportlab's `Paragraph` parses a mini-HTML dialect (`<b>`, `<br/>`,
`<font>`, ...), so every value that originates from user input MUST be
passed through `_esc` before being placed in one. Two things go wrong
otherwise: a name containing `<b>` silently injects formatting into a
financial document, and a name containing a bare `<` raises and makes the
document permanently un-renderable -- which for an invoice is unrecoverable,
since its snapshot is immutable by design. Only literal markup written in
this module is left unescaped.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from html import escape
from io import BytesIO

from num2words import num2words
from sqlalchemy.orm import Session
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from config import get_settings
from models.company import Company
from models.invoice import Invoice
from models.quote import Quote
from services.companies import list_companies
from services.pricing import compute_chargeable_weight
from utils.locations import location_code

_STAGE_LABEL = {"air": "Air", "sea": "Sea", "road": "Road"}

# Charges are grouped under one heading per ChargeKind, in this fixed order,
# so the printed document always reads Freight -> Documentation -> Customs ->
# Pickup -> Handling -> Other regardless of the order line items were added.
_KIND_LABEL = {
    "freight": "Freight Charges",
    "documentation": "Documentation Charges",
    "customs": "Customs Charges",
    "pickup": "Pickup Charges",
    "handling": "Handling Charges",
    "other": "Other Charges",
}
_KIND_ORDER = ["freight", "documentation", "customs", "pickup", "handling", "other"]


@dataclass
class _DocumentData:
    doc_type: str  # "QUOTATION" or "INVOICE"
    doc_number: str
    doc_date: date
    currency: str
    company: Company
    customer_name: str
    customer_address: str | None
    supplier_name: str | None
    supplier_address: str | None
    origin: str
    destination: str
    mode: str
    incoterm: str
    hs_code: str | None
    pieces: int | None
    weight_kg: Decimal
    chargeable_weight_kg: Decimal
    carrier: str | None
    voyage_flight_number: str | None
    job_number: str | None
    references: list[tuple[str, str]]
    line_items: list[tuple[str, str, Decimal, Decimal, Decimal]]  # kind, description, quantity, selling rate, amount
    subtotal: Decimal
    markup_amount: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    valid_until: date | None = None
    show_bank_details: bool = False
    remarks: str | None = None
    cargo_type: str | None = None
    clauses: str | None = None
    volume_cbm: Decimal = Decimal("0")
    dimensions: str | None = None
    description: str | None = None
    ready_date: date | None = None
    quote_reference: str | None = None
    quote_date: date | None = None
    schedule: list[dict] | None = None


def _esc(value: object) -> str:
    """Escapes a value for safe inclusion in a reportlab `Paragraph`.

    `Paragraph` consumes a mini-HTML dialect, so `<` and `&` are markup to
    it. Escaping them turns any user-supplied string back into literal text:
    it neither injects formatting nor raises, which matters because an
    invoice's snapshot is immutable -- an unescaped `<` would brick that
    invoice's PDF permanently. `None` renders as an empty string so callers
    don't have to special-case optional fields.
    """
    if value is None:
        return ""
    return escape(str(value).upper(), quote=False)


def _default_company(session: Session) -> Company:
    companies = list_companies(session)
    default = next((c for c in companies if c.is_default), companies[0] if companies else None)
    if default is None:
        raise RuntimeError("No Company is configured -- seed at least one before generating a quote PDF.")
    return default


def _quote_to_document_data(session: Session, quote: Quote) -> _DocumentData:
    settings = get_settings()
    inquiry = quote.inquiry
    customer = inquiry.customer
    # Not quote.shipment -- see Quote.shipment_stage's docstring: that FK is
    # only set once THIS quote is accepted, but a not-yet-accepted quote
    # (the common case for a PDF preview) still has real shipment/reference
    # data available through the inquiry, independent of quote_id.
    shipment = inquiry.shipment

    references = [(r.type.value, r.value) for r in shipment.references] if shipment else []

    return _DocumentData(
        doc_type="QUOTATION",
        doc_number=f"Q-{quote.root_quote_id or quote.id} Rev {quote.revision_number}",
        doc_date=quote.created_at.date(),
        currency=quote.currency,
        company=_default_company(session),
        customer_name=customer.name,
        customer_address=customer.address,
        supplier_name=inquiry.supplier_name,
        supplier_address=inquiry.supplier_address,
        origin=location_code(inquiry.origin),
        destination=location_code(inquiry.destination),
        mode=inquiry.mode.value,
        incoterm=inquiry.incoterm,
        hs_code=inquiry.hs_code,
        pieces=inquiry.pieces,
        weight_kg=inquiry.weight_kg,
        chargeable_weight_kg=compute_chargeable_weight(inquiry, settings),
        carrier=quote.carrier or (shipment.carrier if shipment else None),
        voyage_flight_number=shipment.voyage_flight_number if shipment else None,
        job_number=shipment.job_number if shipment else None,
        references=references,
        line_items=[(li.kind.value, li.description, li.quantity, li.final_total / li.quantity if li.quantity else Decimal("0"), li.final_total) for li in quote.line_items],
        subtotal=quote.subtotal,
        markup_amount=quote.markup_amount,
        tax_amount=quote.tax_amount,
        discount_amount=quote.discount_amount,
        total=quote.total,
        valid_until=quote.valid_until,
        show_bank_details=False,
        cargo_type=inquiry.cargo_type,
        clauses=quote.clauses,
        volume_cbm=inquiry.volume_cbm,
        dimensions=inquiry.dimensions,
        description=inquiry.description,
        ready_date=inquiry.ready_date,
        schedule=quote.schedule_snapshot,
    )


def _invoice_to_document_data(invoice: Invoice) -> _DocumentData:
    references = []
    if invoice.references_snapshot:
        import json

        references = [(r["type"], r["value"]) for r in json.loads(invoice.references_snapshot)]

    return _DocumentData(
        doc_type="INVOICE",
        doc_number=invoice.invoice_number,
        doc_date=invoice.issued_date,
        currency=invoice.currency,
        company=invoice.company,
        customer_name=invoice.customer_name_snapshot,
        customer_address=invoice.customer_address_snapshot,
        supplier_name=invoice.supplier_name_snapshot,
        supplier_address=invoice.supplier_address_snapshot,
        origin=location_code(invoice.origin_snapshot),
        destination=location_code(invoice.destination_snapshot),
        mode=invoice.mode_snapshot,
        incoterm=invoice.incoterm_snapshot,
        hs_code=invoice.hs_code_snapshot,
        pieces=invoice.pieces_snapshot,
        weight_kg=invoice.weight_kg_snapshot,
        chargeable_weight_kg=invoice.chargeable_weight_kg_snapshot,
        carrier=invoice.carrier_snapshot,
        voyage_flight_number=invoice.voyage_flight_number_snapshot,
        job_number=invoice.job_number_snapshot,
        references=references,
        line_items=[(li.kind.value, li.description, li.quantity, li.amount / li.quantity if li.quantity else Decimal("0"), li.amount) for li in invoice.line_items],
        subtotal=invoice.subtotal,
        markup_amount=invoice.markup_amount,
        tax_amount=invoice.tax_amount,
        discount_amount=invoice.discount_amount,
        total=invoice.total,
        show_bank_details=True,
        remarks=invoice.remarks,
        cargo_type=invoice.cargo_type_snapshot,
        clauses=invoice.clauses_snapshot,
        volume_cbm=invoice.volume_cbm_snapshot,
        dimensions=invoice.dimensions_snapshot,
        description=invoice.description_snapshot,
        ready_date=invoice.ready_date_snapshot,
        quote_reference=invoice.quote_reference_snapshot,
        quote_date=invoice.quote_date_snapshot,
        valid_until=invoice.quote_valid_until_snapshot,
        schedule=invoice.schedule_snapshot,
    )


def _amount_in_words(amount: Decimal, currency: str) -> str:
    whole = int(amount)
    cents = int((amount - whole) * 100)
    words = num2words(whole).upper()
    return f"{words} AND {cents:02d}/100 {currency} ONLY"


def _money(value: Decimal, currency: str) -> str:
    return f"{currency} {value:,.2f}"


def _build_pdf(data: _DocumentData) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm,
    )

    styles = getSampleStyleSheet()
    company_name_style = ParagraphStyle(
        "CompanyName", parent=styles["Heading1"], fontSize=16, leading=19, spaceAfter=1,
    )
    small_style = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, leading=11)
    title_style = ParagraphStyle(
        "DocTitle", parent=styles["Heading1"], fontSize=18, alignment=TA_CENTER, spaceBefore=8, spaceAfter=10,
    )
    label_style = ParagraphStyle("Label", parent=styles["Normal"], fontSize=9, textColor=colors.grey)
    value_style = ParagraphStyle("Value", parent=styles["Normal"], fontSize=9.5, leading=13)
    right_style = ParagraphStyle("Right", parent=styles["Normal"], fontSize=9.5, alignment=TA_RIGHT)

    story = []

    # --- letterhead ---
    company = data.company
    company_lines = [_esc(company.address)]
    if company.phone:
        company_lines.append(f"TEL: {_esc(company.phone)}")
    if company.email:
        company_lines.append(f"EMAIL: {_esc(company.email)}")
    if company.website:
        company_lines.append(_esc(company.website))
    story.append(Paragraph(_esc(company.name), company_name_style))
    story.append(Paragraph("LOGISTICS &amp; SUPPLY CHAIN MANAGEMENT", small_style))
    # The <br/> separators are this module's own markup, so they are joined
    # after each individual line has been escaped.
    story.append(Paragraph("<br/>".join(company_lines), small_style))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.black))
    story.append(Paragraph(_esc(data.doc_type), title_style))

    # --- customer / supplier / metadata ---
    customer_block = [Paragraph("CUSTOMER", label_style), Paragraph(_esc(data.customer_name), value_style)]
    if data.customer_address:
        customer_block.append(Paragraph(_esc(data.customer_address), value_style))
    if data.supplier_name:
        customer_block.append(Spacer(1, 6))
        customer_block.append(Paragraph("SUPPLIER", label_style))
        customer_block.append(Paragraph(_esc(data.supplier_name), value_style))
        if data.supplier_address:
            customer_block.append(Paragraph(_esc(data.supplier_address), value_style))

    meta_rows = [
        [f"{data.doc_type.title()} No:", data.doc_number],
        ["Date:", data.doc_date.strftime("%d-%b-%y")],
        ["Currency:", data.currency],
    ]
    if data.valid_until:
        meta_rows.append(["Valid Until:", data.valid_until.strftime("%d-%b-%y")])
    if data.quote_reference:
        meta_rows.append(["Quotation No:", data.quote_reference])
    if data.quote_date:
        meta_rows.append(["Quotation Date:", data.quote_date.strftime("%d-%b-%y")])
    if company.tax_id_label and company.tax_id:
        meta_rows.append([f"{company.tax_id_label}:", company.tax_id])
    meta_table = Table([[Paragraph(_esc(cell), small_style) for cell in row] for row in meta_rows], colWidths=[32 * mm, 45 * mm])
    meta_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))

    header_table = Table([[customer_block, meta_table]], colWidths=[100 * mm, 77 * mm])
    header_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(header_table)
    story.append(Spacer(1, 10))

    # --- particulars of consignment ---
    particulars = [
        ("Origin", data.origin), ("Destination", data.destination),
        ("Mode", _STAGE_LABEL.get(data.mode, data.mode)), ("Incoterm", data.incoterm),
        ("Description of Goods", data.cargo_type or "-"),
        ("HS Code", data.hs_code or "-"), ("Pieces", str(data.pieces) if data.pieces else "-"),
        ("Gross Weight", f"{data.weight_kg:,.2f} KGS"),
        ("Volume", f"{data.volume_cbm:,.3f} CBM"),
        ("Dimensions", data.dimensions or "-"),
        ("Ready Date", data.ready_date.isoformat() if data.ready_date else "-"),
        ("Chargeable Weight", f"{data.chargeable_weight_kg:,.2f} KGS"),
        ("Carrier", data.carrier or "-"), ("Voyage/Flight No", data.voyage_flight_number or "-"),
        ("Job Number", data.job_number or "-"),
    ]
    for ref_type, ref_value in data.references:
        if ref_type == "JOB_NUMBER":
            continue  # already shown explicitly above
        particulars.append((ref_type.replace("_", " ").title(), ref_value))

    rows = []
    for i in range(0, len(particulars), 2):
        pair = particulars[i:i + 2]
        row = []
        for label, value in pair:
            # `value` includes shipment references, HS codes and carrier
            # names -- all ops- or customer-supplied.
            row.append(
                Paragraph(
                    f"<font color='grey' size=8>{_esc(label)}</font><br/>{_esc(value)}", value_style
                )
            )
        if len(pair) == 1:
            row.append("")
        rows.append(row)
    particulars_table = Table(rows, colWidths=[88.5 * mm, 88.5 * mm])
    particulars_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(Paragraph("PARTICULARS OF CONSIGNMENT", label_style))
    story.append(Spacer(1, 4))
    story.append(particulars_table)
    story.append(Spacer(1, 12))
    if data.description:
        story.append(Paragraph(f"<b>DESCRIPTION:</b> {_esc(data.description)}", value_style))
        story.append(Spacer(1, 8))
    if data.schedule:
        story.append(Paragraph("FLIGHT PLANNING / WEEKLY SCHEDULE", label_style))
        story.append(Paragraph("REFERENCE AT QUOTATION - SUBJECT TO SPACE AND BOOKING CONFIRMATION", small_style))
        day_names = {0: "MON", 1: "TUE", 2: "WED", 3: "THU", 4: "FRI", 5: "SAT", 6: "SUN"}
        for flight in data.schedule:
            days = ", ".join(day_names.get(day, str(day)) for day in flight.get("days_of_week", []))
            details = [
                ("AIRLINE", flight.get("airline_name")), ("FLIGHT", flight.get("flight_number")),
                ("ROUTE", flight.get("routing") or f"{flight.get('origin', '-')} - {flight.get('destination', '-')}"),
                ("OPERATING DAYS", days), ("DEPARTURE (ORIGIN LOCAL)", flight.get("departure_time")),
                ("TRANSIT TIME", flight.get("transit_time")),
                ("VALID FROM", flight.get("valid_from")), ("VALID UNTIL", flight.get("valid_until")),
                ("NOTES", flight.get("notes")),
            ]
            for label, value in details:
                if value:
                    story.append(Paragraph(f"<b>{label}:</b> {_esc(value)}", small_style))
            story.append(Spacer(1, 8))

    # --- charges, grouped under one heading per ChargeKind ---
    charge_rows = [["DESCRIPTION", "QTY", "UNIT RATE", "AMOUNT"]]
    heading_rows: list[int] = []
    group_subtotal_rows: list[int] = []

    present_kinds = [k for k in _KIND_ORDER if any(item[0] == k for item in data.line_items)]
    # Defensive: a kind outside the known fixed order still prints, just last.
    present_kinds += [
        k for k in dict.fromkeys(item[0] for item in data.line_items) if k not in present_kinds
    ]
    for kind in present_kinds:
        items = [item[1:] for item in data.line_items if item[0] == kind]
        heading_rows.append(len(charge_rows))
        charge_rows.append([_KIND_LABEL.get(kind, kind.title()), "", "", ""])
        for description, quantity, unit_price, amount in items:
            charge_rows.append([description, f"{quantity:,.3f}", f"{data.currency} {unit_price:,.4f}", _money(amount, data.currency)])
        if len(items) > 1:
            group_subtotal_rows.append(len(charge_rows))
            group_total = sum((item[-1] for item in items), Decimal("0"))
            charge_rows.append([f"{_KIND_LABEL.get(kind, kind.title())} Subtotal", "", "", _money(group_total, data.currency)])

    charge_rows.append(["Subtotal", "", "", _money(data.subtotal, data.currency)])
    if data.markup_amount:
        charge_rows.append(["Service Charge", "", "", _money(data.markup_amount, data.currency)])
    if data.tax_amount:
        charge_rows.append(["Tax", "", "", _money(data.tax_amount, data.currency)])
    if data.discount_amount:
        charge_rows.append(["Discount", "", "", f"-{_money(data.discount_amount, data.currency)}"])
    charge_rows.append([f"{data.doc_type.title()} Total", "", "", _money(data.total, data.currency)])

    charges_table = Table([[Paragraph(_esc(cell), small_style if i == 0 else ParagraphStyle("Amount", parent=small_style, alignment=TA_RIGHT)) for i, cell in enumerate(row)] for row in charge_rows], colWidths=[85 * mm, 22 * mm, 35 * mm, 35 * mm], repeatRows=1)
    n = len(charge_rows)
    style = [
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f0")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, colors.black),
        ("LINEABOVE", (0, n - 1), (-1, n - 1), 1, colors.black),
        ("FONTNAME", (0, n - 1), (-1, n - 1), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for idx in heading_rows:
        style.append(("NOSPLIT", (0, idx), (-1, idx + 1)))
        style.append(("FONTNAME", (0, idx), (-1, idx), "Helvetica-Bold"))
        style.append(("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#f7f7f7")))
        style.append(("TOPPADDING", (0, idx), (-1, idx), 6))
    for idx in group_subtotal_rows:
        style.append(("FONTNAME", (0, idx), (-1, idx), "Helvetica-Oblique"))
        style.append(("LINEABOVE", (0, idx), (-1, idx), 0.5, colors.HexColor("#cccccc")))
        style.append(("BOTTOMPADDING", (0, idx), (-1, idx), 6))
    charges_table.setStyle(TableStyle(style))
    story.append(charges_table)
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"<b>IN WORDS:</b> {_esc(_amount_in_words(data.total, data.currency))}", value_style))
    story.append(Spacer(1, 24))

    # --- signature ---
    story.append(Paragraph(f"FOR, {_esc(company.name)}", value_style))
    story.append(Spacer(1, 18))
    story.append(Paragraph("AUTHORIZED SIGNATORY", value_style))
    story.append(Spacer(1, 12))

    if data.remarks:
        story.append(Paragraph(f"<b>REMARKS:</b> {_esc(data.remarks)}", value_style))
        story.append(Spacer(1, 8))

    if data.show_bank_details and company.bank_name:
        bank_rows = [
            ["Bank Name:", company.bank_name],
            ["Title of Account:", company.bank_account_title or "-"],
            ["Account No:", company.bank_account_number or "-"],
            ["Sort Code / IBAN:", company.bank_sort_code or "-"],
        ]
        bank_table = Table([[Paragraph(_esc(cell), small_style) for cell in row] for row in bank_rows], colWidths=[40 * mm, 90 * mm])
        bank_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(Paragraph("BANK DETAILS", label_style))
        story.append(bank_table)
        story.append(Spacer(1, 8))

    if data.clauses:
        story.append(Paragraph("TERMS &amp; CONDITIONS", label_style))
        story.append(Spacer(1, 3))
        # Escaped first, then newlines turned into literal <br/> -- safe
        # because escaping already neutralized any markup in the user text.
        story.append(Paragraph(_esc(data.clauses).replace("\n", "<br/>"), small_style))
        story.append(Spacer(1, 8))

    footer_bits = []
    if company.tax_id_label and company.tax_id:
        footer_bits.append(f"{_esc(company.tax_id_label)}: {_esc(company.tax_id)}")
    if company.company_reg_no:
        footer_bits.append(f"COMPANY REG NO: {_esc(company.company_reg_no)}")
    if footer_bits:
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
        story.append(Spacer(1, 4))
        story.append(Paragraph(" | ".join(footer_bits), small_style))

    doc.build(story)
    return buffer.getvalue()


def render_quote_pdf(session: Session, quote: Quote, *, customer_safe: bool = False) -> bytes:
    data = _quote_to_document_data(session, quote)
    if customer_safe:
        data.supplier_name = data.supplier_address = None
    return _build_pdf(data)


def render_invoice_pdf(invoice: Invoice, *, customer_safe: bool = False) -> bytes:
    data = _invoice_to_document_data(invoice)
    if customer_safe:
        data.supplier_name = data.supplier_address = None
    return _build_pdf(data)
