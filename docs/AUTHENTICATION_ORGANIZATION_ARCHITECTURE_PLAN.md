# FlowPilot — Authentication & Organization Architecture Plan

| | |
|---|---|
| **Status** | PROPOSAL — nothing in this document has been implemented. Awaiting explicit approval. |
| **Date** | 2026-10-17 |
| **Scope** | Authentication, organizations, memberships, roles/permissions, invitations, Google OIDC, platform administration, tenant isolation |
| **Method** | Full read of the auth/org/RBAC code (backend + frontend), plus read-only probes against the local dev stack |

**Evidence labels used throughout**

- **[CODE]** — verified by reading the repository.
- **[LIVE]** — verified by running a request against the local stack (details in §2.2).
- **[DOC]** — stated only in documentation; not verified against code.

**What was touched while gathering evidence:** no source files were modified. The live probes created a throwaway Viewer user and one forged workflow run in the local dev database; both were deleted afterwards.

---

## Table of contents

1. Executive Summary
2. Current Architecture (inventory, findings register, what is already correct)
3. Target Architecture
4. Authentication Architecture
5. Organization Architecture
6. User Membership Architecture
7. RBAC Architecture
8. Platform Admin Architecture
9. Organization Admin Architecture
10. Google OIDC Architecture
11. Session Architecture
12. Tenant Isolation Architecture
13. Database Architecture
14. API Architecture
15. Frontend Architecture
16. Security Architecture
17. Migration Strategy
18. Testing Strategy
19. Future Enterprise SSO
20. Future MFA / Passkeys
21. Phase-by-Phase Implementation Plan (Phases 0–14)
22. Risks and Trade-offs
23. Final Recommended Architecture
24. **Implementation Readiness**

---

## 1. Executive Summary

FlowPilot already has a sound multi-tenant core: one identity table, per-organization memberships, role checks that read the **database** (not the token) on every request, 404-on-non-member responses, Argon2id password hashing, atomic refresh-token rotation, a Redis revocation list, an in-memory-only access token in the SPA, and a cross-tenant test for every resource family. The target architecture is therefore an **evolution of what exists, not a rewrite**: one new concept (platform administration), three new capabilities (invitations, Google OIDC, real session management), and a consolidation of authorization into one permission catalog.

**What the code review found that matters most**

| # | Finding | Why it matters |
|---|---|---|
| F-01 | **A Viewer can start workflow runs.** The workflow-version read endpoint returns each webhook step's `secret_token` to every member role; a Viewer can sign a webhook with it. **[LIVE]** | Bypasses the role model. Highest priority; can be fixed independently of this redesign. |
| F-02 | **Sign-out does not sign out on the server** once the 30-minute access token has expired; the refresh cookie stays valid. **[LIVE]** | Session hijack window; users believe they are logged out. |
| F-03 | **There is no platform-admin layer.** `users.is_superuser` exists but is never used for any decision. **[CODE]** | The core business requirement (provider vs. customer administration) has no implementation. |
| F-04 | **There is no invitation flow.** "Add member" attaches an *existing* user by email with no consent, and answers 404/409 differently, which reveals which emails are registered on the platform. **[CODE]** | Customers cannot onboard their own people; privacy leak across tenants. |
| F-05 | **Login rate limiting is spoofable and too blunt.** Keyed on the client IP, trusts `X-Forwarded-For` unconditionally, 5 attempts/minute per IP. **[CODE]** (I hit this limit repeatedly during testing.) | Attacker bypasses it by rotating a header; a whole office behind one NAT locks itself out. |

**Recommended direction (details in §23):** keep one `users` identity table and the existing `organization_members` table; add `platform_role` for the provider layer; add `invitations`, `external_identities`, `auth_sessions`, `email_tokens` and `security_events`; introduce a single permission catalog that preserves today's behaviour exactly (proven by an equivalence test) before any role semantics change; use **Authlib** for Google OIDC (code flow + PKCE, backend-driven); keep tenant isolation in the application layer with an automatically generated contract test, and treat PostgreSQL Row-Level Security as an optional later layer.

**Safest order (§24):** build two safety-net test suites first (tenant-isolation contract, role matrix) → ship the small hotfixes (F-01, F-02, F-05) → organization/membership model → permission catalog → invitations + email → session hardening → organization creation flows → Google OIDC → platform admin → enterprise SSO and MFA.

**Decisions needed from you before implementation: 18 (listed in §24.6; D1–D5 are the ones that block the first phases).** The most important is the role vocabulary: your brief says Owner/Admin/Member/Viewer, but the codebase has five roles — Owner, Admin, **Manager, Operator**, Viewer — and "Member" exists only as a fallback label in the UI.

---

## 2. Current Architecture

### 2.1 Inventory — what exists today

| Area | State | Evidence |
|---|---|---|
| Identity | One `users` table: email (unique), `password_hash` (NOT NULL), `full_name`, `is_active`, `is_superuser` (unused) | `backend/app/models/user.py` [CODE] |
| Organizations | `organizations`: name, unique slug. **No status, owner, plan, or creator** | `models/organization.py` [CODE] |
| Memberships | `organization_members`: (org, user) unique + `role` string. **No status, inviter, or CHECK on role** | `models/membership.py`, migration `0001` [CODE] |
| Roles | `OrganizationRole` = OWNER, ADMIN, MANAGER, OPERATOR, VIEWER; rank map `ROLE_LEVELS` 4→0 lives only in `routers/approvals.py` | `models/membership.py`, `routers/approvals.py:43` [CODE] |
| Password hashing | Argon2id (time 3, 64 MB, parallelism 4) | `core/security.py:13` [CODE] |
| Access token | JWT HS256, 30 min, claims: sub, email, org_id, role, jti, type, iat, exp | `core/security.py:36`, `core/config.py:75` [CODE] |
| Refresh token | JWT, 7 days, rotated atomically through a Redis Lua script; returned **both** in the JSON body and as an HttpOnly cookie (`Path=/api/v1/auth`, `SameSite=Lax`, `Secure` only when `ENVIRONMENT=production`) | `routers/auth.py:189-205`, `core/security.py:157` [CODE] |
| Revocation | Redis: `flowpilot:refresh:{jti}`, `flowpilot:revoked_access:{jti}` | `core/security.py:134-193` [CODE] |
| Sessions | **No session table.** No device list, no "sign out everywhere" | [CODE] |
| AuthZ dependency | `get_org_context` reads the membership from the DB for the **path** `organization_id`; non-members get 404. `require_role([...])` wraps it | `api/deps.py:114-163` [CODE] |
| Org creation | `POST /auth/register` (optional org name) **and** `POST /organizations` — open to any authenticated user, unlimited | `routers/auth.py:105`, `routers/organizations.py:43` [CODE] |
| Member management | Only `POST /organizations/{id}/members` (add existing user) and `DELETE …/members/{user_id}`. **No list, role-change, suspend or ownership-transfer endpoints** | `routers/organizations.py` [CODE] |
| Email | **No email infrastructure of any kind** (no SMTP, templates, reset, verification) | grep of `backend/app` [CODE] |
| Audit | 15 action types, all workflow/integration/execution/approval. **No auth or membership events.** `audit_logs.organization_id` is NOT NULL | `grep action=`, `models/audit_log.py` [CODE] |
| Rate limiting | Redis sliding window, keyed on client IP only, `X-Forwarded-For` trusted, fails **open** | `core/rate_limit.py:41-121` [CODE] |
| CORS / headers | Explicit origins, credentials allowed, `*` methods/headers; strong security-header middleware; production config validator rejects default secrets and localhost origins | `main.py:51`, `core/middleware.py`, `core/config.py:105` [CODE] |
| Frontend session | Access **and** refresh token held in JS memory only (no `localStorage`); silent refresh on page load via the cookie | `services/apiClient.ts:5-45`, `context/AuthContext.tsx:75` [CODE] |
| Frontend org switching | **Client-side only** — sets a variable and an `X-Organization-Id` header that the backend never reads | `AuthContext.tsx:115`, `grep X-Organization-Id` [CODE] |
| Frontend RBAC | Role arrays hard-coded in components (`['OWNER','ADMIN'].includes(...)`, etc.) | `IntegrationConnectModal.tsx:53`, `SLAConfigModal.tsx:27`, `AuditLogsPage.tsx:97` [CODE] |
| Frontend members UI | **Placeholder:** one static row built from the logged-in user, "1 Active Operator" | `SettingsPage.tsx:280-322` [CODE] |
| Tests | 277 backend tests (auth, tenant isolation per resource family, security hardening); 72 frontend tests | test run [CODE] |

### 2.2 Findings register

Severity reflects impact on a multi-tenant B2B product. "Fixed in" refers to the phases in §21.

| ID | Sev. | Finding | Evidence | Fixed in |
|---|---|---|---|---|
| **F-01** | **Critical** | **Role bypass via leaked webhook secret.** `GET …/workflows/{id}/versions/{vid}` uses `get_org_context` (any member). The response includes `secret_token` for WEBHOOK_TRIGGER steps. A **Viewer** gets 403 on `POST …/runs` but can read the secret, HMAC-sign a request and `POST /webhooks/{key}` → **200, run started**. | **[LIVE]** probe: Viewer read secret `demo_w…`, direct run → 403, forged webhook → 200 | Phase 7 (slice 7a, ship early) |
| **F-02** | High | **Logout is ineffective without a valid access token.** `/auth/logout` depends on `get_current_user`. With only the cookie it returns **401**, sends no `Set-Cookie`, and the same refresh cookie then returns **200** on `/auth/refresh`. After 30 min idle the user's Sign out does nothing server-side, and a page reload restores the session. | **[LIVE]** (curl, cookie-only logout → 401, then refresh → 200) | Phase 5 (slice 5a, ship early) |
| **F-03** | High | **No platform administration.** `is_superuser` is stored and returned by `/auth/me`, never consulted for authorization. No provider-level API, no org provisioning, suspension, or support tooling. | **[CODE]** `grep is_superuser` | Phase 9 |
| **F-04** | High | **Members are added without consent and the endpoint leaks account existence.** `POST …/members` attaches any registered user by email; unknown email → 404 "User not found", known → 201/409. Works across tenants, so any Owner/Admin can probe the platform's user list. | **[CODE]** `routers/organizations.py:183-203` | Phase 4 |
| **F-05** | High | **Login throttling is weak and wrongly scoped.** IP-only key; `X-Forwarded-For` taken verbatim (spoofable); 5 attempts/60 s/IP (blocks shared-NAT offices); no per-account limit or lockout; fails open on Redis errors. | **[CODE]** `core/rate_limit.py:41-48,125`; hit repeatedly in testing | Phase 5 (slice 5a) |
| **F-06** | Medium | **Refresh handling gaps.** Replaying an old refresh token returns 401 but does **not** revoke the token family issued since; no session list/revoke; refresh token is also returned in the JSON body and kept in JS memory although the HttpOnly cookie alone suffices. | **[CODE]** `routers/auth.py:269-280`, `apiClient.ts:6,77` | Phase 5 |
| **F-07** | Medium | **Active organization is not a server concept.** `/auth/refresh` always re-issues the token for `memberships[0]`; switching orgs is client-only; token `role`/`org_id` claims go stale and `/auth/me` reports the stale claim; `X-Organization-Id` is dead. | **[CODE]** `routers/auth.py:301`, `AuthContext.tsx:115` | Phase 5 / 10 |
| **F-08** | Medium | **No email verification, password reset, password change, or MFA.** Anyone can register any email address and an unverified address can later be invited/linked. | **[CODE]** grep; schemas | Phases 5, 14 |
| **F-09** | Medium | **Auth and membership events are not audited**, and `audit_logs.organization_id` is NOT NULL so org-less events (failed login, password reset, platform actions) cannot be stored there. Docs say Viewers may read audit logs; code allows MANAGER+ only. | **[CODE]** | Phase 5 / 11 |
| **F-10** | Medium | **Authorization is scattered.** 40 guarded sites use 5 distinct role sets; the rank map is private to one router; the frontend duplicates role arrays; there is no permission catalog. "MEMBER" does not exist in the backend enum. | **[CODE]** role-set census (§7.1) | Phases 2, 7 |
| **F-11** | Medium | **CSRF defence is conditional.** The Origin check on `/auth/refresh` runs only when `ENVIRONMENT=production` **and** an `Origin` header is present; the refresh also accepts a token from the request body. Mitigated today by `SameSite=Lax`. | **[CODE]** `routers/auth.py:226-234` | Phase 5 |
| **F-12** | Medium | **Organization/membership lifecycle is incomplete.** No org or membership status (cannot suspend), no list/PATCH members, no ownership transfer, last-owner check is not race-safe (no row lock), and any user can create unlimited organizations. | **[CODE]** `routers/organizations.py` | Phases 1, 2, 3 |
| **F-13** | Medium | **Configuration contract mismatch.** `docker-compose.prod.yml`, CI and docs use `FIELD_ENCRYPTION_KEY`, `CORS_ORIGINS`, `COOKIE_SECURE`, `COOKIE_SAMESITE`; the code reads `ENCRYPTION_KEY`, `ALLOWED_CORS_ORIGINS` and derives cookie flags from `ENVIRONMENT`. **`JWT_SECRET` is not passed at all**, so the production validator would refuse to start. | **[CODE]** `docker-compose.prod.yml:50-62` vs `core/config.py` | Phase 11 |
| **F-14** | Low | **JWT hardening gaps.** HS256 with one shared secret, no `iss`/`aud`/`kid` (no zero-downtime rotation), `role` embedded though never authoritative. | **[CODE]** `core/security.py:56-66` | Phase 5 |
| **F-15** | Low | **Onboarding dead-end and misleading UI.** Organization name is optional at signup and there is no "create organization" UI, so a user who skips it lands in a "No Organization" shell. Security tab says "60 min TTL" (actual 30). | **[CODE]** `RegisterPage.tsx:99`, `SettingsPage.tsx:340` | Phase 3 / 10 |
| **F-16** | Low | **User enumeration** via registration (`409 already exists`) and login timing (no hash computed when the user is unknown). | **[CODE]** `routers/auth.py:84-91,152` | Phase 5 |
| **F-17** | Info | **Tenant isolation is strong but purely application-level.** Every by-ID query filters on the org (via helpers such as `_get_workflow_or_404`); child tables (`workflow_steps`, `workflow_connections`, `workflow_step_runs`) carry no `organization_id` and rely on their parent; coverage depends on each author remembering the filter. | **[CODE]** | Phase 8 |

### 2.3 What is already correct (and must not regress)

- **Authorization reads the DB per request** (`get_org_context`): removing a member or changing a role takes effect immediately regardless of token lifetime.
- **404 for non-members** — prevents tenant enumeration.
- **Argon2id** with documented parameters; constant-time verify.
- **Refresh rotation is atomic** (Redis Lua compare-and-swap) and replay of a consumed token is rejected.
- **Access token never touches `localStorage`.**
- **Refresh cookie is path-scoped** to `/api/v1/auth`, `HttpOnly`, `Secure` in production.
- **Production config validator** refuses default secrets, `DEBUG=True`, wildcard/localhost CORS.
- **Existing owner safeguards:** Admin cannot grant or remove Owner; the last Owner cannot be removed.
- **A cross-tenant test exists for every resource family** (workflows, runs, approvals, integrations, audit, analytics, webhooks).
- **Integration credentials are encrypted** (AES-256-GCM) and never returned.

---

## 3. Target Architecture

```
                         FLOWPILOT  PLATFORM
                                 │
            ┌────────────────────┼─────────────────────────┐
            │                    │                         │
     PLATFORM CONTROL      IDENTITY SYSTEM            FLOWPILOT APP
     PLANE (/platform)     (one, centralised)        (tenant-scoped)
            │                    │                         │
   platform_role on user   ┌─────┴───────────┐             │
   (ADMIN / SUPPORT)       │                 │             │
   • provision orgs     Email+Password   Google OIDC       │
   • suspend/activate   (Argon2id)       (code + PKCE)     │
   • plans, support         │                 │            │
   • platform monitoring    └────────┬────────┘            │
            │                        ▼                     │
            │                      USER  (users)           │
            │                        │ 1                   │
            │                        │ ──────────── *      │
            │              ORGANIZATION MEMBERSHIP         │
            │           (organization_members: status)     │
            │                        │                     │
            │                      ROLE ──► PERMISSIONS    │
            │            (single catalog, server-enforced) │
            │                        │                     │
            └────────────────────────┴──────────┬──────────┘
                                                ▼
                                    get_org_context(path org)
                                                │
     ┌───────────────┬───────────────┬──────────┴───┬────────────────┬──────────────┐
     ▼               ▼               ▼              ▼                ▼              ▼
 Workflows      Executions       Approvals     Integrations      Analytics        Audit
 (all rows carry organization_id; every query filtered server-side)
```

**Principles**

1. **One identity system.** Organizations never get their own login database. A user is one row; organizations are memberships.
2. **Two authorization scopes that never mix:** *platform scope* (provider staff) and *organization scope* (customer staff). Platform roles grant **no** access to a customer's business data by default.
3. **The backend is the security boundary.** The SPA hides controls for usability only.
4. **FlowPilot owns roles.** Google/other IdPs prove *who* a person is; they never decide organization membership or role.
5. **Reuse before inventing.** Extend `users`, `organizations`, `organization_members`, the Redis revocation scheme and `get_org_context`; add tables only where no equivalent exists.
6. **Expand → migrate → contract.** Every schema change is additive first; behaviour is protected by tests written *before* the refactor.

---

## 4. Authentication Architecture

### 4.1 Methods

| Method | Status | Notes |
|---|---|---|
| Email + password | Exists; hardened in Phase 5 | Argon2id; add email verification, reset, change, uniform errors, dummy-hash timing equalisation, per-account + per-IP throttling |
| Google (OIDC) | New — Phase 6 | Authorization-code flow with PKCE, driven by the backend |
| Other OIDC IdPs / enterprise SSO | Future — Phase 13 | Same code path, per-organization provider config |
| MFA / passkeys | Future — Phase 14 | TOTP first, WebAuthn later; mandatory for platform admins before go-live |

### 4.2 Login flow (email + password)

```
Browser                         FlowPilot API                     Postgres / Redis
   │  POST /auth/login            │                                      │
   │  {email, password}           │                                      │
   │ ───────────────────────────► │  1. throttle: IP bucket + account    │
   │                              │     bucket (Redis)                   │
   │                              │  2. load user by lower(email)        │
   │                              │     unknown? verify against a        │
   │                              │     constant DUMMY hash (timing)     │
   │                              │  3. verify Argon2id                  │
   │                              │  4. user active? email verified?     │
   │                              │     (policy D4)                      │
   │                              │  5. create auth_sessions row (sid)   │
   │                              │     + Redis refresh jti ──────────►  │
   │                              │  6. active org = requested membership│
   │                              │     or last-used or only one         │
   │                              │  7. access JWT {sub,sid,org_id,iss,  │
   │                              │     aud,exp≈15m}                     │
   │                              │  8. security_events: login.success   │
   │  200 {access_token,...}      │                                      │
   │  Set-Cookie: refresh (HttpOnly, Secure, SameSite=Strict, path-scoped)
   │ ◄─────────────────────────── │   (refresh token NOT in JSON body)   │
   │                              │                                      │
   │  later: 401 → POST /auth/refresh (cookie) ─► rotate, same sid,      │
   │         same ACTIVE ORG, family-reuse detection                     │
```

### 4.3 What changes relative to today

| Today | Target |
|---|---|
| Unknown user returns faster than wrong password (no hash computed) | Always run one Argon2 verify (dummy hash) |
| Refresh token in body **and** cookie | Cookie only for the browser; body path kept behind an explicit `client=api` mode if non-browser clients need it |
| Refresh re-issues for `memberships[0]` | Refresh preserves the session's active organization |
| Logout needs a valid access token | Logout works with the refresh cookie alone and always clears it |
| Registration reveals "email exists" | Generic response + email to the address (once email infra exists) |
| No password change / reset | Both, with session revocation (§11) |

---

## 5. Organization Architecture

### 5.1 Lifecycle

```
                 (self-service)                       (platform-provisioned)
                       │                                         │
              user creates org                         platform admin creates org
                       │                                         │
                       ▼                                         ▼
                 status = ACTIVE                       status = PENDING_ACTIVATION
          creator becomes OWNER (immediately)         owner_email invited as OWNER
                       │                                         │ owner accepts
                       │                                         ▼
                       │                                   status = ACTIVE
                       └───────────────┬─────────────────────────┘
                                       ▼
                                    ACTIVE ◄──── platform admin: activate
                                       │
                          platform admin: suspend (reason, audited)
                                       ▼
                                   SUSPENDED   → every org-scoped request returns 403 "organization suspended"
                                                 (members can still sign in and see the notice; data retained)
```

### 5.2 Organization attributes (target)

`name`, `slug` (unique), `status`, `created_via` (SELF_SERVICE | PLATFORM), `created_by_user_id`, `plan` (free-text/enum placeholder for subscription info), `suspended_at`, `suspension_reason`. The `slug` is generated server-side from the name unless an authorised caller supplies one; reserved slugs (`platform`, `admin`, `api`, …) are rejected and the uniqueness check is made race-safe by catching the unique-constraint violation and retrying.

### 5.3 Diagram — organization creation (both scenarios)

```
SCENARIO 1 — SELF-SERVICE                     SCENARIO 2 — ENTERPRISE / SALES-ASSISTED

 john@abc.com                                  FlowPilot Platform Admin
     │ sign up (password or Google)                     │ POST /platform/organizations
     ▼                                                  │ {name:"ABC", owner_email, plan}
 email verified? ──no──► verify first (policy D4)       ▼
     │ yes                                       organization created
     ▼                                           status = PENDING_ACTIVATION
 onboarding: "Create organization"               invitation(role=OWNER, owner@abc.com)
     │ POST /organizations (quota + flag)                │ email with single-use link
     ▼                                                  ▼
 org ACTIVE, John = OWNER                      owner@abc.com opens link
     │                                                  │ new user → sign up / Google
     ▼                                                  │ existing user → sign in
 Settings → Members → Invite                            ▼
                                               membership OWNER created, org ACTIVE
                                                        │
                                               Owner manages own users (Scenario 1 from here on)
```

Safeguards: self-service creation is behind a feature flag (`SELF_SERVICE_ORG_CREATION_ENABLED`, decision D3) and a per-user cap on **owned** organizations (D11); an unactivated platform-provisioned organization has **no members and no data** until the invitation is accepted, and invitations for `OWNER` can only be created by a platform admin or an existing Owner.

---

## 6. User Membership Architecture

### 6.1 Model

```
users 1 ───── * organization_members * ───── 1 organizations
                    │
                    ├─ role      (OWNER | ADMIN | MANAGER | OPERATOR | VIEWER)   (CHECK constraint)
                    ├─ status    (ACTIVE | SUSPENDED)
                    ├─ invited_by_user_id, joined_at
                    └─ UNIQUE (organization_id, user_id)          ← already exists
```

A user may hold different roles in different organizations (John: ADMIN in ABC, VIEWER in XYZ). The **active organization** is a property of the *session* (§11), not of the user.

### 6.2 Membership rules (server-enforced)

| Rule | Enforcement |
|---|---|
| An org always has ≥ 1 active OWNER | Row-lock the org's owner rows (`SELECT … FOR UPDATE`) inside the transaction before demoting/removing/suspending an Owner (fixes the current race) |
| Owners can promote/demote/remove anyone | — |
| Admins can manage Manager/Operator/Viewer only; cannot touch Owners **or other Admins** (decision D17) | Permission check + target-role check |
| Nobody can grant a role higher than their own | Validated on invite and role change |
| A user can leave an organization unless they are its last Owner | `DELETE /organizations/{id}/members/me` |
| Ownership transfer is explicit | `POST …/transfer-ownership` (re-authentication required) |
| Removing a member takes effect immediately | Already true (per-request DB check); additionally revoke that user's sessions *scoped to that org* |

### 6.3 Diagram — invitation flow

```
Owner/Admin                FlowPilot API                   Invitee (jane@abc.com)
    │ Settings → Members → Invite                                   │
    │ POST /organizations/{id}/invitations                          │
    │ {email, role}  ─────────────►│ authorise: user:invite         │
    │                              │ role ≤ inviter's role?          │
    │                              │ already a member? → 409 (generic)│
    │                              │ create invitation:              │
    │                              │   token = 256-bit random        │
    │                              │   store SHA-256(token) only     │
    │                              │   expires_at = now + 7 days     │
    │                              │ audit: member.invited           │
    │                              │ email ──────────────────────────►  link /accept-invite?token=…
    │ ◄── 201 (never the token)    │                                 │
    │                              │ ◄── GET /invitations/preview?token (org name, role, masked email)
    │                              │                                 │
    │                 ┌────────────┴──── invitee chooses ───────────┤
    │                 │                                             │
    │   already has account → sign in          no account → sign up (email locked to the invited
    │   (any method)                            address) or "Continue with Google" (Google email must
    │                 │                         equal the invited email and be verified)
    │                 └────────────┬──────────────────────────────── │
    │                              │ POST /invitations/accept {token} (authenticated)
    │                              │ checks: not expired / not used / not revoked,
    │                              │   authenticated email == invited email,
    │                              │   constant-time hash lookup, rate-limited
    │                              │ transaction: create membership(role), mark accepted_at,
    │                              │   (accepting via the mailbox proves email ownership)
    │                              │ audit: member.joined   → switch session to that org
    │ Members list shows Jane      │                                 │
```

Invitations can be **resent** (new token, old one invalidated), **revoked**, and **listed** with status. There is at most one pending invitation per (organization, email).

---

## 7. RBAC Architecture

### 7.1 Today — measured, not assumed

Role census across all 40 guarded routes **[CODE]**:

| Minimum role | Sites | Examples |
|---|---:|---|
| any member (`get_org_context`) | 14 (+3 via all-roles list) | list/get workflows, runs, analytics, versions |
| OPERATOR and above | 5 | start/cancel runs, approve/reject, inspect webhook |
| MANAGER and above | 14 | create/edit/publish workflows, resume runs, SLA, audit logs, rotate webhook key, test integration |
| ADMIN and above | 4 | create/update/delete integrations, delete workflow, add/remove members |
| OWNER only | 0 | (no Owner-exclusive action exists yet) |

Because all five sets are "minimum role" tiers, the existing rules map **losslessly** onto a permission catalog.

### 7.2 Target: permission catalog + role bundles

A single module (e.g. `backend/app/core/permissions.py`) defines `Permission` constants and a `ROLE_PERMISSIONS` mapping; routes depend on `require_permission("workflow:publish")` instead of a hand-written role list. **Phase 7 first reproduces today's behaviour exactly** (proved by a generated equivalence test), then introduces the new permissions.

| Permission | Min. role today | Notes |
|---|---|---|
| `workflow:view`, `execution:view`, `approval:view`, `integration:view`, `analytics:view` | any member | |
| `workflow:create`, `workflow:edit`, `workflow:publish`, `workflow:enable`, `workflow:disable`, `workflow:archive` | MANAGER | |
| `workflow:delete` | ADMIN | |
| `workflow:execute` (start / cancel run) | OPERATOR | |
| `execution:resume` | MANAGER | |
| `approval:decide` | OPERATOR | **plus** the per-approval `approver_role` level, already enforced server-side (`_check_approver_role`) — keep |
| `integration:manage` (create/update/delete) | ADMIN | |
| `integration:test` | MANAGER | |
| `audit:view` | MANAGER | docs claim Viewer; align docs or decide (D-list) |
| `webhook:inspect` | OPERATOR | |
| `webhook:rotate` | MANAGER | |
| **`webhook:secret:read`** *(new)* | **ADMIN** | **Fixes F-01.** Everyone else receives the secret masked (`••••`) |
| **`user:view`** *(new)* | any member | member directory (name, role) |
| **`user:invite`** *(new)* | ADMIN | Admin may not invite Owner/Admin |
| **`user:manage`** *(new)* — change role / suspend / remove | ADMIN | bounded by §6.2 rules |
| **`organization:manage`** *(new)* — rename, transfer ownership, security settings | OWNER | |

### 7.3 Roles — Owner / Admin / Member / Viewer

Your brief names four roles; the code has five. The recommended, **no-data-migration** reading:

| Your term | Stored role | Meaning |
|---|---|---|
| Owner | `OWNER` | Full control of the organization, including ownership transfer and security settings |
| Admin | `ADMIN` | Manages users (below Admin), integrations, workflows; cannot change Owners/Admins |
| **Member** | `MANAGER` (builds workflows) and `OPERATOR` (runs and approves) | Two bundles of "normal workflow operations". The UI may show both as "Member" until you decide to split or merge them (**decision D1**) |
| Viewer | `VIEWER` | Read-only |

Reasons to keep five: approval steps already encode `approver_role: MANAGER/OPERATOR` in saved workflow definitions; merging would silently change who may approve. A later collapse is possible once permissions (not roles) are what routes check.

### 7.4 Effective permissions are server-computed

`GET /auth/me` returns, for the active organization, the list of **effective permissions** (not just the role name). The frontend renders from that list; it never contains its own role arrays.

### 7.5 Diagram — authorization flow (every org-scoped request)

```
Request: PUT /organizations/{ORG}/workflows/{WF}
   │
   ▼
1. Authenticate ── Bearer access token valid? signature, exp, iss/aud, type=access
   │             ── jti not in Redis revocation list?  session (sid) not revoked?
   │             ── user exists and is_active?                         ──► else 401
   ▼
2. Tenant gate (get_org_context)  — uses the PATH organization, never the token claim
   │   membership(user, ORG) exists AND status=ACTIVE  ?               ──► else 404
   │   organization.status = ACTIVE ?                                  ──► else 403 suspended
   ▼
3. Permission gate (require_permission("workflow:edit"))
   │   permission ∈ ROLE_PERMISSIONS[membership.role] ?                ──► else 403
   ▼
4. Resource gate — object lookup ALWAYS filtered by organization_id
   │   SELECT … WHERE id = :WF AND organization_id = :ORG              ──► else 404
   ▼
5. Business rules (e.g. last-owner, role-escalation, approver level)   ──► 4xx
   ▼
6. Execute  →  audit_logs row (org-scoped event)  →  response
```

---

## 8. Platform Admin Architecture

### 8.1 Separation

Platform administration is a **different authorization scope** with its own dependency, routes and audit stream. It is *not* a highly-privileged organization role.

```
PLATFORM SCOPE  (FlowPilot staff)                 ORGANIZATION SCOPE  (customer staff)
────────────────────────────────                  ─────────────────────────────────────
identity:  users.platform_role                    identity:  organization_members.role
           PLATFORM_ADMIN | PLATFORM_SUPPORT                 OWNER | ADMIN | MANAGER | OPERATOR | VIEWER
routes:    /api/v1/platform/*                     routes:    /api/v1/organizations/{id}/*
guard:     require_platform_role(...)             guard:     get_org_context + require_permission(...)
sees:      org list, status, plan, owner,         sees:      its own workflows, runs, approvals,
           member COUNTS, usage totals,                      integrations, analytics, audit
           platform health                        
does NOT:  read customer workflows, run payloads, does NOT:  see other organizations or any
           credentials, approvals (by default)               platform endpoint
audit:     security_events (platform stream)      audit:     audit_logs (org stream)
```

### 8.2 Platform capabilities (initial)

| Capability | Role |
|---|---|
| List/search organizations; view status, plan, owner, member count, last activity, usage totals | ADMIN, SUPPORT (read) |
| Provision organization + invite initial Owner (Scenario 2) | ADMIN |
| Suspend / reactivate an organization (reason required) | ADMIN |
| Update plan/subscription metadata | ADMIN |
| Resend/revoke the initial-Owner invitation | ADMIN |
| Platform health and aggregate monitoring | ADMIN, SUPPORT |
| **Break-glass access to a tenant** (time-boxed, reason + ticket id, customer-visible audit entry) | ADMIN only; **off by default** (decision D7) |

### 8.3 Safeguards

- Platform roles can **only** be assigned by CLI/management command or by another platform admin — never through public registration, invitations or Google sign-in.
- Platform accounts: mandatory MFA before production use (Phase 14); until then restrict `/platform/*` by network allow-list and short session lifetime.
- Optionally served from a separate host (`admin.<domain>`) with a stricter CSP/CORS; the SPA's platform console is a separate lazy-loaded route group guarded by the platform role.
- `is_superuser` is retired from `/auth/me` and from any decision; it is not a substitute for `platform_role`.

### 8.4 Diagram — Platform Admin vs Organization Admin

```
                    ┌───────────────────────────────────────────────┐
                    │               FLOWPILOT PLATFORM              │
                    │                                               │
                    │   PLATFORM ADMIN / SUPPORT   (platform scope) │
                    │   • create / suspend / activate orgs          │
                    │   • plans, support, platform monitoring       │
                    │   ✗ no default access to tenant business data│
                    └───────────────┬───────────────────────────────┘
                                    │ provisions (invitation) / suspends
              ┌─────────────────────┴──────────────────────┐
              ▼                                            ▼
   ┌───────────────────────────┐              ┌───────────────────────────┐
   │ ORGANIZATION: ABC Corp    │              │ ORGANIZATION: XYZ Corp    │
   │ (organization scope)      │              │ (organization scope)      │
   │  OWNER   ─ org settings,  │              │  OWNER                    │
   │            transfer, all  │              │  ADMIN                    │
   │  ADMIN   ─ users ≤ Admin, │              │  MANAGER / OPERATOR       │
   │            integrations   │              │  VIEWER                   │
   │  MANAGER ─ build workflows│              │                           │
   │  OPERATOR─ run + approve  │      ✗ no cross-tenant access            │
   │  VIEWER  ─ read-only      │◄────────────►│  (404 even with a known ID)│
   └───────────────────────────┘              └───────────────────────────┘
```

---

## 9. Organization Admin Architecture

| Capability | OWNER | ADMIN |
|---|:-:|:-:|
| Invite users (Viewer/Operator/Manager) | ✔ | ✔ |
| Invite/promote to Admin | ✔ | ✘ |
| Invite/promote to Owner, transfer ownership | ✔ | ✘ |
| Change role / suspend / remove members (≤ own authority) | ✔ | ✔ (Manager/Operator/Viewer only) |
| Manage integrations | ✔ | ✔ |
| Manage workflows (incl. delete) | ✔ | ✔ |
| Read webhook secrets | ✔ | ✔ |
| Organization settings (rename, security policy, future: require MFA/SSO) | ✔ | ✘ |
| Delete organization | ✔ (re-auth; soft-delete) | ✘ |
| View audit log | ✔ | ✔ |

**Boundaries and protections:** the last Owner cannot be demoted, suspended, removed or leave; role changes and removals are audited with actor, target, old and new role; sensitive actions (ownership transfer, org delete, SSO enforcement) require **recent re-authentication** (§11.5).

---

## 10. Google OIDC Architecture

**Principle:** Google proves identity; FlowPilot decides everything else. Use a vetted OIDC client library — **Authlib** (decision D5) — rather than hand-assembling the protocol.

### 10.1 Protocol

OpenID Connect **authorization-code flow with PKCE**, executed by the **backend** (a confidential client holding the client secret). The browser never sees the code, the Google tokens, or any FlowPilot token in a URL.

| Concern | Decision |
|---|---|
| Discovery | `https://accounts.google.com/.well-known/openid-configuration` (cached) |
| Scopes | `openid email profile` only |
| `state` | Random, single-use, stored server-side (Redis, 10 min TTL) and bound to the browser by a short-lived `HttpOnly` cookie |
| `nonce` | Random, stored with `state`, must match the ID token |
| PKCE | `S256` code challenge; verifier kept server-side |
| ID-token validation | Signature via Google JWKS (cached, key rotation honoured); `iss ∈ {https://accounts.google.com, accounts.google.com}`; `aud == client_id`; `exp`/`iat`; `nonce`; **`email_verified == true`** |
| Identity key | **`(issuer, subject)`** — never the email |
| Redirect URIs | Exact-match allow-list; the post-login `redirect` parameter accepts relative app paths only (no open redirect) |
| `hd` (hosted domain) | Informational only. **Never** used to grant membership or roles |

### 10.2 Account resolution (the part that prevents account takeover)

```
Callback validated → claims {iss, sub, email, email_verified, name}

1. external_identities WHERE (issuer, subject) matches?
      YES → that user logs in (update last_login_at). DONE.
      NO  → continue

2. Is there a pending LINK intent bound to an authenticated session? (user clicked
   "Connect Google" in Settings → Security, after re-authentication)
      YES → create external_identities row for THAT user. DONE.
      NO  → continue

3. Does a FlowPilot user already exist with this email?
      YES → DO NOT auto-merge. Show: "An account with this email already exists. Sign in with
            your password, then connect Google in Settings → Security."  (audited: link.refused)
      NO  → continue

4. Sign-up policy (D3/D14) allows it?
      YES → create user (password_hash NULL, email_verified_at = now since Google verified it),
            create external_identities row, start session, route to onboarding / invitation.
      NO  → "Sign-ups are invite-only" (unless a valid invitation for this verified email exists)

Invitation acceptance via Google: the invitation's email must equal the verified Google email.
```

### 10.3 Diagram — Google OIDC flow

```
Browser            FlowPilot API (BFF)                    Google              Redis / Postgres
  │ click "Continue with Google"                             │                       │
  │ GET /auth/oidc/google/start?intent=login&redirect=/dashboard                      │
  │ ─────────────────────────►│ generate state, nonce, PKCE verifier ───────────────► store(state→…,10m)
  │                           │ Set-Cookie: oidc_state (HttpOnly, 10 min)              │
  │ ◄── 302 ──────────────────│ Location: accounts.google.com/o/oauth2/v2/auth         │
  │      ?client_id&redirect_uri&scope=openid email profile                           │
  │      &state&nonce&code_challenge=S256(...)                                         │
  │ ───────────────────────────────────────────────────────────►│ user signs in / consents
  │ ◄── 302 /api/v1/auth/oidc/google/callback?code&state ───────│                       │
  │ ─────────────────────────►│ verify state (cookie ↔ Redis), single use              │
  │                           │ POST token endpoint (code + verifier + client_secret) ►│
  │                           │ ◄── id_token, access_token (not stored)                │
  │                           │ validate id_token (JWKS, iss, aud, exp, nonce,         │
  │                           │   email_verified)                                      │
  │                           │ resolve account (§10.2) ───────────────────────────────► users /
  │                           │ create auth_sessions row; Set-Cookie: refresh          external_identities
  │ ◄── 302 /auth/callback ───│ (NO token in the URL)                                  │
  │ SPA loads → existing silent-refresh (cookie) → access token → GET /auth/me         │
```

This reuses the SPA's current "restore session from the refresh cookie" path, so the frontend needs only a button and a landing route.

### 10.4 Explicit non-goals

No Google API access beyond identity; no Google group/role mapping; no storing Google tokens; no password for Google-only users unless they set one (which then requires re-authentication via Google).

---

## 11. Session Architecture

### 11.1 What exists and what is kept

Keep: short-lived JWT access token, rotating refresh token, Redis for hot revocation, Argon2id, in-memory access token in the SPA, path-scoped HttpOnly refresh cookie. **Do not replace the architecture.** Add a durable server-side record of each login.

### 11.2 `auth_sessions` — the missing piece

One row per login (`sid`). Redis remains the fast path (rotation, revocation); Postgres is the system of record for "list my devices", "sign out everywhere", audit and reuse detection.

| Field | Purpose |
|---|---|
| `id` (`sid`) | Appears in the access and refresh tokens |
| `user_id`, `active_organization_id` | The session's active organization (fixes F-07) |
| `auth_method` (`password`/`google`/`sso`), `amr` | For step-up and MFA policy later |
| `created_at`, `last_used_at`, `expires_at` (absolute cap, e.g. 30 d), `revoked_at`, `revoked_reason` | Lifecycle |
| `current_refresh_jti_hash`, `family_id` | Reuse detection |
| `ip`, `user_agent` (label) | Device list |

### 11.3 Token design

| Token | Lifetime | Contents | Notes |
|---|---|---|---|
| Access (JWT) | 15 min (decision D9; today 30) | `sub, sid, org_id, jti, iss, aud, iat, exp, type` — **no `role`** | `role`/permissions are resolved from the DB per request; the claim only existed for display and is stale-prone |
| Refresh | 7 days sliding, 30 days absolute | opaque-style JWT with `sid, jti, family` | Cookie only. `SameSite=Strict`, `Secure`, `HttpOnly`, path `/api/v1/auth`, `__Secure-` prefix in production |

JWT signing: keep HS256 for a single-service deployment but add `iss`, `aud` and a `kid` header, and accept **two** signing keys during rotation (current + previous). Asymmetric signing (EdDSA/RS256) is only warranted if a second service must verify tokens.

### 11.4 Refresh, reuse detection, logout

- `/auth/refresh` rotates the token **within the same session and same active organization**.
- If a **consumed** refresh token is presented again, the whole family/session is revoked and a `session.reuse_detected` event is written (standard stolen-token response).
- `/auth/logout` accepts the refresh cookie alone, revokes the session (and the access `jti` if one is presented), **always** clears the cookie, and returns 204 even when the token is already invalid (fixes F-02).
- `POST /auth/logout-all` and "revoke this device" operate on `auth_sessions`.
- Password change/reset, user deactivation, and MFA reset revoke all of the user's sessions.
- Cookie-authenticated mutations require a custom header (`X-FlowPilot-CSRF`) **and** a matching `Origin` in **every** environment, not just production (fixes F-11).

### 11.5 Re-authentication (step-up)

Sensitive actions — ownership transfer, org deletion, linking an identity, changing email/password, enabling SSO enforcement — require the session to have authenticated within the last N minutes (`auth_time`); otherwise `403 reauth_required`.

### 11.6 Diagram — organization switching

```
Today (client-only, lost on refresh)           Target (server-side, durable)

Header dropdown                                Header dropdown
   │ setActiveOrganizationId(x)                   │ POST /auth/switch-organization {organization_id}
   │ (header X-Organization-Id ignored)           ▼
   ▼                                           API: membership(user, org) ACTIVE and org ACTIVE?  ─no→ 404
page reload / refresh →                           │ yes
re-issues token for memberships[0]  ✗            │ update auth_sessions.active_organization_id
                                                  │ issue new access token {org_id = new}
                                                  │ security_events: org.switched
                                                  ▼
                                               SPA: replaces access token, refetches /auth/me
                                               (effective permissions for the NEW org),
                                               invalidates TanStack/React caches, navigates to /dashboard
                                               refresh later → SAME active org (stored on the session)
```

Authorization never trusts the token's `org_id`; it uses the path organization (§12). The active org exists to choose defaults and to keep the UI consistent.

---

## 12. Tenant Isolation Architecture

### 12.1 Current model (kept)

Every org-scoped route has `{organization_id}` in the path; `get_org_context` verifies membership for **that** org; resource lookups include `organization_id` in the `WHERE` clause. Verified resource-by-resource:

| Resource | Owns `organization_id`? | By-ID lookups scoped? | Cross-tenant test |
|---|---|---|---|
| workflows | yes | `_get_workflow_or_404(db, org, id)` | yes |
| workflow_versions / steps / connections | via `workflow_id` (steps/connections have no org column) | parent checked first | yes (via workflows) |
| workflow_runs | yes | `engine.cancel_run/resume_run` filter by org | yes |
| workflow_step_runs | via run | parent checked first | yes |
| approval_requests | yes | filtered | yes |
| integrations | yes | filtered | yes |
| audit_logs | yes | filtered | yes |
| analytics (raw SQL) | uses `:org_id` in every query | — | yes |
| idempotency / usage records | yes | — | partial |

### 12.2 Gaps to close

1. **Coverage depends on authors remembering the filter.** Add a *generated* contract test (§18): enumerate every route containing `{organization_id}` from `app.routes`, call it with a valid token of a **non-member** and assert 404 (and 403/404 for a lower-privileged member where applicable). New routes are covered automatically.
2. **Static check:** a test/lint that fails if a router queries a tenant-owned model without `organization_id` in the `WHERE` (AST scan of `routers/` and `services/`).
3. **Suspended organizations** return 403 at the gate.
4. **Public webhook route** resolves the org from `webhook_key`, then HMAC-verifies; add a test that a key never resolves another tenant's workflow.
5. **Background jobs** (Celery) already receive `organization_id` explicitly; add an assertion helper so a task cannot run without it.
6. **Optional defence in depth — PostgreSQL Row-Level Security (decision D10):** set `SET LOCAL app.current_org = :id` per request/transaction and add RLS policies on tenant tables. Strong safety net, but it needs a dedicated non-owner DB role, `SET LOCAL` discipline with connection pooling, and care for Celery, migrations and platform queries. **Recommendation:** do items 1–5 first; adopt RLS later if compliance requires it.

### 12.3 Diagram — tenant isolation

```
 ABC user (token: sub=U1)                         XYZ user (token: sub=U2)
        │                                                  │
        │ GET /organizations/ABC/workflows/W-xyz           │
        ▼                                                  
  ┌───────────────────────────────────────────────────────────────────────┐
  │ Gate 1  membership(U1, ABC) ACTIVE?  yes                              │
  │ Gate 2  permission workflow:view?    yes                              │
  │ Gate 3  SELECT … FROM workflows WHERE id=W-xyz AND organization_id=ABC│
  │                         └──► 0 rows  →  404 "Workflow not found"      │
  └───────────────────────────────────────────────────────────────────────┘
        │
        │ GET /organizations/XYZ/workflows/W-xyz
        ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │ Gate 1  membership(U1, XYZ) ACTIVE?  NO → 404 "Organization not found"│
  └───────────────────────────────────────────────────────────────────────┘
   (same response whether the org or the object exists — no enumeration)

   Optional layer:  Postgres RLS  app.current_org = ABC  → rows of XYZ are invisible even to a buggy query
```

---

## 13. Database Architecture

Conventions: UUID primary keys and `created_at/updated_at` via the existing mixins; **all changes are additive** in the first release (expand phase). Existing table names are kept — notably `organization_members` stays (your "organization_memberships" concept).

### 13.1 Changes to existing tables

**`users` (ALTER)**

| Column | Change | Reason |
|---|---|---|
| `password_hash` | **nullable** | Google-only users |
| `email_verified_at` | add, timestamptz null | Verification policy (D4) |
| `platform_role` | add, varchar null, CHECK in (`PLATFORM_ADMIN`,`PLATFORM_SUPPORT`) | Platform scope (F-03) |
| `password_changed_at`, `last_login_at` | add | Session invalidation, security UX |
| unique index on `lower(email)` | add | Case-insensitive uniqueness enforced by the DB (today only the app lower-cases) |
| `is_superuser` | **deprecate** (stop using/returning) | Dead concept; drop in the contract phase |

**`organizations` (ALTER)** — add `status` (`PENDING_ACTIVATION`/`ACTIVE`/`SUSPENDED`, default `ACTIVE`), `created_via`, `created_by_user_id` (nullable FK), `plan` (nullable), `suspended_at`, `suspension_reason`.

**`organization_members` (ALTER)** — add `status` (`ACTIVE`/`SUSPENDED`, default `ACTIVE`), `invited_by_user_id` (nullable), `joined_at`; add `CHECK (role IN ('OWNER','ADMIN','MANAGER','OPERATOR','VIEWER'))`; keep `UNIQUE (organization_id, user_id)`.

### 13.2 New tables

**`invitations`**

| Column | Notes |
|---|---|
| `id`, `organization_id` (FK, cascade) | |
| `email` | lower-cased |
| `role` | CHECK as above; `OWNER` only creatable by platform admin/Owner |
| `token_hash` | SHA-256 of the 256-bit token; **the raw token is never stored** |
| `invited_by_user_id`, `created_at`, `expires_at` | default 7 days |
| `accepted_at`, `accepted_by_user_id`, `revoked_at` | lifecycle |
| Partial unique index | `(organization_id, email)` where `accepted_at IS NULL AND revoked_at IS NULL` |

**`external_identities`** — `id`, `user_id` (FK cascade), `provider` (`google`), `issuer`, `subject`, `email_at_link`, `email_verified`, `created_at`, `last_login_at`; **`UNIQUE (issuer, subject)`**; index on `user_id`. (Authorization never reads the email column.)

**`auth_sessions`** — fields in §11.2; indexes on `(user_id, revoked_at)` and `family_id`.

**`email_tokens`** — `id`, `user_id`, `purpose` (`verify_email`/`reset_password`), `token_hash`, `expires_at`, `used_at`; single use; short TTL (reset 30 min, verify 24 h).

**`security_events`** (append-only) — `occurred_at`, `event_type`, `user_id` (null), `organization_id` (null), `session_id` (null), `ip`, `user_agent`, `outcome`, `details` (JSON, sanitized). Used for events that have no organization (failed login, password reset, platform actions). Organization-relevant events (member invited/joined/removed/role changed, org suspended) are **also** written to the existing `audit_logs` so Owners/Admins see them.

**Future (Phase 13):** `oidc_providers` — per-organization issuer, client_id, encrypted client secret (reuse `core/encryption.py`), `enforce_sso`, default role, allowed email domains.

### 13.3 Relationships

```
users 1──* organization_members *──1 organizations
users 1──* external_identities
users 1──* auth_sessions            (active_organization_id → organizations)
users 1──* email_tokens
organizations 1──* invitations      (invited_by → users)
organizations 1──* audit_logs       (existing)
security_events  → user / organization / session (all nullable)
```

### 13.4 Backfill rules (existing data)

`organization_members.status='ACTIVE'`, `organizations.status='ACTIVE'`, `created_via='SELF_SERVICE'`; `users.email_verified_at` — **grandfather existing users** as verified (decision D16); no platform admins created by migration (CLI only).

---

## 14. API Architecture

Status legend: **KEEP** unchanged · **CHANGE** behaviour/shape changes · **NEW**.

### 14.1 Authentication & identity — `/api/v1/auth`

| Method & path | Status | Notes |
|---|---|---|
| `POST /register` | CHANGE | Generic response (no enumeration); email verification; `organization_name` removed from signup → separate onboarding (D3) |
| `POST /login` | CHANGE | Dummy-hash timing equalisation; per-account throttling; creates `auth_sessions`; refresh cookie only |
| `POST /refresh` | CHANGE | Cookie-only for browsers; preserves active org; reuse detection; CSRF header + Origin in all envs |
| `POST /logout` | CHANGE | Works with cookie alone; always clears cookie; 204 (F-02) |
| `POST /logout-all` | NEW | Revoke all of the user's sessions |
| `GET /me` | CHANGE | Adds effective permissions for the active org, memberships with status, `platform_role` presence; removes `is_superuser`; role from DB, not token |
| `POST /switch-organization` | NEW | §11.6 |
| `POST /verify-email`, `POST /resend-verification` | NEW | |
| `POST /forgot-password`, `POST /reset-password` | NEW | Generic responses; single-use tokens; revokes sessions |
| `POST /change-password` | NEW | Requires current password; revokes other sessions |
| `GET /sessions`, `DELETE /sessions/{sid}` | NEW | Device list / revoke |
| `GET /oidc/google/start`, `GET /oidc/google/callback` | NEW | §10 |
| `POST /identities/link/google/start`, `GET /identities`, `DELETE /identities/{id}` | NEW | Authenticated, re-auth required; cannot unlink the last login method |

### 14.2 Organizations & members — `/api/v1/organizations`

| Method & path | Permission | Status |
|---|---|---|
| `POST /organizations` | authenticated + flag + quota | CHANGE |
| `GET /organizations` | authenticated | KEEP |
| `GET/PATCH /organizations/{id}` | member / `organization:manage` | PATCH NEW |
| `GET /organizations/{id}/members` | `user:view` | **NEW** (does not exist today) |
| `PATCH /organizations/{id}/members/{user_id}` | `user:manage` | NEW (role, status) |
| `DELETE /organizations/{id}/members/{user_id}` | `user:manage` | CHANGE (row lock, audit) |
| `DELETE /organizations/{id}/members/me` | member | NEW (leave) |
| `POST /organizations/{id}/transfer-ownership` | `organization:manage` + re-auth | NEW |
| `POST /organizations/{id}/members` (add existing user by email) | — | **DEPRECATE** behind `ALLOW_DIRECT_MEMBER_ADD` (default off in production); 10 backend test files use it as a fixture → provide a test helper first (D12) |
| `POST /organizations/{id}/invitations`, `GET`, `DELETE /{inv}`, `POST /{inv}/resend` | `user:invite` | NEW |
| `GET /invitations/preview?token`, `POST /invitations/accept` | token + authenticated | NEW |

### 14.3 Platform — `/api/v1/platform` (platform scope only)

`GET /organizations`, `GET /organizations/{id}`, `POST /organizations` (provision + invite Owner), `POST /organizations/{id}/suspend`, `/activate`, `PATCH /organizations/{id}/plan`, `POST /organizations/{id}/owner-invitation/resend`, `GET /health`. Optional (D7): `POST /organizations/{id}/break-glass` (time-boxed, audited).

### 14.4 Existing resource endpoints

Unchanged in shape. Changes are limited to: guards move from role lists to `require_permission`, **webhook secrets are masked** unless `webhook:secret:read` (F-01), and suspended organizations return 403.

---

## 15. Frontend Architecture

### 15.1 Principles

Server-driven: the SPA reads effective permissions from `/auth/me` and **never** embeds role arrays; switching organizations calls the server; tokens stay in memory; the refresh token is never visible to JavaScript.

### 15.2 Changes by area

| Area | Files (current) | Change |
|---|---|---|
| Login | `pages/auth/LoginPage.tsx` | Add "Continue with Google", "Forgot password", verified-email notices, generic error text |
| Registration | `pages/auth/RegisterPage.tsx` | Drop optional org name; remove password auto-login if verification is required; show invitation context when arriving from an invite |
| Onboarding (new) | `pages/onboarding/CreateOrganizationPage.tsx` | Shown when a verified user has no memberships (fixes F-15); honours the self-service flag |
| Auth state | `context/AuthContext.tsx`, `services/apiClient.ts`, `services/authService.ts` | Stop storing the refresh token; `switchOrganization` calls `POST /auth/switch-organization`; persist nothing client-side; handle `reauth_required` |
| Permissions (new) | `hooks/usePermissions.ts` (+ `<Can permission="…">`) | Single source: effective permissions from `/auth/me`; replace the hard-coded role checks in 7 files |
| Routes | `routes/AppRoutes.tsx`, `components/auth/ProtectedRoute.tsx` | Add `/accept-invite`, `/auth/callback`, `/onboarding`, `/verify-email`, `/reset-password`; add permission-gated and platform-gated route wrappers |
| Org switcher | `components/layout/Header.tsx` | Server-backed; clears cached queries; shows suspended orgs distinctly |
| Members (real) | `pages/settings/SettingsPage.tsx` (placeholder at L280) | Real list, invite dialog, pending invitations (resend/revoke), role change, suspend, remove, transfer ownership |
| Security tab (real) | same | Active sessions, sign out everywhere, linked identities (Google), change password, (later) MFA; remove the incorrect "60 min TTL" text |
| Platform console (new) | `pages/platform/*` (lazy, separate route group) | Org list, provision, suspend/activate |
| Webhook secrets | workflow editor | Show masked secret; reveal/rotate only with `webhook:secret:read` |

### 15.3 UX rules

Hiding or disabling a control is a usability aid only; every action must also be rejected by the API. Error messages for authentication stay generic. After an organization switch, all cached server data is invalidated.

---

## 16. Security Architecture

### 16.1 Control matrix

| Threat | Today | Target control | Phase |
|---|---|---|---|
| Privilege escalation via leaked secrets (F-01) | Viewer can read webhook secret | Mask secrets; `webhook:secret:read` ≥ ADMIN; rotate existing secrets after deploy | 7a |
| IDOR / BOLA | Org + object filter on every query; tests per family | Generated contract test over every org route + static scan; optional RLS | 8 |
| Role-based privilege escalation | Admin cannot grant Owner | No-role-above-own rule everywhere; admin cannot touch peers; re-auth for ownership changes | 2, 4 |
| Brute force / credential stuffing | 5/min/IP, spoofable header | Per-account + per-IP limits; trusted-proxy handling; progressive lockout; breached-password check (HIBP k-anonymity); audit | 5a |
| User enumeration | 409 on register, 404 on add-member, login timing | Generic responses, dummy hash, invitation flow replaces add-by-email | 4, 5 |
| Session theft / fixation | Refresh rotation; no reuse detection | Family reuse detection; `sid`; device list; revoke-all; Strict cookie | 5 |
| Logout ineffective (F-02) | Broken when access token expired | Cookie-only logout, always clears | 5a |
| CSRF | SameSite=Lax; Origin check in prod only | Custom header + Origin in all envs; SameSite=Strict for the refresh cookie | 5 |
| XSS impact | Access token in memory; refresh token also in memory | Refresh token cookie-only; strict CSP already present | 5 |
| JWT misuse | HS256, no iss/aud/kid | `iss`/`aud`/`kid`, two-key rotation, no `role` claim | 5 |
| Account takeover via account linking | n/a | Link only by `(issuer, subject)`; never merge on email; authenticated + re-auth linking; refuse and audit collisions | 6 |
| OIDC attacks (code injection, mix-up, replay) | n/a | PKCE, `state` + `nonce`, exact redirect URIs, `aud`/`iss` checks, single-use state | 6 |
| Invitation abuse | n/a | Hashed single-use tokens, 7-day expiry, email-bound, rate-limited accept, role ≤ inviter | 4 |
| Unverified email abuse | none | Verification policy (D4); Google `email_verified` required | 5, 6 |
| Password reset takeover | none | Hashed single-use tokens, 30-min TTL, generic responses, revoke sessions | 5c |
| Platform admin compromise | no platform layer | MFA, network allow-list, short sessions, audit stream, no default tenant-data access | 9, 14 |
| Silent security events | none audited | `security_events` + org audit for membership changes | 5, 11 |
| Config drift (F-13) | prod compose/docs mismatch | One documented env contract + a startup self-check + CI check | 11 |
| CORS | explicit origins, credentials | Keep; add test that `*` + credentials is impossible; per-env lists | 11 |
| DoS on Argon2 | rate limit only | Rate limit before hashing; bounded concurrency for hash operations | 5a |

### 16.2 Audit coverage (target)

Org stream (`audit_logs`): `member.invited`, `member.invitation_revoked`, `member.joined`, `member.role_changed`, `member.suspended`, `member.removed`, `member.left`, `org.ownership_transferred`, `org.updated`, `org.suspended/activated`.
Security stream (`security_events`): `login.success/failure`, `logout`, `session.reuse_detected`, `session.revoked`, `password.changed/reset_requested/reset_completed`, `email.verified`, `identity.linked/unlinked/link_refused`, `org.switched`, `platform.*` (every platform action, including who and why).

---

## 17. Migration Strategy

**Approach: expand → migrate → contract**, each release independently deployable and reversible.

| Step | Content | Rollback |
|---|---|---|
| 0. Safety nets | Add tenant-isolation contract test + role-matrix test against the **current** code | n/a (tests only) |
| 1. Hotfixes | Mask webhook secrets; cookie-only logout; trusted-proxy aware throttle | Revert commit |
| 2. Expand schema (migration `0004`) | Add nullable/defaulted columns and new tables; backfill statuses; **no behaviour change** | Down-migration drops additions |
| 3. Dual-read | Code reads new columns when present; old tokens still accepted (no `sid`) for one access-token lifetime | Feature flag off |
| 4. Switch behaviour behind flags | `PERMISSION_CATALOG_ENABLED`, `INVITATIONS_ENABLED`, `SESSIONS_V2_ENABLED`, `SELF_SERVICE_ORG_CREATION_ENABLED`, `ALLOW_DIRECT_MEMBER_ADD`, `GOOGLE_OIDC_ENABLED` | Flip flag |
| 5. Contract | After a full release cycle: drop `is_superuser`, remove deprecated endpoints/fields, make `email_verified_at` meaningful for new users only | Restore from backup/migration |

Specific points:

- **JWT format change:** accept tokens without `sid` for ≤ one access lifetime after deploy, then require it.
- **Secrets:** after masking (F-01), **rotate webhook secrets** for workflows whose secret could have been read by a Viewer; add a one-off script that lists affected workflows.
- **Existing users:** grandfathered as verified (D16); no forced password reset.
- **`POST /members` consumers:** 10 test files build RBAC fixtures through it. Add a shared test helper (direct DB insert) **before** deprecating the endpoint, then migrate tests.
- **Environment contract (F-13):** fix before any production rollout; document and validate at startup.
- **Seed/demo scripts** (`backend/scripts/seed_demo.py`) are updated alongside.

---

## 18. Testing Strategy

Current baseline: 277 backend tests, 72 frontend tests, all passing. **No existing test is allowed to be weakened;** tests that exercise intentionally changed behaviour (add-member-by-email, refresh body token, `is_superuser` in `/me`) are updated explicitly in the phase that changes them.

| Layer | What | Where |
|---|---|---|
| **Role-matrix (generated)** | For every route × every role, assert the expected status derived from `ROLE_PERMISSIONS`; first run against *today's* behaviour as the characterisation test, so Phase 7 can prove equivalence | `tests/security/test_role_matrix.py` |
| **Tenant-isolation contract (generated)** | Enumerate `{organization_id}` routes from `app.routes`; non-member token → 404; cross-tenant object ID → 404 | `tests/security/test_tenant_contract.py` |
| Static scan | AST check that tenant-model queries include `organization_id` | `tests/security/test_tenant_static.py` |
| Unit | Permission catalog, role-escalation rules, last-owner lock, invitation token hashing/expiry, OIDC validators, `redirect` sanitiser, session reuse detection, JWT key rotation | `tests/unit/` |
| Auth integration | Login timing equalisation, throttling (spoofed `X-Forwarded-For` ignored), logout with cookie only, refresh keeps active org, reuse detection revokes family, password reset flow, email verification, CSRF header | `tests/api/` |
| Invitation integration | Create/accept/expire/revoke/resend, wrong-email accept, reused token, role > inviter, Admin cannot invite Owner, accepting via Google with mismatched email | `tests/api/` |
| OIDC | Run against a **local fake IdP** (test signing key + stub discovery/JWKS/token endpoints). Negative cases: bad state, replayed state, wrong nonce, wrong `aud`, wrong `iss`, expired, `email_verified=false`, email collision (must **not** link), link flow requires re-auth | `tests/api/test_oidc_google.py` |
| Platform | Platform role required; org admin cannot reach `/platform/*`; platform admin cannot read tenant data; every platform action audited; suspend → 403 | `tests/api/` |
| Frontend unit | `usePermissions`, protected/permission routes, switch-org invalidates caches, members page states, accept-invite page | Vitest |
| **E2E (browser)** | Register → verify → create org → invite → accept (second browser context) → role change → switch org → logout → refresh blocked; Google flow with the fake IdP; platform provisioning flow. Recommend adding Playwright as a **dev** dependency (needs approval; not installed by this plan) | `e2e/` |
| Security regression | Webhook secret never returned to Viewer; cookie flags; CSP unchanged; production config validator | existing `tests/security/` extended |

Quality gates: ruff/mypy/format clean; no skipped isolation tests; coverage of `core/security.py`, `api/deps.py`, auth/org/invitation/platform routers ≥ 90%.

---

## 19. Future Enterprise SSO (Phase 13)

The Google design is deliberately provider-agnostic, so Microsoft Entra ID, Okta, Auth0, Keycloak and any OIDC provider reuse the same code path:

- `oidc_providers` table (per organization): `issuer`, `client_id`, encrypted `client_secret`, optional `allowed_email_domains`, `default_role`, `enforce_sso`, `jit_provisioning`.
- Discovery + JWKS from the issuer's well-known document; the same `start/callback` handlers with a provider registry; org-specific entry point `/auth/sso/{org_slug}/start`.
- Identity key stays `(issuer, subject)` in `external_identities`; role is still decided by FlowPilot (default role on first JIT login, adjustable by the org; **IdP group→role mapping is an optional later feature, never the default**).
- `enforce_sso`: password and Google login blocked for that organization's members (except a documented break-glass Owner path).
- Entra-specific notes: multi-tenant `common` issuer must be validated per tenant (`tid`); Okta custom authorization servers use their own issuer.
- Out of scope until requested: SAML 2.0 and SCIM provisioning (the model allows them later; they would be separate adapters).

---

## 20. Future MFA / Passkeys (Phase 14)

1. **TOTP** (authenticator apps) with one-time recovery codes; secrets encrypted with the existing encryption helper; enrol/verify/disable flows requiring re-authentication.
2. **Policy:** per-organization `require_mfa`; **mandatory for platform roles** (blocks Phase 9 go-live in production, or use the interim network allow-list).
3. **Step-up:** sessions carry `amr`/`auth_time`; sensitive actions demand fresh MFA.
4. **Passkeys / WebAuthn** (`py_webauthn` on the server, `navigator.credentials` in the SPA) as a phishing-resistant primary or second factor; credentials stored per user with sign-count tracking.
5. Account recovery policy (recovery codes, admin-assisted reset with audit) designed before MFA is enforced.

---

## 21. Phase-by-Phase Implementation Plan

Each phase lists the twelve requested items. "Risk" is delivery/regression risk. Phases are **not** strictly sequential; the recommended execution order is in §24.5.

> **Safety-net pre-work (before Phase 1):** generate and merge the *role-matrix* and *tenant-isolation contract* tests against current behaviour (§18). Several later phases are only safe because of them.

---

### PHASE 0 — CURRENT STATE AUDIT *(complete — this document)*

1. **Objective:** Establish facts before designing.
2. **Current implementation:** §2.
3. **Required changes:** none (read-only). Outputs: findings register F-01…F-17, decisions list.
4. **Files likely affected:** `docs/AUTHENTICATION_ORGANIZATION_ARCHITECTURE_PLAN.md` only.
5. **Database changes:** none. 6. **API changes:** none. 7. **Frontend changes:** none.
8. **Security considerations:** F-01 and F-02 are already exploitable on the current build; treat the hotfixes as urgent regardless of the redesign schedule.
9. **Tests required:** none new.
10. **Dependencies:** none.
11. **Risk:** none. 12. **Migration required:** no.

---

### PHASE 1 — ORGANIZATION MODEL

1. **Objective:** Give organizations and memberships a lifecycle (status, provenance) so suspension, provisioning and activation are possible.
2. **Current implementation:** `organizations` has only name/slug; `organization_members` has role only; `get_org_context` checks nothing about status (F-12).
3. **Required changes:** add org `status`, `created_via`, `created_by_user_id`, `plan`, suspension fields; add membership `status`, `invited_by_user_id`, `joined_at`; `get_org_context` rejects suspended orgs (403) and suspended memberships (404); reserved-slug list; race-safe slug generation.
4. **Files likely affected:** `models/organization.py`, `models/membership.py`, `api/deps.py`, `routers/organizations.py`, `routers/auth.py` (register path), `schemas/organization.py`, new `alembic/versions/0004_*`, `scripts/seed_demo.py`.
5. **Database changes:** additive columns + CHECK constraints (§13.1); backfill ACTIVE/SELF_SERVICE.
6. **API changes:** `GET /organizations/{id}` returns status; 403 `organization_suspended`. No new endpoints.
7. **Frontend changes:** show suspended state in the org switcher; handle 403 suspended on org routes.
8. **Security considerations:** suspension must be checked at the **gate** so no route can forget it; ensure suspended orgs' public webhooks are also refused.
9. **Tests required:** gate tests (suspended org → 403 on every org route — covered by the contract test); migration up/down test; slug race test.
10. **Dependencies:** safety-net tests.
11. **Risk:** Low–Medium (touches the central dependency).
12. **Migration required:** **Yes** (`0004`, additive).

---

### PHASE 2 — USER / MEMBERSHIP / ROLE MODEL

1. **Objective:** Define Owner/Admin/Member/Viewer semantics, complete member management, and make the last-owner rule safe.
2. **Current implementation:** five roles; add/remove member only; no list, role change, transfer, or leave; last-owner check has no lock (F-10, F-12).
3. **Required changes:** adopt the role semantics in §7.3 (decision D1); `GET members`, `PATCH member`, `DELETE members/me`, `transfer-ownership`; row-locked owner-count checks; "no role above own" and "Admin cannot manage Admin/Owner" rules; DB CHECK on `role`; centralise `ROLE_LEVELS` (move out of `approvals.py`).
4. **Files likely affected:** `models/membership.py`, `routers/organizations.py`, new `core/permissions.py` (rank + bundles), `routers/approvals.py` (use shared ranks), `schemas/organization.py`.
5. **Database changes:** role CHECK constraint (membership columns come from Phase 1).
6. **API changes:** NEW `GET/PATCH/DELETE members…`, `transfer-ownership`, `members/me`.
7. **Frontend changes:** none yet (consumed in Phase 10).
8. **Security considerations:** concurrency (two Owners demoting each other), escalation paths (Admin promoting themselves), audit every change.
9. **Tests required:** concurrency test for last Owner; escalation matrix; audit rows written; existing org tests updated for the new rules.
10. **Dependencies:** Phase 1.
11. **Risk:** Medium (behavioural rules), mitigated by tests.
12. **Migration required:** Yes (CHECK constraint; verify no invalid role strings first).

---

### PHASE 3 — ORGANIZATION CREATION

1. **Objective:** Support self-service creation and platform provisioning safely, and remove the "no organization" dead-end.
2. **Current implementation:** `/auth/register` may create an org; `POST /organizations` is open and unlimited; no UI to create an org after signup (F-12, F-15).
3. **Required changes:** `SELF_SERVICE_ORG_CREATION_ENABLED` flag + owned-org quota (D3, D11); move org creation out of signup into an onboarding step; require a verified email before creating an org (D4); enterprise provisioning is delivered by Phase 9 + Phase 4 (this phase prepares `PENDING_ACTIVATION` handling).
4. **Files likely affected:** `routers/auth.py`, `routers/organizations.py`, `core/config.py` (flags), `schemas/auth.py`, frontend `RegisterPage.tsx`, new `CreateOrganizationPage.tsx`, `AppRoutes.tsx`.
5. **Database changes:** none beyond Phase 1.
6. **API changes:** CHANGE `POST /auth/register` (no org name), CHANGE `POST /organizations` (flag, quota, verification).
7. **Frontend changes:** onboarding route + page; guard that sends org-less users there.
8. **Security considerations:** abuse (org spam) → quota + rate limit; reserved slugs; creator becomes OWNER atomically.
9. **Tests required:** flag off → 403; quota; unverified user blocked; onboarding E2E; register no longer creates an org.
10. **Dependencies:** Phase 1; verification from Phase 5c for the verified-email gate.
11. **Risk:** Medium (changes the signup path; many tests register + create org).
12. **Migration required:** No (flags/config).

---

### PHASE 4 — INVITATION SYSTEM

1. **Objective:** Let Owners/Admins onboard their own people without platform support, and retire add-by-email.
2. **Current implementation:** direct add of an existing user, no consent, account-existence leak (F-04); no email capability.
3. **Required changes:** `invitations` table; `EmailService` abstraction (SMTP/provider adapter, console/Mailpit in dev, Celery task for sending) — decision D2; endpoints per §14.2; accept flow bound to the authenticated email; `ALLOW_DIRECT_MEMBER_ADD` flag (off in production); test fixture helper replacing `POST /members` in tests.
4. **Files likely affected:** new `models/invitation.py`, `services/email/*`, `routers/invitations.py`, `routers/organizations.py`, `workers/tasks.py`, `core/config.py`, tests (10 files use `/members`), frontend invite/accept pages.
5. **Database changes:** NEW `invitations` (+ partial unique index).
6. **API changes:** NEW invitation endpoints; DEPRECATE `POST …/members`.
7. **Frontend changes:** invite dialog, pending list, accept-invite page.
8. **Security considerations:** hashed single-use tokens, expiry, email-bound acceptance, role ≤ inviter, rate limits, no account-existence signal, link never logged.
9. **Tests required:** §18 invitation matrix; token entropy/hash; expiry; replay; mail rendering (no secrets in logs).
10. **Dependencies:** Phases 1, 2; email infra is built here and reused by Phase 5.
11. **Risk:** Medium (new external dependency: email delivery).
12. **Migration required:** Yes (`invitations`).

---

### PHASE 5 — AUTHENTICATION HARDENING

Delivered in three slices so the urgent fixes ship first.

**5a — urgent fixes:** cookie-only logout that always clears (F-02); trusted-proxy-aware client IP and per-account + per-IP throttling with sensible limits (F-05); dummy-hash timing equalisation (F-16).
**5b — sessions:** `auth_sessions`, `sid`, org-preserving refresh, `POST /auth/switch-organization`, family reuse detection, device list/revoke, cookie-only refresh with CSRF header + Origin in all envs, `iss/aud/kid` and two-key rotation, drop `role` claim, `/auth/me` role from DB (F-06, F-07, F-11, F-14).
**5c — account lifecycle:** email verification, password reset, password change, auth events in `security_events` (F-08, F-09).

1. **Objective:** Make the existing email/password + session architecture production-grade without replacing it.
2. **Current implementation:** §2 rows "Access token", "Refresh token", "Sessions", "Rate limiting".
3. **Required changes:** as above; policy decisions D4, D8, D9.
4. **Files likely affected:** `routers/auth.py`, `core/security.py`, `core/rate_limit.py`, `api/deps.py`, `core/config.py`, new `models/auth_session.py`, `models/email_token.py`, `models/security_event.py`, `schemas/auth.py`, `main.py` (proxy headers), frontend `apiClient.ts`, `AuthContext.tsx`, `authService.ts`.
5. **Database changes:** NEW `auth_sessions`, `email_tokens`, `security_events`; `users.email_verified_at`, `password_changed_at`, `last_login_at`, lower-email unique index.
6. **API changes:** per §14.1.
7. **Frontend changes:** stop storing the refresh token; switch-org call; forgot/reset/verify pages; Security tab (sessions).
8. **Security considerations:** reuse detection false positives (multi-tab refresh races — keep the frontend mutex and add a short grace window), cookie `Strict` vs the Google redirect (cookie is set *by* the callback response, so Strict is compatible), throttle before hashing, never log tokens.
9. **Tests required:** §18 auth integration list; existing refresh/logout/cookie tests updated.
10. **Dependencies:** 5a none; 5b needs the `0004` migration; 5c needs Phase 4's email service.
11. **Risk:** **High** for 5b (touches every authenticated request and the SPA session logic); Low for 5a.
12. **Migration required:** Yes (5b, 5c). 5a: no.

---

### PHASE 6 — GOOGLE OIDC

1. **Objective:** Add "Continue with Google" with identity linking that cannot cause account takeover.
2. **Current implementation:** none.
3. **Required changes:** `external_identities`; Authlib-based start/callback (§10); account resolution (§10.2); authenticated link/unlink with re-auth; invitation acceptance via Google; config (`GOOGLE_CLIENT_ID/SECRET`, redirect URIs, flag); allow `password_hash IS NULL`.
4. **Files likely affected:** new `routers/oidc.py`, `services/oidc/*`, `models/external_identity.py`, `routers/auth.py`, `core/config.py`, `requirements.txt` (Authlib — approval needed), frontend `LoginPage.tsx`, `RegisterPage.tsx`, `AuthCallbackPage.tsx`, Security tab.
5. **Database changes:** NEW `external_identities`; `users.password_hash` nullable.
6. **API changes:** NEW `/auth/oidc/google/*`, `/auth/identities*`.
7. **Frontend changes:** Google button, callback landing, linked-identities UI.
8. **Security considerations:** §10 and §16 (state/nonce/PKCE, JWKS, `email_verified`, no email-based merge, `hd` never trusted, open-redirect protection, unlink rules).
9. **Tests required:** §18 OIDC suite with a fake IdP; collision refusal; link re-auth.
10. **Dependencies:** Phases 1, 4 (invite via Google), 5b (sessions).
11. **Risk:** Medium–High (security-sensitive); contained by tests and the feature flag.
12. **Migration required:** Yes.

---

### PHASE 7 — RBAC & PERMISSIONS

Two slices: **7a** (urgent, independent) mask webhook secrets and add `webhook:secret:read` (F-01); **7b** the permission catalog migration.

1. **Objective:** One server-side authorization model that routes depend on, with no behavioural change first.
2. **Current implementation:** 40 guarded sites, five role sets, private rank map, duplicated frontend arrays (F-10).
3. **Required changes:** `core/permissions.py` (`Permission`, `ROLE_PERMISSIONS`, `require_permission`); migrate routes mechanically; add the new permissions (§7.2); `/auth/me` returns effective permissions; secret masking in `WorkflowStepResponse`/version detail.
4. **Files likely affected:** `api/deps.py`, all `routers/*.py`, `schemas/workflow.py`, `routers/workflows.py`, `schemas/auth.py`, frontend `hooks/usePermissions.ts` and the 7 files with hard-coded role checks.
5. **Database changes:** none.
6. **API changes:** CHANGE `/auth/me`; workflow version responses mask secrets unless permitted.
7. **Frontend changes:** `usePermissions`, `<Can>`; remove hard-coded role arrays; masked-secret UI.
8. **Security considerations:** equivalence — the migrated catalog must grant exactly today's access; deny-by-default for any route without a permission; **rotate webhook secrets** exposed before the fix.
9. **Tests required:** role-matrix equivalence test (written first, run before and after); secret-masking test for every role; frontend permission tests.
10. **Dependencies:** Phase 2 (rank/bundles) for 7b; 7a has none.
11. **Risk:** 7a Low; 7b Medium (40 mechanical edits, guarded by the generated matrix).
12. **Migration required:** No schema change; operational secret rotation yes.

---

### PHASE 8 — TENANT ISOLATION

1. **Objective:** Turn today's careful-but-manual isolation into something enforced automatically.
2. **Current implementation:** consistent app-level filtering with per-family tests; no automatic coverage; child tables lack an org column (F-17).
3. **Required changes:** generated contract test + static scan (§12.2); suspended-org gate (Phase 1); webhook-key resolution test; Celery assertion helper; **decision D10** on adding RLS later.
4. **Files likely affected:** `tests/security/*` (new), `api/deps.py`, `workers/tasks.py` (assertion), optional later: Alembic RLS migration and DB session wrapper.
5. **Database changes:** none for items 1–5; RLS policies + non-owner DB role if D10 = adopt.
6. **API changes:** none.
7. **Frontend changes:** none.
8. **Security considerations:** the contract test must hit *real* tokens from two orgs; the scan must fail closed on unknown patterns.
9. **Tests required:** the contract + static suites **are** the deliverable.
10. **Dependencies:** none (do first as a safety net); extended after Phase 1.
11. **Risk:** Low (tests) / Medium–High if RLS is adopted.
12. **Migration required:** No (unless RLS).

---

### PHASE 9 — PLATFORM ADMIN

1. **Objective:** Provide the provider-level administration layer, separate from organization administration (F-03).
2. **Current implementation:** none; `is_superuser` inert.
3. **Required changes:** `users.platform_role`; `require_platform_role`; `/api/v1/platform/*` (§14.3); org provisioning + Owner invitation; suspend/activate; CLI to create the first platform admin; audit stream; optional break-glass (D7); retire `is_superuser` from `/auth/me`.
4. **Files likely affected:** `models/user.py`, `api/deps.py`, new `routers/platform.py`, `schemas/platform.py`, `scripts/create_platform_admin.py`, `core/config.py` (allow-list), frontend `pages/platform/*`.
5. **Database changes:** `users.platform_role` (+ CHECK).
6. **API changes:** NEW `/platform/*`.
7. **Frontend changes:** platform console route group (lazy), role-gated.
8. **Security considerations:** MFA before production (Phase 14) or interim IP allow-list + short sessions; no tenant-data endpoints; every action audited with actor and reason; platform roles can't be granted via public flows.
9. **Tests required:** §18 platform suite; privilege-separation tests both directions.
10. **Dependencies:** Phases 1, 4, 5.
11. **Risk:** Medium (new high-privilege surface).
12. **Migration required:** Yes (column).

---

### PHASE 10 — FRONTEND UX

1. **Objective:** Deliver the user-facing experience for every backend capability.
2. **Current implementation:** login/register pages; client-only org switch; placeholder Members tab; hard-coded role checks (§2.1).
3. **Required changes:** §15.2 table — delivered **incrementally alongside** Phases 2–9 so each backend capability ships with its UI.
4. **Files likely affected:** `pages/auth/*`, `pages/onboarding/*`, `pages/settings/SettingsPage.tsx` (split into Members/Security/Organization components), `pages/platform/*`, `context/AuthContext.tsx`, `services/*`, `hooks/usePermissions.ts`, `routes/AppRoutes.tsx`, `components/layout/Header.tsx`.
5. **Database changes:** none. 6. **API changes:** none new (consumes the above).
7. **Frontend changes:** as listed.
8. **Security considerations:** permissions come from the server; no tokens/PII in URLs or storage; invitation tokens read from the URL once and removed from history; generic auth errors.
9. **Tests required:** component/route tests; E2E (§18).
10. **Dependencies:** each UI piece depends on its backend phase.
11. **Risk:** Medium (large surface, but mostly additive).
12. **Migration required:** No.

---

### PHASE 11 — SECURITY

1. **Objective:** Cross-cutting controls and operational readiness.
2. **Current implementation:** strong headers/CSP/config validator; env contract mismatch (F-13); audit gaps (F-09).
3. **Required changes:** single documented environment contract + startup self-check + CI check (fix `FIELD_ENCRYPTION_KEY`/`ENCRYPTION_KEY`, `CORS_ORIGINS`/`ALLOWED_CORS_ORIGINS`, missing `JWT_SECRET`, unused `COOKIE_*`); `security_events` retention/export; alerting on `session.reuse_detected`, spikes in `login.failure`, platform actions; secret-rotation runbook update; dependency scanning (`pip-audit`, `npm audit`) in CI; threat-model review before go-live.
4. **Files likely affected:** `docker-compose.prod.yml`, `core/config.py`, `.env.example`, `.github/workflows/ci.yml`, `docs/security.md`, `docs/DEPLOYMENT.md`, `docs/operations/secret-rotation.md`.
5. **Database changes:** retention job only. 6. **API changes:** none.
7. **Frontend changes:** none.
8. **Security considerations:** no secrets in repo/logs; HSTS/CSP unchanged; rate-limit fail-open reconsidered for auth endpoints (fail **closed** for login/reset when Redis is down, decision in D-list).
9. **Tests required:** config-validation tests for every documented variable; CI job that boots the production config.
10. **Dependencies:** none (config part is independent and should happen before any production rollout).
11. **Risk:** Low. 12. **Migration required:** No.

---

### PHASE 12 — TESTING

1. **Objective:** Make the security properties regression-proof.
2. **Current implementation:** 277 backend + 72 frontend tests; per-family tenant tests; no generated authorization matrix; no browser E2E in the repo.
3. **Required changes:** the suites in §18; test helpers (create org + users with roles by direct DB insert; fake OIDC IdP; mail capture).
4. **Files likely affected:** `backend/tests/security/*`, `tests/conftest.py`, `tests/helpers/*`, `frontend/src/tests/*`, optional `e2e/` (Playwright dev dependency — approval needed).
5. **Database changes:** none. 6. **API changes:** none. 7. **Frontend changes:** none.
8. **Security considerations:** tests must use independent tokens per tenant; never reuse the dev database for destructive tests (**recommend a separate test database** — today the suite writes into the dev DB).
9. **Tests required:** this phase *is* the tests.
10. **Dependencies:** the safety-net portion first; the rest tracks Phases 2–9.
11. **Risk:** Low. 12. **Migration required:** No.

---

### PHASE 13 — FUTURE ENTERPRISE SSO

1. **Objective:** Per-organization OIDC providers (Entra ID, Okta, others) with optional SSO enforcement.
2. **Current implementation:** none (Phase 6 supplies the reusable core).
3. **Required changes:** §19.
4. **Files likely affected:** `services/oidc/*` (provider registry), new `models/oidc_provider.py`, `routers/sso.py`, settings UI.
5. **Database changes:** NEW `oidc_providers`.
6. **API changes:** NEW `/auth/sso/{org_slug}/*`, org SSO settings endpoints.
7. **Frontend changes:** SSO sign-in entry, org SSO settings.
8. **Security considerations:** issuer/`tid` validation, JIT provisioning defaults to the lowest role, enforced-SSO break-glass, encrypted client secrets.
9. **Tests required:** fake IdP per provider; enforcement tests.
10. **Dependencies:** Phase 6, 5b, 14 recommended.
11. **Risk:** Medium. 12. **Migration required:** Yes.

---

### PHASE 14 — MFA / PASSKEYS

1. **Objective:** Strong second factors and phishing-resistant login.
2. **Current implementation:** none.
3. **Required changes:** §20.
4. **Files likely affected:** new `models/mfa_credential.py`, `routers/mfa.py`, session `amr`, frontend Security tab, login step-up screens.
5. **Database changes:** NEW credential/recovery-code tables.
6. **API changes:** NEW MFA enrol/verify/disable, WebAuthn registration/assertion.
7. **Frontend changes:** enrolment, challenge, recovery codes.
8. **Security considerations:** encrypted TOTP secrets, rate-limited verification, recovery-code hygiene, enforcement for platform roles first.
9. **Tests required:** TOTP vectors, recovery codes, step-up enforcement, WebAuthn virtual authenticator tests.
10. **Dependencies:** Phase 5b; required before production use of Phase 9.
11. **Risk:** Medium. 12. **Migration required:** Yes.

---

## 22. Risks and Trade-offs

| Risk / trade-off | Assessment | Mitigation |
|---|---|---|
| **Touching `get_org_context` / `require_role` affects every endpoint** | Highest-leverage code in the system | Generated role-matrix + contract tests written first; mechanical migration; feature flag |
| **Session rewrite (5b) could log users out or break multi-tab refresh** | High | Token-format dual acceptance; frontend refresh mutex retained; grace window on reuse detection; staged rollout |
| **Test suite depends on `POST /members`** | Medium (10 files) | Introduce a DB-level fixture helper before deprecating; keep the endpoint flag-gated |
| **Email becomes a hard dependency** (invites, verification, reset) | Medium | Provider adapter, queue + retry, dev capture; invitations show a copy-link fallback for admins only if policy allows (D2) |
| **Role vocabulary mismatch** (4 vs 5 roles) | Medium | Decide D1 before Phase 2; keep stored roles to avoid altering approval configs |
| **Authlib is a new dependency** | Low–Medium | Pinned; isolated in `services/oidc`; alternative is PyJWT + httpx (already present) at the cost of more custom security code |
| **RLS adds operational complexity** | Medium | Deferred (D10); contract tests first |
| **Stricter cookies (`SameSite=Strict`) vs. cross-site entry** | Low | Cookie is set by the first-party callback; verify in the OIDC E2E test |
| **Shorter access tokens (15 min) increase refresh traffic** | Low | Existing refresh endpoint + mutex handles it; limit raised appropriately |
| **Grandfathering unverified existing users** | Low–Medium | Verification enforced for new users and for sensitive actions (org create, invite, link) |
| **Platform admin is a high-value target** | High | No tenant-data access by default, MFA, allow-list, audit, separate route group/host |
| **Scope** — 15 phases is large | High | Safety nets → hotfixes → incremental, flag-gated releases; each phase independently shippable |

**Trade-offs chosen:** extend existing tables rather than introduce a parallel identity model (less migration, more careful constraints); keep JWT + Redis rather than a full server-side session store (smaller change; Postgres `auth_sessions` supplies visibility and reuse detection); application-level isolation first, RLS later (faster, lower risk, still testable); single backend rather than a separate auth service (no microservices — authentication stays centralised inside FlowPilot).

---

## 23. Final Recommended Architecture

1. **Identity:** one `users` table; passwords (Argon2id) and Google OIDC as login methods; identities keyed by `(issuer, subject)`; **no email-based account merging**; email verification before sensitive actions.
2. **Organizations:** `organizations` with `status`/`created_via`; self-service (flagged, quota-limited, onboarding step) and platform-provisioned (`PENDING_ACTIVATION` → owner invitation → `ACTIVE`).
3. **Membership & roles:** keep `organization_members` and the five stored roles; add `status`; one permission catalog; Owner/Admin/Member(Manager+Operator)/Viewer semantics per §7.3; no role above one's own; last-Owner protection under lock.
4. **Invitations:** hashed, single-use, expiring, email-bound; add-by-email retired.
5. **Sessions:** JWT access (15 min, no role claim, `iss/aud/kid`) + cookie-only rotating refresh; `auth_sessions` as system of record; server-side active organization; reuse detection; working logout; re-auth for sensitive actions.
6. **Authorization:** `get_org_context` (path org + ACTIVE membership + ACTIVE org) → `require_permission` → org-filtered resource lookup; effective permissions delivered to the SPA.
7. **Platform:** `users.platform_role` + `/platform/*`, entirely separate from org roles, no default tenant-data access, MFA before production, full audit.
8. **Tenant isolation:** app-level filtering + generated contract tests + static scan (+ optional RLS later).
9. **Audit:** org events in `audit_logs`; identity/platform events in `security_events`.
10. **Frontend:** server-driven permissions, server-backed org switching, real Members and Security pages, onboarding, invitation acceptance, Google button, lazy platform console.
11. **Future:** per-organization OIDC SSO, then MFA/passkeys — both reuse the same identity/session model.

---

## 24. IMPLEMENTATION READINESS

### 24.1 What is already correct

Per-request DB authorization and 404-on-non-member; Argon2id; atomic refresh rotation and Redis revocation; in-memory access token and path-scoped HttpOnly cookie; strict production config validator and security headers; owner safeguards (no Admin→Owner, last-Owner); encrypted integration credentials; a cross-tenant test per resource family; a healthy 277 + 72 test baseline. **Keep all of this.**

### 24.2 What must change

| Must change | Why | Phase |
|---|---|---|
| Mask webhook secrets; add `webhook:secret:read` | **F-01 — Viewer can start runs** | 7a |
| Logout that works without an access token | F-02 | 5a |
| Trusted-proxy-aware, per-account throttling | F-05, F-16 | 5a |
| Platform administration layer | F-03 (core business requirement) | 9 |
| Invitation system + email service | F-04; customers must manage their own users | 4 |
| Server-side sessions, active org, reuse detection | F-06, F-07, F-11, F-14 | 5b |
| Email verification, password reset/change | F-08 | 5c |
| Permission catalog; real member management | F-10, F-12 | 2, 7 |
| Auth/membership/platform audit events | F-09 | 5, 11 |
| Environment-variable contract (prod compose, CI, docs) | F-13 | 11 |
| Onboarding and real Members/Security UI | F-15 | 3, 10 |

### 24.3 What can remain unchanged

The workflow engine, executions, approvals logic (including the per-approval `approver_role` check), integrations and their encryption, analytics, webhook HMAC verification and idempotency, Celery architecture, Argon2 parameters, security-header middleware, Docker/compose structure (except the env names), and the data model of all workflow/run tables (no `organization_id` additions required).

### 24.4 Highest-risk changes

1. **Session rewrite (5b)** — affects every authenticated request and the SPA's session restoration.
2. **Permission-catalog migration (7b)** — 40 guard sites; protected by the generated equivalence test.
3. **Retiring `POST /members`** — many tests depend on it.
4. **Google account resolution (6)** — a mistake here is an account-takeover bug; protected by the fake-IdP negative suite and "never merge on email".
5. **Platform admin surface (9)** — new high-privilege area; do not ship to production without MFA or the interim allow-list.

### 24.5 Recommended implementation order *(one phase or slice per approval)*

1. **Safety nets** — role-matrix and tenant-isolation contract tests against current behaviour (Phase 8 contract part, Phase 7 characterisation, Phase 12 helpers). *Tests only.*
2. **Hotfixes** — 7a (secret masking + rotate secrets), 5a (logout, throttling, timing). *Small, independent, ship immediately.*
3. **Phase 11 config contract** — fix env names/`JWT_SECRET` so later work can be deployed.
4. **Phase 1** — organization/membership lifecycle (migration `0004`).
5. **Phase 2** — member management and role semantics.
6. **Phase 7b** — permission catalog (equivalence-proven), effective permissions in `/auth/me`.
7. **Phase 4** — email service + invitations; migrate test fixtures; flag-gate add-by-email.
8. **Phase 5b/5c** — sessions, org switching, verification, reset.
9. **Phase 3** — self-service flag/quota/onboarding.
10. **Phase 10** — UI, delivered incrementally with steps 4–9.
11. **Phase 6** — Google OIDC.
12. **Phase 9** — platform admin (after MFA or with the interim allow-list).
13. **Phase 11** (remainder), **Phase 13**, **Phase 14**.

### 24.6 Decisions required before implementation

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Role vocabulary: keep five stored roles (Owner/Admin/Manager/Operator/Viewer) with "Member" as a UI grouping, or collapse to four? | **DECIDED (2026-10-17): keep five.** Label Manager/Operator as "Member (builder/operator)" in the UI |
| **D2** | Email provider and sender domain (SMTP, SES, SendGrid, Resend…); dev tool (Mailpit/console) | Provider-agnostic adapter; Mailpit in dev. *Needs your choice of provider* |
| **D3** | Self-service signup/org creation: open, invite-only, or a per-deployment flag? | Flag, default **on** for SaaS, **off** for enterprise deployments |
| **D4** | Email-verification policy | Required before creating an org, inviting, or linking an identity; existing users grandfathered |
| **D5** | Google OIDC library | **Authlib** (alternative: PyJWT + httpx hand-assembled — more custom code) |
| **D6** | Platform admin identity | `users.platform_role` + separate route group/host; no separate user table |
| **D7** | May platform staff ever access tenant data (break-glass)? | **No default access**; if needed, time-boxed, reasoned, customer-visible audit |
| **D8** | Refresh token shape | Keep JWT, add `sid`/`family`; no switch to opaque tokens now |
| **D9** | Access-token lifetime | 15 minutes (today 30) |
| **D10** | Adopt PostgreSQL RLS? | Not now; revisit after the contract tests exist |
| **D11** | Cap on organizations a user may own via self-service | 3 (configurable) |
| **D12** | Keep `POST /organizations/{id}/members` (add-by-email)? | Flag-gated, off in production; introduce test helper first |
| **D13** | Domain-verified auto-join / SSO domain claims | Out of scope until Phase 13 |
| **D14** | May Google sign-in create a brand-new account without an invitation? | Yes when D3 allows signups (then onboarding) |
| **D15** | Rate-limit behaviour when Redis is down for auth endpoints | Fail **closed** for login/reset/register, fail open elsewhere |
| **D16** | Treat existing users as email-verified? | Yes (grandfather) |
| **D17** | Can an Admin manage other Admins? | No — only Owners manage Admins/Owners |
| **D18** | Who may read the audit log? (docs say Viewer; code says Manager+) | Keep Manager+; correct the docs |

### 24.7 Open items outside this plan's scope but noticed

- The backend test suite writes into the development database; a separate test database is recommended (Phase 12).
- `docs/security.md` and deployment docs reference environment names the code does not read (F-13).
- The Members tab and the "60 min TTL" label are static placeholders (F-15).

---

*End of plan. No implementation has started. Reply with approval (and answers to the decisions, especially D1–D5) and indicate which phase or slice to begin with.*
