# FlowPilot — Authoritative Project Working Explanation

> **Release Candidate (RC-1.0) Technical Specification & Operational Guide**  
> *Target Audience: Core Engineering, DevOps, Solutions Architecture, and Enterprise Security Auditors*

---

## 1. Executive Summary

FlowPilot is an enterprise-grade **B2B Workflow Orchestration Control Plane**. It accepts unstructured and structured business requests (e.g., enterprise leads, refund disputes, privileged access escalations), extracts typed entities via bounded AI semantic parsing, evaluates explicit deterministic business rules, halts execution for authorized human sign-off when governance thresholds are triggered, dispatches downstream actions (CRM, Slack, Webhooks), and permanently commits an immutable cryptographic audit record.

FlowPilot is built on a fundamental architectural principle:
$$\mathbf{AI\ Understands.\ Rules\ Control.}$$

AI is strictly quarantined to read-only semantic extraction. AI never directly mutates databases, authorizes access, or triggers downstream side-effects without passing through deterministic rule gates and human approval checkpoints.

---

## 2. Core Request Lifecycle

Every business transaction flowing through FlowPilot traverses a deterministic state pipeline:

```
[Inbound Request]
       │
       ▼
[01. Ingestion & HMAC Verification]  ── (Reject 401 if invalid / 409 if duplicate)
       │
       ▼
[02. Schema Validation]             ── (Reject 422 if malformed or oversized)
       │
       ▼
[03. Bounded AI Classification]     ── (Extract Typed Entities, Intent & Confidence)
       │
       ▼
[04. Deterministic Business Rules]  ── (Evaluate IF/THEN conditions with Zero Bias)
       │
       ├── Threshold Exceeded? ──► [05. Human Approval Gate] ──► (Reject -> Halt / Expire)
       │                                     │ (Approved)
       └─────────────────────────────────────┘
       │
       ▼
[06. Downstream Action Execution]   ──► [CRM Record Mutation] + [Slack Alert Dispatch]
       │
       ▼
[07. Cryptographic Audit Ledger]    ── (SHA-256 Tamper-Evident Hash Chain)
       │
       ▼
[08. SLA & Telemetry Recording]     ── (Duration Tracking, Breach Flags & Analytics)
```

---

## 3. Technology Stack & Runtime Topology

### Backend Architecture
- **Framework**: FastAPI (Python 3.13.2) utilizing native asynchronous request pipelines (`asyncio`, `anyio`).
- **Database Layer**: PostgreSQL 16 managed via `SQLAlchemy 2.0` in strict async mode (`asyncpg` driver).
- **Asynchronous Task Queue**: Celery 5.4 backed by Redis 7 for long-running workflows, automated retries, and async notifications.
- **Cache & Ephemeral Broker**: Redis 7 Alpine with dedicated logical databases:
  - DB 0: Application session cache, webhook idempotency keys, and rate-limiting counters.
  - DB 1: Celery task message broker.
  - DB 2: Celery task result backend.
- **Security & Cryptography**: `PyJWT` for RS256/HS256 signed access tokens, `passlib` (Argon2 / BCrypt) for password hashing, and `cryptography.fernet` for field-level database encryption.

### Frontend Architecture
- **Framework**: React 18 with TypeScript in strict mode (`noUnusedLocals: true`).
- **Build Engine**: Vite 6 delivering optimized, code-split production bundles.
- **Design System**: Vanilla CSS tokens in `index.css` alongside Tailwind CSS utilities.
- **Motion Engine**: Hardware-accelerated CSS keyframe transforms (`transform`, `opacity`) combined with custom hooks (`useInView`, `useCountUp`, `useScrollParallax`, `useReducedMotion`).
- **State Management**: Scoped React Contexts (`AuthContext`, `ThemeContext`) with native `fetch` wrappers (`apiClient.ts`).

---

## 4. Multi-Tenant Isolation & RBAC Matrix

FlowPilot enforces strict multi-tenancy at both the database and application levels:
- Every organization (`organizations` table) has a unique UUID.
- All core tables (`workflows`, `workflow_versions`, `workflow_runs`, `approvals`, `integrations`, `audit_logs`) possess a mandatory, indexed `organization_id` foreign key.
- Queries enforce multi-tenant isolation via repository-level scopes: `WHERE organization_id = :active_org_id`. Cross-tenant queries are blocked with `403 Forbidden` or `404 Not Found`.

### Role-Based Access Control (RBAC)

| Permission / Capability | OWNER | ADMIN | MANAGER | OPERATOR | VIEWER |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Manage Org Settings & Billing** | Yes | No | No | No | No |
| **Invite & Remove Members** | Yes | Yes | No | No | No |
| **Create & Edit Workflows** | Yes | Yes | Yes | No | No |
| **Publish Workflow Versions** | Yes | Yes | No | No | No |
| **Resolve Human Approvals** | Yes | Yes | Yes | Yes | No |
| **Trigger Manual Executions** | Yes | Yes | Yes | Yes | No |
| **Manage Third-Party Integrations**| Yes | Yes | No | No | No |
| **View Telemetry & Audit Logs** | Yes | Yes | Yes | Yes | Yes |

---

## 5. Security & Governance Foundations

1. **HMAC Webhook Signatures**: Incoming webhooks are verified via `X-Webhook-Signature` using tenant-specific secret keys with replay protection (`X-Webhook-Timestamp` window $\le 300\text{s}$).
2. **Idempotency Protection**: Redis-backed atomic locks on `Idempotency-Key` / webhook payload hashes prevent duplicate workflow executions.
3. **SSRF Guard**: Automated IP validation blocks requests to private IPv4/IPv6 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, and AWS metadata endpoint `169.254.169.254`).
4. **Field Encryption**: Third-party integration credentials and API tokens are encrypted with AES-256-GCM before database storage.
5. **Tamper-Evident Audit Trail**: Every mutating event (approval, status change, configuration edit) generates an immutable audit record containing actor ID, IP address, timestamp, diff payload, and a SHA-256 checksum.
