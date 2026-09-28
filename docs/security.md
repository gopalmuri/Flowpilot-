# FlowPilot — Enterprise Security & Compliance Architecture

> **Security Posture, Cryptographic Controls, and Tenant Boundary Protection**  
> *Release Candidate (RC-1.0) Security Guide*

---

## 1. Security Architecture Principles

FlowPilot is engineered to meet enterprise compliance standards (SOC2 Type II, ISO 27001, GDPR) by establishing strict security boundaries around multi-tenant isolation, cryptographic audit trails, bounded AI interactions, and defense-in-depth API protection.

---

## 2. Authentication & Credential Protection

### 2.1 Password Hashing
- Passwords are salted and hashed using **Argon2id** (memory-hard algorithm recommended by OWASP).
- Passwords must meet strict enterprise complexity: minimum 8 characters, with lowercase, uppercase, numeric, and special character requirements.

### 2.2 JWT Token Mechanics
- Access tokens are cryptographically signed JSON Web Tokens (JWT) containing `sub` (User UUID), `org_id` (Active Tenant), and `role` (`OWNER`, `ADMIN`, etc.).
- Tokens have a default expiration of **60 minutes**.
- Transported via secure `HttpOnly`, `SameSite=Lax`, `Secure` cookies or explicit `Authorization: Bearer <token>` headers.

---

## 3. Multi-Tenant Isolation & Authorization

Every data access path enforces multi-tenant boundary checks:
1. **Repository Query Scoping**: Every SQL query is parameterized with `WHERE organization_id = :active_org_id`.
2. **Path Parameter Verification**: Any attempt to access resources across organizations results in an immediate `403 Forbidden` or `404 Not Found`.
3. **Role-Based Access Control (RBAC)**:
   - `OWNER`: Full administrative, billing, workflow, approval, and integration authority.
   - `ADMIN`: User management, workflow creation/publishing, and integrations.
   - `MANAGER`: Workflow editing, run triggers, and human approvals.
   - `OPERATOR`: Manual run triggers, approval reviews, and execution telemetry viewing.
   - `VIEWER`: Read-only access to workflows, telemetry, and audit logs.

---

## 4. Webhook Security & Ingest Protection

### 4.1 HMAC-SHA256 Signatures
Inbound webhooks are validated by computing an HMAC-SHA256 digest over the raw HTTP request body concatenated with the `X-Webhook-Timestamp` header.

$$\text{Signature} = \text{HMAC-SHA256}(\text{SecretKey},\ \text{Timestamp} + \text{RawBody})$$

### 4.2 Replay Protection
Webhooks with timestamps differing from server time by more than 300 seconds are rejected with `401 Unauthorized`.

### 4.3 Payload Size Limiting & DoS Guard
Incoming payloads are capped at **1 MB**. Payloads exceeding this limit are rejected immediately with `413 Content Too Large` before memory parsing.

### 4.4 Idempotency Filtering
Redis caches payload hashes for 24 hours. Duplicate requests return cached responses, preventing replay-based duplicate transactions.

---

## 5. Server-Side Request Forgery (SSRF) Guard

External HTTP egress steps validate destination URLs prior to dispatch (`app/services/ssrf_validator.py`):
- All target hostnames are resolved to IP addresses.
- Requests to loopback addresses (`127.0.0.0/8`, `::1`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local IPs, and cloud metadata endpoints (`169.254.169.254`) are blocked and logged.

---

## 6. Field-Level Database Encryption

Third-party API keys, webhook signing secrets, and OAuth tokens are never stored in plaintext:
- Encrypted using **Fernet (AES-128-CBC + HMAC-SHA256)** via the `cryptography` library.
- Encryption keys are loaded exclusively from environment variables (`FIELD_ENCRYPTION_KEY`).

---

## 7. Tamper-Evident Cryptographic Audit Ledger

Every sensitive operational action emits an append-only audit event:
- Captured attributes: Actor ID, Tenant ID, Event Action, Resource ID, IP Address, User Agent, Timestamp.
- Payload Diff: Encapsulates state transitions.
- Checksum: Every record includes a SHA-256 hash verifying that historical ledger entries have not been tampered with or modified.
