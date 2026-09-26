# FlowPilot: REST API Specification (v1)

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **Base URL** | `/api/v1` |
| **Protocol** | HTTPS / JSON / RFC 7807 Error Standard |

---

## 1. Global API Standards

### 1.1 Authentication & Organization Context
All protected endpoints require an HTTP `Authorization` header with a Bearer JWT:
```http
Authorization: Bearer <access_token>
```
To support users with memberships in multiple organizations, requests may include an optional tenant selector header:
```http
X-Organization-Id: <organization_uuid>
```
If omitted, the user's default/primary organization context is automatically resolved.

### 1.2 Standard Error Format (RFC 7807)
All error responses return a standardized JSON structure:
```json
{
  "type": "https://api.flowpilot.io/errors/validation-error",
  "title": "Invalid Request Parameters",
  "status": 422,
  "detail": "The 'email' field must be a valid email address.",
  "instance": "/api/v1/workflows",
  "correlation_id": "corr_01j7xyz89...",
  "timestamp": "2026-09-19T11:24:00Z",
  "errors": [
    {
      "field": "email",
      "message": "value is not a valid email address"
    }
  ]
}
```

### 1.3 Pagination Standards
All list endpoints support cursor-based or standard limit/offset pagination:
- `page` (default: 1)
- `page_size` (default: 20, max: 100)
- `sort_by` (e.g., `created_at`, `name`)
- `sort_order` (`asc` or `desc`)

---

## 2. Authentication & User Endpoints

### 2.1 Register New User
`POST /api/v1/auth/register`
- **Request Body**:
  ```json
  {
    "email": "sarah.chen@enterprise.com",
    "password": "SecurePassword123!",
    "full_name": "Sarah Chen",
    "organization_name": "Chen Enterprises"
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "user": {
      "id": "usr_9901...",
      "email": "sarah.chen@enterprise.com",
      "full_name": "Sarah Chen"
    },
    "organization": {
      "id": "org_7701...",
      "name": "Chen Enterprises",
      "role": "OWNER"
    },
    "tokens": {
      "access_token": "eyJhbGci...",
      "refresh_token": "dGhpcy1p...",
      "token_type": "bearer",
      "expires_in": 1800
    }
  }
  ```

### 2.2 Login
`POST /api/v1/auth/login`
- **Request Body**:
  ```json
  {
    "username": "sarah.chen@enterprise.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK)**: Access & Refresh tokens.

### 2.3 Refresh Token
`POST /api/v1/auth/refresh`
- **Request Body**: `{"refresh_token": "..."}`
- **Response (200 OK)**: New Access Token.

### 2.4 Get Current User Profile
`GET /api/v1/auth/me`
- **Response (200 OK)**: User profile, organizations list, and active permissions.

---

## 3. Webhook Ingestion API (Zero-Block Latency)

### 3.1 Ingest Webhook Event
`POST /api/v1/webhooks/{webhook_key}`

> [!IMPORTANT]
> This endpoint is engineered for **sub-100ms response latency**. It writes an idempotency marker, schedules the workflow run task in Celery, and immediately returns `202 Accepted`.

- **Headers**:
  ```http
  Content-Type: application/json
  X-Event-Id: evt_lead_12345 (optional deduplication header)
  ```
- **Request Body**: Arbitrary JSON payload (e.g., Sales Lead):
  ```json
  {
    "event_id": "lead_123",
    "name": "John Doe",
    "email": "john@example.com",
    "company": "Example Corp",
    "employee_count": 250,
    "message": "We need an enterprise software solution"
  }
  ```
- **Response (202 Accepted)**:
  ```json
  {
    "status": "ACCEPTED",
    "message": "Workflow execution queued asynchronously.",
    "run_id": "run_01j7x89q2...",
    "workflow_id": "wf_4401...",
    "correlation_id": "corr_9901...",
    "queued_at": "2026-09-19T11:24:00.102Z"
  }
  ```
- **Duplicate Event Response (200 OK)**:
  If the `event_id` was already ingested within the 24-hour TTL, returns the existing run reference without re-executing:
  ```json
  {
    "status": "DUPLICATE_IGNORED",
    "run_id": "run_01j7x89q2...",
    "message": "Event previously processed."
  }
  ```

---

## 4. Workflows API

### 4.1 List Workflows
`GET /api/v1/workflows`
- **Query Params**: `status`, `search`, `page`, `page_size`
- **Response (200 OK)**: Paginated array of workflow summaries.

### 4.2 Create Workflow Draft
`POST /api/v1/workflows`
- **Request Body**:
  ```json
  {
    "name": "Enterprise Sales Lead Router",
    "description": "Qualifies leads via AI and notifies Slack with manager approval"
  }
  ```
- **Response (201 Created)**: Workflow object with initial `DRAFT` status and generated `webhook_key`.

### 4.3 Update Workflow Canvas & Steps
`PUT /api/v1/workflows/{workflow_id}`
- **Request Body**:
  ```json
  {
    "name": "Enterprise Sales Lead Router",
    "steps": [
      {
        "step_key": "node_1",
        "step_type": "WEBHOOK_TRIGGER",
        "name": "Inbound Lead Webhook",
        "config": {},
        "ui_position": {"x": 100, "y": 100}
      },
      {
        "step_key": "node_2",
        "step_type": "AI_CLASSIFICATION",
        "name": "Classify Lead Priority",
        "config": {"model": "gpt-4o-mini", "timeout_seconds": 15},
        "ui_position": {"x": 100, "y": 250}
      }
    ],
    "connections": [
      {"source_step_key": "node_1", "target_step_key": "node_2"}
    ]
  }
  ```

### 4.4 Validate & Publish Workflow
`POST /api/v1/workflows/{workflow_id}/publish`
- Validates DAG completeness (no cycles, valid connections, required config fields).
- Creates an immutable `workflow_versions` record.
- Sets workflow status to `ACTIVE`.

### 4.5 Pause Workflow
`POST /api/v1/workflows/{workflow_id}/pause`
- Suspends webhook triggering and rejects new executions with `409 Conflict`.

---

## 5. Workflow Runs & Execution History

### 5.1 List Executions
`GET /api/v1/workflows/{workflow_id}/runs` or `GET /api/v1/runs`
- **Query Params**: `status`, `from_date`, `to_date`, `correlation_id`

### 5.2 Get Run Detail & Step Timeline
`GET /api/v1/runs/{run_id}`
- **Response (200 OK)**:
  ```json
  {
    "id": "run_01j7x89q2...",
    "workflow_id": "wf_4401...",
    "status": "SUCCESS",
    "started_at": "2026-09-19T11:24:00.105Z",
    "completed_at": "2026-09-19T11:24:03.420Z",
    "duration_ms": 3315,
    "trigger_payload": { ... },
    "steps": [
      {
        "step_key": "node_1",
        "name": "Inbound Lead Webhook",
        "status": "SUCCESS",
        "duration_ms": 12,
        "output_data": { "validated": true }
      },
      {
        "step_key": "node_2",
        "name": "Classify Lead Priority",
        "status": "SUCCESS",
        "duration_ms": 1420,
        "output_data": {
          "lead_category": "enterprise",
          "priority": "high",
          "confidence": 0.94,
          "reason": "Large employee base with enterprise requirements"
        }
      }
    ]
  }
  ```

### 5.3 Retry Failed Run
`POST /api/v1/runs/{run_id}/retry`
- Re-enqueues execution starting from the failed step or from beginning.

---

## 6. Approvals API

### 6.1 List Pending Approvals
`GET /api/v1/approvals`
- **Query Params**: `status=PENDING`
- **Permissions**: `MANAGER`, `ADMIN`, `OWNER`

### 6.2 Approve Request
`POST /api/v1/approvals/{approval_id}/approve`
- **Request Body**:
  ```json
  {
    "comment": "Verified enterprise account legitimacy with VP Sales"
  }
  ```
- Resumes the suspended workflow execution task in background Celery worker.

### 6.3 Reject Request
`POST /api/v1/approvals/{approval_id}/reject`
- **Request Body**: `{"comment": "Duplicate spam lead"}`
- Marks approval rejected and completes the run with status `CANCELLED` or routes to failure branch.

---

## 7. Integrations API

### 7.1 List Configured Integrations
`GET /api/v1/integrations`

### 7.2 Connect or Update Integration
`POST /api/v1/integrations`
- Encrypts credentials with AES-256-GCM before saving to PostgreSQL.

### 7.3 Test Integration Connection
`POST /api/v1/integrations/{integration_id}/test`
- Executes an active handshake with Slack or Mock CRM and returns latency and health status.

---

## 8. Audit Logs & System Health

### 8.1 Query Audit Logs
`GET /api/v1/audit-logs`
- **Query Params**: `resource_type`, `user_id`, `from_date`

### 8.2 Health Check Endpoint
`GET /api/v1/health`
- **Response (200 OK)**:
  ```json
  {
    "status": "healthy",
    "version": "1.0.0",
    "services": {
      "database": "connected",
      "redis": "connected",
      "celery_workers": 4
    },
    "timestamp": "2026-09-19T11:24:00Z"
  }
  ```
