from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_db
from utils.errors import NotFound
from models.ops_user import OpsUser
from models.quote import Quote
from schemas.quotes import (
    QuoteAdjustmentsRequest,
    QuoteClausesRequest,
    QuoteGenerateRequest,
    QuoteLineItemsOverrideRequest,
    QuoteManualCreateRequest,
    QuoteRead,
    QuoteRejectRequest,
)
from schemas.shipments import ShipmentRead
from utils.security import get_current_ops_user
from services.pdf_documents import render_quote_pdf
from services.email import delivery_result
from services.quotes import (
    LineItemOverride,
    ManualLineItem,
    accept_quote,
    create_manual_quote,
    email_quote,
    generate_quotes,
    list_revisions,
    override_line_items,
    reject_quote,
    send_quote,
    set_quote_adjustments,
    set_quote_clauses,
)

router = APIRouter(prefix="/quotes", tags=["quotes"], dependencies=[Depends(get_current_ops_user)])


@router.post("/generate", response_model=list[QuoteRead], status_code=201)
def generate(payload: QuoteGenerateRequest, db: Session = Depends(get_db)) -> list[Quote]:
    """One quote per carrier with a currently-valid rate card for this
    inquiry's lane/mode -- see services.quotes.generate_quotes."""
    return generate_quotes(db, payload.inquiry_id)


@router.post("/manual", response_model=QuoteRead, status_code=201)
def create_manual(payload: QuoteManualCreateRequest, db: Session = Depends(get_db)) -> Quote:
    line_items = [
        ManualLineItem(
            kind=li.kind, description=li.description, quantity=li.quantity,
            unit_price=li.unit_price, amount=li.amount,
        )
        for li in payload.line_items
    ]
    return create_manual_quote(
        db, payload.inquiry_id, carrier=payload.carrier, currency=payload.currency, line_items=line_items,
        valid_until=payload.valid_until, clauses=payload.clauses,
    )


@router.get("", response_model=list[QuoteRead])
def list_quotes(db: Session = Depends(get_db)) -> list[Quote]:
    return list(db.execute(select(Quote).order_by(Quote.id)).scalars())


@router.get("/{quote_id}", response_model=QuoteRead)
def get_quote(quote_id: int, db: Session = Depends(get_db)) -> Quote:
    quote = db.get(Quote, quote_id)
    if quote is None:
        raise NotFound(f"Quote {quote_id} not found")
    return quote


@router.patch("/{quote_id}/line-items", response_model=QuoteRead)
def patch_line_items(
    quote_id: int, payload: QuoteLineItemsOverrideRequest, db: Session = Depends(get_db)
) -> Quote:
    overrides = [
        LineItemOverride(line_item_id=o.line_item_id, final_total=o.final_total) for o in payload.overrides
    ]
    return override_line_items(db, quote_id, overrides)


@router.patch("/{quote_id}/adjustments", response_model=QuoteRead)
def patch_adjustments(quote_id: int, payload: QuoteAdjustmentsRequest, db: Session = Depends(get_db)) -> Quote:
    return set_quote_adjustments(
        db, quote_id, tax_amount=payload.tax_amount, discount_amount=payload.discount_amount
    )


@router.patch("/{quote_id}/clauses", response_model=QuoteRead)
def patch_clauses(quote_id: int, payload: QuoteClausesRequest, db: Session = Depends(get_db)) -> Quote:
    return set_quote_clauses(db, quote_id, clauses=payload.clauses)


@router.get("/{quote_id}/pdf")
def download_pdf(quote_id: int, db: Session = Depends(get_db)) -> Response:
    quote = db.get(Quote, quote_id)
    if quote is None:
        raise NotFound(f"Quote {quote_id} not found")
    pdf_bytes = render_quote_pdf(db, quote)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="quote-{quote.id}.pdf"'},
    )


@router.post("/{quote_id}/email", status_code=200)
def email(quote_id: int, db: Session = Depends(get_db)) -> dict:
    return delivery_result(email_quote(db, quote_id))


@router.post("/{quote_id}/send", response_model=QuoteRead)
def send(quote_id: int, db: Session = Depends(get_db)) -> Quote:
    """Publish once, then record automatic delivery independently."""
    send_quote(db, quote_id)
    return email_quote(db, quote_id, automatic=True)


@router.post("/{quote_id}/accept", response_model=ShipmentRead)
def accept(quote_id: int, ops_user: OpsUser = Depends(get_current_ops_user), db: Session = Depends(get_db)):
    return accept_quote(db, quote_id, ops_user.name)


@router.post("/{quote_id}/reject", response_model=QuoteRead)
def reject(
    quote_id: int,
    payload: QuoteRejectRequest,
    ops_user: OpsUser = Depends(get_current_ops_user),
    db: Session = Depends(get_db),
) -> Quote:
    return reject_quote(db, quote_id, reason=payload.reason, actor=ops_user.name)


@router.get("/{quote_id}/revisions", response_model=list[QuoteRead])
def revisions(quote_id: int, db: Session = Depends(get_db)) -> list[Quote]:
    return list_revisions(db, quote_id)
