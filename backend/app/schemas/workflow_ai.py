from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.workflow import WorkflowConnectionSchema, WorkflowStepSchema


class AIMessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class AIChatMessage(BaseModel):
    role: AIMessageRole
    content: str = Field(..., min_length=1)

    model_config = ConfigDict(extra="ignore")


class AIWorkflowDiffSummary(BaseModel):
    added_steps: List[str] = Field(default_factory=list, description="List of step keys/names added")
    removed_steps: List[str] = Field(default_factory=list, description="List of step keys/names removed")
    modified_steps: List[str] = Field(default_factory=list, description="List of step keys/names whose configuration or name changed")
    reconnected_edges: List[str] = Field(default_factory=list, description="List of connections created or rewired")


class AIWorkflowProposal(BaseModel):
    steps: List[WorkflowStepSchema] = Field(default_factory=list, description="Proposed workflow DAG steps")
    connections: List[WorkflowConnectionSchema] = Field(default_factory=list, description="Proposed workflow connections")
    diff_summary: AIWorkflowDiffSummary = Field(default_factory=AIWorkflowDiffSummary)
    valid: bool = Field(default=True, description="Whether the proposed DAG passed authoritative backend validation")
    errors: List[str] = Field(default_factory=list, description="Validation errors if proposal is invalid")
    warnings: List[str] = Field(default_factory=list, description="Validation warnings or notes")


class AIClarificationQuestion(BaseModel):
    id: str = Field(..., description="Unique ID for this question in the interaction")
    question: str = Field(..., description="The clarification question asked to the user")
    options: List[str] = Field(default_factory=list, description="Quick-choice options for the user to click")


class AITemplateSuggestion(BaseModel):
    id: str = Field(..., description="Unique template ID")
    title: str = Field(..., description="Template title")
    description: str = Field(..., description="Brief summary of template")
    prompt: str = Field(..., description="Prompt that builds this template")


class AISetupItem(BaseModel):
    id: str
    kind: Literal["integration", "config", "info"] = Field(
        ..., description="integration: must connect something; config: a step needs a value; info: good to know"
    )
    title: str
    detail: str
    step_key: Optional[str] = None
    action: Optional[Literal["connect_gmail", "open_integrations", "edit_step"]] = None
    blocking: bool = Field(default=False, description="True if the workflow cannot do real work until this is resolved")


class AIWorkflowAssistRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    prompt: str = Field(..., min_length=1, description="Natural language prompt or query from user")
    conversation_history: List[AIChatMessage] = Field(
        default_factory=list,
        description="Previous turns in the assistant conversation",
    )
    current_steps: List[WorkflowStepSchema] = Field(
        default_factory=list,
        description="The current nodes/steps present in the editor canvas",
    )
    current_connections: List[WorkflowConnectionSchema] = Field(
        default_factory=list,
        description="The current edges/connections present in the editor canvas",
    )
    workflow_name: Optional[str] = Field(None, description="Optional current workflow name")
    workflow_description: Optional[str] = Field(None, description="Optional current workflow description")


class AIWorkflowAssistResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mode: Literal["proposal", "clarification", "explanation", "suggestion", "error"] = Field(
        ...,
        description="The outcome type of the AI assistant turn",
    )
    message: str = Field(..., description="Explanatory text message to show in assistant chat")
    proposal: Optional[AIWorkflowProposal] = Field(
        None,
        description="Generated or refined workflow DAG proposal when mode is 'proposal'",
    )
    clarification_questions: List[AIClarificationQuestion] = Field(
        default_factory=list,
        description="Options to present when the assistant needs clarification",
    )
    template_suggestions: List[AITemplateSuggestion] = Field(
        default_factory=list,
        description="Template recommendations to present when user asks for ideas or starters",
    )
    summary: Optional[str] = Field(None, description="Plain-English one-paragraph description of the proposed flow")
    suggested_name: Optional[str] = Field(None, description="Short suggested workflow name for a proposal")
    setup_needed: List[AISetupItem] = Field(default_factory=list, description="What must be set up before it can run for real")
    unsupported: List[str] = Field(default_factory=list, description="Requested capabilities the product cannot do yet")
    repair_attempts: int = Field(default=0, ge=0, description="How many times the proposal was auto-repaired")
    tokens_used: int = Field(default=0, ge=0)
    latency_ms: int = Field(default=0, ge=0)
    provider: str = Field(default="grok")
    model: str = Field(default="grok")


class AISimulatePayloadRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    steps: List[WorkflowStepSchema] = Field(default_factory=list, description="Workflow DAG steps")
    connections: List[WorkflowConnectionSchema] = Field(default_factory=list, description="Workflow DAG connections")
    scenario: Optional[str] = Field("happy_path", description="Scenario type: 'happy_path', 'edge_case', 'failure', or 'custom'")
    custom_instruction: Optional[str] = Field(None, description="Optional custom prompt to tailor payload fields")


class AISimulatePayloadResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scenario: str = Field(..., description="Scenario that was generated")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Generated JSON payload")
    summary: str = Field(..., description="Explanation of why this payload tests the workflow")
    target_trigger: Optional[str] = Field(None, description="Step name/key of the trigger step targeted")


class AISimulateExecutionStep(BaseModel):
    step_id: str = Field(..., description="Step ID or step_key")
    step_name: str = Field(...)
    step_type: str = Field(...)
    status: Literal["SUCCESS", "SKIPPED", "WAITING_APPROVAL", "FAILED"] = Field(...)
    branch_taken: Optional[str] = Field(None, description="Branch chosen, e.g. 'true', 'false', 'default'")
    simulated_output: Dict[str, Any] = Field(default_factory=dict, description="Simulated output payload of the step")
    reasoning: str = Field(..., description="Why this step succeeded, failed, or was skipped")


class AISimulateExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    steps: List[WorkflowStepSchema] = Field(default_factory=list, description="Workflow DAG steps")
    connections: List[WorkflowConnectionSchema] = Field(default_factory=list, description="Workflow DAG connections")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Initial input payload to test")


class AISimulateExecutionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    overall_outcome: Literal["COMPLETED", "TERMINATED_EARLY", "HALTED_ON_ERROR", "PENDING_APPROVAL"] = Field(...)
    simulation_summary: str = Field(..., description="Overview narrative of how the workflow executed")
    active_step_ids: List[str] = Field(default_factory=list, description="Ordered list of step IDs traversed in this simulated run")
    steps: List[AISimulateExecutionStep] = Field(default_factory=list, description="Simulated results for each step in execution order")
    latency_ms: int = Field(default=0, ge=0)



class AIBuilderCreateRequest(BaseModel):
    """Create a DRAFT workflow from an accepted AI proposal. Nothing is activated."""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)
    steps: List[WorkflowStepSchema] = Field(..., min_length=1)
    connections: List[WorkflowConnectionSchema] = Field(default_factory=list)


class AIBuilderCreateResponse(BaseModel):
    workflow_id: str
    version_id: str
    name: str
    status: str
    valid: bool
    warnings: List[str] = Field(default_factory=list)


class AICatalogStep(BaseModel):
    step_type: str
    label: str
    category: str
    description: str
    example_config: Dict[str, Any] = Field(default_factory=dict)
    edge_labels: List[str] = Field(default_factory=list)
    is_trigger: bool = False
    is_mock: bool = False
    needs_integration: Optional[str] = None


class AIWorkflowTemplate(BaseModel):
    id: str
    title: str
    description: str
    prompt: str
    category: str
    uses: List[str] = Field(default_factory=list, description="Plain-language step labels used")


class AIRunFailedStep(BaseModel):
    step_key: str
    name: str
    step_type: str
    error: str


class AIRunExplainResponse(BaseModel):
    run_id: str
    run_status: str
    explanation: str
    next_steps: List[str] = Field(default_factory=list)
    failed_steps: List[AIRunFailedStep] = Field(default_factory=list)
    suggested_fix: Optional[AIWorkflowProposal] = None
    base_version_id: Optional[str] = None
    used_ai: bool = False


class AIWorkflowStats(BaseModel):
    window_days: int = 30
    total_runs: int = 0
    completed_runs: int = 0
    failed_runs: int = 0
    failure_rate: float = 0.0
    pending_approvals: int = 0
    avg_approval_wait_hours: Optional[float] = None
    top_failing_steps: List[Dict[str, Any]] = Field(default_factory=list)


class AIImprovementSuggestion(BaseModel):
    id: str
    title: str
    detail: str
    severity: Literal["info", "warning", "critical"] = "info"


class AISuggestionsResponse(BaseModel):
    workflow_id: str
    stats: AIWorkflowStats
    suggestions: List[AIImprovementSuggestion] = Field(default_factory=list)
    proposal: Optional[AIWorkflowProposal] = None
    base_version_id: Optional[str] = None
    used_ai: bool = False
