import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, BigInteger, ForeignKey, DateTime, Index, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import UUIDMixin, utc_now

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.workflow import Workflow


class UsageRecord(Base, UUIDMixin):
    __tablename__ = "usage_records"
    __table_args__ = (
        Index("idx_usage_records_org_metric", "organization_id", "metric_type", "recorded_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    metric_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )
    quantity: Mapped[int] = mapped_column(
        BigInteger,
        default=1,
        nullable=False,
    )
    workflow_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid,
        ForeignKey("workflows.id"),
        nullable=True,
        index=True,
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="usage_records",
    )
    workflow: Mapped[Optional["Workflow"]] = relationship(
        "Workflow",
    )
