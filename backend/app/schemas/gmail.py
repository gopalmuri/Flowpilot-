import uuid
from datetime import datetime
from typing import Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PubSubMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    data: str = Field(..., min_length=1, max_length=8192)
    messageId: Optional[str] = None
    publishTime: Optional[str] = None
    attributes: Optional[Dict[str, str]] = None


class PubSubEnvelope(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message: PubSubMessage
    subscription: Optional[str] = Field(None, max_length=512)


class GmailPushData(BaseModel):
    """The decoded Gmail notification: which mailbox changed and its new historyId. Never message content."""

    model_config = ConfigDict(extra="ignore")
    emailAddress: str = Field(..., min_length=3, max_length=320)
    historyId: Union[int, str]

    @field_validator("emailAddress")
    @classmethod
    def _looks_like_email(cls, v: str) -> str:
        if "@" not in v or any(ch.isspace() for ch in v):
            raise ValueError("not an email address")
        return v


class AuthorizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    integration_id: Optional[uuid.UUID] = Field(None, description="Reconnect this existing Gmail integration")
    workflow_id: Optional[uuid.UUID] = Field(None, description="Workflow started by incoming mail")


class AuthorizeResponse(BaseModel):
    authorization_url: str


class SchedulerStatus(BaseModel):
    last_tick: Optional[datetime] = None
    healthy: bool = False


class GmailAccountStatus(BaseModel):
    """Everything the UI shows about a connected mailbox. Contains no credentials or tokens."""

    integration_id: uuid.UUID
    organization_id: uuid.UUID
    organization_name: Optional[str] = None
    mailbox: str
    integration_status: str
    health: str = Field(..., description="healthy | degraded | needs_reauth | disconnected")
    health_reasons: List[str] = Field(default_factory=list)
    connected_at: datetime
    disconnected_at: Optional[datetime] = None
    granted_scopes: List[str] = Field(default_factory=list)
    workflow_id: Optional[str] = None
    sync_state: str
    last_sync_at: Optional[datetime] = None
    last_sync_error: Optional[str] = None
    last_notification_at: Optional[datetime] = None
    watch_status: str
    watch_expiration: Optional[datetime] = None
    watch_error: Optional[str] = None


class GmailAccountsResponse(BaseModel):
    items: List[GmailAccountStatus]
    oauth_configured: bool
    pubsub_configured: bool
    poll_interval_seconds: int
    scheduler: SchedulerStatus
