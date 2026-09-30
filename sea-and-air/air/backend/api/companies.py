from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from models.company import Company
from schemas.companies import CompanyRead, CompanyEmailUpdate
from utils.security import get_current_ops_user
from services.companies import get_company, list_companies

router = APIRouter(prefix="/companies", tags=["companies"], dependencies=[Depends(get_current_ops_user)])


@router.get("", response_model=list[CompanyRead])
def list_all(db: Session = Depends(get_db)) -> list[Company]:
    return list_companies(db)


@router.patch("/{company_id}", response_model=CompanyRead)
def update_email_settings(company_id: int, payload: CompanyEmailUpdate, db: Session = Depends(get_db)) -> Company:
    company = get_company(db, company_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    db.flush()
    return company
