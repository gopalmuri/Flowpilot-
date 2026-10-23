"""
Reply-draft review endpoints that sit beside the approval decisions in routers/approvals.py.

Every handler is organization-scoped through the approval it is addressed by, takes the acting user from the
authenticated session (never from the request body), and enforces the approval's required role server-side.
None of them sends anything.
"""

import uuid
from typing import Tuple

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_db
from app.models.approval import ApprovalRequest
from app.models.conversation import InboundMessage, ReplyDraft, ReplyDraftVersion
from app.models.membership import OrganizationMember
from app.models.organization import Organization
from app.models.outbound import OutboundDelivery
from app.models.user import User
from app.models.workflow_step import WorkflowStep
from app.routers.approvals import (
    _check_and_apply_lazy_expiration,
    _check_approver_role,
    _load_approval,
    _required_role,
    non_viewer_roles,
    router,
)
from app.routers.deliveries import summarize
from app.schemas.ai import MessageAnalysisInput, MessageAnalysisResult
from app.schemas.approval import (
    ApprovalReviewResponse,
    DraftEditRequest,
    DraftVersionView,
    RegenerateRequest,
    ReviewAnalysis,
    ReviewDraft,
    ReviewMessage,
    RevisionRequest,
)
from app.services.ai.message_analysis import MessageAnalysisService, provider_config_from_step
from app.services.inbound import drafts as draft_service


async def _build_review(db: AsyncSession, approval: ApprovalRequest) -> ApprovalReviewResponse:
    review = ApprovalReviewResponse(
        approval_id=approval.id,
        approval_status=approval.status,
        is_reapproval=draft_service.is_reapproval(approval),
    )
    draft_id = draft_service.draft_id_from_approval(approval)
    if draft_id is None:
        return review

    draft = (
        await db.execute(
            select(ReplyDraft)
            .where(ReplyDraft.id == draft_id, ReplyDraft.organization_id == approval.organization_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if draft is None:
        return review

    versions = (
        (
            await db.execute(
                select(ReplyDraftVersion)
                .where(ReplyDraftVersion.draft_id == draft.id)
                .order_by(ReplyDraftVersion.version_number.asc())
            )
        )
        .scalars()
        .all()
    )
    review.draft = ReviewDraft(
        id=draft.id,
        status=draft.status,
        current_version=draft.current_version_number,
        approved_version=draft.approved_version_number,
        revision_instructions=draft.revision_instructions,
        decision_comment=draft.decision_comment,
        decided_by=draft.decided_by,
        decided_at=draft.decided_at,
        risk_flags=list(draft.risk_flags or []),
        versions=[
            DraftVersionView(
                version_number=v.version_number,
                author_type=v.author_type,
                author_user_id=v.author_user_id,
                content=v.content,
                content_hash=v.content_hash,
                created_at=v.created_at,
                is_approved=draft.approved_version_number == v.version_number,
            )
            for v in versions
        ],
    )

    latest_delivery = (
        await db.execute(
            select(OutboundDelivery)
            .where(OutboundDelivery.draft_id == draft.id, OutboundDelivery.organization_id == approval.organization_id)
            .order_by(OutboundDelivery.version_number.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if latest_delivery is not None:
        review.delivery = summarize(latest_delivery)

    message = (
        await db.execute(
            select(InboundMessage).where(
                InboundMessage.id == draft.source_message_id,
                InboundMessage.organization_id == approval.organization_id,
            )
        )
    ).scalar_one_or_none()
    if message is not None:
        review.message = ReviewMessage(
            channel=message.channel,
            sender_name=message.sender_name,
            sender_address=message.sender_address,
            subject=message.subject,
            text=message.text_content,
            received_at=message.received_at,
        )
        if message.ai_analysis:
            a = message.ai_analysis
            review.analysis = ReviewAnalysis(
                category=a.get("category"),
                summary=a.get("summary"),
                requirements=list(a.get("requirements") or []),
                missing_information=list(a.get("missing_information") or []),
                urgency=a.get("urgency"),
                recommended_action=a.get("recommended_action"),
                confidence=a.get("confidence"),
                uncertainty_notes=a.get("uncertainty_notes"),
                injection_suspected=bool(a.get("injection_suspected")),
                needs_human_attention=bool(a.get("needs_human_attention")),
                risk_flags=list(a.get("risk_flags") or []),
                is_fallback=bool(a.get("is_fallback")),
                provider=a.get("provider"),
                model=a.get("model"),
            )
    return review


async def _lock_pair(
    db: AsyncSession, organization_id: uuid.UUID, approval_id: uuid.UUID
) -> Tuple[ApprovalRequest, ReplyDraft]:
    """Locks approval then draft (the codebase-wide order) and checks they still belong together."""
    approval = await draft_service.lock_approval(db, organization_id, approval_id)
    if approval is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found")
    draft_id = draft_service.draft_id_from_approval(approval)
    draft = await draft_service.lock_draft(db, organization_id, draft_id) if draft_id else None
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This approval has no reply draft")
    if draft.approval_request_id != approval.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This approval has been superseded by a newer approval request for the draft",
        )
    return approval, draft


async def _guard_actionable(db: AsyncSession, approval: ApprovalRequest) -> None:
    if await _check_and_apply_lazy_expiration(approval, db):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The approval request has expired")


@router.get(
    "/{approval_id}/review",
    response_model=ApprovalReviewResponse,
    summary="Everything a reviewer needs to decide on a reply draft",
)
async def review_approval(
    organization_id: uuid.UUID,
    approval_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(non_viewer_roles),
    db: AsyncSession = Depends(get_db),
):
    approval = await _load_approval(db, organization_id, approval_id)
    return await _build_review(db, approval)


@router.put(
    "/{approval_id}/draft",
    response_model=ApprovalReviewResponse,
    summary="Edit the reply draft (creates a new version; invalidates an existing approval)",
)
async def edit_draft(
    organization_id: uuid.UUID,
    approval_id: uuid.UUID,
    req: DraftEditRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(non_viewer_roles),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _, member = org_context
    approval = await _load_approval(db, organization_id, approval_id)
    _check_approver_role(member.role, _required_role(approval))
    await _guard_actionable(db, approval)

    approval, draft = await _lock_pair(db, organization_id, approval_id)
    if approval.status == "APPROVED" and draft.status not in (draft_service.APPROVED, draft_service.SEND_FAILED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The approval is no longer active")
    if approval.status not in ("PENDING", "APPROVED"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"The approval request is {approval.status.lower()}"
        )
    await draft_service.apply_edit(db, approval, draft, current_user.id, req.content, req.reviewed_version)
    await db.commit()
    return await _build_review(db, await _load_approval(db, organization_id, approval_id))


@router.post(
    "/{approval_id}/request-revision",
    response_model=ApprovalReviewResponse,
    summary="Ask for a revised draft; the workflow stays paused and nothing is sent",
)
async def request_revision(
    organization_id: uuid.UUID,
    approval_id: uuid.UUID,
    req: RevisionRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(non_viewer_roles),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _, member = org_context
    approval = await _load_approval(db, organization_id, approval_id)
    _check_approver_role(member.role, _required_role(approval))
    await _guard_actionable(db, approval)

    approval, draft = await _lock_pair(db, organization_id, approval_id)
    if approval.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"The approval request is {approval.status.lower()}"
        )
    await draft_service.request_revision(db, draft, current_user.id, req.instructions)
    await db.commit()
    return await _build_review(db, await _load_approval(db, organization_id, approval_id))


@router.post(
    "/{approval_id}/draft/regenerate",
    response_model=ApprovalReviewResponse,
    summary="Have the AI rewrite the draft following the revision instructions",
)
async def regenerate_draft(
    organization_id: uuid.UUID,
    approval_id: uuid.UUID,
    req: RegenerateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(non_viewer_roles),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _, member = org_context
    approval = await _load_approval(db, organization_id, approval_id)
    _check_approver_role(member.role, _required_role(approval))
    await _guard_actionable(db, approval)

    # 1. Read phase (no locks held while the model runs).
    draft_id = draft_service.draft_id_from_approval(approval)
    draft = None
    if draft_id:
        draft = (
            await db.execute(
                select(ReplyDraft)
                .where(ReplyDraft.id == draft_id, ReplyDraft.organization_id == organization_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
    if draft is None or draft.approval_request_id != approval.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This approval has no active reply draft")
    if draft.status != draft_service.REVISION_REQUESTED or not draft.revision_instructions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Request a revision with instructions before regenerating"
        )
    draft_service.require_current_version(draft, req.reviewed_version)

    message = (
        await db.execute(
            select(InboundMessage).where(
                InboundMessage.id == draft.source_message_id, InboundMessage.organization_id == organization_id
            )
        )
    ).scalar_one()
    step = await db.get(WorkflowStep, approval.step_id)
    analyze_step = None
    if step is not None:
        analyze_step = (
            (
                await db.execute(
                    select(WorkflowStep).where(
                        WorkflowStep.workflow_version_id == step.workflow_version_id,
                        WorkflowStep.step_type == "AI_ANALYZE_MESSAGE",
                    )
                )
            )
            .scalars()
            .first()
        )
    step_config = (analyze_step.config if analyze_step else None) or {}
    provider_config, threshold = provider_config_from_step(step_config)
    analysis_input = MessageAnalysisInput(
        channel=message.channel,
        message_text=message.text_content,
        sender_name=message.sender_name,
        subject=message.subject,
        business_profile=(str(step_config.get("business_profile") or "")[:6000] or None),
        revision_instructions=draft.revision_instructions,
        previous_draft=draft.draft_content,
    )
    read_version = draft.current_version_number
    actor_id = current_user.id  # captured now: the rollback below expires ORM instances
    await db.rollback()  # release the read transaction before the (slow) model call

    result: MessageAnalysisResult = await MessageAnalysisService().analyze(analysis_input, provider_config, threshold)
    if not result.reply_draft:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The AI could not produce a revised draft. Edit the draft manually instead.",
        )

    # 2. Write phase: re-check under locks that nothing changed while the model was running.
    approval, draft = await _lock_pair(db, organization_id, approval_id)
    if approval.status != "PENDING" or draft.status != draft_service.REVISION_REQUESTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The draft changed while it was regenerated")
    if draft.current_version_number != read_version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The draft changed while it was regenerated")
    draft.risk_flags = result.risk_flags
    draft.generated_by = f"{result.provider}:{result.model}"
    await draft_service.apply_edit(db, approval, draft, actor_id, result.reply_draft, read_version, "AI")
    await db.commit()
    return await _build_review(db, await _load_approval(db, organization_id, approval_id))
