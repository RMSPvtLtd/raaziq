from pydantic import BaseModel, ConfigDict, Field
from typing import Annotated

NotificationEmail = Annotated[str, Field(max_length=320, pattern=r"^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$")]


class CompanyEmailUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    notification_email: NotificationEmail | None = None
    automatic_email_enabled: bool = True


class CompanyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str
    phone: str | None
    email: str | None
    website: str | None
    tax_id_label: str | None
    tax_id: str | None
    company_reg_no: str | None
    is_default: bool
    notification_email: str | None
    automatic_email_enabled: bool
    email_configured: bool
