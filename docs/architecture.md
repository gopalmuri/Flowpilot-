# FlowPilot — System Architecture & Topology

> **Release Candidate (RC-1.0) Technical Architecture Document**  
> *Target Audience: Principal Engineers, System Architects, Infrastructure Leads*

---

## 1. High-Level Architectural Diagram

```
                              [EXTERNAL CLIENTS / WEBHOOKS]
                                            │
                                            │ HTTPS (Port 443 / 80)
                                            ▼
                                   [NGINX REVERSE PROXY]
                        (TLS Termination, Rate Limiting, Static Assets)
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    │                                               │
             /api/v1/* (REST)                                  /* (SPA Assets)
                    ▼                                               ▼
          [FASTAPI APPLICATION]                            [REACT 18 VITE SPA]
       (Auth, Router, Engine, RBAC)                         (Control Plane UI)
                    │
       ┌────────────┴────────────┐
       │                         │
       ▼                         ▼
[POSTGRESQL 16]             [REDIS 7]
- Multi-Tenant Tables       - Session Cache (DB 0)
- DAG Version Definitions   - Celery Broker (DB 1)
- Cryptographic Audit       - Result Backend (DB 2)
       │                         │
       └────────────┬────────────┘
                    │
                    ▼
          [CELERY WORKER POOL]
    (Step Execution, AI Parsing, CRM/Slack Egress)
```

---

## 2. Component Subsystems

### 2.1 Edge & Gateway Layer: NGINX
- **Responsibilities**:
  - TLS termination utilizing modern cipher suites (`TLSv1.2`, `TLSv1.3`).
  - Security headers injection: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`.
  - Rate limiting on public intake endpoints (e.g. `20 req/s` per IP burstable).
  - Reverse-proxy routing: forwards `/api/*` to FastAPI upstream and serves compiled frontend assets with immutable cache headers.

### 2.2 Application Core: FastAPI
- **Responsibilities**:
  - High-performance asynchronous endpoint handlers (`uvicorn` ASGI server).
  - Authentication and RBAC enforcement on all protected tenant routes.
  - Webhook ingest validation, HMAC signature verification, and idempotency filtering.
  - Workflow compilation, topological sorting, and DAG validation.
  - Ephemeral health diagnostics (`/health`, `/api/v1/health`, `/api/v1/health/ready`).

### 2.3 Distributed Execution Engine: Celery & Redis
- **Worker Configuration**:
  - Pre-fork worker concurrency with dedicated task queues.
  - Automatic task retries with exponential backoff on transient third-party network failures.
  - Heartbeat monitoring and task revocation on in-flight run cancellations.

### 2.4 Relational Persistence: PostgreSQL 16
- **Database Engine**:
  - ACID-compliant relational storage.
  - Connection pooling via `SQLAlchemy AsyncEngine` (`pool_size=20`, `max_overflow=10`, `pool_pre_ping=True`).
  - Strict tenant partitioning on every entity table.

---

## 3. Entity-Relationship Data Model

```
┌────────────────────┐
│   organizations    │
├────────────────────┤
│ id (UUID, PK)      │
│ name               │
│ created_at         │
└─────────┬──────────┘
          │ 1
          │
          │ N
┌─────────▼──────────┐       ┌────────────────────┐
│     workflows      │       │       users        │
├────────────────────┤       ├────────────────────┤
│ id (UUID, PK)      │       │ id (UUID, PK)      │
│ organization_id(FK)│       │ email              │
│ name               │       │ password_hash      │
│ webhook_key        │       └─────────┬──────────┘
└─────────┬──────────┘                 │
          │ 1                          │
          │                            │ 1
          │ N                          │
┌─────────▼──────────┐                 │ N
│ workflow_versions  │       ┌─────────▼──────────┐
├────────────────────┤       │ organization_users │
│ id (UUID, PK)      │       ├────────────────────┤
│ workflow_id (FK)   │       │ organization_id(FK)│
│ version_number     │       │ user_id (FK)       │
│ status (PUB/DRAFT) │       │ role (OWNER/ADMIN) │
└─────────┬──────────┘       └────────────────────┘
          │ 1
          ├─────────────────────────────┐
          │ N                           │ N
┌─────────▼──────────┐        ┌─────────▼──────────┐
│   workflow_steps   │        │   workflow_runs    │
├────────────────────┤        ├────────────────────┤
│ id (UUID, PK)      │        │ id (UUID, PK)      │
│ version_id (FK)    │        │ version_id (FK)    │
│ step_key           │        │ organization_id(FK)│
│ step_type          │        │ status             │
│ config (JSONB)     │        │ started_at         │
└────────────────────┘        │ completed_at       │
                              └─────────┬──────────┘
                                        │ 1
                                        │
                                        │ N
                              ┌─────────▼──────────┐
                              │     approvals      │
                              ├────────────────────┤
                              │ id (UUID, PK)      │
                              │ workflow_run_id(FK)│
                              │ status (PEND/APPR) │
                              │ approver_role      │
                              │ resolved_by_user_id│
                              └────────────────────┘
```

---

## 4. Resilience & Fault Tolerance Patterns

1. **Database Connection Pre-Ping**: Async connection pools verify connection viability before dispatching queries, seamlessly recovering from network partitions or database restarts.
2. **Deterministic Idempotency**: Redis stores a SHA-256 hash of inbound webhook payloads alongside the client-provided `Idempotency-Key` for 86,400 seconds. Subsequent identical payloads return the existing run ID immediately without duplicate processing.
3. **Execution State Checkpointing**: Each step execution updates the database transactionally. If a worker node crashes mid-execution, the unacknowledged Celery task restarts from the last committed step run state.
4. **Circuit Breaker on Downstream Egress**: Integrations with external CRM and Slack APIs enforce bounded timeouts (5s) and automatic exponential retries.
