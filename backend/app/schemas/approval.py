import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.outbound import DeliverySummary


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class ApprovalDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    comment: Optional[str] = Field(None, max_length=1000, description="Optional reviewer justification or notes")
    # Reply-draft approvals only. `reviewed_version` is the draft version the reviewer actually saw; the decision is
    # refused if the draft has changed since. `edited_content` makes the reviewer's own edit the approved version.
    reviewed_version: Optional[int] = Field(None, ge=1, description="Draft version number that was reviewed")
    edited_content: Optional[str] = Field(None, max_length=3000, description="Reviewer-edited reply text to approve")


class DraftEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(..., min_length=1, max_length=3000)
    reviewed_version: int = Field(..., ge=1, description="Draft version the edit is based on")


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instructions: str = Field(..., min_length=1, max_length=2000, description="What should change in the draft")


class RegenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewed_version: int = Field(..., ge=1)


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
    draft_id: Optional[uuid.UUID] = None
    draft_status: Optional[str] = None


class ApprovalListResponse(BaseModel):
    items: List[ApprovalResponse]
    total: int
    page: int
    page_size: int


class DraftVersionView(BaseModel):
    version_number: int
    author_type: str
    author_user_id: Optional[uuid.UUID] = None
    content: str
    content_hash: str
    created_at: datetime
    is_approved: bool = False


class ReviewMessage(BaseModel):
    channel: str
    sender_name: Optional[str] = None
    sender_address: Optional[str] = None
    subject: Optional[str] = None
    text: str
    received_at: datetime


class ReviewAnalysis(BaseModel):
    category: Optional[str] = None
    summary: Optional[str] = None
    requirements: List[str] = Field(default_factory=list)
    missing_information: List[str] = Field(default_factory=list)
    urgency: Optional[str] = None
    recommended_action: Optional[str] = None
    confidence: Optional[float] = None
    uncertainty_notes: Optional[str] = None
    injection_suspected: bool = False
    needs_human_attention: bool = False
    risk_flags: List[str] = Field(default_factory=list)
    is_fallback: bool = False
    provider: Optional[str] = None
    model: Optional[str] = None


class ReviewDraft(BaseModel):
    id: uuid.UUID
    status: str
    current_version: int
    approved_version: Optional[int] = None
    revision_instructions: Optional[str] = None
    decision_comment: Optional[str] = None
    decided_by: Optional[uuid.UUID] = None
    decided_at: Optional[datetime] = None
    risk_flags: List[str] = Field(default_factory=list)
    versions: List[DraftVersionView]


class ApprovalReviewResponse(BaseModel):
    approval_id: uuid.UUID
    approval_status: str
    is_reapproval: bool = False
    message: Optional[ReviewMessage] = None
    analysis: Optional[ReviewAnalysis] = None
    draft: Optional[ReviewDraft] = None
    delivery: Optional[DeliverySummary] = None
