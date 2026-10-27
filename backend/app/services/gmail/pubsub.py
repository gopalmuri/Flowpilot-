"""
Pub/Sub push receiver logic.

A push request is trusted only if it carries a valid Google-signed OIDC token whose audience is ours and whose service
account is the one we configured on the push subscription. The notification body then only names a mailbox and a
historyId; the organization is always derived from our own `gmail_accounts` row, and the notification is treated as a
hint to run a sync, never as message data.

Verification uses google-auth (maintained). It has been exercised with fakes, not against live Google tokens.
"""

import asyncio
import base64
import binascii
import json
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.logging import logger
from app.models.base import utc_now
from app.models.gmail import GmailAccount
from app.schemas.gmail import GmailPushData, PubSubEnvelope


class PubSubAuthError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class PubSubVerifier(ABC):
    @abstractmethod
    async def verify(self, authorization: Optional[str]) -> None:
        """Raises PubSubAuthError unless the request really comes from our Pub/Sub push subscription."""


class GooglePubSubVerifier(PubSubVerifier):
    async def verify(self, authorization: Optional[str]) -> None:
        audience = settings.GMAIL_PUBSUB_AUDIENCE
        service_account = settings.GMAIL_PUBSUB_SERVICE_ACCOUNT
        if not audience or not service_account:
            # Never fall back to accepting unauthenticated pushes.
            raise PubSubAuthError(503, "Gmail push notifications are not configured")
        if not authorization or not authorization.lower().startswith("bearer "):
            raise PubSubAuthError(401, "Missing bearer token")
        token = authorization.split(" ", 1)[1].strip()
        if not token:
            raise PubSubAuthError(401, "Missing bearer token")

        def check() -> Dict[str, Any]:
            from google.auth.transport import requests as google_requests
            from google.oauth2 import id_token

            return id_token.verify_oauth2_token(token, google_requests.Request(), audience=audience)

        try:
            claims = await asyncio.to_thread(check)
        except Exception:  # noqa: BLE001 - bad signature, wrong audience, expired, cert fetch failure: all "not trusted"
            raise PubSubAuthError(401, "Invalid token") from None
        if not claims.get("email_verified") or str(claims.get("email", "")).lower() != service_account.lower():
            raise PubSubAuthError(401, "Token is not from the expected service account")


def default_pubsub_verifier() -> PubSubVerifier:
    return GooglePubSubVerifier()


def parse_notification(body: bytes) -> GmailPushData:
    """Parses and validates the push envelope. Raises ValueError for anything malformed."""
    envelope = PubSubEnvelope.model_validate(json.loads(body.decode("utf-8")))
    expected = settings.GMAIL_PUBSUB_SUBSCRIPTION
    if expected and envelope.subscription and envelope.subscription != expected:
        raise ValueError("notification is for a different subscription")
    try:
        decoded = base64.b64decode(envelope.message.data, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("notification data is not base64") from None
    return GmailPushData.model_validate(json.loads(decoded.decode("utf-8")))


async def record_notification(
    session_factory: async_sessionmaker[AsyncSession], data: GmailPushData
) -> Optional[uuid.UUID]:
    """
    Marks the mailbox as needing a sync (the durable signal the sync worker and the periodic task act on).
    Returns the account id, or None for a mailbox we do not know (acknowledged and ignored).
    """
    mailbox = data.emailAddress.strip().lower()
    now = utc_now()
    async with session_factory() as session:
        account_id = (
            await session.execute(
                select(GmailAccount.id).where(
                    GmailAccount.email_address == mailbox, GmailAccount.disconnected_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if account_id is None:
            logger.info("Gmail notification for an unknown or disconnected mailbox ignored")
            return None
        await session.execute(
            update(GmailAccount)
            .where(GmailAccount.id == account_id)
            .values(sync_requested_at=now, last_notification_at=now)
        )
        await session.commit()
        return account_id


def enqueue_sync(account_id: uuid.UUID) -> bool:
    """Best-effort nudge. The durable record is `sync_requested_at`; the periodic task re-enqueues if this is lost."""
    try:
        from app.workers.tasks import sync_gmail_mailbox

        sync_gmail_mailbox.delay(str(account_id))
        return True
    except Exception:  # noqa: BLE001
        logger.warning("Could not enqueue a Gmail sync; the periodic task will pick the mailbox up")
        return False
