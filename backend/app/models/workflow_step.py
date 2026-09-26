import uuid
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from sqlalchemy import String, ForeignKey, JSON, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.workflow import WorkflowVersion
    from app.models.workflow_run import WorkflowStepRun


class WorkflowStep(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "workflow_steps"

    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflow_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    step_key: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    step_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    config: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )
    ui_position: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=lambda: {"x": 0, "y": 0},
        nullable=False,
    )

    # Relationships
    workflow_version: Mapped["WorkflowVersion"] = relationship(
        "WorkflowVersion",
        back_populates="steps",
    )
    step_runs: Mapped[List["WorkflowStepRun"]] = relationship(
        "WorkflowStepRun",
        back_populates="step",
    )


class WorkflowConnection(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "workflow_connections"

    workflow_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflow_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_step_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflow_steps.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_step_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("workflow_steps.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    condition_label: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )

    # Relationships
    workflow_version: Mapped["WorkflowVersion"] = relationship(
        "WorkflowVersion",
        back_populates="connections",
    )
    source_step: Mapped["WorkflowStep"] = relationship(
        "WorkflowStep",
        foreign_keys=[source_step_id],
    )
    target_step: Mapped["WorkflowStep"] = relationship(
        "WorkflowStep",
        foreign_keys=[target_step_id],
    )
