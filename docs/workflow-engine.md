# FlowPilot: Workflow Engine Specification

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **Engine Pattern** | Step-Executor Registry with DAG Topological Evaluation |
| **Execution Mode** | Asynchronous Distributed Workers (Celery + Redis) |

---

## 1. Engine Architecture Overview

The FlowPilot Workflow Engine executes business automation processes defined as Directed Acyclic Graphs (DAGs). Each node represents an discrete unit of computation or integration, and directed edges represent data flow dependencies and conditional branch paths.

```
Workflow Definition (DAG)
         │
         ▼
[DAG Validator & Topological Sorter]
         │
         ▼
[Execution Context Builder] (Injects Trigger Payload & Environment)
         │
         ├─────────────────────────────────────────┐
         ▼                                         ▼
[Step Executor Registry]                   [State Persistence]
  - WEBHOOK_TRIGGER                         - workflow_runs
  - VALIDATE_DATA                           - workflow_step_runs
  - AI_CLASSIFICATION                       - approval_requests
  - CONDITION (Rule Engine)
  - MOCK_CRM_CREATE
  - SLACK_NOTIFICATION
  - HUMAN_APPROVAL (Suspension Guard)
```

---

## 2. Supported Step Node Types (MVP)

| Step Node Type | Category | Responsibility & Behavior |
|---|---|---|
| `WEBHOOK_TRIGGER` | Trigger | Entry node. Extracts incoming HTTP payload, headers, and query parameters. |
| `MANUAL_TRIGGER` | Trigger | Entry node for manual test runs initiated from the UI dashboard. |
| `VALIDATE_DATA` | Processing | Validates incoming payloads against Pydantic schema rules; sanitizes strings. |
| `AI_CLASSIFICATION` | AI / Enrichment | Sends prompt to LLM provider with structured JSON schema constraints; validates output. |
| `CONDITION` | Logic / Branch | Deterministic rule engine evaluating boolean expressions; directs downstream edge flow. |
| `MOCK_CRM_CREATE` | Action | Interacts with Mock CRM service to create/update lead records and store CRM ID. |
| `SLACK_NOTIFICATION`| Action | Formats and dispatches markdown/block alerts to Slack channels or webhooks. |
| `HUMAN_APPROVAL` | Governance | Suspends workflow execution in `WAITING_FOR_APPROVAL` until an authorized user resolves. |

---

## 3. Step Executor Interface Pattern

To ensure modularity and ease of adding future integrations (Gmail, Salesforce, HubSpot), every node is powered by a class implementing `BaseStepExecutor`:

```python
from abc import ABC, abstractmethod
from typing import Any, Dict
from pydantic import BaseModel

class StepExecutionContext(BaseModel):
    organization_id: str
    workflow_run_id: str
    step_id: str
    step_key: str
    config: Dict[str, Any]
    workflow_data: Dict[str, Any]      # Accumulated outputs from upstream steps
    trigger_payload: Dict[str, Any]

class StepExecutionResult(BaseModel):
    status: str                        # SUCCESS | FAILED | SUSPENDED
    output_data: Dict[str, Any]
    error_message: str | None = None
    execution_time_ms: int = 0
    requires_approval: bool = False
    approval_context: Dict[str, Any] | None = None

class BaseStepExecutor(ABC):
    """Abstract interface for all workflow step executors."""

    @abstractmethod
    async def validate_config(self, config: Dict[str, Any]) -> None:
        """Validates configuration parameters prior to workflow publishing."""
        pass

    @abstractmethod
    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        """Executes the discrete step logic asynchronously."""
        pass
```

### 3.1 Registry Dispatcher
Step executors are registered into a central registry at application startup:
```python
STEP_EXECUTOR_REGISTRY: Dict[str, Type[BaseStepExecutor]] = {
    "WEBHOOK_TRIGGER": WebhookTriggerExecutor,
    "VALIDATE_DATA": ValidateDataExecutor,
    "AI_CLASSIFICATION": AIClassificationExecutor,
    "CONDITION": ConditionRuleExecutor,
    "MOCK_CRM_CREATE": MockCRMCreateExecutor,
    "SLACK_NOTIFICATION": SlackNotificationExecutor,
    "HUMAN_APPROVAL": HumanApprovalExecutor,
}
```

---

## 4. Workflow Run State Machine

```
                  ┌──────────────┐
                  │   PENDING    │
                  └──────┬───────┘
                         │ Worker picks up task
                         ▼
                  ┌──────────────┐
                  │   RUNNING    │
                  └──────┬───────┘
                         │
        ┌────────────────┼────────────────┐
        │ Node: APPROVAL │ Error occurred │ All steps completed
        ▼                ▼                ▼
┌──────────────────┐ ┌────────┐ ┌─────────┐
│WAITING_FOR_APP...│ │ FAILED │ │ SUCCESS │
└───────┬──────────┘ └────────┘ └─────────┘
        │
   ┌────┴────┐
   ▼         ▼
[APPROVED] [REJECTED]
   │         │
   │         ▼
   │   ┌───────────┐
   │   │ CANCELLED │
   │   └───────────┘
   │
   ▼ Resume Execution
[RUNNING]
```

### Status Definitions:
- **`PENDING`**: Fast ACK returned; run record stored in Postgres; task enqueued in Redis.
- **`RUNNING`**: Worker actively executing steps in the DAG sequence.
- **`WAITING_FOR_APPROVAL`**: Suspended at a `HUMAN_APPROVAL` node.
- **`SUCCESS`**: All active branch nodes finished successfully.
- **`FAILED`**: An unhandled step error occurred or retry limit was exhausted.
- **`CANCELLED`**: Cancelled manually by operator or rejected by approver.

---

## 5. Human-in-the-Loop Suspension & Resumption

1. **Suspension Protocol**:
   When `HumanApprovalExecutor` is reached:
   - Verifies if the trigger conditions warrant approval (e.g. `priority == 'high'`).
   - If approval is required:
     - Creates an `approval_requests` entry with status `PENDING`.
     - Updates `workflow_runs.status = 'WAITING_FOR_APPROVAL'`.
     - Dispatches a Slack notification to `#sales-approvals` with approval details.
     - Returns `StepExecutionResult(status="SUSPENDED", requires_approval=True)`.
     - Worker completes task without blocking worker threads.
2. **Resumption Protocol**:
   When an authorized reviewer calls `/api/v1/approvals/{id}/approve`:
   - Updates `approval_requests.status = 'APPROVED'`.
   - Schedules `resume_workflow_run.delay(workflow_run_id, resume_from_step_id)`.
   - Celery worker reloads the accumulated `workflow_data` state and resumes execution from downstream nodes.

---

## 6. DAG Validation Rules

Before a workflow can be transitioned from `DRAFT` to `ACTIVE`:
1. **Cycle Detection**: Kahn's algorithm or DFS cycle check ensures no circular loops exist.
2. **Single Entry Point**: Exactly one active trigger node (`WEBHOOK_TRIGGER` or `MANUAL_TRIGGER`) must exist.
3. **No Orphan Nodes**: Every non-trigger node must have at least one incoming edge.
4. **Step Configuration Validation**: Each node's `validate_config()` must pass schema checks.
