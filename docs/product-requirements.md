# FlowPilot: Product Requirements Document (PRD)

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **Product Tier** | B2B SaaS Workflow Automation & Integration |
| **Target Audience** | Enterprise Operations, RevOps, Sales Engineering, Product Teams |

---

## 1. Executive Summary & Vision

### 1.1 Problem Statement
Modern B2B enterprises operate on a complex mosaic of software tools: CRM systems, email clients, communication workspaces (Slack, Teams), document signing, and internal databases. While specialized software excels within its vertical, inter-application workflows remain deeply fragmented:
- Sales reps manually qualify and copy lead data between webhook forms, spreadsheets, and CRMs.
- Routine notifications spam channels without prioritized context or classification.
- High-value deals stall waiting for manual manager sign-offs without a unified approval queue.
- Custom internal scripts built to automate these workflows lack observability, audit trails, error recovery, and security governance.

### 1.2 Product Vision
**FlowPilot** is an AI-powered B2B business integration and automation SaaS platform. FlowPilot acts as the intelligent orchestration fabric across existing business software:
- Ingesting events in real-time via high-throughput webhooks.
- Extracting semantic insights and categorizing unstructured data via schema-constrained AI.
- Enforcing deterministic enterprise business rules without unvetted AI hallucinations.
- Orchestrating actions across CRMs, messaging platforms, and internal services.
- Providing human-in-the-loop approval workflows for mission-critical actions.
- Ensuring end-to-end multi-tenant isolation, idempotency, and audit compliance.

FlowPilot does **not** seek to replace CRMs (Salesforce, HubSpot), ERPs (SAP, NetSuite), or communication tools (Slack, Teams), but rather multiplies their value through seamless, resilient orchestration.

---

## 2. Target Personas

| Persona | Role & Objectives | Key Pain Points |
|---|---|---|
| **RevOps Director** ("Elena") | Oversees lead routing, sales SLA, and data hygiene across HubSpot, CRM, and Slack. | Inconsistent data entry, leads delayed in intake queues, lack of visibility into lead qualification logic. |
| **Automation Engineer** ("Marcus") | Builds integration workflows, connects webhooks, configures business rules. | Fragile custom glue scripts, hardcoded API tokens, lack of retry mechanisms and dead-letter queues. |
| **Sales Operations Manager** ("David") | Approves high-value accounts, reviews enterprise discounts, handles tier-1 routing. | Scattered approval requests across emails and Slack; no centralized status or audit log of approvals. |
| **Security & Compliance Officer** ("Sarah") | Audits vendor security, tenant data boundaries, and API access logs. | Concerns over uncontrolled LLMs executing arbitrary actions, data leakage across tenants, and missing audit trails. |

---

## 3. Initial MVP Scope: Sales Lead Automation

The MVP demonstrates the complete end-to-end capabilities of FlowPilot through a high-value enterprise workflow: **Sales Lead Automation**.

```
[Inbound Webhook] ──> Fast 202 ACK (<100ms)
       │
       ▼ (Asynchronous Queue)
[Pydantic Validation] ──> [AI Lead Classification] ──> [Deterministic Rule Engine]
                                                              │
                     ┌────────────────────────────────────────┴────────────────────────────────────────┐
                     ▼                                                                                 ▼
             [Priority: STANDARD]                                                              [Priority: HIGH]
                     │                                                                                 │
          [Mock CRM Lead Creation]                                                             [Human Approval Step]
                     │                                                                                 │
          [Slack Channel Notification]                                                ┌────────────────┴────────────────┐
                     │                                                                ▼                                 ▼
              [Run Completed]                                                     [Approved]                        [Rejected]
                                                                                      │                                 │
                                                                           [Mock CRM Lead Creation]             [Slack Alert: Rejected]
                                                                                      │                                 │
                                                                           [Slack Channel Notification]          [Run Completed]
```

### Detailed MVP Execution Flow
1. **Webhook Reception**: An external form or landing page emits an HTTP POST event with lead attributes:
   ```json
   {
     "event_id": "lead_evt_88921",
     "name": "Alex Rivera",
     "email": "alex.rivera@enterprisecorp.com",
     "company": "Enterprise Corp",
     "employee_count": 450,
     "message": "We are seeking an enterprise automation platform for 500 team members with SLA guarantees."
   }
   ```
2. **Fast Ingestion & Acknowledgement**:
   - Webhook URL contains a tenant-isolated key: `/api/v1/webhooks/{webhook_key}`.
   - Endpoint verifies the key and computes an idempotency hash of `event_id` in Redis.
   - Database creates a `workflow_runs` record in `PENDING` state.
   - Endpoint enqueues the execution task into Redis/Celery and returns **HTTP 202 Accepted** in **< 100ms** with payload:
     ```json
     {
       "run_id": "run_01j7xyz89...",
       "status": "QUEUED",
       "correlation_id": "corr_7721...",
       "received_at": "2026-09-19T11:24:00Z"
     }
     ```
3. **Pydantic Validation**:
   - Worker picks up the job.
   - Validates email format, positive employee counts, non-empty company string.
   - Sanitizes text inputs to prevent prompt injection or script injection.
4. **AI Lead Classification**:
   - Calls the configured AI Provider (OpenAI/Anthropic/Mock) with strict system instructions and structured JSON output.
   - Validates the response against the Pydantic schema:
     - `lead_category`: `enterprise` | `mid_market` | `smb` | `spam`
     - `priority`: `high` | `medium` | `low`
     - `confidence`: float between `0.0` and `1.0`
     - `reason`: concise string explanation
5. **Deterministic Rule Engine**:
   - Applies deterministic customer-configured rules:
     - `IF employee_count >= 100 THEN priority = high`
     - `IF priority == high THEN require_human_approval = true`
   - Rules override or validate AI classification to prevent unpredictable decision making.
6. **Conditional Branching & Human Approval**:
   - If `priority == high`:
     - Creates an `approval_requests` entry linked to the run.
     - Sets run status to `WAITING_FOR_APPROVAL`.
     - Sends an alert to the Approvers' Slack channel with one-click review details.
     - Halts workflow step execution until an authorized user approves or rejects via the dashboard API.
   - If `priority != high`:
     - Immediately proceeds to step 7.
7. **Mock CRM Action**:
   - Calls the Mock CRM client to persist the lead record with enriched AI metadata.
   - Stores the CRM lead ID and response payload in the step execution history.
8. **Slack Notification**:
   - Posts a rich message block to the target Slack channel detailing the lead, category, priority, and CRM link.
9. **Full Observability & Audit**:
   - Finalizes the `workflow_runs` record with `SUCCESS`, recording execution duration, token count, and step logs.

---

## 4. Functional Requirements

### FR-01: Multi-Tenancy & Access Control
- **Organizations**: Every user belongs to one or more Organizations. All data (workflows, runs, integrations, approvals) must be strictly partitioned by `organization_id`.
- **RBAC**: Enforce 5 standard roles:
  - `OWNER`: Full administrative, billing, and organizational authority.
  - `ADMIN`: Manages team memberships, integrations, and global workflow settings.
  - `MANAGER`: Can approve/reject human approval requests and publish workflows.
  - `OPERATOR`: Can trigger runs, retry failed runs, and inspect executions.
  - `VIEWER`: Read-only access to dashboards, logs, and analytics.

### FR-02: Workflow Management
- Users can create, update, duplicate, pause, activate, archive, and delete workflows.
- Workflows support versioning (`workflow_versions`). Publishing creates an immutable active snapshot.
- Workflows must undergo structural DAG validation (cycle check, required input mapping, valid connections) before transition to `ACTIVE`.

### FR-03: Webhook Ingestion & Idempotency
- Each workflow trigger generates a unique, cryptographically random `webhook_key`.
- Webhooks must deduplicate incoming payloads based on `event_id` or body hash within a 24-hour sliding window.
- **Latency Requirement**: The webhook intake endpoint must respond within **< 100-200ms** with `202 Accepted`. Background Celery workers process the execution graph asynchronously.

### FR-04: AI Boundary & Guardrails
- AI services must only output structured JSON matching a Pydantic schema.
- System must enforce strict request timeouts (default: 15s) and token limits.
- System must track token usage (`prompt_tokens`, `completion_tokens`) for billing and cost auditing.
- Fallback policies must trigger if the AI provider fails (e.g., fallback to rule-based defaults or fail gracefully).
- **Zero Unrestricted Actions**: The LLM is never given tool-use permissions to call arbitrary APIs directly.

### FR-05: Deterministic Business Rule Engine
- Evaluates logical expressions on step outputs: `==`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `CONTAINS`, `AND`, `OR`.
- Rules are evaluated safely without using `eval()` or Python dynamic code execution.

### FR-06: Human-in-the-Loop Approvals
- Workflows can be suspended in state `WAITING_FOR_APPROVAL`.
- Approvers receive notification with context and reason for approval.
- An authorized user can approve or reject with comments via `/api/v1/approvals/{id}/approve`.
- On approval, the Celery worker resumes downstream steps from the suspended node.

### FR-07: Integrations Abstraction
- Unified `BaseIntegration` interface for third-party systems.
- Credentials must be stored with AES-256-GCM encryption.
- Initial integrations: Webhook, Mock CRM, Slack.

### FR-08: Execution Observability & Audit Logs
- Every run stores: start time, end time, status, duration, trigger payload, error details, correlation ID.
- Each step within a run stores its individual input, output, duration, and error trace.
- Audit logs capture all administrative actions (workflow changes, role modifications, credential updates).

---

## 5. Non-Functional Requirements (NFRs)

| Metric | Target | Verification Method |
|---|---|---|
| **Webhook Response Latency** | p99 < 100ms | Load testing webhook receiver under 500 RPS |
| **Workflow Run Concurrency** | 100+ concurrent workers | Celery worker scale testing with Redis broker |
| **Tenant Isolation** | 100% data separation | Security unit tests attempting cross-tenant queries |
| **API Availability** | 99.9% uptime SLA | Docker container healthchecks and automated monitoring |
| **Credential Security** | AES-256-GCM at rest | Automated secret scanning and encryption tests |
| **Browser Compatibility** | Chrome, Edge, Safari, Firefox | Responsive Vite/React layout validation |
