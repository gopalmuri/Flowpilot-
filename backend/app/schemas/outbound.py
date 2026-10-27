import uuid
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

STATUS_LABELS = {
    "PENDING": "Queued",
    "CLAIMED": "Starting",
    "SENDING": "Sending",
    "SENT": "Accepted by provider (delivery not confirmed)",
    "FAILED_RETRYABLE": "Failed, will retry",
    "FAILED_PERMANENT": "Failed",
    "UNKNOWN_OUTCOME": "Outcome unknown, needs reconciliation",
    "CANCELLED": "Cancelled",
}


class DeliveryError(BaseModel):
    category: Optional[str] = None
    code: Optional[str] = None
    detail: Optional[str] = None


class DeliverySummary(BaseModel):
    """What a reviewer sees next to a draft. SENT means the provider accepted it, never that it was delivered."""

    id: uuid.UUID
    status: str
    status_label: str
    version_number: int
    attempt_count: int
    max_attempts: int
    next_attempt_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    provider_message_id: Optional[str] = None
    error: Optional[DeliveryError] = None


class DeliveryResponse(DeliverySummary):
    model_config = ConfigDict(from_attributes=True)

    organization_id: uuid.UUID
    draft_id: uuid.UUID
    conversation_id: uuid.UUID
    workflow_run_id: Optional[uuid.UUID] = None
    integration_id: Optional[uuid.UUID] = None
    channel: str
    provider: str
    destination: str
    content_hash_prefix: str
    resolution: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class DeliveryListResponse(BaseModel):
    items: List[DeliveryResponse]
    total: int
    page: int
    page_size: int


class ReconcileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: Literal["SENT", "NOT_SENT"] = Field(
        ..., description="What you verified with the provider. NOT_SENT authorises exactly one more attempt."
    )
    provider_message_id: Optional[str] = Field(None, max_length=255)
