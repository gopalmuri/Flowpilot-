# FlowPilot — Complete User Flow & Operational Journey

> **Step-by-Step Operator, Approver, and Auditor Journey Map**  
> *Release Candidate (RC-1.0) Execution Manual*

---

## 1. Journey Architecture Overview

The FlowPilot journey spans three distinct operational phases:

```
[Phase 1: Onboarding & Setup]
Landing Page (/) ──► Registration (/register) ──► Login (/login) ──► Dashboard (/dashboard)

[Phase 2: Workflow Engineering & Publishing]
Workflow Catalog (/workflows) ──► Visual Builder (/workflows/:id/editor) ──► Validate ──► SLA Config ──► Publish

[Phase 3: Runtime Execution & Governance]
Inbound Webhook ──► AI Extraction ──► Rule Evaluation ──► Approval Pause (/approvals) ──► Dispatch ──► Audit & Analytics
```

---

## 2. Step-by-Step Walkthrough

### Step 1: Public Discovery & Exploration
- **URL**: `http://localhost:5173/`
- **User Action**: The visitor reviews the value proposition, watches the live 9-stage workflow execution loop in the hero, explores the interactive scenario switcher (*Enterprise Lead*, *High-Risk Refund*, *Production Access*), and verifies security credentials.
- **Next Transition**: Clicks **Get Started** or **Sign In** in the navigation bar.

### Step 2: User Registration & Organization Provisioning
- **URL**: `/register`
- **API Endpoint**: `POST /api/v1/auth/register`
- **Parameters**: `full_name`, `email`, `password`.
- **System Action**: 
  - Validates password complexity (minimum 8 characters, upper, lower, number, special character).
  - Hashes credentials with Argon2 / BCrypt.
  - Generates a root user account.
  - Automatically provisions the default tenant organization.
  - Emits an initial audit log entry (`user.registered`).

### Step 3: Secure Operator Authentication
- **URL**: `/login`
- **API Endpoint**: `POST /api/v1/auth/login`
- **System Action**:
  - Issues signed JWT access token containing `sub` (User UUID), `org_id` (Active Tenant), and `role` (`OWNER`).
  - Sets secure, HttpOnly, SameSite cookies.
  - Directs operator to the central control plane dashboard.

### Step 4: Executive Dashboard
- **URL**: `/dashboard`
- **Key Visuals**:
  - Organization Badge: Active tenant indicator (*Acme RC Systems*) and verified role (*OWNER*).
  - KPI Metrics Cards: *Active Workflows*, *In-Flight Executions*, *Pending Approvals*, *Failed Runs*, and *SLA Compliance Rate*.
  - Attention Required Banners: Direct alerts when pending approvals or SLA warning thresholds require immediate human intervention.

### Step 5: Workflow Catalog & Creation
- **URL**: `/workflows`
- **API Endpoint**: `POST /api/v1/organizations/{org_id}/workflows`
- **User Action**:
  - Clicks **New Workflow**.
  - Inputs workflow title (e.g. `Enterprise Lead Intake Pipeline`) and optional description.
  - System initializes Workflow entity and creates draft version `v1` in `DRAFT` status.

### Step 6: Visual Directed Acyclic Graph (DAG) Configuration
- **URL**: `/workflows/:id/editor`
- **Canvas Operations**:
  - Drag and drop step nodes onto the canvas or configure pipeline steps:
    1. `WEBHOOK_TRIGGER` (Inbound HTTP POST ingest)
    2. `AI_CLASSIFICATION` (Semantic category and entity parsing)
    3. `CONDITION` (Deterministic boolean logic rules)
    4. `HUMAN_APPROVAL` (Sign-off gate assigned to role)
    5. `MOCK_CRM_CREATE` (Downstream lead creation)
    6. `SLACK_NOTIFICATION` (Downstream team alert dispatch)
  - Connect step handles to establish execution dependency order.
  - Configure node parameters in the configuration drawer.

### Step 7: Authoritative DAG Validation
- **Action**: Operator clicks **Validate Workflow**.
- **API Endpoint**: `POST /api/v1/organizations/{org_id}/workflows/{id}/versions/{version_id}/validate`
- **Validation Rules Checked**:
  - Exactly one trigger step exists as the root node.
  - Graph is strictly acyclic (no infinite loops).
  - All nodes have valid paths leading to terminal states.
  - Node parameters satisfy required schemas.

### Step 8: Operational SLA Configuration
- **Action**: Operator clicks **Configure SLA**.
- **API Endpoint**: `PUT /api/v1/organizations/{org_id}/workflows/{id}/versions/{version_id}/sla`
- **Parameters**: `target_seconds` (e.g. 900s / 15m), `warning_threshold_seconds` (e.g. 600s / 10m), `enabled: true`.

### Step 9: Production Publishing
- **Action**: Operator clicks **Publish Version**.
- **API Endpoint**: `POST /api/v1/organizations/{org_id}/workflows/{id}/versions/{version_id}/publish`
- **System Action**:
  - Freezes draft version into immutable `PUBLISHED` state.
  - Generates unique tenant `webhook_key` and cryptographically secure secret token.
  - Retires previous published version to `ARCHIVED`.

### Step 10: Inbound Business Request Ingestion
- **Trigger**: External system dispatches webhook.
- **Endpoint**: `POST /api/v1/webhooks/{webhook_key}`
- **Security Headers**:
  - `X-Webhook-Timestamp`: Unix timestamp (verified within 300s window).
  - `X-Webhook-Signature`: HMAC-SHA256 hex digest computed with webhook secret token.
  - `Idempotency-Key`: Unique UUID ensuring zero duplicate executions.
- **System Response**: Status `200 OK` returning `workflow_run_id` and initial status `PENDING`.

### Step 11: Automated Pipeline Processing & Approval Pause
- **Execution Engine**:
  - Trigger step completes: status $\rightarrow$ `RUNNING`.
  - AI Classification parses payload: extracts `{ company: "Acme Corp", seats: 500, value: 50000 }`.
  - Condition gate checks `seats >= 250 AND value > 25000` $\rightarrow$ evaluates to `TRUE`.
  - Workflow enters Human Approval step: execution engine automatically sets run status to `PAUSED` / `WAITING_APPROVAL`.
  - Pending approval record created with expiration timer.

### Step 12: Human-in-the-Loop Sign-off
- **URL**: `/approvals`
- **User Action**:
  - Manager opens pending approval card.
  - Inspects inbound request payload, AI extraction scores, and rule match criteria.
  - Enters mandatory resolution note: *"Verified Acme Corp enterprise credentials. Approved for CRM sync."*
  - Clicks **Approve**.
- **API Endpoint**: `POST /api/v1/organizations/{org_id}/approvals/{approval_id}/approve`
- **System Action**: Sets approval status to `APPROVED`, records approver identity, and triggers Celery task resumption.

### Step 13: Downstream Dispatch & Terminal Completion
- **Execution Engine**:
  - Resumes execution on authorized branch.
  - Dispatches `MOCK_CRM_CREATE`: Lead record `#8819` generated with `$50,000` ARR value.
  - Dispatches `SLACK_NOTIFICATION`: Alert card posted to `#enterprise-wins`.
  - Sets run status to `COMPLETED`.
  - Appends SHA-256 tamper-evident record to PostgreSQL audit table.
  - Records duration telemetry against the SLA target.

### Step 14: Execution History & Telemetry Inspection
- **URL**: `/executions`
- **Operator Action**:
  - Locates `workflow_run_id` in the execution telemetry table.
  - Opens detail drawer to view execution graph, step latencies, input/output JSON payloads, and SLA indicator (*Completed in 84ms — Within Target*).

### Step 15: Compliance Audit Verification
- **URL**: `/audit-logs`
- **Auditor Action**:
  - Filters audit trail by resource `workflow_run` or action `approval.approved`.
  - Verifies cryptographic checksum, timestamps, and actor UUID.

### Step 16: Operational SLA & Analytics Review
- **URL**: `/analytics`
- **Executive Action**:
  - Reviews volume throughput, overall success rates (100%), P50/P95 latencies, and SLA health status (*Healthy: 100%, Warning: 0%, Breached: 0%*).

### Step 17: Session Termination
- **Action**: Operator clicks user avatar $\rightarrow$ **Sign Out**.
- **API Endpoint**: `POST /api/v1/auth/logout`
- **System Action**: Clears authentication tokens and redirects safely to `/login`.
