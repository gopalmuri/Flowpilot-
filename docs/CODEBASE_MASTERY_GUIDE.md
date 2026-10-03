# FlowPilot — Codebase Mastery & Engineering Guide

This document is an exhaustive, authoritative technical guide to the **FlowPilot** codebase. It reflects the exact, current implementation residing in `E:\flowpilot`. Every pattern, diagram, database schema, and request flow described herein is verified against active source code.

---

## 1. PROJECT OVERVIEW

### What problem does FlowPilot solve?
Modern enterprises receive inbound business events (leads, tickets, onboarding requests, escalation notices) from multiple external channels. These events require:
1. **Security & Ingest Integrity:** Cryptographic signature verification (HMAC-SHA256), replay protection, and strict idempotency so duplicate webhooks never execute twice.
2. **Contextual AI Intelligence:** Categorizing unstructured business text into structured taxonomy with confidence scores and token tracking.
3. **Deterministic Business Rules:** Evaluating strict organizational policies (e.g., deal size, territory, priority) without hallucination or probabilistic variance.
4. **Human-in-the-Loop Oversight:** Suspending execution and awaiting authorized manager approval before triggering high-impact downstream side-effects.
5. **Transactional Integrations:** Securely dispatching updates to external systems (CRM, Slack, webhooks) with AES-256-GCM encrypted credentials and SSRF network egress protection.
6. **Enterprise Auditability & SLA Telemetry:** Every execution state transition, human decision, and outgoing integration call is immutably logged for compliance and aggregated for real-time SLA latency percentiles (P50, P95, P99).

FlowPilot provides an enterprise-grade, multi-tenant orchestration platform that unifies these requirements into a deterministic Directed Acyclic Graph (DAG) execution engine.

### Who uses it?
- **Enterprise Administrators & Operations Managers:** Configure multi-tenant organizational policies, manage member roles (Owner, Admin, Manager, Operator, Viewer), and oversee SLA metrics.
- **Workflow Designers / Engineers:** Define workflow graphs with visual nodes (Triggers, Data Validation, AI Classifiers, Conditions, Human Approval Gates, CRM Actions, Slack Notifications).
- **Human Approvers (Managers / Owners):** Review paused workflow runs in the Approvals inbox and approve or reject requests with audit comments.
- **Auditors & Compliance Officers:** Inspect cryptographic audit trails, actor identities, and sanitized execution traces.

### What enters FlowPilot?
1. **Inbound HTTP Webhooks:** JSON payloads received over public endpoints (`/api/v1/webhooks/{webhook_key}`) or tenant-scoped endpoints (`/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook`). Webhooks carry HMAC-SHA256 signatures (`X-Webhook-Signature`), timestamps (`X-Webhook-Timestamp`), and idempotency keys (`Idempotency-Key`).
2. **Manual Execution Requests:** Authenticated HTTP POST calls (`/api/v1/organizations/{org_id}/workflows/{wf_id}/runs`) triggered by authenticated operators or the frontend UI.
3. **Approval Decisions:** Authenticated POST requests (`/api/v1/organizations/{org_id}/approvals/{id}/approve` or `/reject`) carrying decision comments.

### What happens to the request?
1. **Authentication & Rate Limiting:** Enforces Redis sliding-window rate limiting. For webhooks, validates payload size (<= 64KB), timestamp freshness (within 300 seconds), and HMAC-SHA256 cryptographic signature.
2. **Tenant Scoping & Membership:** Resolves the organization and checks membership and role (Owner, Admin, Manager, Operator, Viewer).
3. **Idempotency Serialization:** In PostgreSQL, queries or atomically inserts an `IdempotencyRecord` inside a nested transaction savepoint (`session.begin_nested()`). Winning requests proceed; duplicate requests return the existing execution state without re-running.
4. **Run Initialization:** A `WorkflowRun` record is persisted in `PENDING` -> `RUNNING` status with a correlation ID.
5. **Execution Dispatch:**
   - **Synchronous Execution:** Inline execution directly through the in-process `WorkflowEngine`.
   - **Asynchronous Execution:** Celery task (`tasks.execute_workflow_run`) dispatched via Redis broker returning HTTP 202 Accepted.
6. **Topological DAG Traversal:** The `WorkflowEngine` iterates through ready steps, opening dedicated database transactions per step:
   - **Trigger / Validate:** Ingests input and verifies schema constraints.
   - **AI Classification:** Calls `BaseAIProvider` (Mock, OpenAI, Anthropic) with fallback to `DeterministicFallbackClassifier`; records token metrics in `usage_records`.
   - **Condition:** Resolves dot-notation variables (e.g. `ai_classify.category`) and evaluates boolean/numeric rules without dynamic code evaluation; activates outgoing edge branches.
   - **Human Approval:** Pauses the workflow run (`status = "PAUSED"`), creates an `ApprovalRequest` (`status = "PENDING"`), emits `approval.requested` audit log, and halts engine traversal.
   - **Approval Resumption:** When approved by a manager, acquires PostgreSQL row locks (`SELECT ... FOR UPDATE`), records decision, transitions approval to `APPROVED`, and resumes DAG traversal.
   - **Integrations:** Dispatches calls to Mock CRM (`MockCRMService`) and Slack (`SlackService`) using decrypted credentials while enforcing SSRF blocked-range checks.
7. **Run Finalization:** Transitions `WorkflowRun` to `COMPLETED` (or `FAILED`), calculates execution duration, and writes `execution.completed` audit log.

### What comes out?
1. **Downstream Integration Calls:** CRM records created/updated, Slack channel announcements posted.
2. **Synchronous or Polled HTTP Responses:** Immediate JSON run status or Celery task receipt.
3. **Audit Records:** Immutable log entries tracking every step, actor, and payload snapshot.
4. **Analytics Telemetry:** Aggregated run volumes, latency percentiles (P50, P95, P99), and SLA compliance percentages calculated by `AnalyticsService`.

---

## 2. SYSTEM ARCHITECTURE

```text
                           +---------------------------+
                           |  Web Browser / User / API  |
                           +---------------------------+
                                         |
                                         | HTTPS (JSON / REST)
                                         v
                           +---------------------------+
                           |    Nginx Reverse Proxy    |
                           |   (Port 80/443 / SSL)     |
                           +---------------------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
                       v                                   v
        +-----------------------------+     +-----------------------------+
        |  React 18 SPA (Vite / TS)   |     |      FastAPI Backend        |
        |  (Tailwind, In-Memory Auth) |     |     (Uvicorn ASGI App)      |
        +-----------------------------+     +-----------------------------+
                                                           |
                       +-----------------------------------+-----------------------------------+
                       |                                   |                                   |
                       v                                   v                                   v
        +-----------------------------+     +-----------------------------+     +-----------------------------+
        |   PostgreSQL 16 (Relational)|     |       Redis 7 (Cache/Broker)|     |      Celery Worker Pool     |
        | - Tenant Isolation (Org ID) |     | - JWT Token Blacklist       |     | - Task Queues: default,     |
        | - Workflows, Steps, Conns   |     | - Rate Limiting Windows     |     |   workflows, webhooks,      |
        | - Runs, Step Runs, Approvals|     | - Celery Message Broker     |     |   maintenance               |
        | - Audit Logs, Idempotency   |     | - Celery Result Backend     |     | - Autoretry with Backoff    |
        +-----------------------------+     +-----------------------------+     +-----------------------------+
                                                                                               |
                                                                                               v
                                                                                +-----------------------------+
                                                                                |       Workflow Engine       |
                                                                                | - Topological DAG Traversal |
                                                                                | - OR-Convergence Branching  |
                                                                                | - Step Transaction Bounds   |
                                                                                +-----------------------------+
                                                                                               |
                                   +-----------------------------------+-----------------------+-----------------------+
                                   |                                   |                       |                       |
                                   v                                   v                       v                       v
                    +-----------------------------+     +--------------------+     +--------------------+     +--------------------+
                    |     AI Provider System      |     |  Condition Engine  |     |   Approval Gate    |     | Integrations Egress|
                    | - BaseAIProvider Interface  |     | - Dot-notation Path|     | - PENDING State    |     | - Mock CRM Service |
                    | - Mock Provider             |     | - Safe Comparison  |     | - Row Locks (PG)   |     | - Slack Service    |
                    | - OpenAI Provider           |     | - Branch Selector  |     | - Lazy Expiration  |     | - AES-256 Decrypt  |
                    | - Anthropic Provider        |     | - Zero eval()/exec |     | - Role Validation  |     | - SSRF IP Blocker  |
                    | - Heuristic Fallback        |     +--------------------+     +--------------------+     +--------------------+
                    +-----------------------------+
                                   |
                                   v
                    +-----------------------------+
                    |  Audit & Telemetry Storage  |
                    | - Immutable AuditLog Table  |
                    | - Token Usage Records       |
                    | - SLA Percentiles & Volume  |
                    +-----------------------------+
```

---

## 3. REPOSITORY MAP

```text
E:\flowpilot\
├── .github/
│   └── workflows/
│       └── ci.yml                 # CI pipeline: Linting, type checks, backend pytest, frontend build
├── backend/                       # Python FastAPI application and Celery workers
│   ├── alembic/                   # Database migration scripts
│   ├── app/                       # Application source package
│   │   ├── api/                   # Dependency injection (Auth, Tenant Context, RBAC)
│   │   ├── core/                  # Configuration, database sessionmaker, security, crypto, SSRF
│   │   ├── engine/                # Workflow execution engine, DAG traversal, step registry, condition evaluator
│   │   ├── models/                # SQLAlchemy ORM models (multi-tenant relational schema)
│   │   ├── routers/               # HTTP REST endpoints (Auth, Workflows, Webhooks, Approvals, Analytics, etc.)
│   │   ├── schemas/               # Pydantic validation schemas
│   │   ├── services/              # Domain services (AI providers, CRM, Slack, Webhook HMAC, Analytics)
│   │   └── workers/               # Celery app configuration and task functions
│   ├── tests/                     # Unit, integration, and full E2E pipeline test suites
│   ├── Dockerfile                 # Multi-stage production container build for backend
│   └── requirements.txt           # Python package dependencies
├── docker/
│   └── nginx/
│       └── nginx.conf             # Production reverse proxy configuration
├── docs/                          # Architecture, database design, API specs, and runbooks
├── frontend/                      # React 18 single-page application (TypeScript + Tailwind)
│   ├── src/
│   │   ├── components/            # UI components (Navbar, Sidebar, Modals, Badges, Buttons)
│   │   ├── context/               # React Context providers (AuthContext, ThemeContext)
│   │   ├── layouts/               # Dashboard layout shell
│   │   ├── pages/                 # Route pages (Landing, Login, Dashboard, Workflows, Executions, Approvals, Audit, Analytics)
│   │   ├── routes/                # Client-side routing with authentication guards
│   │   ├── services/              # In-memory API client (apiClient.ts) and domain HTTP clients
│   │   └── types/                 # TypeScript interfaces and type definitions
│   ├── Dockerfile                 # Nginx-based production container build for frontend
│   └── package.json               # NPM packages and scripts
├── scripts/
│   ├── bridge_service.py          # Development bridge utility
│   └── dev.ps1                    # PowerShell local development startup orchestration
├── docker-compose.yml             # Local development multi-container composition
├── docker-compose.prod.yml        # Production deployment multi-container composition
└── Makefile                       # Command shortcuts (build, test, migrate, lint)
```

### Directory Dependency Analysis:
- `backend/app/main.py` depends on `routers/`, `core/`, `api/`, `models/`, `engine/`.
- `backend/app/engine/workflow_engine.py` depends on `models/`, `engine/registry.py`, `engine/executors.py`, `services/workflow_validator.py`.
- `backend/app/workers/tasks.py` depends on `workers/celery_app.py`, `engine/workflow_engine.py`, `services/webhook_service.py`.
- `frontend/src/` depends purely on REST API contracts exposed by `backend/app/routers/` over HTTP.
- `docker/nginx/nginx.conf` routes `/api/` traffic to `backend:8000` and root `/` to `frontend:80`.

---

## 4. BACKEND MAP

| File | Purpose | Who Calls It | What It Calls | Data Flow |
| :--- | :--- | :--- | :--- | :--- |
| `app/main.py` | FastAPI entry point, lifespan, CORS, middleware, router mounts. | Uvicorn ASGI server | `routers/*`, `core/config.py`, `core/middleware.py`, `core/encryption.py` | Initializes app, registers routes, validates production encryption keys on startup. |
| `app/api/deps.py` | Security dependencies: Bearer extraction, JWT validation, tenant isolation, RBAC role check. | FastAPI route handlers via `Depends()` | `core/security.py`, `core/database.py`, `models/user.py`, `models/membership.py` | HTTP Authorization header -> Decoded JWT -> Redis revocation check -> Postgres User & OrganizationMember -> `(Organization, OrganizationMember)`. |
| `app/core/config.py` | Pydantic `BaseSettings` reading environment variables with defaults. | Entire backend | `pydantic_settings` | `.env` / Environment variables -> Typed `settings` object. |
| `app/core/database.py` | Async SQLAlchemy engine and sessionmaker. | `deps.py`, routers, services, Celery tasks | `sqlalchemy.ext.asyncio` | Connection string -> `create_async_engine` -> `AsyncSession` context managers. |
| `app/core/security.py` | Password hashing (bcrypt/argon2), JWT token creation/decoding, Redis token blacklist. | `routers/auth.py`, `api/deps.py` | `passlib`, `python-jose`, `redis.asyncio` | Raw password/payload -> Salted Hash / JWT token string. JTI -> Redis blacklist check. |
| `app/core/encryption.py` | AES-256-GCM symmetric encryption for credentials at rest. | `routers/integrations.py`, `engine/executors.py` | `cryptography.hazmat.primitives.ciphers.aead.AESGCM` | Plaintext API keys -> `AES-256-GCM` ciphertext with 12-byte nonce & authentication tag. |
| `app/core/ssrf.py` | Outbound URL validator blocking RFC 1918 private IPs, loopback, and cloud metadata. | `services/slack/slack_service.py`, `services/crm/mock_crm_service.py` | `socket`, `ipaddress`, `urllib.parse` | Target URL -> DNS resolution -> IP range check -> Allowed or `SSRFValidationError`. |
| `app/routers/auth.py` | Registration, login, token refresh, password reset, current user profile. | Web clients via HTTP | `core/security.py`, `models/user.py`, `models/membership.py` | Credentials -> User record in DB -> Access & Refresh JWT tokens. |
| `app/routers/workflows.py` | Workflow CRUD, version creation, step/connection updates, version publishing. | Frontend Workflows & WorkflowEditor pages | `services/workflow_validator.py`, `models/workflow.py`, `models/workflow_step.py` | Step & Connection JSON -> Graph validation -> Persisted Version -> Published status. |
| `app/routers/webhooks.py` | Public & tenant-scoped webhook ingestion, HMAC validation, idempotency savepoint. | External systems (Stripe, GitHub, Hubspot, custom callers) | `services/webhook_service.py`, `engine/workflow_engine.py`, `workers/tasks.py` | Signed JSON body -> HMAC verification -> Idempotency check -> Run created -> Celery / Inline Engine. |
| `app/routers/approvals.py` | List pending approvals, submit approve/reject decision, lazy expiration. | Frontend Approvals page | `engine/workflow_engine.py`, `workers/tasks.py`, `models/approval.py` | Decision + Comment -> Row lock -> Approval record updated -> Engine resumption. |
| `app/routers/executions.py` | Trigger manual run, query execution history, get step execution details, cancel run. | Frontend Executions page | `engine/workflow_engine.py`, `models/workflow_run.py` | Workflow ID + payload -> Run initiated -> Status, timeline, and step outputs returned. |
| `app/routers/analytics.py` | Execution KPIs, latency percentiles (P50/95/99), SLA monitoring, time-series bucketing. | Frontend Analytics page | `services/analytics_service.py`, `models/workflow_run.py` | Filter parameters -> PostgreSQL single-pass aggregations -> JSON KPI cards & charts. |
| `app/engine/workflow_engine.py` | In-process stateful DAG execution engine with topological traversal & OR-convergence. | `routers/executions.py`, `routers/webhooks.py`, `workers/tasks.py` | `engine/registry.py`, `engine/sanitizer.py`, `models/*` | WorkflowRun + Step DAG -> Discrete step transactions -> Step execution -> Run completed. |
| `app/engine/executors.py` | Concrete executors for AI, Condition, Approval, CRM, Slack, Data Validation. | `engine/workflow_engine.py` via `registry.py` | `services/ai/*`, `services/crm/*`, `services/slack/*`, `condition_evaluator.py` | `StepExecutionContext` -> Step business logic -> `StepExecutionResult`. |
| `app/engine/condition_evaluator.py` | Pure deterministic rule evaluator supporting dot-notation path resolution and boolean logic. | `engine/executors.py` | `schemas/condition.py` | Context dict + RuleGroup -> Dot-notation resolution -> True/False branch decision. |
| `app/services/webhook_service.py` | HMAC-SHA256 signature verification, 64KB size limit, 300s timestamp check, idempotency savepoint. | `routers/webhooks.py` | `models/idempotency.py`, `models/workflow_run.py` | Raw request bytes -> HMAC validation -> Atomic PostgreSQL insert -> Winning run. |
| `app/services/analytics_service.py` | High-performance SQL analytics aggregator using `PERCENTILE_CONT` and `FILTER`. | `routers/analytics.py` | `sqlalchemy.text`, `models/workflow_run.py` | Time range & Org ID -> PostgreSQL native aggregation -> `AnalyticsOverviewResponse`. |
| `app/workers/celery_app.py` | Celery application, queue definitions (`workflows`, `webhooks`, etc.), task routing. | Celery CLI, `workers/tasks.py` | `celery`, `kombu` | Celery broker configuration, worker concurrency settings, serialization rules. |
| `app/workers/tasks.py` | Background tasks for executing runs and resuming paused runs. | Celery worker process | `engine/workflow_engine.py`, `core/database.py` | Celery message -> NullPool async database session -> `WorkflowEngine` execution. |

---

## 5. FRONTEND MAP

### Architecture Overview
The frontend is a React 18 Single-Page Application (SPA) built with TypeScript, Vite, and Tailwind CSS.
- **Entry Points:** `frontend/src/main.tsx` initializes React DOM, while `frontend/src/App.tsx` configures providers (`BrowserRouter`, `AuthProvider`, `ThemeProvider`).
- **Routing:** `frontend/src/routes/AppRoutes.tsx` defines route paths, segregating public routes (`/`, `/login`, `/register`) from protected dashboard routes wrapped by `<ProtectedRoute>` and `<DashboardLayout>`.
- **In-Memory Security:** JWT access and refresh tokens are stored strictly in JavaScript module memory in `frontend/src/services/apiClient.ts` to neutralize Cross-Site Scripting (XSS) risks. They are NEVER stored in `localStorage` or `sessionStorage`.
- **Token Refresh Mutex & Queue:** When an HTTP call fails with 401, `apiClient.ts` suspends pending calls in a `refreshQueue`, requests a new access token via `/api/v1/auth/refresh`, and replays queued requests transparently.

### Concrete User Interaction Lifecycle:
```text
User clicks [Approve Request] in UI
    |
    v
ApprovalsPage.tsx (handleApprove(id, comment))
    |
    v
approvalService.approveRequest(orgId, approvalId, { comment })
    |
    v
apiClient.post(`/api/v1/organizations/${orgId}/approvals/${approvalId}/approve`, body)
    |
    v (HTTP POST with Bearer token & active Organization ID)
FastAPI Router: app/routers/approvals.py :: approve_request()
    |
    v
WorkflowEngine.resume_run() acquires PostgreSQL row lock (FOR UPDATE)
    |
    v
Approval updated to APPROVED; DAG traversal resumes in database
    |
    v
FastAPI returns HTTP 200 JSON with updated ApprovalResponse
    |
    v
approvalService returns response data to ApprovalsPage.tsx
    |
    v
React State updated: setApprovals(prev => prev.filter(a => a.id !== approvalId))
    |
    v
UI updates: Approved card removed from PENDING list, Toast notification displayed
```

---

## 6. DATABASE MAP

The database is PostgreSQL 16 managed via async SQLAlchemy 2.0 with Alembic migrations (`backend/alembic/versions/`).

### Entity Relationship Diagram (ERD)

```text
+-------------------+       1:N       +-------------------------+
|   organizations   |<--------------->|  organization_members   |
+-------------------+                 +-------------------------+
| id (PK, UUID)     |                 | id (PK, UUID)           |
| name (VARCHAR)    |                 | organization_id (FK)    |
| slug (VARCHAR, UQ)|                 | user_id (FK)            |
| created_at        |                 | role (OWNER/ADMIN/etc.) |
+-------------------+                 +-------------------------+
          |                                        |
          | 1:N                                    | N:1
          v                                        v
+-------------------+                 +-------------------------+
|     workflows     |                 |          users          |
+-------------------+                 +-------------------------+
| id (PK, UUID)     |                 | id (PK, UUID)           |
| organization_id(FK|                 | email (VARCHAR, UQ)     |
| name (VARCHAR)    |                 | hashed_password         |
| webhook_key (UQ)  |                 | is_active (BOOLEAN)     |
| active_version_id |                 | full_name (VARCHAR)     |
| status (ACTIVE)   |                 +-------------------------+
+-------------------+
          |
          | 1:N
          v
+------------------------+
|   workflow_versions    |
+------------------------+
| id (PK, UUID)          |
| workflow_id (FK)       |
| version_number (INT)   |
| status (DRAFT/PUB)     |
| sla_target_seconds     |
+------------------------+
          |
          +------------------------------------+
          | 1:N                                | 1:N
          v                                    v
+------------------------+           +------------------------+
|     workflow_steps     |           |  workflow_connections  |
+------------------------+           +------------------------+
| id (PK, UUID)          |           | id (PK, UUID)          |
| workflow_version_id(FK)|           | workflow_version_id(FK)|
| step_key (VARCHAR)     |           | source_step_id (FK)    |
| step_type (VARCHAR)    |           | target_step_id (FK)    |
| config (JSONB)         |           | condition_label (STR)  |
+------------------------+           +------------------------+
          |                                    |
          | Referenced by                      |
          v                                    v
+------------------------+       1:N       +------------------------+
|     workflow_runs      |<--------------->|   workflow_step_runs   |
+------------------------+                 +------------------------+
| id (PK, UUID)          |                 | id (PK, UUID)          |
| organization_id (FK)   |                 | workflow_run_id (FK)   |
| workflow_id (FK)       |                 | step_id (FK)           |
| workflow_version_id(FK)|                 | status (COMPLETED/etc.)|
| status (RUNNING/COMP)  |                 | input_data (JSONB)     |
| trigger_type (MANUAL)  |                 | output_data (JSONB)    |
| trigger_payload (JSONB)|                 | execution_time_ms (INT)|
| correlation_id (STR)   |                 | error_message (TEXT)   |
| started_at / completed |                 +------------------------+
+------------------------+
          |
          +------------------------------------+
          | 1:N                                | 1:N
          v                                    v
+------------------------+           +------------------------+
|   approval_requests    |           |       audit_logs       |
+------------------------+           +------------------------+
| id (PK, UUID)          |           | id (PK, UUID)          |
| organization_id (FK)   |           | organization_id (FK)   |
| workflow_run_id (FK)   |           | user_id (FK, nullable) |
| step_id (FK)           |           | action (VARCHAR)       |
| status (PENDING/APP)   |           | resource_type (VARCHAR)|
| payload_snapshot(JSONB)|           | resource_id (VARCHAR)  |
| decided_by_user_id(FK) |           | details (JSONB)        |
| decision_comment (STR) |           | created_at (TIMESTAMP) |
+------------------------+           +------------------------+
          |
          | Additional Supporting Tables:
          +---> idempotency_records: [id, organization_id, idempotency_key (UQ with org), workflow_run_id, expires_at]
          +---> integrations:        [id, organization_id, type, name, encrypted_config, status]
          +---> usage_records:       [id, organization_id, workflow_id, metric_type, quantity, recorded_at]
```

---

## 7. AUTHENTICATION FLOW

1. **Registration:**
   - Client sends `POST /api/v1/auth/register` with `email`, `password`, `full_name`.
   - `app/routers/auth.py` invokes `core/security.py :: get_password_hash()`, which hashes the password using Argon2/bcrypt with unique per-password salt.
   - A `User` record is persisted in PostgreSQL.
2. **Login & Credential Verification:**
   - Client sends `POST /api/v1/auth/login` with `email`, `password`, and optional `organization_id`.
   - `core/security.py :: verify_password()` verifies the plaintext password against the hash.
   - If valid, `create_access_token()` and `create_refresh_token()` generate cryptographically signed JWTs:
     - Includes standard claims: `sub` (User ID), `exp` (expiration), `type` (`access` or `refresh`), and a unique cryptographic `jti` (JWT ID).
3. **Frontend Token Storage:**
   - Response returns `{ access_token, refresh_token, token_type: "bearer" }`.
   - Stored in module-level in-memory variables in `frontend/src/services/apiClient.ts`.
4. **Subsequent API Request:**
   - Client sends HTTP request with header: `Authorization: Bearer <access_token>`.
5. **Authentication Dependency Enforcement:**
   - Route handler specifies dependency: `current_user: User = Depends(get_current_user)` (in `app/api/deps.py`).
   - `core/security.py :: decode_token()` validates JWT signature and expiration.
   - Checks Redis token revocation list: `is_access_token_revoked(jti)`. If present in Redis, raises HTTP 401.
   - Fetches active user from PostgreSQL along with preloaded memberships (`selectinload(User.memberships)`).
6. **Organization Context & RBAC:**
   - Route specifies `get_org_context` which resolves caller membership in the target organization.
   - `require_role([OrganizationRole.ADMIN, OrganizationRole.OWNER])` validates that `member.role` meets required authorization level, returning HTTP 403 Forbidden on violation.

---

## 8. MULTI-TENANCY

### Tenant Isolation Architecture
FlowPilot enforces a **pooled multi-tenant database model** with row-level logical separation governed by strict application-layer access boundaries.

```text
Incoming HTTP Request: /api/v1/organizations/{organization_id}/workflows
                           |
                           v
        FastAPI Dependency: get_org_context() (app/api/deps.py)
                           |
       SELECT * FROM organization_members
       WHERE organization_id = :org_id AND user_id = :current_user_id
                           |
        +------------------+------------------+
        |                                     |
    Not Found                              Found
        |                                     |
        v                                     v
HTTP 404 Not Found                    Inject org_context into route
(Anti-Enumeration Guard)                      |
                                              v
                             SQL Query explicitly scoped to tenant:
                             SELECT * FROM workflows
                             WHERE organization_id = :org_id
```

### Prevention of Cross-Tenant Data Leaks:
1. **Foreign Key Tenant Scoping:** Every business entity (`workflows`, `workflow_runs`, `workflow_step_runs`, `approval_requests`, `integrations`, `audit_logs`, `idempotency_records`) contains a mandatory foreign key `organization_id`.
2. **Anti-Enumeration 404 Response:** If an authenticated user from Organization A attempts to access a resource in Organization B, `get_org_context()` raises HTTP 404 Not Found (not 403). This prevents attackers from enumerating valid organization IDs.
3. **Explicit Query Binding:** Every query constructed in routers, engines, and services filters explicitly by `organization_id == target_org_id`.

---

## 9. WORKFLOW SYSTEM

FlowPilot models business processes as Directed Acyclic Graphs (DAGs):

- **Workflow (`Workflow`):** Top-level administrative entity belonging to an organization. Owns a unique public `webhook_key`, a name, description, and an `active_version_id` pointing to the currently published version.
- **Workflow Version (`WorkflowVersion`):** An immutable snapshot of steps and connections. Only one version can be in status `PUBLISHED` at any time; drafts remain in status `DRAFT`.
- **Workflow Step (`WorkflowStep`):** A discrete computational node within a version, identified by a unique `step_key` (e.g. `ai_classify`, `crm_lead`). Contains a `step_type` and arbitrary configuration `config` (JSONB).
- **Step Types (`StepType`):**
  - `WEBHOOK_TRIGGER` / `MANUAL_TRIGGER`: Entry point node that supplies the initial `trigger_payload`.
  - `VALIDATE_DATA`: Validates payload schema fields.
  - `AI_CLASSIFICATION`: Categorizes input text using an AI provider and outputs structured metadata.
  - `CONDITION`: Evaluates deterministic business rules against accumulated step data.
  - `HUMAN_APPROVAL`: Halts execution and awaits authorized human review.
  - `MOCK_CRM_CREATE`: Creates a lead or contact in the CRM integration.
  - `SLACK_NOTIFICATION`: Posts formatted messages to a designated Slack channel.
- **Workflow Connection (`WorkflowConnection`):** A directed edge between `source_step_id` and `target_step_id`. May include an optional `condition_label` (e.g. `"true"`, `"false"`, `"approved"`, `"rejected"`).
- **Execution Run (`WorkflowRun`):** An instantiated execution of a published workflow version. Tracks overall state (`PENDING`, `RUNNING`, `PAUSED`, `COMPLETED`, `FAILED`, `CANCELLED`), correlation ID, and execution duration.
- **Execution Step Run (`WorkflowStepRun`):** A record of a discrete step's execution within a run. Stores exact `input_data`, `output_data`, `execution_time_ms`, and `error_message`.
- **Approval Request (`ApprovalRequest`):** Created when an execution encounters a `HUMAN_APPROVAL` step. Stores state (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`), reviewer identity, and audit comment.
- **Integration (`Integration`):** Stored third-party connection credentials encrypted at rest with AES-256-GCM.

---

## 10. WORKFLOW ENGINE

The engine (`app/engine/workflow_engine.py`) is an in-process, stateful DAG execution orchestrator.

### Execution Sequence Breakdown:
1. **Pre-Execution Validation (`execute_new_run`):**
   - Validates workflow exists, belongs to tenant, has `status == "ACTIVE"`, and has a `PUBLISHED` active version.
   - Runs `validate_workflow_dag()` to ensure the graph contains no cycles, has a single trigger, and has reachable terminal steps.
   - Inserts `WorkflowRun` in status `RUNNING`.
   - Records `execution.started` in `audit_logs`.
2. **Topological Traversal Loop (`_run_dag_traversal`):**
   - Hydrates graph nodes and edges into memory structures (`parent_step_ids`, `incoming_edges`, `outgoing_edges`).
   - Identifies "Ready Nodes": nodes in `PENDING` state whose parent steps have all reached terminal states (`COMPLETED` or `SKIPPED`).
   - **OR-Convergence Rule:** A ready node is executed if **at least one** incoming edge from its parents is `active`. If all incoming edges are inactive, the node is marked `SKIPPED` and not executed.
3. **Step Transaction Isolation:**
   - Opens an isolated database transaction to create a `WorkflowStepRun` in status `RUNNING`.
   - Resolves the step's registered executor from `STEP_EXECUTOR_REGISTRY` in `app/engine/registry.py`.
   - Executes `executor.execute(context)` asynchronously under an `asyncio.wait_for` timeout (default 30 seconds).
4. **Step Result Handling:**
   - **FAILED:** Sets step run and workflow run to `FAILED`. Emits `execution.failed` audit log and halts engine traversal.
   - **PAUSED (Human Approval):**
     - Sets `WorkflowRun.status = "PAUSED"`.
     - Acquires row lock and inserts `ApprovalRequest` in status `PENDING`.
     - Emits `approval.requested` audit log and exits traversal cleanly.
   - **COMPLETED:**
     - Persists `output_data` to `WorkflowStepRun` and sets status `COMPLETED`.
     - Accumulates step output in `workflow_data[step_key]`.
     - If AI tokens were consumed, writes a `UsageRecord`.
     - Activates outgoing edges matching the step's `selected_branch` (e.g. condition `"true"` or approval `"approved"`).
5. **Resumption (`resume_run`):**
   - Acquires PostgreSQL row locks (`with_for_update()`) on both `WorkflowRun` and `ApprovalRequest`.
   - Resolves approval status (`APPROVED` or `REJECTED`).
   - If approved, marks the `HUMAN_APPROVAL` step run `COMPLETED` and re-enters `_run_dag_traversal`.

---

## 11. WEBHOOK FLOW

FlowPilot supports both public ingestion endpoints (`/api/v1/webhooks/{webhook_key}`) and tenant-scoped ingestion endpoints (`/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook`).

```text
External System (HTTP POST)
    |
    | Headers: X-Webhook-Signature, X-Webhook-Timestamp, Idempotency-Key
    v
app/routers/webhooks.py :: handle_public_webhook()
    |
    +---> Rate Limiting: public_webhook_rate_limiter() (Redis sliding-window)
    |
    +---> validate_payload_size(raw_body): Enforces 64KB maximum (HTTP 413)
    |
    +---> Resolve Workflow & Active Version: Status must be ACTIVE and PUBLISHED
    |
    +---> verify_timestamp(ts): Enforces 300s window to prevent replay attacks (HTTP 401)
    |
    +---> verify_hmac_signature(): HMAC-SHA256(secret_token, ts + "." + body)
    |     Constant-time comparison via hmac.compare_digest() (HTTP 401)
    |
    +---> get_or_create_idempotent_run():
    |     PostgreSQL nested transaction savepoint (session.begin_nested())
    |     Winning request -> is_winner = True, is_idempotent = False
    |     Duplicate request -> is_winner = False, is_idempotent = True
    |
    +---> Execution Ownership Guarantee:
          |
          +---> IF async_dispatch == True:
          |        Returns HTTP 202 Accepted
          |        Only winner dispatches Celery task: execute_workflow_run.delay(...)
          |
          +---> IF async_dispatch == False:
                   Returns HTTP 200 OK
                   Only winner invokes WorkflowEngine.execute_run_dag(...) inline
```

---

## 12. IDEMPOTENCY

### Why does Idempotency exist?
In distributed systems, external webhooks (e.g. payment confirmations, lead notifications) frequently retry upon network latency or timeout. Without idempotency, duplicate webhook delivery causes duplicate downstream charges, duplicate CRM records, and corrupted analytics.

### Implementation Details (`app/services/webhook_service.py`):
1. **Scoped Idempotency Key:**
   ```python
   scoped_key = f"{operation_scope}:{workflow_id}:{client_idempotency_key}"
   ```
2. **PostgreSQL Atomic Concurrency via Nested Savepoints:**
   ```python
   async with session.begin_nested():
       new_run = WorkflowRun(...)
       session.add(new_run)
       await session.flush()

       idemp_rec = IdempotencyRecord(
           organization_id=organization_id,
           idempotency_key=scoped_key,
           workflow_run_id=new_run.id,
           expires_at=utc_now() + timedelta(hours=24),
       )
       session.add(idemp_rec)
       await session.flush()
   ```
3. **Execution Ownership Guarantee:**
   - If two requests with the same `Idempotency-Key` hit the server simultaneously, PostgreSQL's unique index on `(organization_id, idempotency_key)` raises an `IntegrityError` on the second transaction.
   - The second transaction rolls back to the savepoint cleanly, queries the winning record, and returns `is_winner = False, is_idempotent = True`.
   - **Crucial Rule:** The losing duplicate request NEVER initiates DAG traversal. If the winning run previously failed, duplicates receive `status: "FAILED"` without triggering re-execution.

---

## 13. CELERY + REDIS

### The Role of Redis:
1. **Message Broker for Celery:** Provides FIFO queues (`default`, `workflows`, `webhooks`, `maintenance`).
2. **Celery Result Backend:** Temporarily stores asynchronous task completion status.
3. **JWT Revocation Blacklist:** Tracks revoked token JTIs until their natural expiration.
4. **Sliding-Window Rate Limiter:** Enforces per-IP and per-tenant rate limits.

### The Role of Celery (`app/workers/celery_app.py` & `tasks.py`):
- Offloads long-running, multi-step workflow executions from FastAPI request threads.
- Enables webhook endpoints to return immediate `202 Accepted` responses.
- Handles graceful retries for transient infrastructure failures (`OperationalError`, `RedisError`, `httpx.RequestError`).

### Task Execution Architecture:
```text
FastAPI Route / Endpoint
    |
    | execute_workflow_run.delay(org_id, run_id, version_id, payload)
    v
Redis Queue: 'workflows'
    |
    v
Celery Worker Process (celery -A app.workers.celery_app worker -Q workflows)
    |
    v
tasks.py :: execute_workflow_run(self, ...)
    |
    v
tasks.py :: run_coroutine_sync(_async_execute_workflow_run(...))
    |
    +---> get_worker_session_maker(): Creates isolated NullPool async database session
    |
    +---> WorkflowEngine(session_factory=session_maker).execute_run_dag(...)
    |
    +---> On Transient Error: autoretry_for=(OperationalError, RedisError, RequestError)
          Exponential backoff with jitter up to max_retries=3
```

---

## 14. AI CLASSIFICATION

FlowPilot separates AI intelligence from business logic via a strict provider abstraction layer (`app/services/ai/`).

```text
WorkflowEngine Step Execution
    |
    v
executors.py :: AIClassificationExecutor
    |
    v
app/services/ai/factory.py :: AIProviderFactory.get_provider(provider_type)
    |
    +---> MockAIProvider (Testing mock with rule-based heuristics)
    +---> OpenAIProvider (Calls OpenAI gpt-4o / gpt-3.5 with JSON mode)
    +---> AnthropicProvider (Calls Anthropic claude-3 with system prompts)
    |
    v
BaseAIProvider.classify() -> Returns normalized AIProviderResponse:
    - raw_output: str
    - prompt_tokens: int, completion_tokens: int, total_tokens: int
    - provider: str, model: str, latency_ms: int
    |
    v
service.py :: extract_json_payload()
    - Uses regex parsing to extract JSON blocks
    - Strictly forbids eval() or exec()
    |
    v
Pydantic Schema Validation :: LeadClassificationResult
    - category: str (validated against allowed candidate categories)
    - confidence: float (0.0 to 1.0)
    - reasoning: str
    |
    +---> IF Provider Fails (Network / API Error / Timeout):
          service.py :: DeterministicFallbackClassifier.classify()
          Executes deterministic keyword scoring as an in-process production fallback
    |
    v
WorkflowStepRun.output_data = validated_result
UsageRecord inserted in PostgreSQL tracking consumed tokens
```

---

## 15. DETERMINISTIC RULES

### Why Business Rules Exist Separately from AI:
AI models are non-deterministic, probabilistic, and vulnerable to prompt drifting. Core enterprise compliance (e.g., "deals over $50,000 must require VP approval") cannot be entrusted to probabilistic models. FlowPilot enforces deterministic policy gating via `app/engine/condition_evaluator.py`.

### Real Code Example:
```json
{
  "step_key": "eval_enterprise",
  "step_type": "CONDITION",
  "name": "Check Enterprise Lead",
  "config": {
    "logic": "AND",
    "conditions": [
      {
        "field": "ai_classify.category",
        "operator": "equals",
        "value": "enterprise"
      }
    ]
  }
}
```

### Evaluation Mechanism:
1. **Dot-Notation Path Traversal (`resolve_context_path`):** Resolves `ai_classify.category` by looking up the output dictionary of upstream completed step `ai_classify`.
2. **Type-Safe Evaluation:** Evaluates operators (`equals`, `not_equals`, `greater_than`, `less_than`, `contains`, `is_empty`, `is_not_empty`) using strict type coercion and scalar-safe checks.
3. **Branch Selection:** If rule passes, sets `selected_branch = "true"`; otherwise `selected_branch = "false"`.
4. **Edge Activation:** In `WorkflowEngine._run_dag_traversal`, only outgoing edges with `condition_label == selected_branch` are activated.

---

## 16. HUMAN APPROVAL

When high-stakes actions are required, FlowPilot suspends execution and transfers control to authorized human operators.

```text
Topological Traversal encounters HUMAN_APPROVAL step
    |
    v
executors.py :: HumanApprovalExecutor returns:
StepExecutionResult(status="PAUSED", requires_approval=True)
    |
    v
WorkflowEngine._run_dag_traversal:
    - Sets WorkflowRun.status = "PAUSED"
    - Inserts ApprovalRequest in status "PENDING" with payload_snapshot
    - Emits AuditLog action="approval.requested"
    - Traversal exits cleanly; request unblocks
    |
    v
Human Operator opens Approvals UI (/approvals)
    - GET /api/v1/organizations/{org_id}/approvals?status=PENDING
    - Reviews approval context snapshot (company, AI category, lead score)
    |
    v
Approver clicks [Approve]
    - POST /api/v1/organizations/{org_id}/approvals/{id}/approve
    - app/routers/approvals.py validates caller role meets approver_role level
    |
    v
WorkflowEngine.resume_run():
    1. Acquires PostgreSQL row lock: SELECT * FROM workflow_runs WHERE id = :run_id FOR UPDATE
    2. Acquires row lock: SELECT * FROM approval_requests WHERE id = :id FOR UPDATE
    3. Lazy expiration check: If created_at + timeout_hours < now, marks EXPIRED
    4. Transitions ApprovalRequest.status = "APPROVED"
    5. Emits AuditLog action="approval.approved"
    6. Initiates DAG traversal resuming from downstream steps
```

---

## 17. INTEGRATIONS

FlowPilot manages third-party external integrations (`app/services/crm/`, `app/services/slack/`) with rigorous enterprise security controls:

### 1. Credentials Encryption at Rest (`app/core/encryption.py`):
- All integration secrets, webhooks, and API keys are encrypted at rest using AES-256-GCM.
- Each encrypted payload includes a 12-byte cryptographically random initialization vector (nonce) and a 16-byte authentication tag preventing ciphertext tampering.
- On startup, `validate_production_key()` ensures that production environments never run with default development encryption keys.

### 2. SSRF (Server-Side Request Forgery) Egress Protection (`app/core/ssrf.py`):
- Every outbound integration webhook or API URL is passed through `validate_url_target()`.
- Resolves DNS hostname to IP address.
- Blocks requests targeting:
  - Private RFC 1918 networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Loopback addresses (`127.0.0.1`, `::1`)
  - Link-local ranges (`169.254.0.0/16`, `fe80::/10`)
  - IPv4-mapped IPv6 addresses
  - Cloud Instance Metadata services (`169.254.169.254`, `metadata.google.internal`)

### 3. Execution & Result Snapshotting:
- Integration calls (`MockCRMService`, `SlackService`) execute within dedicated step transactions.
- Raw outputs are passed through `sanitize_payload()` to redact sensitive authorization headers before storage in `WorkflowStepRun.output_data`.

---

## 18. EXECUTION HISTORY

Execution history is persisted across two relational tables:

1. **`workflow_runs`:**
   - `id`: Unique UUID for the execution.
   - `organization_id`: Tenant identifier.
   - `workflow_id` & `workflow_version_id`: Provenance linking to the exact workflow version executed.
   - `status`: State lifecycle: `PENDING` -> `RUNNING` -> (`PAUSED` -> `RUNNING`) -> `COMPLETED` / `FAILED` / `CANCELLED`.
   - `trigger_type`: `WEBHOOK` or `MANUAL`.
   - `trigger_payload`: Sanitized JSON payload initiating the run.
   - `correlation_id`: Trace identifier propagated across Celery workers and audit logs.
   - `started_at` & `completed_at`: Timestamps used to calculate execution latency.
2. **`workflow_step_runs`:**
   - Tracks the discrete execution of each node in the DAG.
   - Stores `input_data`, `output_data`, `status` (`RUNNING`, `COMPLETED`, `FAILED`, `PAUSED`, `SKIPPED`), `execution_time_ms`, and `error_message`.

### Frontend Retrieval & Visualization:
- `frontend/src/pages/executions/ExecutionsPage.tsx` queries `/api/v1/organizations/{org_id}/runs`.
- Selecting an execution renders the chronological execution timeline, displaying step badges, latency, inputs, and outputs.

---

## 19. AUDIT LOGGING

### What creates an audit event?
Audit events are emitted immutably whenever state changes occur:
- `execution.started`: Run created and initiated.
- `execution.completed`: Run successfully finished all steps.
- `execution.failed`: Step or run failed with an error.
- `approval.requested`: Run paused awaiting human review.
- `approval.approved` / `approval.rejected`: Approver resolved an approval gate.
- `workflow.created` / `workflow.published`: Administrative workflow configuration change.

### Data Recorded in `audit_logs`:
- `id`: UUID primary key.
- `organization_id`: Tenant scope.
- `user_id`: Actor identity (null for automated webhook/system actions).
- `action`: Canonical event name (e.g. `approval.approved`).
- `resource_type`: Entity type (`workflow_run`, `approval_request`, `workflow`).
- `resource_id`: Target entity UUID.
- `details`: JSONB payload snapshot.

### Secret Sanitization (`app/engine/sanitizer.py`):
Before logging, all dictionaries are recursively sanitized. Keys matching `password`, `secret`, `token`, `authorization`, `api_key`, `key` are replaced with `"[REDACTED]"`.

---

## 20. ANALYTICS + SLA

Analytics and SLA metrics are computed directly by `AnalyticsService` (`app/services/analytics_service.py`) via optimized, single-pass PostgreSQL SQL queries:

### Core Performance Aggregations:
```sql
SELECT
    COUNT(*) FILTER (WHERE r.status IN ('SUCCESS', 'COMPLETED')) AS success_count,
    COUNT(*) FILTER (WHERE r.status = 'FAILED') AS failed_count,
    COUNT(*) FILTER (WHERE r.status = 'RUNNING') AS running_count,
    COALESCE(AVG(EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0), 0.0) AS avg_duration_ms,
    COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0), 0.0) AS p50_duration_ms,
    COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0), 0.0) AS p95_duration_ms,
    COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0), 0.0) AS p99_duration_ms
FROM workflow_runs r
WHERE r.organization_id = :org_id
  AND r.started_at >= :start_dt
  AND r.started_at < :end_dt;
```

### SLA Compliance Calculations:
- Each workflow version defines `sla_target_seconds` (e.g., 60 seconds) and `sla_warning_threshold_seconds` (e.g., 45 seconds).
- `AnalyticsService` computes SLA compliance rate:
  $$\text{SLA Compliance (\%)} = \frac{\text{Runs Completed Within Target Seconds}}{\text{Total Completed Runs}} \times 100$$
- Visualized in `frontend/src/pages/analytics/AnalyticsPage.tsx` with latency distribution curves, SLA violation warnings, and time-series volume charts.
