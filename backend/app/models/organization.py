from typing import List, TYPE_CHECKING
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.membership import OrganizationMember
    from app.models.integration import Integration
    from app.models.workflow import Workflow
    from app.models.workflow_run import WorkflowRun
    from app.models.approval import ApprovalRequest
    from app.models.audit_log import AuditLog
    from app.models.usage import UsageRecord
    from app.models.idempotency import IdempotencyRecord


class Organization(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    slug: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )

    # Relationships
    members: Mapped[List["OrganizationMember"]] = relationship(
        "OrganizationMember",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    integrations: Mapped[List["Integration"]] = relationship(
        "Integration",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    workflows: Mapped[List["Workflow"]] = relationship(
        "Workflow",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    workflow_runs: Mapped[List["WorkflowRun"]] = relationship(
        "WorkflowRun",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    approval_requests: Mapped[List["ApprovalRequest"]] = relationship(
        "ApprovalRequest",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    audit_logs: Mapped[List["AuditLog"]] = relationship(
        "AuditLog",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    usage_records: Mapped[List["UsageRecord"]] = relationship(
        "UsageRecord",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    idempotency_records: Mapped[List["IdempotencyRecord"]] = relationship(
        "IdempotencyRecord",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
