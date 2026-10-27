"""
AI builder endpoints: prompt-first workflow creation, the step catalog, templates, failed-run diagnosis and
improvement suggestions.

Registered BEFORE the generic workflows router so static paths such as /catalog are not parsed as a workflow id.
Every AI call is metered per organisation (daily cap) and can only ever produce DRAFTS.
"""

import secrets
import uuid
from typing import List, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.api.deps import get_current_active_user, get_org_context, require_role
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_run import WorkflowRun
from app.models.workflow_step import WorkflowConnection, WorkflowStep
from app.schemas.workflow import WorkflowStatus, WorkflowVersionStatus
from app.schemas.workflow_ai import (
    AISimulateExecutionRequest,
    AISimulateExecutionResponse,
    AISimulatePayloadRequest,
    AISimulatePayloadResponse,
    AIBuilderCreateRequest,
    AIBuilderCreateResponse,
    AICatalogStep,
    AIRunExplainResponse,
    AISuggestionsResponse,
    AIWorkflowAssistRequest,
    AIWorkflowAssistResponse,
    AIWorkflowTemplate,
)
from app.services.ai.run_insights import RunInsightsService
from app.services.ai.setup_check import compute_setup_needed, detect_unsupported
from app.services.ai.templates import TEMPLATES
from app.services.ai.usage import enforce_ai_limit, record_ai_usage
from app.services.ai.workflow_generator import AIWorkflowGeneratorService
from app.services.workflow_catalog import catalog_as_dicts
from app.services.workflow_validator import validate_workflow_dag

router = APIRouter(
    prefix="/organizations/{organization_id}/workflows",
    tags=["Workflow AI Builder"],
)

_BUILDER_ROLES = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER]
_VIEW_ROLES = _BUILDER_ROLES + [OrganizationRole.OPERATOR]


async def assist_with_accounting(
    db: AsyncSession,
    organization_id: uuid.UUID,
    req: AIWorkflowAssistRequest,
    workflow_id: uuid.UUID | None = None,
) -> AIWorkflowAssistResponse:
    """Runs the builder under the org's daily cap, then attaches setup requirements and unsupported-request notes."""
    await enforce_ai_limit(db, organization_id)
    response = await AIWorkflowGeneratorService().assist(req)

    if response.proposal is not None:
        response.setup_needed = await compute_setup_needed(
            db, organization_id, response.proposal.steps, response.proposal.connections
        )
        response.unsupported = detect_unsupported(
            " ".join([req.prompt] + [m.content for m in req.conversation_history if m.role.value == "user"])
        )
    elif response.mode in ("clarification", "suggestion"):
        response.unsupported = detect_unsupported(req.prompt)

    if response.provider != "unavailable" and response.model != "unavailable":
        await record_ai_usage(db, organization_id, tokens=response.tokens_used, workflow_id=workflow_id)
    return response


@router.get("/catalog", response_model=List[AICatalogStep], summary="Step catalog (what workflows can do)")
async def get_step_catalog(
    organization_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
) -> List[AICatalogStep]:
    return [AICatalogStep(**item) for item in catalog_as_dicts()]


@router.get("/templates", response_model=List[AIWorkflowTemplate], summary="Ready-made workflow templates")
async def get_templates(
    organization_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
) -> List[AIWorkflowTemplate]:
    return TEMPLATES


@router.post("/ai-builder", response_model=AIWorkflowAssistResponse, summary="Describe an automation; AI proposes it")
async def ai_builder(
    organization_id: uuid.UUID,
    req: AIWorkflowAssistRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(require_role(_BUILDER_ROLES)),
    db: AsyncSession = Depends(get_db),
) -> AIWorkflowAssistResponse:
    """Prompt-first entry point: no workflow exists yet. Returns questions or a validated proposal; saves nothing."""
    return await assist_with_accounting(db, organization_id, req)


@router.post(
    "/ai-builder/create",
    response_model=AIBuilderCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a DRAFT workflow from an accepted AI proposal",
)
async def ai_builder_create(
    organization_id: uuid.UUID,
    req: AIBuilderCreateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(require_role(_BUILDER_ROLES)),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> AIBuilderCreateResponse:
    keys = [s.step_key for s in req.steps]
    if len(set(keys)) != len(keys):
        raise HTTPException(status_code=400, detail="Each step must have a unique key")
    key_set = set(keys)
    for c in req.connections:
        if c.source_step_key not in key_set or c.target_step_key not in key_set:
            raise HTTPException(
                status_code=400,
                detail=f"Connection references a step that does not exist: {c.source_step_key} -> {c.target_step_key}",
            )

    validation = validate_workflow_dag(req.steps, req.connections)

    workflow = Workflow(
        organization_id=organization_id,
        name=req.name.strip(),
        description=req.description.strip() if req.description else None,
        status=WorkflowStatus.DRAFT.value,
        webhook_key=secrets.token_urlsafe(32),
        created_by=current_user.id,
    )
    db.add(workflow)
    await db.flush()

    version = WorkflowVersion(
        workflow_id=workflow.id,
        version_number=1,
        status=WorkflowVersionStatus.DRAFT.value,
        definition={
            "steps": [s.model_dump() for s in req.steps],
            "connections": [c.model_dump() for c in req.connections],
        },
        created_by=current_user.id,
    )
    db.add(version)
    await db.flush()

    step_by_key = {}
    for s in req.steps:
        row = WorkflowStep(
            workflow_version_id=version.id,
            step_key=s.step_key,
            step_type=s.step_type,
            name=s.name,
            config=s.config,
            ui_position=s.ui_position,
        )
        db.add(row)
        await db.flush()
        step_by_key[s.step_key] = row
    for c in req.connections:
        db.add(
            WorkflowConnection(
                workflow_version_id=version.id,
                source_step_id=step_by_key[c.source_step_key].id,
                target_step_id=step_by_key[c.target_step_key].id,
                condition_label=c.condition_label,
            )
        )

    db.add(
        AuditLog(
            organization_id=organization_id,
            user_id=current_user.id,
            action="workflow.created_by_ai",
            resource_type="workflow",
            resource_id=str(workflow.id),
            details={"name": workflow.name, "steps": len(req.steps), "valid": validation.valid},
        )
    )
    await db.commit()

    return AIBuilderCreateResponse(
        workflow_id=str(workflow.id),
        version_id=str(version.id),
        name=workflow.name,
        status=workflow.status,
        valid=validation.valid,
        warnings=validation.errors + validation.warnings,
    )


@router.post(
    "/ai-builder/simulate-payload",
    response_model=AISimulatePayloadResponse,
    summary="Generate a sample input for a proposed (not yet saved) workflow",
)
async def ai_builder_simulate_payload(
    organization_id: uuid.UUID,
    req: AISimulatePayloadRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(require_role(_BUILDER_ROLES)),
    db: AsyncSession = Depends(get_db),
) -> AISimulatePayloadResponse:
    await enforce_ai_limit(db, organization_id)
    result = await AIWorkflowGeneratorService().generate_test_payload(req)
    if settings.AI_PROVIDER and settings.AI_PROVIDER != "mock":
        await record_ai_usage(db, organization_id)
    return result


@router.post(
    "/ai-builder/simulate-run",
    response_model=AISimulateExecutionResponse,
    summary="Dry-run a proposed (not yet saved) workflow; no side effects",
)
async def ai_builder_simulate_run(
    organization_id: uuid.UUID,
    req: AISimulateExecutionRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(require_role(_BUILDER_ROLES)),
) -> AISimulateExecutionResponse:
    return await AIWorkflowGeneratorService().simulate_workflow_execution(req)


async def _get_workflow(db: AsyncSession, organization_id: uuid.UUID, workflow_id: uuid.UUID) -> Workflow:
    workflow = await db.scalar(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.organization_id == organization_id)
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@router.post(
    "/{workflow_id}/runs/{run_id}/ai-explain",
    response_model=AIRunExplainResponse,
    summary="Explain why a run failed and propose a fix as a draft",
)
async def ai_explain_run(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    run_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(require_role(_VIEW_ROLES)),
    db: AsyncSession = Depends(get_db),
) -> AIRunExplainResponse:
    await _get_workflow(db, organization_id, workflow_id)
    run = await db.scalar(
        select(WorkflowRun).where(
            WorkflowRun.id == run_id,
            WorkflowRun.workflow_id == workflow_id,
            WorkflowRun.organization_id == organization_id,
        )
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    await enforce_ai_limit(db, organization_id)
    service = RunInsightsService()
    result = await service.explain_run(db, run)
    if result.used_ai:
        await record_ai_usage(db, organization_id, tokens=service.last_tokens, workflow_id=workflow_id)
    return result


@router.post(
    "/{workflow_id}/ai-suggestions",
    response_model=AISuggestionsResponse,
    summary="Improvement suggestions from this workflow's run history (on demand)",
)
async def ai_suggestions(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(require_role(_BUILDER_ROLES)),
    db: AsyncSession = Depends(get_db),
) -> AISuggestionsResponse:
    workflow = await _get_workflow(db, organization_id, workflow_id)

    version_id = workflow.active_version_id
    if version_id is None:
        version_id = await db.scalar(
            select(WorkflowVersion.id)
            .where(WorkflowVersion.workflow_id == workflow_id)
            .order_by(WorkflowVersion.version_number.desc())
            .limit(1)
        )

    await enforce_ai_limit(db, organization_id)
    service = RunInsightsService()
    result = await service.suggest_improvements(db, organization_id, workflow_id, version_id)
    if result.used_ai:
        await record_ai_usage(db, organization_id, tokens=service.last_tokens, workflow_id=workflow_id)
    return result
