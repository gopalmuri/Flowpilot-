import uuid
from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin, utc_now

# gmail_accounts.sync_state
SYNC_OK = "OK"
SYNC_PENDING = "PENDING"  # connected, nothing synced yet
SYNC_RESYNC = "RESYNC_REQUIRED"
SYNC_NEEDS_REAUTH = "NEEDS_REAUTH"
SYNC_ERROR = "ERROR"

# gmail_accounts.watch_status
WATCH_NONE = "NONE"
WATCH_NOT_CONFIGURED = "NOT_CONFIGURED"  # no Pub/Sub topic configured: the mailbox is kept current by polling
WATCH_ACTIVE = "ACTIVE"
WATCH_FAILED = "FAILED"
WATCH_EXPIRED = "EXPIRED"


class GmailAccount(Base, UUIDMixin, TimestampMixin):
    """
    Mailbox state for one Gmail integration (1:1). Tokens are NOT here: they stay encrypted in
    Integration.credentials_encrypted. `email_address` is the identity Google reported, lowercased, and is unique among
    connected accounts so a push notification (which only names the mailbox) maps to exactly one organization.
    """

    __tablename__ = "gmail_accounts"
    __table_args__ = (
        Index(
            "uq_gmail_accounts_active_email",
            "email_address",
            unique=True,
            postgresql_where=text("disconnected_at IS NULL"),
        ),
        Index("idx_gmail_accounts_sync", "sync_requested_at", "last_sync_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    email_address: Mapped[str] = mapped_column(String(320), nullable=False)
    granted_scopes: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    connected_by: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    disconnected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # History synchronisation. historyId is a uint64 string from Gmail; compare numerically in code.
    history_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    sync_state: Mapped[str] = mapped_column(String(30), default=SYNC_PENDING, nullable=False)
    sync_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_notification_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_error: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sync_lease_owner: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    sync_lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Mailbox watch (Pub/Sub). Watches expire (about 7 days) and must be renewed.
    watch_status: Mapped[str] = mapped_column(String(30), default=WATCH_NONE, nullable=False)
    watch_expiration: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    watch_registered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    watch_error: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    watch_lease_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class OAuthState(Base, UUIDMixin):
    """
    One in-flight OAuth authorization. Single use and short-lived. The state and the browser nonce are stored only as
    hashes; the PKCE verifier is stored encrypted. It binds the callback to the organization and user that started it.
    """

    __tablename__ = "oauth_states"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    integration_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("integrations.id", ondelete="CASCADE"), nullable=True
    )
    purpose: Mapped[str] = mapped_column(String(30), default="gmail", nullable=False)
    state_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    nonce_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    code_verifier_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extra: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
