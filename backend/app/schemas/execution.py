import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator


class WorkflowRunStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PAUSED = "PAUSED"
    CANCELLED = "CANCELLED"


class WorkflowStepRunStatus(str, Enum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PAUSED = "PAUSED"
    SKIPPED = "SKIPPED"


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class WorkflowRunCreateRequest(BaseModel):
    trigger_payload: Dict[str, Any] = Field(
        default_factory=dict,
        description="Input parameters or webhook payload to start execution",
    )
    correlation_id: Optional[str] = Field(
        None,
        max_length=100,
        description="Optional client-provided correlation identifier for tracing",
    )

    @field_validator("trigger_payload")
    @classmethod
    def validate_payload_size(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        import json
        try:
            dumped = json.dumps(v)
            if len(dumped.encode("utf-8")) > 1024 * 1024:  # 1MB max upload payload
                raise ValueError("Payload exceeds maximum permitted size of 1MB")
        except (TypeError, OverflowError):
            raise ValueError("Payload must be valid JSON-serializable dictionary")
        return v


class WorkflowRunResumeRequest(BaseModel):
    approved: bool = Field(
        True,
        description="Whether to approve (True) or reject (False) the suspended human approval request",
    )
    comment: Optional[str] = Field(
        None,
        max_length=2000,
        description="Optional reviewer notes or explanation",
    )


class WorkflowStepRunResponse(BaseModel):
    id: uuid.UUID
    workflow_run_id: uuid.UUID
    step_id: uuid.UUID
    step_key: Optional[str] = None
    step_type: Optional[str] = None
    status: str
    input_data: Dict[str, Any] = Field(default_factory=dict)
    output_data: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None
    execution_time_ms: int = 0
    started_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ExecutionApprovalSummaryResponse(BaseModel):
    id: uuid.UUID
    workflow_run_id: uuid.UUID
    step_id: uuid.UUID
    status: str
    reviewed_by: Optional[uuid.UUID] = None
    reviewer_email: Optional[str] = None
    reviewer_name: Optional[str] = None
    comment: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class WorkflowRunResponse(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    workflow_id: uuid.UUID
    workflow_version_id: uuid.UUID
    workflow_name: Optional[str] = None
    status: str
    trigger_type: str
    trigger_payload: Dict[str, Any] = Field(default_factory=dict)
    correlation_id: str
    error_message: Optional[str] = None
    duration_ms: Optional[int] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowRunDetailResponse(WorkflowRunResponse):
    step_runs: List[WorkflowStepRunResponse] = Field(default_factory=list)
    approvals: List[ExecutionApprovalSummaryResponse] = Field(default_factory=list)


class WorkflowRunListResponse(BaseModel):
    items: List[WorkflowRunResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
