import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from sqlalchemy import String, Text, Integer, ForeignKey, DateTime, Index, JSON, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin, utc_now

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.workflow import Workflow, WorkflowVersion
    from app.models.workflow_step import WorkflowStep
    from app.models.approval import ApprovalRequest


class WorkflowRun(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "workflow_runs"
    __table_args__ = (
        Index("idx_workflow_runs_org_status", "organization_id", "status", "started_at"),
        Index("idx_workflow_runs_correlation", "correlation_id"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflow_versions.id"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(50),
        default="PENDING",
        nullable=False,
        index=True,
    )
    trigger_type: Mapped[str] = mapped_column(
        String(50),
        default="WEBHOOK",
        nullable=False,
    )
    trigger_payload: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )
    correlation_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="workflow_runs",
    )
    workflow: Mapped["Workflow"] = relationship(
        "Workflow",
        back_populates="runs",
    )
    version: Mapped["WorkflowVersion"] = relationship(
        "WorkflowVersion",
    )
    step_runs: Mapped[List["WorkflowStepRun"]] = relationship(
        "WorkflowStepRun",
        back_populates="workflow_run",
        cascade="all, delete-orphan",
    )
    approval_requests: Mapped[List["ApprovalRequest"]] = relationship(
        "ApprovalRequest",
        back_populates="workflow_run",
        cascade="all, delete-orphan",
    )


class WorkflowStepRun(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "workflow_step_runs"

    workflow_run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    step_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflow_steps.id"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(50),
        default="RUNNING",
        nullable=False,
    )
    input_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )
    output_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    execution_time_ms: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    workflow_run: Mapped["WorkflowRun"] = relationship(
        "WorkflowRun",
        back_populates="step_runs",
    )
    step: Mapped["WorkflowStep"] = relationship(
        "WorkflowStep",
        back_populates="step_runs",
    )
