"""
AI-assisted run diagnosis and improvement suggestions.

Statistics and the basic explanation are computed deterministically from real run data, so the feature still
works (and never invents numbers) when the model is unavailable. The model only turns those facts into plain
language and, where it can, a proposed fix. Proposals are always drafts: nothing here edits a live workflow.
"""

import json
import logging
import re
import uuid
from datetime import timedelta
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.engine.sanitizer import sanitize_payload
from app.models.approval import ApprovalRequest
from app.models.base import utc_now
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.models.workflow_step import WorkflowConnection, WorkflowStep
from app.schemas.ai import AIProviderConfig
from app.schemas.workflow import WorkflowConnectionSchema, WorkflowStepSchema
from app.schemas.workflow_ai import (
    AIImprovementSuggestion,
    AIRunExplainResponse,
    AIRunFailedStep,
    AISuggestionsResponse,
    AIWorkflowAssistRequest,
    AIWorkflowStats,
)
from app.services.ai.factory import AIProviderFactory
from app.services.ai.service import extract_json_payload
from app.services.ai.workflow_generator import AIWorkflowGeneratorService
from app.services.workflow_catalog import CATALOG_BY_TYPE

logger = logging.getLogger("flowpilot.ai.run_insights")

STATS_WINDOW_DAYS = 30

_HINTS = [
    (re.compile(r"missing required fields?: (.+)", re.I), "The incoming data did not include: {0}. Make sure the sender provides it, or remove it from the 'Check required details' step."),
    (re.compile(r"no input text found", re.I), "The step had no message text to read. Check that the trigger sends a field like 'message' or 'body', or set 'source_field' on the step."),
    (re.compile(r"no reply draft", re.I), "'Send the approved reply' needs an earlier 'AI reads & drafts a reply' step in the same flow."),
    (re.compile(r"delivery refused", re.I), "The reply was blocked by the safety check. It must be approved by a person before it can be sent."),
    (re.compile(r"timed? ?out|timeout", re.I), "The step took too long. This is usually temporary; run it again."),
    (re.compile(r"rate limit", re.I), "The AI service was busy. Run it again in a minute."),
    (re.compile(r"authentication|unauthorized|forbidden|401|403", re.I), "A connected service rejected our credentials. Reconnect it from the Integrations page."),
]


def _plain_hint(error: str) -> Optional[str]:
    for pattern, template in _HINTS:
        m = pattern.search(error or "")
        if m:
            return template.format(*m.groups()) if m.groups() else template
    return None


async def load_version_graph(db: AsyncSession, version_id: uuid.UUID):
    steps = list((await db.execute(select(WorkflowStep).where(WorkflowStep.workflow_version_id == version_id))).scalars())
    conns = list(
        (await db.execute(select(WorkflowConnection).where(WorkflowConnection.workflow_version_id == version_id))).scalars()
    )
    key_by_id = {s.id: s.step_key for s in steps}
    step_schemas = [
        WorkflowStepSchema(
            step_key=s.step_key,
            step_type=s.step_type,
            name=s.name,
            config=s.config or {},
            ui_position=s.ui_position or {"x": 0, "y": 0},
        )
        for s in steps
    ]
    conn_schemas = [
        WorkflowConnectionSchema(
            source_step_key=key_by_id[c.source_step_id],
            target_step_key=key_by_id[c.target_step_id],
            condition_label=c.condition_label,
        )
        for c in conns
        if c.source_step_id in key_by_id and c.target_step_id in key_by_id
    ]
    return steps, step_schemas, conn_schemas


class RunInsightsService:
    def __init__(self) -> None:
        self.generator = AIWorkflowGeneratorService()
        self.last_tokens = 0

    async def _ask(self, system_prompt: str, user_payload: Dict[str, Any], max_tokens: int = 3000) -> Optional[Dict[str, Any]]:
        provider_name = settings.AI_PROVIDER or "mock"
        if provider_name == "mock":
            return None
        try:
            provider = AIProviderFactory.get_provider(provider_name=provider_name)
            response = await provider.generate_json(
                system_prompt=system_prompt,
                user_prompt=json.dumps(user_payload, indent=2, default=str),
                config=AIProviderConfig(
                    provider=provider_name,
                    temperature=0.2,
                    max_tokens=max_tokens,
                    timeout_seconds=settings.AI_BUILDER_TIMEOUT_SECONDS,
                ),
            )
            self.last_tokens = response.total_tokens
            return extract_json_payload(response.raw_output)
        except Exception as exc:  # noqa: BLE001
            logger.warning("AI insight call failed: %s", exc)
            return None

    # ------------------------------------------------------------------ failed run
    async def explain_run(self, db: AsyncSession, run: WorkflowRun) -> AIRunExplainResponse:
        steps, step_schemas, conn_schemas = await load_version_graph(db, run.workflow_version_id)
        step_by_id = {s.id: s for s in steps}

        step_runs = list(
            (
                await db.execute(
                    select(WorkflowStepRun)
                    .where(WorkflowStepRun.workflow_run_id == run.id)
                    .order_by(WorkflowStepRun.started_at)
                )
            ).scalars()
        )
        failed: List[AIRunFailedStep] = []
        for sr in step_runs:
            if sr.status == "FAILED":
                step = step_by_id.get(sr.step_id)
                failed.append(
                    AIRunFailedStep(
                        step_key=step.step_key if step else "unknown",
                        name=step.name if step else "Unknown step",
                        step_type=step.step_type if step else "UNKNOWN",
                        error=(sr.error_message or run.error_message or "No error message was recorded.")[:500],
                    )
                )
        if not failed and run.error_message:
            failed.append(AIRunFailedStep(step_key="run", name="Whole run", step_type="RUN", error=run.error_message[:500]))

        # Deterministic baseline
        next_steps: List[str] = []
        if failed:
            lead = failed[0]
            label = CATALOG_BY_TYPE[lead.step_type].label if lead.step_type in CATALOG_BY_TYPE else lead.name
            explanation = f"The run stopped at \"{lead.name}\" ({label}). Reason: {lead.error}"
            for f in failed:
                hint = _plain_hint(f.error)
                if hint and hint not in next_steps:
                    next_steps.append(hint)
        else:
            explanation = f"This run ended with status {run.status}, and no step reported an error."

        response = AIRunExplainResponse(
            run_id=str(run.id),
            run_status=run.status,
            explanation=explanation,
            next_steps=next_steps,
            failed_steps=failed,
            base_version_id=str(run.workflow_version_id),
            used_ai=False,
        )
        if not failed:
            return response

        facts = {
            "run_status": run.status,
            "trigger_payload": sanitize_payload(run.trigger_payload or {}),
            "failed_steps": [f.model_dump() for f in failed],
            "workflow_steps": [
                {"step_key": s.step_key, "step_type": s.step_type, "name": s.name, "config": sanitize_payload(s.config)}
                for s in step_schemas
            ],
            "connections": [c.model_dump() for c in conn_schemas],
        }
        system = (
            "You are FlowPilot's AI Workflow Architect acting as a support engineer for non-technical business users. "
            "A workflow run failed. Explain in 2-3 plain sentences why, using ONLY the facts provided. "
            "Then give up to 3 short, concrete next steps. If (and only if) the workflow definition itself should change "
            "to prevent this failure, also return the full corrected workflow as 'proposal'. Never include secrets. "
            'Respond with one JSON object: {"explanation": str, "next_steps": [str], "proposal": null | {"steps": [...], "connections": [...]}}. '
            "Allowed step types: " + ", ".join(CATALOG_BY_TYPE) + ". A branching step's outgoing connections need condition_label values."
        )
        data = await self._ask(system, facts)
        if not data:
            return response

        if isinstance(data.get("explanation"), str) and data["explanation"].strip():
            response.explanation = data["explanation"].strip()
        ai_steps = [s for s in (data.get("next_steps") or []) if isinstance(s, str) and s.strip()][:3]
        if ai_steps:
            response.next_steps = ai_steps
        response.used_ai = True

        proposal_raw = data.get("proposal")
        if isinstance(proposal_raw, dict) and proposal_raw.get("steps"):
            req = AIWorkflowAssistRequest(prompt="fix failed run", current_steps=step_schemas, current_connections=conn_schemas)
            proposal = self.generator._build_proposal(proposal_raw, req)
            if proposal.valid and proposal.diff_summary and (
                proposal.diff_summary.added_steps
                or proposal.diff_summary.removed_steps
                or proposal.diff_summary.modified_steps
                or proposal.diff_summary.reconnected_edges
            ):
                response.suggested_fix = proposal
        return response

    # ------------------------------------------------------------------ suggestions
    async def compute_stats(self, db: AsyncSession, organization_id: uuid.UUID, workflow_id: uuid.UUID) -> AIWorkflowStats:
        since = utc_now() - timedelta(days=STATS_WINDOW_DAYS)
        runs = list(
            (
                await db.execute(
                    select(WorkflowRun).where(
                        WorkflowRun.organization_id == organization_id,
                        WorkflowRun.workflow_id == workflow_id,
                        WorkflowRun.started_at >= since,
                    )
                )
            ).scalars()
        )
        total = len(runs)
        completed = sum(1 for r in runs if r.status == "COMPLETED")
        failed = sum(1 for r in runs if r.status == "FAILED")

        top_failing: List[Dict[str, Any]] = []
        run_ids = [r.id for r in runs]
        if run_ids:
            failed_srs = list(
                (
                    await db.execute(
                        select(WorkflowStepRun, WorkflowStep)
                        .join(WorkflowStep, WorkflowStep.id == WorkflowStepRun.step_id)
                        .where(WorkflowStepRun.workflow_run_id.in_(run_ids), WorkflowStepRun.status == "FAILED")
                    )
                ).all()
            )
            counts: Dict[str, Dict[str, Any]] = {}
            for _sr, step in failed_srs:
                entry = counts.setdefault(step.step_key, {"step_key": step.step_key, "name": step.name, "failures": 0})
                entry["failures"] += 1
            top_failing = sorted(counts.values(), key=lambda e: e["failures"], reverse=True)[:3]

        approvals = list(
            (
                await db.execute(
                    select(ApprovalRequest)
                    .join(WorkflowRun, WorkflowRun.id == ApprovalRequest.workflow_run_id)
                    .where(
                        ApprovalRequest.organization_id == organization_id,
                        WorkflowRun.workflow_id == workflow_id,
                        ApprovalRequest.created_at >= since,
                    )
                )
            ).scalars()
        )
        pending = sum(1 for a in approvals if a.status == "PENDING")
        waits = [
            (a.resolved_at - a.created_at).total_seconds() / 3600
            for a in approvals
            if a.resolved_at is not None and a.created_at is not None
        ]
        return AIWorkflowStats(
            window_days=STATS_WINDOW_DAYS,
            total_runs=total,
            completed_runs=completed,
            failed_runs=failed,
            failure_rate=round(failed / total, 3) if total else 0.0,
            pending_approvals=pending,
            avg_approval_wait_hours=round(sum(waits) / len(waits), 1) if waits else None,
            top_failing_steps=top_failing,
        )

    @staticmethod
    def rule_based_suggestions(stats: AIWorkflowStats, step_schemas: Sequence[WorkflowStepSchema]) -> List[AIImprovementSuggestion]:
        out: List[AIImprovementSuggestion] = []
        if stats.total_runs == 0:
            out.append(
                AIImprovementSuggestion(
                    id="no_runs",
                    title="No runs yet",
                    detail=f"This workflow hasn't run in the last {stats.window_days} days. Use the test run to check it before relying on it.",
                )
            )
            return out
        if stats.failure_rate >= 0.2 and stats.failed_runs >= 2:
            worst = stats.top_failing_steps[0] if stats.top_failing_steps else None
            out.append(
                AIImprovementSuggestion(
                    id="high_failure",
                    title=f"{round(stats.failure_rate * 100)}% of runs failed",
                    detail=(
                        f"{stats.failed_runs} of {stats.total_runs} runs failed in the last {stats.window_days} days."
                        + (f" Most failures are at \"{worst['name']}\" ({worst['failures']} times)." if worst else "")
                    ),
                    severity="critical" if stats.failure_rate >= 0.5 else "warning",
                )
            )
        if stats.avg_approval_wait_hours is not None and stats.avg_approval_wait_hours >= 24:
            out.append(
                AIImprovementSuggestion(
                    id="slow_approvals",
                    title="Approvals are slow",
                    detail=f"People take about {stats.avg_approval_wait_hours} hours on average to approve. Consider a shorter timeout or a second approver role.",
                    severity="warning",
                )
            )
        if stats.pending_approvals >= 5:
            out.append(
                AIImprovementSuggestion(
                    id="approval_backlog",
                    title=f"{stats.pending_approvals} approvals are waiting",
                    detail="Runs are paused until someone decides. Check the Approvals page.",
                    severity="warning",
                )
            )
        types = {s.step_type for s in step_schemas}
        if "HUMAN_APPROVAL" not in types and "SEND_REPLY" in types:
            out.append(
                AIImprovementSuggestion(
                    id="send_without_approval",
                    title="Replies need an approval step",
                    detail="This flow sends replies but has no approval step. Add one so a person reviews each reply.",
                    severity="critical",
                )
            )
        if not out:
            out.append(
                AIImprovementSuggestion(
                    id="healthy",
                    title="Looking healthy",
                    detail=f"{stats.completed_runs} of {stats.total_runs} runs completed in the last {stats.window_days} days.",
                )
            )
        return out

    async def suggest_improvements(
        self, db: AsyncSession, organization_id: uuid.UUID, workflow_id: uuid.UUID, version_id: Optional[uuid.UUID]
    ) -> AISuggestionsResponse:
        stats = await self.compute_stats(db, organization_id, workflow_id)
        step_schemas: List[WorkflowStepSchema] = []
        conn_schemas: List[WorkflowConnectionSchema] = []
        if version_id:
            _, step_schemas, conn_schemas = await load_version_graph(db, version_id)

        result = AISuggestionsResponse(
            workflow_id=str(workflow_id),
            stats=stats,
            suggestions=self.rule_based_suggestions(stats, step_schemas),
            base_version_id=str(version_id) if version_id else None,
            used_ai=False,
        )
        if not step_schemas or stats.total_runs == 0:
            return result

        facts = {
            "stats": stats.model_dump(),
            "workflow_steps": [
                {"step_key": s.step_key, "step_type": s.step_type, "name": s.name, "config": sanitize_payload(s.config)}
                for s in step_schemas
            ],
            "connections": [c.model_dump() for c in conn_schemas],
            "rule_based_findings": [s.model_dump() for s in result.suggestions],
        }
        system = (
            "You are FlowPilot's AI Workflow Architect reviewing a live automation for a non-technical business owner. "
            "Using ONLY the provided statistics, give up to 4 specific improvement suggestions in plain language. "
            "Do not invent numbers. If a concrete workflow change would help, ALSO return the full improved workflow as "
            "'proposal' (it will be saved as a draft for the owner to review). Allowed step types: "
            + ", ".join(CATALOG_BY_TYPE)
            + '. Respond with one JSON object: {"suggestions": [{"id": str, "title": str, "detail": str, "severity": "info"|"warning"|"critical"}], '
            '"proposal": null | {"steps": [...], "connections": [...]}}.'
        )
        data = await self._ask(system, facts)
        if not data:
            return result

        ai_items: List[AIImprovementSuggestion] = []
        for i, item in enumerate(data.get("suggestions") or []):
            if isinstance(item, dict) and item.get("title") and item.get("detail"):
                sev = item.get("severity") if item.get("severity") in ("info", "warning", "critical") else "info"
                ai_items.append(
                    AIImprovementSuggestion(id=str(item.get("id") or f"ai_{i}"), title=str(item["title"])[:120], detail=str(item["detail"])[:500], severity=sev)
                )
        if ai_items:
            result.suggestions = ai_items[:4]
            result.used_ai = True

        proposal_raw = data.get("proposal")
        if isinstance(proposal_raw, dict) and proposal_raw.get("steps"):
            req = AIWorkflowAssistRequest(prompt="improve workflow", current_steps=step_schemas, current_connections=conn_schemas)
            proposal = self.generator._build_proposal(proposal_raw, req)
            d = proposal.diff_summary
            if proposal.valid and (d.added_steps or d.removed_steps or d.modified_steps or d.reconnected_edges):
                result.proposal = proposal
        return result
