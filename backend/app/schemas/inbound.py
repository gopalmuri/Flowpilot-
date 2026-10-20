from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class NormalizedMessage(BaseModel):
    """Channel-independent representation every adapter converts into."""

    model_config = ConfigDict(frozen=True)

    channel: str
    external_message_id: str = Field(..., min_length=1, max_length=255)
    external_conversation_id: str = Field(..., min_length=1, max_length=255)
    sender_identity: str = Field(..., min_length=1, max_length=320)
    sender_name: Optional[str] = Field(None, max_length=255)
    sender_address: Optional[str] = Field(None, max_length=320)
    subject: Optional[str] = Field(None, max_length=500)
    text_content: str = Field(..., min_length=1, max_length=10000)
    received_at: Optional[datetime] = None
    extra: dict = Field(default_factory=dict)
    # Provider identifiers and reply-routing headers (never message body). Stored on the inbound message.
    provider_metadata: dict = Field(default_factory=dict)


class PortfolioSubmission(BaseModel):
    """Body the portfolio backend signs and posts to FlowPilot."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    submission_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:\-]+$")
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    message: str = Field(..., min_length=1, max_length=5000)
    company: Optional[str] = Field(None, max_length=255)
    subject: Optional[str] = Field(None, max_length=500)
    submitted_at: Optional[datetime] = None
    # Honeypot: real visitors never fill this hidden field. Bots do.
    website: Optional[str] = Field(None, max_length=255)

    @field_validator("name", "message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v


class InboundAcceptedResponse(BaseModel):
    status: str = Field(..., description="accepted | duplicate | ignored")
    message_id: Optional[str] = None
    workflow_run_id: Optional[str] = None
    correlation_id: Optional[str] = None
