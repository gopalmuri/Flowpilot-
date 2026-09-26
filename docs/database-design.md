# FlowPilot: Database Design Specification

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **RDBMS Engine** | PostgreSQL 16+ |
| **ORM / Migration Tool** | SQLAlchemy 2.0 (Async) + Alembic |

---

## 1. Schema Design Principles

1. **UUID Primary Keys**: All tables use cryptographically secure UUIDv4 identifiers to prevent sequential enumeration and IDOR vulnerabilities.
2. **UTC Timestamps Everywhere**: All timestamp columns are defined as `TIMESTAMPTZ` (timestamp with time zone) and default to `NOW() AT TIME ZONE 'UTC'`.
3. **Mandatory Tenant Scoping**: Every resource owned by an organization contains `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`.
4. **JSONB for Extensible Payloads**: Trigger inputs, step outputs, node configurations, and AI completions use PostgreSQL `JSONB` for schema flexibility and GIN indexing where needed.
5. **Alembic Versioning**: All schema modifications are executed strictly via versioned Alembic migration scripts. No raw DDL is executed directly in production environments.

---

## 2. Entity Relationship Overview

```
 organizations (1) ───< organization_members (N) >─── (1) users
       │
       ├───< integrations (N)
       ├───< workflows (N) ───< workflow_versions (N)
       │                              │
       │                              ├───< workflow_steps (N)
       │                              └───< workflow_connections (N)
       │
       ├───< workflow_runs (N) ───< workflow_step_runs (N)
       │          │
       │          └───< approval_requests (N)
       │
       ├───< audit_logs (N)
       ├───< usage_records (N)
       └───< idempotency_records (N)
```

---

## 3. Detailed Table Specifications

### 3.1 `users`
Represents individual accounts across all organizations.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Unique user identifier |
| `email` | `VARCHAR(255)` | `NOT NULL, UNIQUE` | Normalized login email (lowercase) |
| `password_hash` | `VARCHAR(255)` | `NOT NULL` | Argon2id password hash string |
| `full_name` | `VARCHAR(255)` | `NOT NULL` | Display name of user |
| `is_active` | `BOOLEAN` | `NOT NULL, DEFAULT TRUE` | Active account status flag |
| `is_superuser` | `BOOLEAN` | `NOT NULL, DEFAULT FALSE` | Platform system administrator flag |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Account creation timestamp (UTC) |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Last update timestamp (UTC) |

### 3.2 `organizations`
Represents customer enterprise tenant accounts.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Unique tenant identifier |
| `name` | `VARCHAR(255)` | `NOT NULL` | Enterprise organization name |
| `slug` | `VARCHAR(255)` | `NOT NULL, UNIQUE` | URL-safe slug identifier |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Tenant creation timestamp (UTC) |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Last update timestamp (UTC) |

### 3.3 `organization_members`
Join table establishing multi-tenant RBAC permissions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Membership record ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant reference |
| `user_id` | `UUID` | `NOT NULL, FK -> users(id) ON DELETE CASCADE` | User reference |
| `role` | `VARCHAR(50)` | `NOT NULL, CHECK (role IN ('OWNER','ADMIN','MANAGER','OPERATOR','VIEWER'))` | Tenant role |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Timestamp of membership grant |
| `UNIQUE(organization_id, user_id)` | Constraint | | User can have only one role per organization |

### 3.4 `integrations`
Represents connected external services (Slack, Mock CRM, Custom Webhooks).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Integration connection ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant boundary |
| `type` | `VARCHAR(50)` | `NOT NULL` | `SLACK`, `MOCK_CRM`, `WEBHOOK_CONNECTOR` |
| `name` | `VARCHAR(255)` | `NOT NULL` | Friendly name assigned by user |
| `status` | `VARCHAR(50)` | `NOT NULL, DEFAULT 'CONNECTED'` | `CONNECTED`, `DISCONNECTED`, `ERROR` |
| `credentials_encrypted`| `BYTEA` | `NULL` | AES-256-GCM encrypted credentials |
| `config` | `JSONB` | `NOT NULL, DEFAULT '{}'` | Non-sensitive connection config |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Updated timestamp |

### 3.5 `workflows`
Core automation workflow entity.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Workflow ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant boundary |
| `name` | `VARCHAR(255)` | `NOT NULL` | Workflow title |
| `description` | `TEXT` | `NULL` | Optional detailed description |
| `status` | `VARCHAR(50)` | `NOT NULL, DEFAULT 'DRAFT'` | `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `active_version_id`| `UUID` | `NULL` | Pointer to current published version |
| `webhook_key` | `VARCHAR(64)` | `UNIQUE, NULL` | Secure random ingestion key |
| `created_by` | `UUID` | `NOT NULL, FK -> users(id)` | Author user ID |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Updated timestamp |

### 3.6 `workflow_versions`
Immutable version snapshots of published workflows.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Version snapshot ID |
| `workflow_id` | `UUID` | `NOT NULL, FK -> workflows(id) ON DELETE CASCADE` | Parent workflow reference |
| `version_number` | `INTEGER` | `NOT NULL` | Incrementing version number (1, 2, 3...) |
| `definition` | `JSONB` | `NOT NULL` | Complete serialized DAG snapshot |
| `created_by` | `UUID` | `NOT NULL, FK -> users(id)` | User who published version |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Published timestamp |
| `UNIQUE(workflow_id, version_number)` | Constraint | | Unique versioning per workflow |

### 3.7 `workflow_steps`
Represents individual nodes in the workflow DAG.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Step ID |
| `workflow_version_id`| `UUID`| `NOT NULL, FK -> workflow_versions(id) ON DELETE CASCADE` | Version reference |
| `step_key` | `VARCHAR(100)`| `NOT NULL` | Canvas node key (e.g., `step_1`) |
| `step_type` | `VARCHAR(50)` | `NOT NULL` | `WEBHOOK_TRIGGER`, `AI_CLASSIFICATION`, etc. |
| `name` | `VARCHAR(255)`| `NOT NULL` | Display step name |
| `config` | `JSONB` | `NOT NULL, DEFAULT '{}'` | Step execution config parameters |
| `ui_position` | `JSONB` | `NOT NULL, DEFAULT '{"x":0,"y":0}'` | React Flow canvas coordinates |

### 3.8 `workflow_connections`
Represents directed edges connecting steps in the DAG.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Connection ID |
| `workflow_version_id`| `UUID`| `NOT NULL, FK -> workflow_versions(id) ON DELETE CASCADE` | Version reference |
| `source_step_id` | `UUID` | `NOT NULL, FK -> workflow_steps(id) ON DELETE CASCADE` | Origin step node |
| `target_step_id` | `UUID` | `NOT NULL, FK -> workflow_steps(id) ON DELETE CASCADE` | Destination step node |
| `condition_label` | `VARCHAR(100)`| `NULL` | Branch label (e.g., `true`, `high`, `else`) |

### 3.9 `workflow_runs`
Instances of workflow executions triggered by webhooks or manual runs.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Execution run ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant boundary |
| `workflow_id` | `UUID` | `NOT NULL, FK -> workflows(id) ON DELETE CASCADE` | Workflow reference |
| `workflow_version_id`| `UUID`| `NOT NULL, FK -> workflow_versions(id)` | Exact version snapshot executed |
| `status` | `VARCHAR(50)` | `NOT NULL, DEFAULT 'PENDING'` | `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `WAITING_FOR_APPROVAL`, `CANCELLED` |
| `trigger_type` | `VARCHAR(50)` | `NOT NULL` | `WEBHOOK`, `MANUAL`, `SCHEDULE` |
| `trigger_payload` | `JSONB` | `NOT NULL, DEFAULT '{}'` | Raw input event payload |
| `correlation_id` | `VARCHAR(100)`| `NOT NULL, INDEX` | Distributed tracing ID |
| `error_message` | `TEXT` | `NULL` | Root cause failure explanation |
| `started_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Execution initiation time |
| `completed_at` | `TIMESTAMPTZ` | `NULL` | Completion timestamp |

### 3.10 `workflow_step_runs`
Detailed execution trace for every step executed inside a run.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Step run ID |
| `workflow_run_id` | `UUID` | `NOT NULL, FK -> workflow_runs(id) ON DELETE CASCADE` | Parent run |
| `step_id` | `UUID` | `NOT NULL, FK -> workflow_steps(id)` | Node executed |
| `status` | `VARCHAR(50)` | `NOT NULL` | `RUNNING`, `SUCCESS`, `FAILED`, `SKIPPED` |
| `input_data` | `JSONB` | `NOT NULL, DEFAULT '{}'` | Contextual input passed to step |
| `output_data` | `JSONB` | `NOT NULL, DEFAULT '{}'` | Structured result returned by step |
| `error_message` | `TEXT` | `NULL` | Step-specific error stack |
| `execution_time_ms`| `INTEGER` | `NOT NULL, DEFAULT 0` | Step execution duration in milliseconds |
| `started_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Step start time |
| `completed_at` | `TIMESTAMPTZ` | `NULL` | Step completion time |

### 3.11 `approval_requests`
Manages human-in-the-loop approval requests generated by workflows.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Approval request ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant boundary |
| `workflow_run_id` | `UUID` | `NOT NULL, FK -> workflow_runs(id) ON DELETE CASCADE` | Linked execution run |
| `step_id` | `UUID` | `NOT NULL, FK -> workflow_steps(id)` | Suspended approval node |
| `status` | `VARCHAR(50)` | `NOT NULL, DEFAULT 'PENDING'` | `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED` |
| `payload_snapshot` | `JSONB` | `NOT NULL` | Context presented to reviewer |
| `reviewed_by` | `UUID` | `NULL, FK -> users(id)` | User who approved/rejected |
| `comment` | `TEXT` | `NULL` | Reason or comment from reviewer |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Requested timestamp |
| `resolved_at` | `TIMESTAMPTZ` | `NULL` | Approval/rejection timestamp |

### 3.12 `audit_logs`
Immutable record of administrative, security, and approval events.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Audit log entry ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant boundary |
| `user_id` | `UUID` | `NULL, FK -> users(id)` | Actor user (or NULL for system) |
| `action` | `VARCHAR(100)`| `NOT NULL` | e.g., `WORKFLOW_PUBLISH`, `APPROVAL_APPROVE` |
| `resource_type` | `VARCHAR(50)` | `NOT NULL` | `workflow`, `approval`, `integration` |
| `resource_id` | `VARCHAR(100)`| `NOT NULL` | Target resource UUID |
| `details` | `JSONB` | `NOT NULL, DEFAULT '{}'` | Sanitized diff or action context |
| `ip_address` | `VARCHAR(45)` | `NULL` | Client IP address |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Event timestamp |

### 3.13 `usage_records`
Tracks monthly automation usage and AI consumption per organization.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Usage record ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant boundary |
| `metric_type` | `VARCHAR(50)` | `NOT NULL` | `WORKFLOW_RUN`, `AI_TOKENS`, `CRM_ACTIONS` |
| `quantity` | `BIGINT` | `NOT NULL, DEFAULT 1` | Consumed units |
| `workflow_id` | `UUID` | `NULL, FK -> workflows(id)` | Attributed workflow |
| `recorded_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Usage timestamp |

### 3.14 `idempotency_records`
Guarantees duplicate protection for inbound webhook events.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Idempotency record ID |
| `organization_id` | `UUID` | `NOT NULL, FK -> organizations(id) ON DELETE CASCADE` | Tenant boundary |
| `idempotency_key` | `VARCHAR(255)`| `NOT NULL` | Unique hash / event ID |
| `workflow_run_id` | `UUID` | `NOT NULL, FK -> workflow_runs(id)` | Associated execution |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT NOW()` | Ingestion timestamp |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL` | TTL expiration (e.g. 24 hours) |
| `UNIQUE(organization_id, idempotency_key)` | Constraint | | Enforces single processing per key |

---

## 4. Indexing & Performance Strategy

```sql
-- Multi-tenant query acceleration
CREATE INDEX idx_workflows_org_status ON workflows(organization_id, status);
CREATE INDEX idx_workflow_runs_org_status ON workflow_runs(organization_id, status, started_at DESC);
CREATE INDEX idx_workflow_runs_correlation ON workflow_runs(correlation_id);
CREATE INDEX idx_approval_requests_org_status ON approval_requests(organization_id, status);
CREATE INDEX idx_audit_logs_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_idempotency_lookup ON idempotency_records(organization_id, idempotency_key);
CREATE INDEX idx_usage_records_org_metric ON usage_records(organization_id, metric_type, recorded_at);
```
