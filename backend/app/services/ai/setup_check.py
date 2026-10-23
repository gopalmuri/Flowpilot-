"""
Works out what a person still has to do before a proposed workflow can do real work, and which of their requests
the product cannot fulfil yet. Deterministic on purpose: the model is never trusted to report this.
"""

import re
import uuid
from typing import Any, List, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gmail import GmailAccount
from app.models.integration import Integration
from app.schemas.workflow import StepType
from app.schemas.workflow_ai import AISetupItem
from app.services.workflow_catalog import CATALOG_BY_TYPE

_UNSUPPORTED_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"whats\s?app", re.I), "WhatsApp messages are not available yet. Email replies and Slack alerts are."),
    (
        re.compile(r"\b(wait|delay|after \d+ (minute|hour|day)s?|follow[- ]?up (in|after)|remind(er)? (me )?in)\b", re.I),
        "Waiting or delaying for a period of time is not available yet. Runs move straight to the next step.",
    ),
    (
        re.compile(r"\b(every (day|week|weekday|weekend|month|morning|evening|night|hour|minute|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+ (minutes?|hours?|days?))|daily|weekly|monthly|hourly|on a schedule|cron)\b", re.I),
        "Running on a schedule (daily or weekly) is not available yet. Flows start from a webhook, a message, or a manual run.",
    ),
    (re.compile(r"\b(sms|text message|telegram|twilio)\b", re.I), "SMS and other messaging apps are not available yet."),
]


def detect_unsupported(prompt: str) -> List[str]:
    return [msg for pattern, msg in _UNSUPPORTED_PATTERNS if pattern.search(prompt or "")]


def _get(obj: Any, name: str) -> Any:
    return getattr(obj, name, None) if not isinstance(obj, dict) else obj.get(name)


async def compute_setup_needed(
    db: AsyncSession,
    organization_id: uuid.UUID,
    steps: Sequence[Any],
    connections: Sequence[Any],
) -> List[AISetupItem]:
    items: List[AISetupItem] = []
    types_present = {_get(s, "step_type") for s in steps}

    gmail_connected = bool(
        await db.scalar(
            select(GmailAccount.id)
            .where(GmailAccount.organization_id == organization_id, GmailAccount.disconnected_at.is_(None))
            .limit(1)
        )
    )
    any_channel = gmail_connected or bool(
        await db.scalar(
            select(Integration.id)
            .where(Integration.organization_id == organization_id, Integration.status == "CONNECTED")
            .limit(1)
        )
    )

    for step in steps:
        stype = _get(step, "step_type")
        key = _get(step, "step_key")
        name = _get(step, "name") or key
        spec = CATALOG_BY_TYPE.get(stype)
        if not spec:
            continue

        if stype == StepType.SEND_REPLY.value:
            if not gmail_connected:
                items.append(
                    AISetupItem(
                        id=f"gmail_{key}",
                        kind="integration",
                        title="Connect Gmail",
                        detail=f"'{name}' needs a connected Gmail account to deliver replies.",
                        step_key=key,
                        action="connect_gmail",
                        blocking=True,
                    )
                )
            if StepType.AI_ANALYZE_MESSAGE.value not in types_present:
                items.append(
                    AISetupItem(
                        id=f"draft_{key}",
                        kind="config",
                        title="A reply draft is needed first",
                        detail=f"'{name}' can only send a reply that an earlier 'AI reads & drafts a reply' step prepared and a person approved.",
                        step_key=key,
                        action="edit_step",
                        blocking=True,
                    )
                )
            elif StepType.HUMAN_APPROVAL.value not in types_present:
                items.append(
                    AISetupItem(
                        id=f"approve_{key}",
                        kind="config",
                        title="Add an approval before sending",
                        detail="Replies are only sent after a person approves the draft.",
                        step_key=key,
                        action="edit_step",
                        blocking=True,
                    )
                )

        elif stype == StepType.AI_ANALYZE_MESSAGE.value and not any_channel:
            items.append(
                AISetupItem(
                    id=f"channel_{key}",
                    kind="integration",
                    title="Connect a message source",
                    detail=f"'{name}' reads inbound messages. Connect Gmail or a website form so messages can reach this flow.",
                    step_key=key,
                    action="open_integrations",
                    blocking=False,
                )
            )

        elif stype == StepType.SLACK_NOTIFICATION.value and (_get(step, "config") or {}).get("mock_mode", True):
            items.append(
                AISetupItem(
                    id=f"slack_{key}",
                    kind="info",
                    title="Slack is in test mode",
                    detail=f"'{name}' records the message in FlowPilot but does not post to a real Slack channel yet.",
                    step_key=key,
                    action="edit_step",
                )
            )

        elif stype == StepType.MOCK_CRM_CREATE.value:
            items.append(
                AISetupItem(
                    id=f"crm_{key}",
                    kind="info",
                    title="CRM is simulated",
                    detail=f"'{name}' creates records in FlowPilot's built-in test CRM, not an external CRM.",
                    step_key=key,
                )
            )

    # One note per kind is enough; keep the checklist short.
    seen = set()
    unique: List[AISetupItem] = []
    for item in items:
        sig = (item.title, item.kind) if item.kind == "info" else (item.id,)
        if sig in seen:
            continue
        seen.add(sig)
        unique.append(item)
    unique.sort(key=lambda i: (not i.blocking, i.kind == "info"))
    return unique
