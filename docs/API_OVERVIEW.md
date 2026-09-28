# FlowPilot — REST API Reference & Overview

> **Release Candidate (RC-1.0) API Contract Documentation**  
> *Interactive Swagger Documentation: http://localhost:8000/docs*  
> *ReDoc Specification: http://localhost:8000/redoc*

---

## 1. Global API Conventions

- **Base URL**: `/api/v1`
- **Protocol**: HTTPS (enforced via HSTS in production)
- **Data Format**: `Content-Type: application/json`
- **Authentication**: `Authorization: Bearer <jwt_access_token>`
- **Multi-Tenancy**: All protected endpoints require `{organization_id}` path parameter validated against caller's token claims.

### Standard Error Response Format
```json
{
  "detail": "Descriptive, safe error message without internal stack trace leakage"
}
```

---

## 2. Core Endpoint Summary

### 2.1 Authentication & Session Management
- `POST /api/v1/auth/register`: Create user account & provision tenant organization.
- `POST /api/v1/auth/login`: Authenticate credentials; returns signed JWT & sets secure cookie.
- `GET /api/v1/auth/me`: Retrieve authenticated user profile, roles, and organizations.
- `POST /api/v1/auth/logout`: Revoke active session tokens.

### 2.2 Organization Management
- `GET /api/v1/organizations`: List organizations for current user.
- `POST /api/v1/organizations`: Create a new enterprise tenant organization.
- `GET /api/v1/organizations/{org_id}`: Retrieve organization details.

### 2.3 Workflow Catalog & Versioning
- `GET /api/v1/organizations/{org_id}/workflows`: List workflows with status filters (`ACTIVE`, `DRAFT`, `ARCHIVED`).
- `POST /api/v1/organizations/{org_id}/workflows`: Create a new workflow root entity.
- `GET /api/v1/organizations/{org_id}/workflows/{wf_id}`: Retrieve workflow metadata and webhook key.
- `GET /api/v1/organizations/{org_id}/workflows/{wf_id}/versions`: List versions for workflow.
- `PUT /api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v_id}`: Update draft DAG steps & connections.
- `POST /api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v_id}/validate`: Authoritatively validate DAG integrity.
- `PUT /api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v_id}/sla`: Configure SLA duration & warning thresholds.
- `POST /api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v_id}/publish`: Publish draft version to production.

### 2.4 Inbound Webhook Ingestion (Public Ingest)
- `POST /api/v1/webhooks/{webhook_key}`: Ingest external business event.
  - **Required Headers**:
    - `X-Webhook-Timestamp`: Unix timestamp (verified within 300s window).
    - `X-Webhook-Signature`: HMAC-SHA256 hex signature computed with secret token.
    - `Idempotency-Key`: Optional client UUID preventing duplicate execution.
  - **Status 200 Response**:
    ```json
    {
      "status": "accepted",
      "workflow_run_id": "9f82d1c0-b3e1-4c7a-a551-88f910b284c1",
      "correlation_id": "corr_88192a01",
      "idempotency_key": "idem_49102"
    }
    ```

### 2.5 Execution Telemetry & Runs
- `GET /api/v1/organizations/{org_id}/runs`: Query execution history with pagination and status filters.
- `GET /api/v1/organizations/{org_id}/runs/{run_id}`: Retrieve run detail, step-level latencies, and output payloads.
- `POST /api/v1/organizations/{org_id}/runs/{run_id}/cancel`: In-flight execution cancellation.

### 2.6 Human Approval Inbox
- `GET /api/v1/organizations/{org_id}/approvals`: List pending approvals or resolution history.
- `POST /api/v1/organizations/{org_id}/approvals/{approval_id}/approve`: Grant authorization; resumes workflow.
- `POST /api/v1/organizations/{org_id}/approvals/{approval_id}/reject`: Deny request; terminates workflow.

### 2.7 Analytics & SLA Monitoring
- `GET /api/v1/organizations/{org_id}/analytics/overview?range=24h`: Aggregate volume, success rate, and latency.
- `GET /api/v1/organizations/{org_id}/analytics/sla`: Retrieve SLA health ratios (healthy, warning, breached).
- `GET /api/v1/organizations/{org_id}/analytics/latency`: Step-by-step P50/P95 latency breakdown.

### 2.8 Audit & System Health
- `GET /api/v1/organizations/{org_id}/audit-logs`: Query chronological SHA-256 audit ledger.
- `GET /health`: Public liveness check (200 OK).
- `GET /api/v1/health`: Detailed subsystem connectivity (database, redis, celery).
- `GET /api/v1/health/ready`: Kubernetes / container readiness probe.
