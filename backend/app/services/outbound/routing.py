"""
Same-channel routing for replies.

Given a draft's conversation, work out which connected account sends the reply and to which verified destination,
without inventing anything. The reply goes out on the channel the message arrived on; if that cannot be verified the
delivery stops with an actionable error. There is deliberately no fallback to another channel.
"""

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation, InboundMessage, ReplyDraft
from app.models.integration import Integration

_EMAIL = TypeAdapter(EmailStr)
_PHONE = re.compile(r"^\+?[1-9]\d{6,14}$")

PORTFOLIO_CHANNEL = "PORTFOLIO_FORM"
GMAIL_CHANNEL = "GMAIL"
WHATSAPP_CHANNEL = "WHATSAPP"

# Integration types that may act as the sending account for each channel.
GMAIL_INTEGRATION = "GMAIL"
WHATSAPP_INTEGRATION = "WHATSAPP_BUSINESS"
EMAIL_SENDER_INTEGRATION = "EMAIL_SENDER"


class RoutingError(Exception):
    """The destination or sending account cannot be verified. `code` is stable and shown to operators."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Route:
    channel: str
    integration_id: uuid.UUID
    integration_type: str
    account_config: Dict[str, Any]
    provider: str
    destination: str
    context: Dict[str, Any] = field(default_factory=dict)
    subject: Optional[str] = None


def _valid_email(value: Optional[str]) -> str:
    try:
        return str(_EMAIL.validate_python((value or "").strip()))
    except ValidationError:
        raise RoutingError("destination_invalid", "The recipient email address is not valid") from None


async def _account(
    session: AsyncSession, organization_id: uuid.UUID, integration_id: Any, allowed_type: str
) -> Integration:
    try:
        account_id = uuid.UUID(str(integration_id))
    except ValueError:
        raise RoutingError("no_reply_account", "No sending account is configured for this channel") from None
    account = (
        await session.execute(
            select(Integration).where(Integration.id == account_id, Integration.organization_id == organization_id)
        )
    ).scalar_one_or_none()
    # A missing row and another organization's row look identical: the account must belong to this organization.
    if account is None:
        raise RoutingError("account_not_found", "The sending account was not found in this organization")
    if account.type != allowed_type:
        raise RoutingError("account_wrong_type", f"The sending account must be of type {allowed_type}")
    if account.status != "CONNECTED":
        raise RoutingError("account_disconnected", "The sending account is not connected")
    return account


async def resolve_route(session: AsyncSession, draft: ReplyDraft) -> Route:
    conversation = (
        await session.execute(
            select(Conversation).where(
                Conversation.id == draft.conversation_id, Conversation.organization_id == draft.organization_id
            )
        )
    ).scalar_one_or_none()
    if conversation is None:
        raise RoutingError("conversation_not_found", "The original conversation was not found")
    message = (
        await session.execute(
            select(InboundMessage).where(
                InboundMessage.id == draft.source_message_id,
                InboundMessage.organization_id == draft.organization_id,
            )
        )
    ).scalar_one_or_none()
    if message is None or message.conversation_id != conversation.id or message.channel != conversation.channel:
        raise RoutingError("channel_mismatch", "The original message does not match the conversation channel")

    channel = conversation.channel
    subject = f"Re: {message.subject}" if message.subject else None

    if channel == PORTFOLIO_CHANNEL:
        source = (
            await session.execute(
                select(Integration).where(
                    Integration.id == conversation.integration_id,
                    Integration.organization_id == draft.organization_id,
                )
            )
        ).scalar_one_or_none()
        if source is None or source.type != PORTFOLIO_CHANNEL:
            raise RoutingError("channel_mismatch", "The originating form integration is missing")
        reply_id = (source.config or {}).get("reply_integration_id")
        if not reply_id:
            raise RoutingError(
                "no_reply_account", "This contact form has no reply email account configured (reply_integration_id)"
            )
        account = await _account(session, draft.organization_id, reply_id, EMAIL_SENDER_INTEGRATION)
        from_address = _valid_email((account.config or {}).get("from_address"))
        destination = _valid_email(conversation.sender_identity)
        # The recipient must be exactly the address the visitor submitted, never something derived or guessed.
        if message.sender_address and destination.lower() != message.sender_address.strip().lower():
            raise RoutingError("destination_mismatch", "The destination does not match the original sender")
        context = {"kind": "email", "from_address": from_address}

    elif channel == GMAIL_CHANNEL:
        account = await _account(session, draft.organization_id, conversation.integration_id, GMAIL_INTEGRATION)
        mailbox = (account.config or {}).get("email_address")
        if not mailbox:
            raise RoutingError("account_incomplete", "The connected mailbox address is unknown")
        destination = _valid_email(conversation.sender_identity)
        context = {
            "kind": "gmail_reply",
            "mailbox": _valid_email(mailbox),
            "thread_id": conversation.external_conversation_id,
            "in_reply_to_message_id": message.external_message_id,
        }

    elif channel == WHATSAPP_CHANNEL:
        account = await _account(session, draft.organization_id, conversation.integration_id, WHATSAPP_INTEGRATION)
        phone_number_id = (account.config or {}).get("phone_number_id")
        if not phone_number_id:
            raise RoutingError("account_incomplete", "The connected business phone number is unknown")
        destination = (conversation.sender_identity or "").strip()
        if not _PHONE.match(destination):
            raise RoutingError("destination_invalid", "The recipient phone number is not valid")
        context = {
            "kind": "whatsapp",
            "phone_number_id": str(phone_number_id),
            "recipient": destination,
            "inbound_received_at": message.received_at.isoformat(),
        }
        subject = None

    else:
        raise RoutingError("channel_unsupported", f"Replying on channel '{channel}' is not supported")

    return Route(
        channel=channel,
        integration_id=account.id,
        integration_type=account.type,
        account_config=dict(account.config or {}),
        provider=str((account.config or {}).get("provider", "mock")),
        destination=destination,
        context=context,
        subject=subject,
    )
