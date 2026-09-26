import math
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator


class SLAConfig(BaseModel):
    """SLA threshold and activation configuration."""
    target_seconds: float = Field(..., description="Target SLA duration in seconds (> 0 and <= 604800)")
    warning_threshold_seconds: float = Field(..., description="Warning threshold in seconds (>= 0 and < target_seconds)")
    enabled: bool = Field(True, description="Whether SLA evaluation is active")

    @model_validator(mode="after")
    def validate_sla_constraints(self) -> "SLAConfig":
        if not math.isfinite(self.target_seconds):
            raise ValueError("target_seconds must be a finite numeric value")
        if not math.isfinite(self.warning_threshold_seconds):
            raise ValueError("warning_threshold_seconds must be a finite numeric value")
        if self.target_seconds <= 0:
            raise ValueError("target_seconds must be strictly greater than 0")
        if self.warning_threshold_seconds < 0:
            raise ValueError("warning_threshold_seconds must be non-negative (>= 0)")
        if self.warning_threshold_seconds >= self.target_seconds:
            raise ValueError("warning_threshold_seconds must be strictly less than target_seconds")
        if self.target_seconds > 604800.0:  # 7 days max
            raise ValueError("target_seconds must not exceed 604800 seconds (7 days)")
        return self


class SLAUpdateRequest(BaseModel):
    """Request payload to configure SLA targets for a draft workflow version."""
    target_seconds: float = Field(..., description="Target duration in seconds")
    warning_threshold_seconds: float = Field(..., description="Warning threshold in seconds")
    enabled: bool = Field(True, description="Enable SLA monitoring")

    @model_validator(mode="after")
    def validate_sla_constraints(self) -> "SLAUpdateRequest":
        if not math.isfinite(self.target_seconds):
            raise ValueError("target_seconds must be a finite numeric value")
        if not math.isfinite(self.warning_threshold_seconds):
            raise ValueError("warning_threshold_seconds must be a finite numeric value")
        if self.target_seconds <= 0:
            raise ValueError("target_seconds must be strictly greater than 0")
        if self.warning_threshold_seconds < 0:
            raise ValueError("warning_threshold_seconds must be non-negative (>= 0)")
        if self.warning_threshold_seconds >= self.target_seconds:
            raise ValueError("warning_threshold_seconds must be strictly less than target_seconds")
        if self.target_seconds > 604800.0:
            raise ValueError("target_seconds must not exceed 604800 seconds (7 days)")
        return self


class SLAVersionResponse(BaseModel):
    """Response returned upon SLA configuration update."""
    workflow_id: uuid.UUID
    version_id: uuid.UUID
    version_number: int
    status: str
    sla: SLAConfig


class ExecutionVolumeMetrics(BaseModel):
    """Execution volume counts and terminal completion rates."""
    total: int = Field(..., description="Total executions (terminal + in-flight)")
    terminal: int = Field(..., description="Terminal executions (success + failed + cancelled)")
    in_flight: int = Field(..., description="In-flight executions (running + pending + waiting_approval)")
    success_count: int
    failed_count: int
    cancelled_count: int
    running_count: int
    pending_count: int
    waiting_approval_count: int
    success_rate: float = Field(..., description="success / terminal * 100 (0.0 if terminal == 0)")
    failure_rate: float = Field(..., description="failed / terminal * 100 (0.0 if terminal == 0)")
    cancellation_rate: float = Field(..., description="cancelled / terminal * 100 (0.0 if terminal == 0)")


class DurationMetrics(BaseModel):
    """Duration percentiles in milliseconds for finished executions."""
    avg_duration_ms: float
    p50_duration_ms: float
    p95_duration_ms: float
    p99_duration_ms: float


class SLAMetrics(BaseModel):
    """Query-derived SLA compliance metrics across evaluated executions."""
    monitored_count: int = Field(..., description="healthy + warning + breached")
    healthy_count: int
    warning_count: int
    breached_count: int
    not_applicable_count: int
    sla_compliance_rate: float = Field(..., description="(healthy + warning) / monitored * 100")
    sla_healthy_rate: float = Field(..., description="healthy / monitored * 100")
    sla_breach_rate: float = Field(..., description="breached / monitored * 100")


class AnalyticsOverviewResponse(BaseModel):
    """Executive KPI overview aggregating volume, latency, and SLA performance."""
    organization_id: uuid.UUID
    workflow_id: Optional[uuid.UUID] = None
    time_range: str
    start_time: datetime
    end_time: datetime
    volume: ExecutionVolumeMetrics
    duration: DurationMetrics
    sla: SLAMetrics


class TimeSeriesBucket(BaseModel):
    """Continuous time bucket for execution volume and latency trend."""
    timestamp: datetime
    total_count: int
    success_count: int
    failed_count: int
    cancelled_count: int
    in_flight_count: int
    avg_duration_ms: float
    p95_duration_ms: float


class TimeSeriesResponse(BaseModel):
    """Time-series trend analysis response with continuous zero-filled buckets."""
    organization_id: uuid.UUID
    workflow_id: Optional[uuid.UUID] = None
    start_time: datetime
    end_time: datetime
    granularity: str  # "hourly", "daily", "weekly"
    buckets: List[TimeSeriesBucket]


class WorkflowPerformanceItem(BaseModel):
    """Per-workflow aggregated execution and SLA metrics."""
    workflow_id: uuid.UUID
    workflow_name: str
    status: str
    active_version_number: Optional[int] = None
    total_executions: int
    success_count: int
    failed_count: int
    cancelled_count: int
    in_flight_count: int
    success_rate: float
    failure_rate: float
    avg_duration_ms: float
    p95_duration_ms: float
    has_sla: bool
    sla_compliance_rate: float
    sla_breach_count: int


class WorkflowPerformanceResponse(BaseModel):
    """Paginated list of workflow performance summaries."""
    items: List[WorkflowPerformanceItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class StepLatencyItem(BaseModel):
    """Step execution statistics identifying bottlenecks."""
    step_key: str
    step_type: str
    name: Optional[str] = None
    total_executions: int
    failed_count: int
    failure_rate: float
    avg_execution_time_ms: float
    p95_execution_time_ms: float
    p99_execution_time_ms: float


class StepLatencyResponse(BaseModel):
    """Bounded step performance and bottleneck analysis."""
    items: List[StepLatencyItem]
    total: int
    limit: int
    sort_by: str


class SLAMonitoringItem(BaseModel):
    """Workflow-level SLA tracking status."""
    workflow_id: uuid.UUID
    workflow_name: str
    active_version_number: Optional[int] = None
    sla_enabled: bool
    target_seconds: Optional[float] = None
    warning_threshold_seconds: Optional[float] = None
    total_evaluated: int
    healthy_count: int
    warning_count: int
    breached_count: int
    compliance_rate: float
    healthy_rate: float
    breach_rate: float
    current_active_breaches: int


class SLAMonitoringResponse(BaseModel):
    """Comprehensive SLA monitoring response with overall summary and workflow details."""
    summary: SLAMetrics
    workflows: List[SLAMonitoringItem]
