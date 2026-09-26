# FlowPilot: System Architecture Specification

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **Architectural Style** | Modular Monolith with Asynchronous Distributed Workers |
| **Deployment Model** | Containerized (Docker, Docker Compose, Kubernetes-ready) |

---

## 1. Architectural Principles

1. **Strict Multi-Tenant Isolation**: Tenant boundaries are enforced at the database model layer, query construction layer, and API route authorization layer. Cross-tenant access is structurally impossible.
2. **Decoupled Ingestion & Execution**: Webhook endpoints ingest events with sub-100ms latency, write idempotency records, and queue jobs. Heavy computations (AI, CRM, Slack, external retries) run asynchronously in worker pools.
3. **Deterministic Core with AI Augmentation**: AI models act solely as structured categorization filters. The workflow engine, condition evaluation, and action dispatches are 100% deterministic and auditable.
4. **Resilience by Design**: All external side-effects (API requests, notifications) are idempotent and retry-safe with exponential backoff and jitter.

---

## 2. High-Level C4 Container Architecture

```
                                      ┌────────────────────────┐
                                      │   Web Client (Browser) │
                                      │ React 19 + TypeScript  │
                                      └───────────┬────────────┘
                                                  │ HTTPS / REST
                                                  ▼
                                      ┌────────────────────────┐
                                      │   Reverse Proxy / API  │
                                      │    FastAPI Application │
                                      └─────┬──────────────┬───┘
                                            │              │
                   Enqueue Task (Fast ACK)  │              │ SQL Queries (Tenant-Scoped)
                                            ▼              ▼
                                     ┌─────────────┐  ┌────────────────────────┐
                                     │ Redis Queue │  │ PostgreSQL Database 16 │
                                     │   Broker    │  │ Multi-Tenant Relational│
                                     └──────┬──────┘  └───────────▲────────────┘
                                            │                     │
                                            ▼                     │ Read/Write State
                                     ┌─────────────┐              │
                                     │   Celery    │──────────────┘
                                     │ Worker Pool │
                                     └──────┬──────┘
                                            │
                       ┌────────────────────┼────────────────────┐
                       ▼                    ▼                    ▼
               ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
               │  Mock CRM    │     │  Slack API   │     │ AI Provider  │
               │ Integration  │     │ Integration  │     │ (OpenAI/Mock)│
               └──────────────┘     └──────────────┘     └──────────────┘
```

---

## 3. Webhook Latency & Ingestion Architecture

### 3.1 The Ingestion Challenge
Enterprise webhooks from Stripe, Shopify, HubSpot, or custom frontends typically require acknowledgement within 2 to 5 seconds. If an integration platform executes sequential AI classification (1.5s - 3s) and CRM calls (500ms) synchronously, webhook connections time out, causing duplicate retries and network stampedes.

### 3.2 FlowPilot Zero-Block Solution
FlowPilot separates the **Intake Boundary** from the **Execution Boundary**:

```
Client Form / Webhook Emitter
       │
       │ 1. POST /api/v1/webhooks/{webhook_key}
       ▼
[FastAPI Webhook Router]
       │
       ├─► 2. Validate webhook_key against cached Active Workflows (Redis: <2ms)
       ├─► 3. Check & Set Idempotency Key: HSETNX idempotency:{org_id}:{event_id} (<2ms)
       │      └─► If already exists: Return 200 OK with existing Run ID (No duplicate execution)
       ├─► 4. Insert Initial Workflow Run Record (Postgres: status="PENDING", <10ms)
       ├─► 5. Enqueue Celery Task: execute_workflow_run.delay(run_id, payload) (<3ms)
       │
       ▼ 6. Return Immediate HTTP 202 Accepted (<25ms total server time)
{
  "run_id": "01j8m4n2...",
  "correlation_id": "corr_9901...",
  "status": "QUEUED",
  "received_at": "2026-09-19T11:24:00Z"
}
```

Downstream workers consume the queued task from Redis, update the run status to `RUNNING`, and execute the DAG step-by-step.

---

## 4. Multi-Tenant Data Isolation Strategy

FlowPilot adopts a **Pooled Single-Database, Row-Level Tenant Isolation** architecture:

1. **Foreign Key Invariant**:
   Every tenant-specific entity (`workflows`, `workflow_runs`, `integrations`, `audit_logs`, `approval_requests`, `usage_records`) contains a mandatory foreign key:
   ```sql
   organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
   ```
2. **FastAPI Dependency Injection**:
   Every protected route extracts the caller's verified `user_id` and active `organization_id` from the decoded JWT claims:
   ```python
   async def get_current_org_context(
       current_user: User = Depends(get_current_active_user),
       db: AsyncSession = Depends(get_db_session)
   ) -> OrgContext: ...
   ```
3. **Repository / Query Scoping**:
   All database queries explicitly filter by `organization_id`:
   ```python
   stmt = select(Workflow).where(
       Workflow.id == workflow_id,
       Workflow.organization_id == org_context.org_id
   )
   ```
4. **Cross-Tenant Prevention**:
   Even if an attacker guesses a valid UUID for a workflow or run belonging to another organization, the query returns `404 Not Found`, completely preventing enumeration and cross-tenant leakage.

---

## 5. Asynchronous Workflow Execution Engine

The workflow engine models each workflow as a **Directed Acyclic Graph (DAG)** of step nodes and connection edges.

```
                  ┌──────────────────────┐
                  │ Webhook Trigger Node │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ Validate Data Node   │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ AI Classification    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ Rule Engine Node     │
                  └──────┬────────┬──────┘
                         │        │
     [priority == 'high']│        │ [priority != 'high']
                         ▼        ▼
           ┌─────────────────┐   ┌──────────────────────┐
           │ Approval Node   │   │ Mock CRM Action      │
           │ (State: PAUSED) │   └──────────┬───────────┘
           └────────┬────────┘              │
                    │ [Approved]            ▼
                    └─────────────────────► ┌──────────────────────┐
                                            │ Slack Notification   │
                                            └──────────────────────┘
```

### 5.1 Step Executor Interface (`BaseStepExecutor`)
Every step node implementation inherits from `BaseStepExecutor`:
```python
class BaseStepExecutor(ABC):
    @abstractmethod
    async def validate_config(self, config: dict) -> None:
        """Validates node configuration parameters prior to run."""
        pass

    @abstractmethod
    async def execute(self, step_context: StepExecutionContext) -> StepExecutionResult:
        """Executes the specific integration or logic block."""
        pass
```

### 5.2 Suspension and Resumption for Human Approvals
When a workflow hits a `HUMAN_APPROVAL` step:
1. The executor verifies approval conditions.
2. If approval is required, the step generates an `approval_requests` row with status `PENDING`.
3. The workflow run status transitions to `WAITING_FOR_APPROVAL`.
4. A notification is dispatched to Slack/email with contextual lead information.
5. The Celery worker cleanly exits without consuming continuous CPU or thread resources.
6. When an authorized manager calls `POST /api/v1/approvals/{id}/approve`:
   - The approval status updates to `APPROVED`.
   - The approval service enqueues `resume_workflow_run.delay(run_id, step_id)`.
   - The worker resumes downstream steps from the exact point of suspension.

---

## 6. Resilience, Retries, and Error Handling

| Failure Scenario | Mitigation Strategy |
|---|---|
| **AI Provider Timeout / 503** | Exponential backoff (1s, 2s, 4s) up to 3 retries. If exhausted, fallback to default category or fail run with actionable error. |
| **External API Rate Limit (429)** | Respect `Retry-After` header; Celery task scheduled for delayed retry. |
| **Database Network Blip** | Async connection pool with automatic health check (`pool_pre_ping=True`) and connection recycling. |
| **Worker Process Crash** | Celery tasks run with `acks_late=True`. Unacknowledged messages return to the Redis broker on worker failure. |
| **Malformed Incoming Payload** | Strict Pydantic parsing. If invalid, the run records `FAILED` status with explicit validation error messages and does not trigger downstream side effects. |

---

## 7. Security Architecture Overview

- **Authentication**: JWT with short-lived access tokens (30m) and rotating refresh tokens (7d).
- **Password Security**: Argon2id with memory-hard hashing parameters.
- **Data at Rest**: Sensitive integration tokens, webhook secrets, and API keys are encrypted in PostgreSQL using **AES-256-GCM** with unique nonces.
- **Audit Trails**: Non-repudiation audit logging for every configuration mutation, credential update, and approval action.
