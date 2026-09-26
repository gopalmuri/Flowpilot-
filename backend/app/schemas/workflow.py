import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class WorkflowStatus(str, Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    ARCHIVED = "ARCHIVED"


class WorkflowVersionStatus(str, Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"


class StepType(str, Enum):
    WEBHOOK_TRIGGER = "WEBHOOK_TRIGGER"
    MANUAL_TRIGGER = "MANUAL_TRIGGER"
    VALIDATE_DATA = "VALIDATE_DATA"
    AI_CLASSIFICATION = "AI_CLASSIFICATION"
    CONDITION = "CONDITION"
    MOCK_CRM_CREATE = "MOCK_CRM_CREATE"
    SLACK_NOTIFICATION = "SLACK_NOTIFICATION"
    HUMAN_APPROVAL = "HUMAN_APPROVAL"


# ---------------------------------------------------------
# Step-Specific Configuration Schemas
# ---------------------------------------------------------

class WebhookTriggerConfig(BaseModel):
    """Configuration for inbound HTTP webhook trigger node."""
    secret_token: Optional[str] = Field(None, description="Optional HMAC or shared secret for payload verification")
    allowed_methods: List[str] = Field(default_factory=lambda: ["POST"], description="Allowed HTTP request methods")
    payload_schema: Optional[Dict[str, Any]] = Field(None, description="Optional JSON schema to validate payload")

    model_config = ConfigDict(extra="allow")


class ManualTriggerConfig(BaseModel):
    """Configuration for UI-initiated manual test trigger node."""
    form_fields: Optional[List[Dict[str, Any]]] = Field(None, description="Optional interactive form input definitions")

    model_config = ConfigDict(extra="allow")


class ValidateDataConfig(BaseModel):
    """
    Configuration for data validation and schema sanitization node.
    Requires at least one of: 'schema', 'rules', or 'required_fields' (OR semantics).
    """
    schema_definition: Optional[Dict[str, Any]] = Field(None, alias="schema", description="JSON schema specification")
    rules: Optional[List[Dict[str, Any]]] = Field(None, description="List of discrete validation rule expressions")
    required_fields: Optional[List[str]] = Field(None, description="List of mandatory dictionary keys")

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class AIClassificationConfig(BaseModel):
    """
    Configuration for LLM classification node.
    Requires: 'prompt' or 'categories' (OR semantics; both can be provided).
    """
    prompt: Optional[str] = Field(None, description="Prompt instruction directing LLM classification criteria")
    categories: Optional[List[str]] = Field(None, description="Candidate target labels/categories for classification")
    model: Optional[str] = Field("gpt-4o-mini", description="Underlying model identifier")
    confidence_threshold: Optional[float] = Field(0.7, ge=0.0, le=1.0, description="Minimum confidence cutoff")

    model_config = ConfigDict(extra="allow")


class ConditionStepConfig(BaseModel):
    """
    Configuration for conditional branching node.
    Requires at least one of: 'conditions', 'expression', or 'field' (OR semantics).
    """
    field: Optional[str] = Field(None, description="Variable or payload attribute path to evaluate")
    operator: Optional[str] = Field(None, description="Comparison operator (equals, greater_than, contains, etc.)")
    value: Optional[Any] = Field(None, description="Expected value to compare against")
    expression: Optional[str] = Field(None, description="Raw boolean expression")
    conditions: Optional[List[Dict[str, Any]]] = Field(None, description="List of structured condition clauses")

    model_config = ConfigDict(extra="allow")


class MockCRMCreateConfig(BaseModel):
    """
    Configuration for CRM entity creation node.
    Requires at least one of: 'entity_type' or 'mapping' (OR semantics).
    """
    entity_type: Optional[str] = Field("lead", description="Target CRM entity type (lead, contact, deal)")
    mapping: Optional[Dict[str, str]] = Field(None, description="Field mapping from workflow context to CRM attributes")

    model_config = ConfigDict(extra="allow")


class SlackNotificationConfig(BaseModel):
    """
    Configuration for Slack messaging node.
    Requires at least one destination/content descriptor: 'channel', 'message', or 'webhook_url' (OR semantics).
    """
    channel: Optional[str] = Field(None, description="Target Slack channel name or ID (e.g. #sales-alerts)")
    webhook_url: Optional[str] = Field(None, description="Incoming Slack Webhook URL")
    message: Optional[str] = Field(None, description="Message text or markdown template")

    model_config = ConfigDict(extra="allow")


class HumanApprovalConfig(BaseModel):
    """
    Configuration for human approval guard node.
    Requires at least one of: 'approver_role', 'title', or 'timeout_hours' (OR semantics).
    """
    approver_role: Optional[str] = Field("MANAGER", description="Minimum role required to approve request")
    title: Optional[str] = Field(None, description="Human-readable title/summary of approval request")
    timeout_hours: Optional[int] = Field(24, ge=1, description="Auto-expiration timeout in hours")

    model_config = ConfigDict(extra="allow")


# ---------------------------------------------------------
# Workflow Core Schemas
# ---------------------------------------------------------

class WorkflowStepSchema(BaseModel):
    step_key: str = Field(..., min_length=1, max_length=100, description="Unique node key within version DAG")
    step_type: str = Field(..., min_length=1, max_length=50, description="Registered step executor type")
    name: str = Field(..., min_length=1, max_length=255, description="Human readable step name")
    config: Dict[str, Any] = Field(default_factory=dict, description="Step execution parameters")
    ui_position: Dict[str, Any] = Field(default_factory=lambda: {"x": 0, "y": 0}, description="Canvas coordinates")

    model_config = ConfigDict(from_attributes=True)


class WorkflowConnectionSchema(BaseModel):
    source_step_key: str = Field(..., min_length=1, max_length=100)
    target_step_key: str = Field(..., min_length=1, max_length=100)
    condition_label: Optional[str] = Field(None, max_length=100)

    model_config = ConfigDict(from_attributes=True)


class WorkflowCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Workflow name")
    description: Optional[str] = Field(None, max_length=5000, description="Optional workflow description")


class WorkflowUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)


class WorkflowVersionCreateRequest(BaseModel):
    base_version_id: Optional[uuid.UUID] = Field(None, description="Optional version to clone steps and connections from")


class WorkflowVersionUpdateRequest(BaseModel):
    steps: List[WorkflowStepSchema] = Field(default_factory=list, description="Array of DAG nodes")
    connections: List[WorkflowConnectionSchema] = Field(default_factory=list, description="Array of directed connections")


class WorkflowValidationResult(BaseModel):
    valid: bool = Field(..., description="Whether the DAG is structurally and semantically valid")
    errors: List[str] = Field(default_factory=list, description="List of validation failure explanations")
    warnings: List[str] = Field(default_factory=list, description="Non-fatal configuration warnings")


class WorkflowStepResponse(BaseModel):
    id: uuid.UUID
    workflow_version_id: uuid.UUID
    step_key: str
    step_type: str
    name: str
    config: Dict[str, Any]
    ui_position: Dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowConnectionResponse(BaseModel):
    id: uuid.UUID
    workflow_version_id: uuid.UUID
    source_step_id: uuid.UUID
    target_step_id: uuid.UUID
    source_step_key: Optional[str] = None
    target_step_key: Optional[str] = None
    condition_label: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowVersionSummaryResponse(BaseModel):
    id: uuid.UUID
    workflow_id: uuid.UUID
    version_number: int
    status: str
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowVersionDetailResponse(BaseModel):
    id: uuid.UUID
    workflow_id: uuid.UUID
    version_number: int
    status: str
    definition: Dict[str, Any]
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    steps: List[WorkflowStepResponse] = Field(default_factory=list)
    connections: List[WorkflowConnectionResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class WorkflowResponse(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    description: Optional[str]
    status: str
    active_version_id: Optional[uuid.UUID]
    webhook_key: Optional[str]
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    version_count: int = 0
    active_version: Optional[WorkflowVersionSummaryResponse] = None

    model_config = ConfigDict(from_attributes=True)


class WorkflowListResponse(BaseModel):
    items: List[WorkflowResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
