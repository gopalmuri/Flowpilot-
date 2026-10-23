import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin, utc_now

if TYPE_CHECKING:
    from app.models.organization import Organization


class Conversation(Base, UUIDMixin, TimestampMixin):
    """A thread of messages with one external sender on one channel."""

    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "integration_id",
            "channel",
            "external_conversation_id",
            name="uq_conversation_external",
        ),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("integrations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(50), nullable=False)
    external_conversation_id: Mapped[str] = mapped_column(String(255), nullable=False)
    sender_identity: Mapped[str] = mapped_column(String(320), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="OPEN", nullable=False)

    organization: Mapped["Organization"] = relationship("Organization")


class InboundMessage(Base, UUIDMixin):
    """One message received from a channel. The unique key is the dedup guard."""

    __tablename__ = "inbound_messages"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "channel",
            "external_message_id",
            name="uq_inbound_message_external",
        ),
        Index("idx_inbound_messages_org_received", "organization_id", "received_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("integrations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(50), nullable=False)
    external_message_id: Mapped[str] = mapped_column(String(255), nullable=False)
    sender_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sender_address: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    subject: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    processing_status: Mapped[str] = mapped_column(String(30), default="RECEIVED", nullable=False, index=True)
    workflow_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid,
        ForeignKey("workflow_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    correlation_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Channel-specific identifiers and reply headers (e.g. Gmail thread/message ids, Message-ID, References).
    provider_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    # Structured AI analysis (validated MessageAnalysisResult) and when it was produced.
    ai_analysis: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ReplyDraft(Base, UUIDMixin, TimestampMixin):
    """
    An AI-written reply awaiting human review. Nothing here is ever sent automatically:
    approval fields and send tracking are added with the approval phase.
    """

    __tablename__ = "reply_drafts"
    __table_args__ = (UniqueConstraint("source_message_id", name="uq_reply_draft_source_message"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_message_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("inbound_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Mirror of the current version's text; the immutable history lives in ReplyDraftVersion.
    draft_content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", nullable=False, index=True)
    generated_by: Mapped[str] = mapped_column(String(120), nullable=False)
    risk_flags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    current_version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # Set only while status is APPROVED/READY: the exact version a human authorised.
    approved_version_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    approval_request_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("approval_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    decided_by: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    revision_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ReplyDraftVersion(Base, UUIDMixin):
    """
    One immutable text version of a draft. Rows are insert-only (a database trigger rejects UPDATE),
    so "the approved text" can always be reproduced exactly, with its hash.
    """

    __tablename__ = "reply_draft_versions"
    __table_args__ = (UniqueConstraint("draft_id", "version_number", name="uq_reply_draft_version_number"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    draft_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("reply_drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    author_type: Mapped[str] = mapped_column(String(10), nullable=False)  # AI | HUMAN
    author_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
