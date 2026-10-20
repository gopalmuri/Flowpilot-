"""
Reply-draft lifecycle: immutable versions, approval binding and decisions.

Everything here runs inside the caller's transaction and never commits, so a decision, the exact approved
version and the audit trail are persisted together or not at all. Lock order used across the codebase is
workflow_run -> approval_request -> reply_draft, which keeps concurrent actions deadlock-free.

Nothing in this module sends a message. APPROVED is the "ready for sending" state a later phase consumes.

States:  DRAFT -> PENDING_APPROVAL -> APPROVED
         PENDING_APPROVAL -> REJECTED
         PENDING_APPROVAL -> REVISION_REQUESTED -> PENDING_APPROVAL (a new version is created)
         APPROVED -> PENDING_APPROVAL (text edited: the old approval is invalidated, a new one is required)
         PENDING_APPROVAL/REVISION_REQUESTED -> EXPIRED / CANCELLED (the approval timed out or the run was cancelled)
"""

import hashlib
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approval import ApprovalRequest
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.conversation import ReplyDraft, ReplyDraftVersion

DRAFT = "DRAFT"
PENDING_APPROVAL = "PENDING_APPROVAL"
APPROVED = "APPROVED"
REJECTED = "REJECTED"
REVISION_REQUESTED = "REVISION_REQUESTED"
EXPIRED = "EXPIRED"
CANCELLED = "CANCELLED"
SENDING = "SENDING"  # an outbound delivery consumed the approval; edits are blocked
SENT = "SENT"  # the provider accepted the approved text
SEND_FAILED = "SEND_FAILED"  # delivery will not happen; a person must edit (new approval) or investigate

EDITABLE_STATES = {PENDING_APPROVAL, REVISION_REQUESTED, APPROVED, SEND_FAILED}
MAX_DRAFT_CHARS = 3000


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def draft_id_from_approval(approval: ApprovalRequest) -> Optional[uuid.UUID]:
    raw = ((approval.payload_snapshot or {}).get("approval_context") or {}).get("draft_id")
    try:
        return uuid.UUID(str(raw)) if raw else None
    except ValueError:
        return None


def is_reapproval(approval: ApprovalRequest) -> bool:
    return bool((approval.payload_snapshot or {}).get("reapproval"))


def audit(
    session: AsyncSession,
    organization_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
    action: str,
    draft: ReplyDraft,
    **details: Any,
) -> None:
    """Audit entries carry ids, version numbers and hashes, never message or draft text."""
    session.add(
        AuditLog(
            organization_id=organization_id,
            user_id=user_id,
            action=action,
            resource_type="reply_draft",
            resource_id=str(draft.id),
            details={"conversation_id": str(draft.conversation_id), **details},
        )
    )


async def lock_draft(session: AsyncSession, organization_id: uuid.UUID, draft_id: uuid.UUID) -> Optional[ReplyDraft]:
    return (
        await session.execute(
            select(ReplyDraft)
            .where(ReplyDraft.id == draft_id, ReplyDraft.organization_id == organization_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def lock_approval(
    session: AsyncSession, organization_id: uuid.UUID, approval_id: uuid.UUID
) -> Optional[ApprovalRequest]:
    return (
        await session.execute(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == approval_id, ApprovalRequest.organization_id == organization_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def get_version(session: AsyncSession, draft_id: uuid.UUID, number: int) -> Optional[ReplyDraftVersion]:
    return (
        await session.execute(
            select(ReplyDraftVersion).where(
                ReplyDraftVersion.draft_id == draft_id, ReplyDraftVersion.version_number == number
            )
        )
    ).scalar_one_or_none()


def _clean_content(content: str) -> str:
    cleaned = (content or "").replace("\r\n", "\n").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Draft content must not be empty")
    if len(cleaned) > MAX_DRAFT_CHARS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Draft content exceeds {MAX_DRAFT_CHARS} characters",
        )
    return cleaned


async def create_initial_version(session: AsyncSession, draft: ReplyDraft, content: str) -> ReplyDraftVersion:
    """Version 1 of a brand-new draft (AI authored)."""
    draft.current_version_number = 1
    draft.draft_content = content
    version = ReplyDraftVersion(
        organization_id=draft.organization_id,
        draft_id=draft.id,
        version_number=1,
        content=content,
        content_hash=content_hash(content),
        author_type="AI",
    )
    session.add(version)
    await session.flush()
    return version


async def add_version(
    session: AsyncSession,
    draft: ReplyDraft,
    content: str,
    author_type: str,
    author_user_id: Optional[uuid.UUID],
) -> ReplyDraftVersion:
    """Appends a new immutable version and makes it current. The draft row must already be locked."""
    cleaned = _clean_content(content)
    number = draft.current_version_number + 1
    version = ReplyDraftVersion(
        organization_id=draft.organization_id,
        draft_id=draft.id,
        version_number=number,
        content=cleaned,
        content_hash=content_hash(cleaned),
        author_type=author_type,
        author_user_id=author_user_id,
    )
    session.add(version)
    draft.current_version_number = number
    draft.draft_content = cleaned
    await session.flush()
    return version


def require_current_version(draft: ReplyDraft, reviewed_version_number: int) -> None:
    """The reviewer must have seen the text that is current now; otherwise they are deciding on stale content."""
    if reviewed_version_number != draft.current_version_number:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"The draft changed (now version {draft.current_version_number}, you reviewed "
                f"{reviewed_version_number}). Review the latest version and try again."
            ),
        )


# ----------------------------------------------------------------------------- submission


async def submit_for_approval(session: AsyncSession, approval: ApprovalRequest, draft_id: uuid.UUID) -> bool:
    """
    Links a DRAFT to its PENDING approval request. Idempotent: a retry of the pause step finds the draft
    already linked and emits no second event. Returns True only when the transition happened.
    """
    draft = await lock_draft(session, approval.organization_id, draft_id)
    if draft is None:
        return False
    if draft.approval_request_id == approval.id and draft.status in (PENDING_APPROVAL, REVISION_REQUESTED):
        return False
    if draft.status not in (DRAFT, REVISION_REQUESTED):
        return False
    draft.status = PENDING_APPROVAL
    draft.approval_request_id = approval.id
    audit(
        session,
        approval.organization_id,
        None,
        "reply_draft.submitted_for_approval",
        draft,
        approval_id=str(approval.id),
        version=draft.current_version_number,
        workflow_run_id=str(approval.workflow_run_id),
    )
    return True


# ----------------------------------------------------------------------------- edits


async def apply_edit(
    session: AsyncSession,
    approval: ApprovalRequest,
    draft: ReplyDraft,
    user_id: uuid.UUID,
    content: str,
    reviewed_version_number: int,
    author_type: str = "HUMAN",
) -> ReplyDraftVersion:
    """
    Creates a new version from a manager edit (or an AI revision).
    - Before a decision the approval stays pending; anyone still holding the old version gets a 409.
    - After approval (not yet sent) the approval is INVALIDATED: the old approval row stays as history, the draft
      loses its approved version, and a fresh PENDING approval is opened so the new text must be approved again.
    """
    if draft.status not in EDITABLE_STATES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"A draft in state '{draft.status}' can no longer be edited"
        )
    require_current_version(draft, reviewed_version_number)
    previous_status = draft.status
    previous_version = draft.current_version_number
    version = await add_version(session, draft, content, author_type, user_id if author_type == "HUMAN" else None)
    audit(
        session,
        draft.organization_id,
        user_id,
        "reply_draft.edited" if author_type == "HUMAN" else "reply_draft.revised",
        draft,
        from_version=previous_version,
        to_version=version.version_number,
        content_hash=version.content_hash,
        previous_status=previous_status,
    )

    if previous_status in (APPROVED, SEND_FAILED):
        invalidated = draft.approved_version_number
        draft.approved_version_number = None
        draft.decided_by = None
        draft.decided_at = None
        # A queued-but-unstarted delivery of the old text must never run: cancel it with the approval.
        from app.services.outbound.delivery import cancel_unconsumed

        await cancel_unconsumed(session, draft, "approval_invalidated")
        new_request = ApprovalRequest(
            organization_id=draft.organization_id,
            workflow_run_id=approval.workflow_run_id,
            step_id=approval.step_id,
            status="PENDING",
            payload_snapshot={
                **(approval.payload_snapshot or {}),
                "reapproval": True,
                "reapproval_of": str(approval.id),
            },
        )
        session.add(new_request)
        await session.flush()
        draft.approval_request_id = new_request.id
        draft.status = PENDING_APPROVAL
        audit(
            session,
            draft.organization_id,
            user_id,
            "reply_draft.approval_invalidated",
            draft,
            invalidated_approval_id=str(approval.id),
            invalidated_version=invalidated,
            new_approval_id=str(new_request.id),
        )
        audit(
            session,
            draft.organization_id,
            None,
            "reply_draft.submitted_for_approval",
            draft,
            approval_id=str(new_request.id),
            version=version.version_number,
            reapproval=True,
        )
    else:
        draft.status = PENDING_APPROVAL
        draft.revision_instructions = None if previous_status == REVISION_REQUESTED else draft.revision_instructions
    return version


# ----------------------------------------------------------------------------- decisions


async def finalize_approval(
    session: AsyncSession,
    approval: ApprovalRequest,
    draft: ReplyDraft,
    user_id: uuid.UUID,
    reviewed_version_number: int,
    edited_content: Optional[str],
    comment: Optional[str],
) -> ReplyDraftVersion:
    """Binds the approval to one exact version. With edited_content, the edit itself is the approved version."""
    if draft.status != PENDING_APPROVAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"The draft is '{draft.status}' and cannot be approved. Wait for or request a new version.",
        )
    require_current_version(draft, reviewed_version_number)
    edited = False
    if edited_content is not None and _clean_content(edited_content) != draft.draft_content:
        version = await add_version(session, draft, edited_content, "HUMAN", user_id)
        edited = True
        audit(
            session,
            draft.organization_id,
            user_id,
            "reply_draft.edited",
            draft,
            from_version=reviewed_version_number,
            to_version=version.version_number,
            content_hash=version.content_hash,
            during="approval",
        )
    else:
        loaded = await get_version(session, draft.id, draft.current_version_number)
        if loaded is None:  # data corruption guard: a draft must always have its current version row
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Draft version missing")
        version = loaded

    draft.status = APPROVED
    draft.approved_version_number = version.version_number
    draft.decided_by = user_id
    draft.decided_at = utc_now()
    draft.decision_comment = comment
    audit(
        session,
        draft.organization_id,
        user_id,
        "reply_draft.approved",
        draft,
        approval_id=str(approval.id),
        approved_version=version.version_number,
        content_hash=version.content_hash,
        edited_by_approver=edited,
    )
    return version


async def finalize_rejection(
    session: AsyncSession,
    approval: ApprovalRequest,
    draft: ReplyDraft,
    user_id: uuid.UUID,
    comment: Optional[str],
) -> None:
    if draft.status not in (PENDING_APPROVAL, REVISION_REQUESTED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"The draft is '{draft.status}' and cannot be rejected"
        )
    draft.status = REJECTED
    draft.approved_version_number = None
    draft.decided_by = user_id
    draft.decided_at = utc_now()
    draft.decision_comment = comment
    audit(
        session,
        draft.organization_id,
        user_id,
        "reply_draft.rejected",
        draft,
        approval_id=str(approval.id),
        version=draft.current_version_number,
        has_reason=bool(comment),
    )


async def request_revision(session: AsyncSession, draft: ReplyDraft, user_id: uuid.UUID, instructions: str) -> None:
    """Moves the draft back to its author. The approval stays PENDING and the workflow stays paused; nothing is sent."""
    if draft.status != PENDING_APPROVAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A revision can only be requested while the draft awaits approval (it is '{draft.status}')",
        )
    draft.status = REVISION_REQUESTED
    draft.revision_instructions = instructions.strip()
    audit(
        session,
        draft.organization_id,
        user_id,
        "reply_draft.revision_requested",
        draft,
        version=draft.current_version_number,
    )


async def sync_terminal(session: AsyncSession, approval: ApprovalRequest, new_status: str) -> None:
    """Keeps the draft consistent when its approval expires or its run is cancelled."""
    draft_id = draft_id_from_approval(approval)
    if draft_id is None:
        return
    draft = await lock_draft(session, approval.organization_id, draft_id)
    if draft is None or draft.approval_request_id != approval.id:
        return
    if draft.status in (PENDING_APPROVAL, REVISION_REQUESTED):
        draft.status = new_status
        audit(
            session,
            approval.organization_id,
            None,
            f"reply_draft.{new_status.lower()}",
            draft,
            approval_id=str(approval.id),
        )


def is_sendable(draft: ReplyDraft) -> bool:
    """The only gate a sender may use: an approved version exists and equals what is current."""
    return (
        draft.status == APPROVED
        and draft.approved_version_number is not None
        and draft.approved_version_number == draft.current_version_number
    )


def serialize_decision(draft: ReplyDraft) -> Dict[str, Any]:
    return {
        "status": draft.status,
        "approved_version": draft.approved_version_number,
        "decided_by": str(draft.decided_by) if draft.decided_by else None,
        "decided_at": draft.decided_at.isoformat() if draft.decided_at else None,
    }
