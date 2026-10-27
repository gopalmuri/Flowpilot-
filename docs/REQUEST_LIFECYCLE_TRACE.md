# FlowPilot — Request Lifecycle Trace & Frontend-Backend Interactive Map

This document presents a granular, end-to-end execution trace through the FlowPilot codebase, followed by file-by-file interaction flows for core user actions.

---

# PART 1: THE CANONICAL REQUEST LIFECYCLE TRACE

We trace a real, production workflow present in the codebase:
**Workflow Name:** `"Enterprise Lead Intake Pipeline"` (from `backend/tests/e2e/test_lead_automation_e2e.py`)

### The Pipeline Structure:
```text
[Inbound Webhook: webhook_inbound]
              |
              v
[AI Classifier: ai_classify]
              |
              v
[Condition: eval_enterprise] (category == "enterprise")
              | (true)
              v
[Human Approval: manager_approval] (VP Approval Gate)
              | (approved)
              v
[Mock CRM: crm_lead] (Create Enterprise Lead)
              |
              v
[Slack Notification: slack_announcement] (Post to #enterprise-leads)
```

---

## The Master Trace Diagram

```text
USER / EXTERNAL CALLER (e.g. Partner CRM / Webhook Source)
        |
        | [1] HTTP POST /api/v1/webhooks/{webhook_key}
        v
HTTP REQUEST (Raw Bytes + Headers)
        |
        | [2] Handled by Uvicorn ASGI Server
        v
FASTAPI ROUTE (app/routers/webhooks.py :: handle_public_webhook)
        |
        | [3] Size check (64KB), Timestamp tolerance (300s), HMAC-SHA256 signature
        v
VALIDATION (app/services/webhook_service.py :: verify_hmac_signature)
        |
        | [4] Atomic savepoint (session.begin_nested()) & scoped key
        v
IDEMPOTENCY (app/services/webhook_service.py :: get_or_create_idempotent_run)
        |
        | [5] Inserts IdempotencyRecord & WorkflowRun (status="RUNNING")
        v
DATABASE (PostgreSQL: workflow_runs, idempotency_records)
        |
        | [6] Async dispatch (execute_workflow_run.delay) via Redis
        v
CELERY (app/workers/tasks.py :: execute_workflow_run)
        |
        | [7] In-process topological DAG traversal with OR-convergence
        v
WORKFLOW ENGINE (app/engine/workflow_engine.py :: WorkflowEngine)
        |
        +---- [8]  AI CLASSIFICATION (app/engine/executors.py :: AIClassificationExecutor)
        |          Calls: app/services/ai/service.py & BaseAIProvider
        |          Persists: Token usage in usage_records
        |
        +---- [9]  DETERMINISTIC RULE (app/engine/condition_evaluator.py :: ConditionRuleExecutor)
        |          Resolves: ai_classify.category == "enterprise"
        |          Branch: "true" -> activates downstream edge
        |
        +---- [10] HUMAN APPROVAL SUSPENSION (app/engine/executors.py :: HumanApprovalExecutor)
        |          Status: Run pauses -> status="PAUSED", ApprovalRequest="PENDING"
        |          Audit: Emits action="approval.requested"
        |          ... (Awaits human decision) ...
        |          Resumption: POST /api/v1/organizations/{org_id}/approvals/{id}/approve
        |          Row Locks: SELECT ... FOR UPDATE on run and approval
        |          Status: Transitions to "APPROVED", resumes DAG traversal
        |
        +---- [11] CRM INTEGRATION (app/engine/executors.py :: MockCRMCreateExecutor)
        |          Calls: app/services/crm/mock_crm_service.py
        |          Security: AES-256-GCM decrypt credentials + SSRF IP check
        |
        +---- [12] SLACK NOTIFICATION (app/engine/executors.py :: MockSlackNotificationExecutor)
        |          Calls: app/services/slack/slack_service.py
        |          Security: Webhook egress validation via app/core/ssrf.py
        |
        v
EXECUTION COMPLETION (app/engine/workflow_engine.py :: _run_dag_traversal)
        | Transitions WorkflowRun to COMPLETED, records duration_ms
        v
AUDIT LOGGING (PostgreSQL: audit_logs)
        | Writes execution.completed with duration and actor details
        v
ANALYTICS & SLA AGGREGATION (app/services/analytics_service.py :: AnalyticsService)
        Aggregates volume, P50/P95/P99 duration percentiles, and SLA compliance
```

---

## Step-by-Step Arrow Trace

### Arrow 1: External Caller -> HTTP Request
- **Source:** External webhook agent or client (e.g. `test_full_lead_automation_e2e_pipeline`).
- **Target:** Network socket on port 8000 (FastAPI / Uvicorn).
- **HTTP Method:** `POST`.
- **URL Path:** `/api/v1/webhooks/whk_live_enterprise_99812`.
- **Headers:**
  ```http
  Content-Type: application/json
  X-Webhook-Timestamp: 1727598000
  X-Webhook-Signature: sha256=d5b94f...6f82
  Idempotency-Key: idemp_lead_corp_001
  X-Correlation-ID: corr_8f7b321a
  ```
- **Body Data Object (raw bytes):**
  ```json
  {
    "company": "Globex Corp",
    "employees": 1000,
    "message": "This is an urgent enterprise partnership opportunity"
  }
  ```

### Arrow 2: HTTP Request -> FastAPI Route
- **File:** `backend/app/routers/webhooks.py`
- **Function:** `handle_public_webhook()`
- **Line Reference:** Line ~140
- **Caller:** Uvicorn ASGI router matching route decorator `@router.post("/webhooks/{webhook_key}")`.
- **Injected Dependencies:**
  - `request: Request`
  - `response: Response`
  - `async_dispatch: bool = Query(False)`
  - `db: AsyncSession = Depends(get_db)`
- **Input Data Object:** Raw ASGI request connection, `webhook_key = "whk_live_enterprise_99812"`.

### Arrow 3: FastAPI Route -> Validation
- **File:** `backend/app/services/webhook_service.py`
- **Functions:**
  1. `validate_payload_size(raw_body, max_bytes=65536)`:
     - Calculates `len(raw_body)`. If > 64KB, immediately raises `HTTPException(413)`.
  2. `verify_timestamp(timestamp_str, tolerance_seconds=300)`:
     - Compares `float(timestamp_str)` against UTC epoch `time.time()`. If `abs(current_ts - ts) > 300`, raises `HTTPException(401, "Webhook timestamp expired")`.
  3. `verify_hmac_signature(raw_body, signature_header, secret_token, timestamp_str)`:
     - Computes: `hmac.new(secret_token.encode("utf-8"), timestamp.encode("utf-8") + b"." + raw_body, hashlib.sha256).hexdigest()`.
     - Compares using `hmac.compare_digest(expected, actual)`. If mismatch, raises `HTTPException(401, "Invalid webhook signature")`.
- **Output:** Clean, cryptographically authenticated request bytes.

### Arrow 4: Validation -> Idempotency
- **File:** `backend/app/services/webhook_service.py`
- **Function:** `get_or_create_idempotent_run()`
- **Input Data:**
  - `session_factory: async_sessionmaker`
  - `organization_id: UUID`
  - `workflow_id: UUID`
  - `version_id: UUID`
  - `clean_payload: dict`
  - `correlation_id: "corr_8f7b321a"`
  - `client_idempotency_key: "idemp_lead_corp_001"`
- **Processing:**
  - Constructs scoped key: `"webhook:4f7d2e...:idemp_lead_corp_001"`.
  - Checks if `IdempotencyRecord` exists.
  - If not found, opens a PostgreSQL nested transaction savepoint: `async with session.begin_nested():`.
  - Inserts `WorkflowRun(status="RUNNING", ...)` and `IdempotencyRecord(...)`.
  - If a concurrent request attempts to insert the same key simultaneously, PostgreSQL throws `IntegrityError`. The savepoint rolls back cleanly without aborting the session, fetches the winning record, and sets `is_winner = False, is_idempotent = True`.
- **Output Tuple:** `(run: WorkflowRun, is_winner=True, is_idempotent=False)`.

### Arrow 5: Idempotency -> Database
- **File:** `backend/app/models/workflow_run.py` & `backend/app/models/idempotency.py`
- **Database Tables Updated:**
  - `workflow_runs`: Row inserted with `id = uuid4()`, `status = "RUNNING"`, `trigger_type = "WEBHOOK"`, `started_at = utc_now()`.
  - `idempotency_records`: Row inserted linking `scoped_key` to `workflow_run.id` with `expires_at = utc_now() + 24 hours`.

### Arrow 6: Database -> Celery / Execution Dispatch
- **File:** `backend/app/workers/tasks.py`
- **Function:** `execute_workflow_run.delay(...)`
- **Broker:** Redis queue named `"workflows"`.
- **Worker Execution:**
  - Celery worker receives task message.
  - Invokes `run_coroutine_sync(_async_execute_workflow_run(...))`.
  - Instantiates `NullPool` async engine via `get_worker_session_maker()` (preventing event loop collision between Celery worker threads).
  - Instantiates `engine = WorkflowEngine(session_factory=session_maker)`.
  - Invokes `await engine.execute_run_dag(...)`.

### Arrow 7: Celery -> Workflow Engine (DAG Traversal)
- **File:** `backend/app/engine/workflow_engine.py`
- **Class:** `WorkflowEngine`
- **Method:** `_run_dag_traversal(organization_id, run_id, version_id, trigger_payload)`
- **Data Object Ingested:**
  - Emits `AuditLog(action="execution.started", resource_id=str(run_id))`.
  - Loads steps: `[webhook_inbound, ai_classify, eval_enterprise, manager_approval, crm_lead, slack_announcement]`.
  - Loads connections: `webhook_inbound -> ai_classify -> eval_enterprise -> manager_approval -> crm_lead -> slack_announcement`.
  - Builds graph structures: `incoming_edges`, `outgoing_edges`, `parent_step_ids`.
  - Starts topological loop.

### Arrow 8: Step 1 & 2 — Inbound Trigger & AI Classification
- **File:** `backend/app/engine/executors.py`
- **Class:** `AIClassificationExecutor`
- **Dependency Service:** `backend/app/services/ai/service.py` & `AIProviderFactory`
- **Input Context:**
  - `ctx.workflow_data`: contains trigger data `{"company": "Globex Corp", "employees": 1000, "message": "urgent partnership"}`.
  - `ctx.config`: `{"categories": ["enterprise", "smb"]}`.
- **Processing:**
  - Calls `provider.classify(input_data, config)`.
  - Normalizes JSON output via `extract_json_payload()`.
  - Validates schema: `LeadClassificationResult(category="enterprise", confidence=0.96, reasoning="1000 employees and partnership")`.
- **Output:**
  - `WorkflowStepRun` created with `status = "COMPLETED"`, `output_data = {"category": "enterprise", "confidence": 0.96, "tokens_used": 142}`.
  - Inserts row into `usage_records`: `metric_type = "ai_tokens", quantity = 142`.
  - Stores in memory: `workflow_data["ai_classify"] = {"category": "enterprise", "confidence": 0.96}`.

### Arrow 9: Step 3 — Deterministic Condition Evaluation
- **File:** `backend/app/engine/executors.py` & `backend/app/engine/condition_evaluator.py`
- **Class:** `ConditionRuleExecutor`
- **Function:** `evaluate_rule_group()`
- **Input Context:**
  - `field`: `"ai_classify.category"`
  - `operator`: `"equals"`
  - `value`: `"enterprise"`
- **Processing:**
  - `resolve_context_path("ai_classify.category", context)` navigates into `context["workflow_data"]["ai_classify"]["category"]`.
  - Found value: `"enterprise"`.
  - Evaluates `"enterprise" == "enterprise"` -> `True`.
  - Sets `StepExecutionResult(status="COMPLETED", selected_branch="true")`.
- **Edge Activation:**
  - In `WorkflowEngine._run_dag_traversal`:
  - Scans outgoing edges of `eval_enterprise`.
  - Connection with `condition_label == "true"` is set to `edge_active[conn_id] = True`.
  - Path to `manager_approval` is activated!

### Arrow 10: Step 4 — Human Approval Gate (Suspension & Resumption)
- **File:** `backend/app/engine/executors.py` :: `HumanApprovalExecutor`
- **Execution & Suspension:**
  - Executor returns `StepExecutionResult(status="PAUSED", requires_approval=True)`.
  - Engine acquires row lock on `WorkflowRun`.
  - Inserts `ApprovalRequest` into PostgreSQL:
    ```sql
    INSERT INTO approval_requests (id, organization_id, workflow_run_id, step_id, status, payload_snapshot)
    VALUES (..., 'PENDING', '{"step_key": "manager_approval", "workflow_data": {...}}');
    ```
  - Updates `WorkflowRun.status = "PAUSED"`.
  - Emits `AuditLog(action="approval.requested", resource_id=str(approval.id))`.
  - Engine halts loop and exits.
- **Human Decision Interaction:**
  - VP opens frontend `/approvals` page.
  - VP reviews lead details and clicks **[Approve]**.
  - Sends: `POST /api/v1/organizations/{org_id}/approvals/{approval_id}/approve` with `{"comment": "Qualified enterprise lead approved for CRM entry"}`.
  - Router `app/routers/approvals.py` validates caller role level >= `approver_role` (Owner level 4 >= Owner level 4).
  - Calls `WorkflowEngine.resume_run(...)`.
- **Engine Resumption Sequence:**
  - Acquires row lock: `SELECT * FROM workflow_runs WHERE id = :run_id FOR UPDATE;`
  - Acquires row lock: `SELECT * FROM approval_requests WHERE id = :id FOR UPDATE;`
  - Checks lazy expiration: `created_at + timeout_hours < utc_now()` (False, active).
  - Updates `ApprovalRequest.status = "APPROVED"`.
  - Emits `AuditLog(action="approval.approved")`.
  - Marks `manager_approval` `WorkflowStepRun` as `COMPLETED`.
  - Activates outgoing connection with `condition_label == "approved"`.
  - Re-enters `_run_dag_traversal`.

### Arrow 11: Step 5 — Mock CRM Integration Action
- **File:** `backend/app/engine/executors.py` :: `MockCRMCreateExecutor`
- **Dependency Service:** `backend/app/services/crm/mock_crm_service.py`
- **Processing:**
  - Decrypts integration API token using `app/core/encryption.py :: decrypt_data()`.
  - Checks target endpoint against `app/core/ssrf.py :: validate_url_target()` (ensuring no internal or cloud metadata IPs).
  - Calls `MockCRMService.create_lead(...)`.
  - Returns `{"lead_id": "crm_lead_88412", "status": "created", "entity_type": "lead"}`.
  - `WorkflowStepRun` persisted with `status = "COMPLETED"`.
  - `workflow_data["crm_lead"] = {"lead_id": "crm_lead_88412"}`.

### Arrow 12: Step 6 — Slack Notification Action
- **File:** `backend/app/engine/executors.py` :: `MockSlackNotificationExecutor`
- **Dependency Service:** `backend/app/services/slack/slack_service.py`
- **Processing:**
  - Resolves message template: `"New Enterprise Lead: Globex Corp (CRM ID: crm_lead_88412)"`.
  - Enforces SSRF check on Slack webhook URL.
  - Dispatches message to channel `"#enterprise-leads"`.
  - Returns `{"delivered": True, "channel": "#enterprise-leads", "ts": "1727598045.000100"}`.
  - `WorkflowStepRun` persisted with `status = "COMPLETED"`.

### Arrow 13: Execution Completion & Final Audit
- **File:** `backend/app/engine/workflow_engine.py`
- **Processing:**
  - Traversal finishes: No more ready nodes remain in DAG.
  - Updates `WorkflowRun`:
    - `status = "COMPLETED"`
    - `completed_at = utc_now()`
  - Computes `duration_ms = (completed_at - started_at).total_seconds() * 1000`.
  - Emits immutable `AuditLog`:
    ```json
    {
      "action": "execution.completed",
      "resource_type": "workflow_run",
      "resource_id": "run_uuid_here",
      "details": {
        "workflow_id": "wf_uuid_here",
        "duration_ms": 1420
      }
    }
    ```

### Arrow 14: Analytics & SLA Aggregation
- **File:** `backend/app/services/analytics_service.py`
- **Caller:** `GET /api/v1/organizations/{org_id}/analytics/overview?range=24h`
- **Processing:**
  - Executes single-pass SQL query over `workflow_runs`.
  - Evaluates `COUNT(*) FILTER (WHERE status = 'COMPLETED')`.
  - Evaluates `PERCENTILE_CONT(0.50)`, `PERCENTILE_CONT(0.95)`, `PERCENTILE_CONT(0.99)` within group ordered by duration.
  - Compares `duration_seconds` against workflow version `sla_target_seconds` (60.0s).
  - Since `1.42s <= 60.0s`, execution counts as SLA compliant.
  - Returns JSON response:
    ```json
    {
      "volume": { "total": 1, "success_count": 1, "success_rate": 100.0 },
      "duration": { "p50_ms": 1420.0, "p95_ms": 1420.0, "p99_ms": 1420.0 },
      "sla": { "compliance_rate": 100.0, "violations": 0 }
    }
    ```

---

# PART 2: FRONTEND -> BACKEND INTERACTION TRACES

For each core user action, we trace the full round-trip journey from the UI click to the database and back to the updated React view.

---

### 1. USER ACTION: LOGIN

```text
[Sign In Button]
      |
      v
React Component: frontend/src/pages/auth/LoginPage.tsx
      |
      v
Event Handler: handleSubmit(e: React.FormEvent)
      |
      v
API Client: frontend/src/services/authService.ts :: login({ email, password })
      |
      v
HTTP Client: frontend/src/services/apiClient.ts :: setTokens(access, refresh)
      |
      v
HTTP Request: POST /api/v1/auth/login (Content-Type: application/json)
      |
      v
FastAPI Router: backend/app/routers/auth.py :: login()
      |
      v
Security Service: backend/app/core/security.py :: verify_password()
      |
      v
Database: PostgreSQL table 'users' queried by email; memberships preloaded
      |
      v
HTTP Response: 200 OK with { access_token, refresh_token, token_type: "bearer" }
      |
      v
React State Update: AuthContext.tsx :: setUser(user), setTokens(), setIsAuthenticated(true)
      |
      v
UI Transition: React Router navigates user to /dashboard; Header reflects active user
```

---

### 2. USER ACTION: CREATE WORKFLOW

```text
[+ New Workflow Button]
      |
      v
React Component: frontend/src/pages/workflows/WorkflowsPage.tsx
      |
      v
Event Handler: handleCreateWorkflow({ name, description })
      |
      v
API Client: frontend/src/services/workflowService.ts :: createWorkflow(orgId, data)
      |
      v
HTTP Request: POST /api/v1/organizations/{org_id}/workflows (Authorization: Bearer <token>)
      |
      v
FastAPI Router: backend/app/routers/workflows.py :: create_workflow()
      |
      v
Tenant Context: backend/app/api/deps.py :: get_org_context() validates membership
      |
      v
Database: PostgreSQL inserts into 'workflows' (generates webhook_key) and creates Version 1 (DRAFT) in 'workflow_versions'
      |
      v
HTTP Response: 201 Created with WorkflowResponse JSON
      |
      v
React State Update: setWorkflows(prev => [newWorkflow, ...prev])
      |
      v
UI Transition: Workflows list updates; User redirected to /workflows/{id} editor
```

---

### 3. USER ACTION: PUBLISH WORKFLOW

```text
[Publish Workflow Button]
      |
      v
React Component: frontend/src/pages/workflows/WorkflowEditorPage.tsx
      |
      v
Event Handler: handlePublishVersion(versionId)
      |
      v
API Client: frontend/src/services/workflowService.ts :: publishWorkflowVersion(orgId, workflowId, versionId)
      |
      v
HTTP Request: POST /api/v1/organizations/{org_id}/workflows/{workflow_id}/versions/{version_id}/publish
      |
      v
FastAPI Router: backend/app/routers/workflows.py :: publish_workflow_version()
      |
      v
Validation Service: backend/app/services/workflow_validator.py :: validate_workflow_dag()
      - Checks DAG acyclicity, step connectivity, single trigger presence
      |
      v
Database: 
      - Updates target version status='PUBLISHED'
      - Sets previous active version status='ARCHIVED'
      - Updates workflow active_version_id = version_id, status='ACTIVE'
      - Inserts into 'audit_logs' action='workflow.published'
      |
      v
HTTP Response: 200 OK with WorkflowVersionResponse
      |
      v
React State Update: setActiveVersion(updatedVersion), setPublished(true)
      |
      v
UI Transition: Editor badge turns green: "Active / Published v1"; Webhook URL card unblocks
```

---

### 4. USER ACTION: RUN WORKFLOW (MANUAL TRIGGER)

```text
[Run Workflow Now Button]
      |
      v
React Component: frontend/src/pages/workflows/WorkflowEditorPage.tsx (Run Modal)
      |
      v
Event Handler: handleExecuteManualRun(payloadJson)
      |
      v
API Client: frontend/src/services/workflowService.ts :: executeWorkflow(orgId, workflowId, payload)
      |
      v
HTTP Request: POST /api/v1/organizations/{org_id}/workflows/{workflow_id}/runs
      |
      v
FastAPI Router: backend/app/routers/executions.py :: trigger_manual_execution()
      |
      v
Engine Execution: backend/app/engine/workflow_engine.py :: WorkflowEngine.execute_new_run()
      |
      v
Database: Inserts into 'workflow_runs' (status='RUNNING'), emits 'execution.started' to 'audit_logs'
      |
      v
HTTP Response: 201 Created with WorkflowRunResponse { id, status: "RUNNING", ... }
      |
      v
React State Update: Navigation hook redirects to /executions/{run_id}
      |
      v
UI Transition: Executions detail page opens with active spinner on running steps
```

---

### 5. USER ACTION: APPROVE EXECUTION

```text
[Approve Button] (in Approvals Card)
      |
      v
React Component: frontend/src/pages/approvals/ApprovalsPage.tsx
      |
      v
Event Handler: handleApprove(approvalId, comment)
      |
      v
API Client: frontend/src/services/approvalService.ts :: approveRequest(orgId, approvalId, { comment })
      |
      v
HTTP Request: POST /api/v1/organizations/{org_id}/approvals/{approval_id}/approve
      |
      v
FastAPI Router: backend/app/routers/approvals.py :: approve_request()
      |
      v
RBAC Guard: _check_approver_role() verifies caller role >= required role (OWNER/ADMIN/MANAGER)
      |
      v
Engine Resumption: WorkflowEngine.resume_run() acquires PG row locks (FOR UPDATE), marks approval 'APPROVED', emits 'approval.approved', and resumes traversal
      |
      v
Database: 'approval_requests' status updated to 'APPROVED'; downstream step runs created
      |
      v
HTTP Response: 200 OK with ApprovalResponse { status: "APPROVED", decided_at: "..." }
      |
      v
React State Update: setApprovals(prev => prev.filter(a => a.id !== approvalId))
      |
      v
UI Transition: Approval card animates out; Toast alerts: "Lead approved. Workflow execution resumed."
```

---

### 6. USER ACTION: VIEW EXECUTION DETAILS

```text
[Click Execution Row] (in Executions Table)
      |
      v
React Component: frontend/src/pages/executions/ExecutionsPage.tsx
      |
      v
Event Handler: setSelectedRunId(run.id)
      |
      v
API Client: frontend/src/services/executionService.ts :: getExecution(orgId, runId)
      |
      v
HTTP Request: GET /api/v1/organizations/{org_id}/runs/{run_id}
      |
      v
FastAPI Router: backend/app/routers/executions.py :: get_execution()
      |
      v
Database: Queries 'workflow_runs' joined with 'workflow_step_runs' ordered by started_at
      |
      v
HTTP Response: 200 OK with WorkflowRunDetailResponse (run details + array of step runs)
      |
      v
React State Update: setSelectedRun(response.data)
      |
      v
UI Transition: Detail drawer/panel slides open displaying the Step Timeline, duration badges, and raw JSON input/output payloads
```

---

### 7. USER ACTION: VIEW AUDIT LOG

```text
[Click "Audit Logs" in Sidebar]
      |
      v
React Component: frontend/src/pages/audit/AuditLogsPage.tsx
      |
      v
Event Hook: useEffect() on mount / filter change -> fetchAuditLogs()
      |
      v
API Client: frontend/src/services/auditService.ts :: getAuditLogs(orgId, filters)
      |
      v
HTTP Request: GET /api/v1/organizations/{org_id}/audit-logs?action=approval.approved&page=1
      |
      v
FastAPI Router: backend/app/routers/audit.py :: list_audit_logs()
      |
      v
Tenant Isolation: get_org_context() verifies caller is member of organization
      |
      v
Database: Queries 'audit_logs' WHERE organization_id = :org_id ORDER BY created_at DESC LIMIT 50
      |
      v
HTTP Response: 200 OK with AuditLogListResponse { items: [...], total: 42 }
      |
      v
React State Update: setAuditLogs(response.items), setTotalPages(response.total)
      |
      v
UI Transition: Audit table renders with timestamp, actor name, action badge, and expandable JSON details
```

---

### 8. USER ACTION: VIEW ANALYTICS & SLA

```text
[Click "Analytics" in Sidebar or Change Time Range to "7d"]
      |
      v
React Component: frontend/src/pages/analytics/AnalyticsPage.tsx
      |
      v
Event Handler: handleRangeChange("7d") -> triggers useQuery / fetchAnalytics()
      |
      v
API Client: frontend/src/services/analyticsService.ts :: getOverview(orgId, { range: "7d" })
      |
      v
HTTP Request: GET /api/v1/organizations/{org_id}/analytics/overview?range=7d
      |
      v
FastAPI Router: backend/app/routers/analytics.py :: get_analytics_overview()
      |
      v
Analytics Service: backend/app/services/analytics_service.py :: AnalyticsService.get_overview()
      |
      v
Database: Executes single-pass SQL query using COUNT(*) FILTER and PERCENTILE_CONT(0.50, 0.95, 0.99)
      |
      v
HTTP Response: 200 OK with AnalyticsOverviewResponse { volume, duration, sla }
      |
      v
React State Update: setOverviewData(response.data)
      |
      v
UI Transition: KPI cards update (Total Executions, Success Rate: 98.4%), Latency gauge displays P50 / P95 / P99 bars, and SLA compliance card renders status
```
