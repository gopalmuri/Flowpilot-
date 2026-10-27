import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# Delivery states (see services/outbound/delivery.py for the transition rules).
PENDING = "PENDING"
CLAIMED = "CLAIMED"
SENDING = "SENDING"
SENT = "SENT"  # the provider ACCEPTED the message; this is not proof of delivery to the recipient
FAILED_RETRYABLE = "FAILED_RETRYABLE"
FAILED_PERMANENT = "FAILED_PERMANENT"
UNKNOWN_OUTCOME = "UNKNOWN_OUTCOME"
CANCELLED = "CANCELLED"

TERMINAL_STATES = {SENT, FAILED_PERMANENT, CANCELLED}
DISPATCHABLE_STATES = {PENDING, FAILED_RETRYABLE}


class OutboundDelivery(Base, UUIDMixin, TimestampMixin):
    """
    One logical delivery of one approved, immutable draft version. Unique per (draft, version): the same approved
    text can only ever be consumed once. Holds references and safe diagnostics only, never the message body or
    credentials; the text is read from the immutable version row at send time.
    """

    __tablename__ = "outbound_deliveries"
    __table_args__ = (
        UniqueConstraint("draft_id", "version_number", name="uq_outbound_delivery_draft_version"),
        UniqueConstraint("organization_id", "idempotency_key", name="uq_outbound_delivery_idempotency"),
        Index("idx_outbound_deliveries_dispatch", "status", "next_attempt_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    draft_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("reply_drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    integration_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("integrations.id", ondelete="SET NULL"), nullable=True
    )
    approval_request_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("approval_requests.id", ondelete="SET NULL"), nullable=True
    )
    workflow_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True
    )

    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    channel: Mapped[str] = mapped_column(String(50), nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    destination: Mapped[str] = mapped_column(String(320), nullable=False)
    provider_context: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)

    status: Mapped[str] = mapped_column(String(30), default=PENDING, nullable=False, index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    enqueued_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_by: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    last_error_category: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    last_error_code: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    last_error_detail: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
