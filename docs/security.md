# FlowPilot: Security Architecture & RBAC Specification

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **Compliance Baseline** | SOC 2 Type II / ISO 27001 Readiness |
| **Encryption Standard** | AES-256-GCM (Data at Rest), TLS 1.3 (In Transit) |

---

## 1. Authentication & Token Lifecycle

### 1.1 Password Security
- **Algorithm**: Argon2id (`argon2_cffi`)
- **Parameters**: `time_cost=3`, `memory_cost=65536` (64 MB), `parallelism=4`
- **Validation Rules**: Minimum 10 characters, at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character.

### 1.2 JWT Token Mechanics
FlowPilot utilizes a dual-token JWT architecture:
- **Access Token**:
  - Expiration: **30 minutes**
  - Claims: `sub` (User UUID), `org_id` (Active Tenant UUID), `role` (Tenant RBAC Role), `exp`, `iat`, `jti`
- **Refresh Token**:
  - Expiration: **7 days**
  - Stored as a hashed token in Redis with automatic rotation on each refresh.
  - Revocation of a refresh token immediately invalidates active sessions.

---

## 2. Role-Based Access Control (RBAC) Matrix

Permissions are enforced strictly within the FastAPI route dependency layer, not merely on the frontend UI:

| Resource & Action | `OWNER` | `ADMIN` | `MANAGER` | `OPERATOR` | `VIEWER` |
|---|:---:|:---:|:---:|:---:|:---:|
| **Organization: Billing & Delete** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Members: Invite, Change Roles** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Integrations: Connect & Secrets**| ✅ | ✅ | ❌ | ❌ | ❌ |
| **Workflows: Create & Edit Drafts** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Workflows: Publish to Active** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Workflows: Archive & Delete** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Approvals: Approve / Reject** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Runs: Trigger Manual Run** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Runs: Retry / Cancel** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Runs: Inspect Step Metadata** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Audit Logs: View Audit Trail** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Analytics: View Dashboards** | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 3. Multi-Tenant Isolation & Defense in Depth

```
Request ──> [JWT Auth Layer] (Extracts user_id, verifies active org_id membership)
                  │
                  ▼
            [OrgContext Dependency] (Validates user has active role in org_id)
                  │
                  ▼
            [SQLAlchemy Query Builder] (Injects WHERE organization_id = :org_id)
                  │
                  ▼
            [PostgreSQL Engine] (Row-Level partition guarantee)
```

1. **Defense Layer 1 (Gateway / JWT)**: Token claims define the tenant boundary. A forged or modified `org_id` fails cryptographic signature verification.
2. **Defense Layer 2 (Database Membership Verification)**: Middleware validates against `organization_members` that the user is actively assigned to the target organization before reaching route logic.
3. **Defense Layer 3 (Explicit Query Constraints)**: Every SELECT, UPDATE, and DELETE query automatically adds `.where(Model.organization_id == current_org_id)`.
4. **Defense Layer 4 (UUID Enumeration Prevention)**: Cross-tenant ID requests return generic `404 Not Found` rather than `403 Forbidden` to prevent resource discovery.

---

## 4. Encryption & Secret Management

### 4.1 Integration Credentials at Rest
- Secrets such as Slack OAuth tokens, CRM API keys, and webhook signing secrets are **never** stored in plaintext.
- Secrets are encrypted using **AES-256-GCM** with authenticated data (AEAD):
  ```python
  encrypted_blob = aes_gcm_encrypt(plaintext_json, key=MASTER_ENCRYPTION_KEY, nonce=random_12_bytes)
  ```
- The initialization vector / nonce (12 bytes) is stored prepended to the ciphertext.
- Master encryption keys are loaded strictly from environment variables and never logged or serialized.

### 4.2 Webhook Verification & HMAC Signatures
- Inbound webhooks support optional cryptographic signatures:
  - Header: `X-FlowPilot-Signature: sha256=<hex_digest>`
  - Verification: `hmac.compare_digest(computed_hash, header_hash)` protects against timing attacks.

---

## 5. Log Sanitization & Sensitive Data Redaction

FlowPilot enforces zero-leak logging policies:
- Loggers automatically mask high-risk keys in request bodies and headers:
  - `password`, `token`, `access_token`, `refresh_token`, `authorization`, `api_key`, `secret`, `credentials`
- Raw credit card data, social security numbers, and sensitive enterprise payloads are redacted from persistent application log streams.

---

## 6. OWASP Top 10 Defense Strategies

| Vulnerability | FlowPilot Mitigation |
|---|---|
| **A01: Broken Access Control** | Scoped queries per `organization_id`, strict RBAC matrix enforcement in FastAPI route dependencies. |
| **A02: Cryptographic Failures** | Argon2id for passwords, AES-256-GCM for tokens at rest, TLS 1.3 in transit. |
| **A03: Injection (SQL / Code)** | SQLAlchemy parameterized queries (zero raw SQL strings). Rule Engine uses strict AST parser (zero `eval()`). |
| **A04: Insecure Design** | Separation of ingestion from background execution; human approval gating for high-priority actions. |
| **A05: Security Misconfiguration** | Minimal Alpine Docker containers, explicit CORS origin whitelisting, non-root container users. |
| **A06: Vulnerable Components** | Pinned dependencies in `requirements.txt` and `package.json`, GitHub Actions automated security audit. |
| **A07: Identification & Auth Failures** | Rate limiting on `/api/v1/auth/login` (5 attempts/min), secure cookie options (`SameSite=Strict`, `HttpOnly`). |
| **A08: Software & Data Integrity** | AI output strictly parsed by Pydantic; LLM has zero direct tool execution authority. |
| **A09: Security Logging & Monitoring** | Structured JSON logs with correlation IDs, tamper-evident audit log table for admin events. |
| **A10: Server-Side Request Forgery (SSRF)** | Outbound integration requests restricted to validated domains; private IP ranges (127.0.0.1, 10.0.0.0/8, 192.168.0.0/16) blocked. |
