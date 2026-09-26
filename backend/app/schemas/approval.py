import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class ApprovalDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    comment: Optional[str] = Field(None, max_length=1000, description="Optional reviewer justification or notes")


class ApprovalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    workflow_run_id: uuid.UUID
    step_id: uuid.UUID
    status: str
    payload_snapshot: Dict[str, Any] = Field(default_factory=dict)
    reviewed_by: Optional[uuid.UUID] = None
    comment: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    time_remaining_seconds: Optional[int] = None
    approver_role: Optional[str] = None
    workflow_name: Optional[str] = None
    step_key: Optional[str] = None


class ApprovalListResponse(BaseModel):
    items: List[ApprovalResponse]
    total: int
    page: int
    page_size: int
