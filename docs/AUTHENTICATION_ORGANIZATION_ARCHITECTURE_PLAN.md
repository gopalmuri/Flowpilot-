# FlowPilot: Enterprise Authentication & Multi-Tenant Organization Architecture

> **Document Version:** 2.0.0-PROPOSAL  
> **Status:** ARCHITECTURE DESIGN & IMPLEMENTATION PLAN (PENDING APPROVAL)  
> **Target System:** FlowPilot Workflow Automation Platform (`E:\flowpilot`)  
> **Date:** October 2026  
> **Classification:** Confidential / System Architecture Specification  

---

## Table of Contents
1. [Executive Summary]#1-executive-summary)
2. [Current Architecture (Codebase Inspection Audit)]#2-current-architecture-codebase-inspection-audit)
3. [Target Architecture]#3-target-architecture)
4. [Authentication Architecture]#4-authentication-architecture)
5. [Organization ArchitectureWI5-organization-architecture)
6. [User Membership ArchitectureWI6-user-membership-architecture)
7. [RBAC Architecture]#7-rbac-architecture)
8. [Platform Admin Architecture]#8-platform-admin-architecture)
9. [Organization Admin ArchitectureWH9-organization-admin-architecture)
10. [Google OIDC Architecture]#10-google-oidc-architecture)
11. [Session Architecture]#11-session-architecture)
12. [Tenant Isolation Architecture]#12-tenant-isolation-architecture)
13. [Database Architecture]#13-database-architecture)
14. [API Architecture]#14-api-architecture)
15. [Frontend Architecture]#15-frontend-architecture)
16. [Security Architecture]#16-security-architecture)
17. [Migration Strategy]#17-migration-strategy)
18. [Testing Strategy]#18-testing-strategy)
19. [Future Enterprise SSO]#19-future-enterprise-sso)
20. [Future MFA / Passkeys]#20-future-mfa---passkeys)
21. [Phase-by-Phase Implementation Plan]#21-phase-by-phase-implementation-plan)
    - [PHASE 0 — Current State Audit]#phase-0--current-state-audit)
    - [PHASE 1 – Organization Model]#phase-1--organization-model)
    - [PHASE 2 — User / Membership / Role Model]#phase-2--user--membership--role-model)
    - [PHASE 3 — Organization Creation]#phase-3--organization-creation)
    - [PHASE 4 – Invitation System]#phase-4--invitation-system)
    - [PHASE 5 – Authentication Hardening]#phase-5--authentication-hardening)
    - [PHASE 6 – Google OIDC]#phase-6--google-oidc)
    - [PHASE 7 – RBAC & Permissions]#phase-7--rbac--permissions)
    - [PHASE 8 – Tenant Isolation]#phase-8--tenant-isolation)
    - [PHASE 9 — Platform Admin]#phase-9--platform-admin)
    - [PHASE 10 – Frontend UX]#phase-10--frontend-ux)
    - [PHASE 11 — Security]#phase-11--security)
    - [PHASE 12 – Testing]#phase-12--testing)
    - [PHASE 13 – Future Enterprise SSO]#phase-13--future-enterprise-sso)
    - [PHASE 14 — MFA / Passkeys]#phase-14--mfa---passkeys)
22. [Risks and Trade-offs]#22-risks-and-trade-offs)
23. [Final Recommended Architecture]#23-final-recommended-architecture)
24. [Implementation Readiness]#24-implementation-readiness)

---

## 1. Executive Summary

FlowPilot is an enterprise B2B multi-tenant SaaS workflow automation platform. In FlowPilot's commercial model, the software platform is provided and licensed by FlowPilot (the software vendor) to independent customer organizations (e.g., ABC Corporation, XYZ Corporation).

### Primary Business & Engineering Requirements
1. **Autonomous Customer Administration:** When FlowPilot is handed over or sold to a customer organization, that organization must possess full autonomous administration of its own users, team roles, invitations, integrations, workflows, approvals, and data assets.
2. **Two Separate Administrative Planes:**
   - **FlowPilot Platform Admin:** Operated strictly by the FlowPilot software vendor to provision customer organizations, manage subscriptions, monitor multi-tenant system health, enforce platform suspensions, and provide vendor support.
   - **Customer Organization Admin:** Operated by customer personnel (e.g., ABC Corporation's Owner/Admin) to invite employees, assign roles, build workflows, and manage enterprise settings. An "Admin" role within an organization has **zero** authority over the FlowPilot platform or other customer organizations.
3. **Sovereign FlowPilot Identity System:** Users maintain a single global FlowPilot identity (`User`). A user may belong to multiple customer organizations simultaneously (e.g., John is `ADMIN` in ABC Corp, and `MEMBER` in XYZ Corp). Authentication is centralized, while authorization is strictly scoped to the active organization membership context.
4. **Defense-in-Depth Authentication:** Support robust Email/Password authentication (Argon2id) and industry-standard **Google OpenID Connect (OIDC)** using Google Discovery, PKCE, state/nonce protection, and cryptographic identity linking (`issuer + subject`). External identity providers only assert who the user is; FlowPilot remains the sole source of truth for organization memberships, roles, permissions, and sessions.
5. **Strict Server-Side Tenant Isolation:** Client-side interfaces (React) are explicitly recognized as presentation layers, not security boundaries. Tenant isolation and RBAC are enforced server-side on every request via database foreign-key scoping, cryptographic token claims, and OWASP-compliant 404 masking (preventing tenant resource enumeration).

---
## 2. Current Architecture (Codebase Inspection Audit)

A thorough, rigorous inspection of the FlowPilot codebase at `Es\flowpilot` was conducted across backend models, security modules, dependencies, routers, schemas, frontend contexts, API clients, UI pages, Alembic migrations, and automated test suites.

### 2.1 Backend Implementation Audit

#### A. Database Models (`backend/app/models/`)
- **`User` (`app/models/user.py`):**
  - Defines `id` (UUID), `email` (String(355), unique, indexed), `password_hash` (String(355), non-nullable), `full_name` (String(355)), `is_active` (Boolean, default True), and `is_superuser` (Boolean, default False).
  - Relationship `memberships` back-populates `OrganizationMember`.
  - **Gap 1 (OIDC Blocker):** `password_hash` is `nullable=False`. This prevents creating passwordless external identity accounts (Google OIDC) without dummy hashes or schema migration.
  - **Gap 2:** Lacks `email_verified` (Boolean) and user account status flags.
- **@Organization` (`app/models/organization.py`):**
  - Defines `id` (UUID), `name` (String(255)), `slug` (String(255), unique, indexed), `created_at`, `updated_at`.
  - Cascading relationships to `members`, `integrations`, `workflows`, `workflow_runs`, `approval_requests`, `audit_logs`, `usage_records`, `idempotency_records`.
  - **Gap 3:** Lacks lifecycle status (e.g., `ACTIVE`, `SUSPENDED`, `DELETED`), plan tier (`FREE`, `PRO`, `ENTERPRISE`), and organization settings JSONB.
- **@OrganizationMember` (`app/models/membership.py`):**
  - Defines `organization_id` (UUID FK to organizations.id), `user_id` (UUID FK to users.id), `role` (String(50)), with unique constraint `uq_org_member` on `(organization_id, user_id)`.
  - `OrganizationRole` enum defines: `OWNER`, `ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`.
  - **Gap 4:** Role model uses rigid strings without mapping to fine-grained permission capabilities.
  - **Gap 5:** No status field (e.g., `ACTIVE`, `SUSPENDED`, `INVITED`).
- **Resource Tenant Scoping:**
  - `Workflow`, `WorkflowRun`, `ApprovalRequest`, `Integration`, `AuditLog`, `UsageRecord` and `IdempotencyRecord` all define a direct `organization_id` foreign key.
  - `WorkflowVersion` is child to `Workflow` (hierarchically isolated through workflow ownership).

#### B. Cryptography & Session Core (`backend/app/core/security.py`)
- **Password Hashing:** Argon2id with memory-hard parameters (`memory_cost=65536` [64 MB], `time_cost=3`, `parallelism=4`, `hash_len=32`). Correctly implemented.
- **Access Tokens:** Dual-token JWT (HS256) with 30-minute default expiration. Payload includes `sub`, `email`, `org_id`, `role`, `jti`, type="access".
- **Refresh Tokens:** 7-day expiration, stored in Redis (`flowpilot:refresh:{jti}`). Atomic Lua script rotation (`rotate_refresh_token`) prevents token replay.
- **Revocation Blacklist:** Access token blacklisting in Redis (`flowpilot:revoked_access:{jti}`) until token natural expiry.
- **Cookies:** Refresh token dispatched in HttpOnly, SameSite=Lax cookie with path `/api/v1/auth`.

#### C. Authorization & Dependencies (`backend/app/api/deps.py`)
- `get_current_user`: Decodes JWT, validates revocation against Redis blacklist, verifies UULD, and fetches User with memberships.
- `get_current_active_user`: Verifies `user.is_active`.
- `get_org_context`: Enforces tenant boundary by validating membership for `(organization_id, current_user.id)`. Returns `404 Not Found` if user is not a member, preventing cross-tenant enumeration.
- `require_role`: Checks membership role against allowed roles list.
- **Gap 6:** Roles are checked via list matching (e.g., `[OWNER, ADMIN]`). There is no granular permission engine (e.g., checking `workflow:create`, `user:invite`).
- **Gap 7:** Zero dependencies or checks exist for `is_superuser`. Platform Admin authorization is completely absent.

---
### D. API Routers (`backend/app/routers/`)
- **`auth.py`:**
  - `/register`: Creates user, optionally creates organization with user as `OWNER`.
  - `/login`: Verifies Argon2id hash, issues access/refresh tokens. Sets `refresh_token` cookie.
  - `/refresh`: Rotates refresh token in Redis, issues new access token.
    - **CRITICAL DEFECT 1:** In `/refresh`, active org is hardcoded to `user.memberships[0]`. If a user belongs to multiple organizations and switches to Org B, token refresh resets them back to Org A.
  - `/logout`: Revokes access token in Redis, deletes refresh token from Redis, clears cookie.
  - `/me`: Returns user profile and organization list.
- **`organizations.py`:**
  - `POST /organizations`: Creates organization and adds user as `OWNER`.
  - `GET /organizations`: Lists organizations user belongs to.
  - `GET /organizationr/{id}`: Returns org detail.
  - `POST /organizations/{id}/members`: Adds member by email.
    - **CRITICAL DEFECT 2:** Requires the user to **already exist** in `users` table (`select(User).where(User.email == email)`). If the email is not registered, returns 404! There is no invitation mechanism for unonboarded employees.
  - `DELETE /organizationr/{id}/members/{user_id}`: Removes member, prevents removing the last OWNER or ADMIN removing OWNER.
  - **CRITICAL DEFECT 3:** No `GET /organizations/{id}/members` endpoint exists.
  - **CRITICAL DEFECT 4:** No `PATCH /organizations/{id}/members/{user_id}` (role update) endpoint exists.
- **Platform Admin Router:** None exists in the entire backend.

### 2.2 Frontend Implementation Audit (`frontend/src/`)
- **Session & API Client (`services/apiClient.ts`):**
  - Access token and refresh token are stored **in-memory** (`memoryAccessToken`, `memoryRefreshToken`). This provides robust defense against XSS (no tokens in `localStorage`).
  - Automatic silent refresh via HttpOnly cookie when 401 encountered.
  - Attaches `X-Organization-Id` header to outbound API calls.
- **Authentication State (`context/AuthContext.tsx`):**
  - Manages `user`, `organizations`, `activeOrganization`, `activeRole`.
  - Provides `switchOrganization(organizationId)`.
  - **Gap 8:** `switchOrganization` only updates client-side state and `X-Organization-It` header; it does not request a re-issued access token scoped to the new org from the backend.
- **Settings Page (`pages/settings/SettingsPage.tsx`):**
  - The "Members" tab renders a **hardcoded static mock row** ("1 Active Operator"). It does not fetch organization members from any API, has no member invitation modal, and no role management UI.
- **Login / Register Pages (`pages/auth/`):**
  - Only support Email + Password.
  - No Google OIDC button, no OAuth callback handling, no invitation acceptance flow.

### 2.3 Alembic Migrations Audit (`backend/alembic/versions/`)
- `0001_initial_schema.py`: Initial schema creating 14 tables: `users`, `organizations`, `organization_members`, `integrations`, `workflows`, `workflow_versions`, `workflow_steps`, `workflow_connections`, `workflow_runs`, `workflow_step_runs`, `approval_requests`, `audit_logs`, `usage_records`, `idempotency_records`.
- `0002_add_workflow_version_status.py`: Adds `status` column to `workflow_versions`.
- **Gap 9:** No tables for `invitations` or `external_identities`.

---
## 3. Target Architecture

The target architecture establishes a clean, sovereign separation between the FlowPilot Platform Control Plane and the Customer Tenant Plane.

### ASCII Diagram 1: Overall Target Architecture

```
+===================================================================================================+|
                                               FLOWPILOT PLATFORM                                     |
+===================================================================================================+
                                            |
                    +-----------------------------+-----------------------------+
                    |                                                    |
     [ PLATFORM CONTROL PLANE ]                              [ IDENTITY SYSTEM ]
     * Platform Superadmin                                    * Dual Authentication Engine
     * Organization Provisioning                                * Centralized Users Table
     * Subscription / Plan Governance                             * External Identities Store
     * Platform Health & Monitoring                              * Security Session Manager
                    |                                              |
                    |                                       +-------------++-------------+-+
                    |                                       |                              |
                    |                                       [ EMAIL / ARGON2ID ]          [ GOOGLE OIDC ]
                    |                                       (Password Hash)               (sub + iss)
                    |                                       |                              |
                    |                                       +-------------+--------------+
                    |                                                    |
                    |                                                    v
                    |                                              [ FLOWPILOT USER ]
                    |                                              (Global Identity)
                    |                                                    |
                    +--------------------------------------------)               |
                                                              |               |
                                                              v`              v
                                               +=======================================================+
                                              |               ORGANIZATION MEMBERSHIPS               |
                                              +=======================================================+
                                              | User: John Doe                                      |
                                              |  -> ABC Corp : OWNER                                   |
                                              |  -> XYZ Corp : MEMBER                                 |
                                               +========================================================+
                                                                  |
                                                         +------------------+-------------------+
                                                         |                                |
                                                         v`                               v`
                                              [ ABC CORPORATION ]                     [ XYZ CORPORATION ]
                                             (Customer Tenant A)                    (Customer Tenant B)
                                             |                                    |
                                             +-- OWNER / ADMIN (Org Admin)          +-- OWNER / ADMIN (Org Admin)
                                             +-- Workflows & Versions               +-- Workflows & Versions
                                            +-- Execution Runs                     +-- Execution Runs
                                            +-- Human Approvals                   +-- Human Approvals
                                            +-- Integrations (Slack/CRM)          +-- Integrations
                                            +-- Tenant Audit Logs                 +-- Tenant Audit Logs
                                            +-- Member Invitations                 +-- Member Invitations
```

---
## 4. Authentication Architecture

FlowPilot operates a centralized identity system where user accounts exist independently of organization tenancies. Authentication asserts who a user is; organization memberships assert what a user can access.

### 4.1 Dual-Method Authentication*1. **Email + Password:**
   - Password hashing: Argon2id (`time_cost=3`, `memory_cost=65536`, `parallelism=4`, `hash_len=32`).
   - Constant-time verification prevents timing attacks.
   - Enforce minimum password policy: 10+
characters, mixed case, numbers, symbols.
2. **Google OpenID Connect (OIDC):**
   - Implements standard OIDC Authorization Code Flow with PKCE (`S256`).
   - Authenticates directly against Google identity servers (`https://accounts.google.com`).
   - Never stores Google access tokens long-term; parses verified `id_token` for cryptographic identity assertion.

### 4.2 External Identity Store & Account Linking
To avoid security vulnerabilities like Pre-Account Takeover, external identities are decoupled from the core `users` record and maintained in `external_identities`:
- Columns: `id`, `user_id`, `provider` ("google"), `issuer` ("https://accounts.google.com"), `subject` (Google sub ID), `provider_email`.
- Unique constraint: `hprovider, issuer, subject)`.

**Account Linking Security Boundary:**
- **Never Auto-Merge Unauthenticated Accounts:** If a user registers with `john@example.com` via password, and subsequently attempts "Sign in with Google" using `john@example.com`:
  - FlowPilot will NOT blindly merge the Google identity into the password account.
  - If the Google account possesses a verified email matching an existing account, FlowPilot requires the user to authenticate with their password to link their Google account (`/auth/link-identity`), or explicitly prompts for confirmation via email verification loop.


### ASCII Diagram 2: Login Flow (Email/Password)

```
[ User Browser ]                  [ FlowPilot Backend ]                  [ Redis / DB ]
       |                                    |                                  |
       | 1. POST /auth/login               |                                  |
       |    {email, password, org_id?}     |                                   |
       |---------------------------------->|                                  |
       |                                   | 2. Rate limit check (IP)          |
       |                                   |---------------------------------->|
       |                                   |    Redis sliding window OK        |
       |                                   |<------------------------------------ |
       |                                   |                                  |
       |                                   | 3. Query user & memberships       |
       |                                   |----------------------------------->|
       |                                   |    Returns User + memberships     |
       |                                   |<------------------------------------ |
       |                                   |                                  |
       |                                   | 4. Verify Argon2id hash           |
       |                                   |    Constant-time compare OK       |
       |                                   |                                  |
       |                                   | 5. Resolve active org context     |
       |                                   |    (explicit org_id or default)   |
       |                                   |                                  |
       |                                   | 6. Generate Dual JWTs:            |
       |                                   |    - Access Token (15m, in-memory)|
       |                                   |    - Refresh Token (7d, jti)      |
       |                                   |                                  |
       |                                   | 7. Store refresh jti in Redis     |
       |                                   |----------------------------------->|
       |                                   |    SET flowslot:refresh:{jti}    |
       |                                   |                                  |
       | 8. 200 OK Response                |                                  |
       |    Set-Cookie: refresh_token=...  |                                  |
       |    Body: {access_token, exp, user}|                                  |
       |<-----------------------------------|                                  |
       |                                   |                                  |
       | 9. Store Access Token in memory   |                                  |
       |    Set active org in AuthContext  |                                  |
```

---
## 5. Organization Architecture

Customer organizations are isolated operational tenants with dedicated boundaries.

### 5.1 Organization Lifecycle & Settings
- **Lifecycle Statuses:** `ACTIVE` (normal operations), `SUSPENDED` (temporary access freeze by Platform Admin or billing failure), `ARCHIVED` (soft-deleted).
- **Organization Settings (`settings` JSONB):**
  - Workflow retention policies (90/180/365 days).
  - Allowed email domains for user invitations (e.g., `@abccorp.com`).
  - Security policies (require MFA, session timeout duration).

### 5.2 Two Organization Provisioning Scenarios1. **Scenario 1 – Self-Service SaaS:**
   - Any authenticated user can create an organization via `POST /api/v1/organizations`.
   - The creator is automatically assigned the `OWNER` role.
   - The creator can immediately begin inviting team members.
2. **Scenario 2 — Enterprise / Sales-Assisted Provisioning:**
   - Provisioned via Platform Admin API (`POST /api/v1/platform/organizations`).
   - Platform Admin specifies organization name, slug, tier (`ENTERPRISE`), and initial Owner email.
   - An Owner Activation Invitation is dispatched to the designated owner.
   - Upon acceptance, the owner establishes their password or links Google OIDC, becoming the sole initial `OWNER`.

### ASCII Diagram 4: Organization Creation Flow

```
SCENARIO 1: SELF-SERVICE SAAS               SCENARIO 2: ENTERPRISE PROVISIONING
===========================               ====================================
      [ Customer User ]                                 [ Platform Admin ]
             |                                               |
             | 1. Sign Up (Email or OIDC)                      | 1. POST /platform/organizations
             v                                            |    {name, slug, tier, owner_email}
    [ Active User Account ]                                v
             |                                        [ FlowPilot Backend ]
             | 2. POST /organizations                          |
             |    {name: "ABC Corp"}                          | 2. Create Org (status=ACTIVE)
             v                                           |    Create Owner Invitation
    [ FlowPilot Backend ]                                 v
             |                                        [ Dispatch Activation Email ]
             | 3. Create Org + Slug                          |
             |    Assign User as OWNER                       v
             v                                        [ Customer Owner ]
    [ Ready for Team Invitations ]                         | 3. Clicks Activation Link
                                                       |    Accepts Invitation
                                                       v
                                                     [ Assigned as Org OWNER ]
                                                     [ Autonomous Management ]
```

---
## 6. User Membership Architecture

The relationship between users and organizations is mediated exclusively through the `OrganizationMember` association model.

### 6.1 Membership Model Semantics
- A single global `User` can possess $N$ organization memberships simultaneously.
- Every membership binds the user to a specific `Organization` with an assigned `OrganizationRole` and a membership lifecycle `status` (`ACTIVE`, `SUSPENDED`, `INVITED`).
- Organization roles are local to that tenant. A user can be `OWNER` of Org A and `VIEWER` of Org B.

### 6.2 Organization Role Hierarchy1. **@OWNER` (Organization Owner):**
  - Has full control over organization settings, billing plans, integrations, workflows, and executions.
  - Can invite, promote, demote, or remove any member, including `ADMIN`s.
  - Can delete the organization or initiate ownership transfer.
  - **Critical Invariant:** An organization must have at least one active `OWNER`. The last owner cannot be demoted or removed.
2. **@ADMIN` (Organization Administrator):**
  - Can invite new members (`MEMBER`, `VIEWER`), assign roles, configure integrations, create/edit/publish workflows, and manage human approvals.
  - **Critical Invariant:** An `ADMIN` cannot remove or demote an `OWNER`, nor can an `ADMIN` promote a user to `OWNER`.
3. **@MEMBER` (Workflow Developer / Operator):**
  - Can create, edit, test, and execute workflows.
  - Can view integrations and respond to approval requests assigned to their team.
  - Cannot manage organization members, invitations, or tenant-level credentials.
4. **@VIEWER` (Read-Only Auditor):**
  - Has read-only visibility into workflows, execution runs, approval logs, and audit trails.
  - Cannot create, modify, execute, or approve any workflow actions.

---
## 7. RBAC Architecture

The FlowPilot backend is the sole security boundary. Authorization is evaluated against fine-grained capability permissions rather than static role string checks.

### 7.1 Fine-Grained Permission Matrix

| Capability Permission | OWNER | ADMIN | MEMBER | VIEWER | Description |
| :--- | :---:��| :---:��| :---:��| :---:��| :--- |
| `org:view` | YES | YES | YES | YES | View organization profile and public metadata |
| `org:update` | YES | YES | NO | NO | Update organization name, slug, settings |
| `org:delete` | YES | NO | NO | NO | Soft-delete or archive the organization |
| `org:transfer_ownership` | YES | NO | NO | NO | Transfer primary ownership to another member |
| `member:view` | YES | YES | YES | YES | List members and roles in the organization |
| `member:invite` | YES | YES | NO | NO | Create and dispatch member invitations |
| `member:update_role` | YES | YES | NO | NO | Change member roles (Admin cannot promote to Owner) |
| `member:remove` | YES | YES | NO | NO | Remove member (Admin cannot remove Owner) |
| `workflow:view` | YES | YES | YES | YES | View workflows, definitions, versions, and steps |
| `workflow:create` | YES | YES | YES | NO | Create new workflow drafts |
| `workflow:update` | YES | YES | YES | NO | Update canvas nodes, configurations, connections |
| `workflow:publish`, | YES | YES | YES | NO | Promote version to ACTIVE |
| `workflow:delete` | YES | YES | NO | NO | Archive or permanently delete workflow |
| `execution:trigger` | YES | YES | YES | YES | Manually execute or test workflow runs |
| `execution:view` | YES | YES | YES | YES | View execution traces, run logs, step outputs |
| `execution:cancel` | YES | YES | YES | NO | Abort in-flight workflow executions |
| `approval:view` | YES | YES | YES | YES | View pending and historical approval requests |
| `approval:respond` | YES | YES | YES | NO | Approve or reject human approval checkpoints |
| `integration:view` | YES | YES | YES | YES | View connected third-party integrations |
| `integration:manage` | YES | YES | NO | NO | Connect, configure, or revoke OAuth/API integrations |
| `audit:view` | YES | YES | NO | YES | View organization immutable audit trails |
| `analytics:view` | YES | YES | YES | YES | Access SLA monitoring and latency analytics |

---
### ASCII Diagram 7: Authorization Flow (Backend Enforcement)

```
[ Incoming Client Request ]
       | (Bearer Access Token + /organizations/{org_id}/workflows)
       v
[ FastAPI Dependency: get_current_user ]
       |-- Decodes JWT, validates signature & expiration
       |-- Validates against Redis revocation blacklist
       |-- Fetches User (is_active == True)
       v
[ FastAPI Dependency: get_org_context(org_id) ]
       |-- Queries OrganizationMember WHERE user_id == user.id AND org_id == org_id
       |-- IF NOT FOUND: RAISES 404 NOT FOUND (OWASP Tenant Masking)
       |-- IF ORG SUSPENDED: RAISES 403 FORBIDDEN ("Organization is suspended")
       v
[ FastAPI Dependency: require_permission(Permission.WORKFLOW_CREATE) ]
       |-- Looks up active OrganizationMember.role in Permission Map
       |-- Checks if Permission.WORKFLOW_CREATE in RolePermissions[member.role]
       |-- IF MISSING: RAISES 403 FORBIDDEN ("Insufficient permissions")
       v
[ Authorized Route Execution ]
       |-- Executes business logic scoped to org_id
       v
[ Response Returned to Client ]
```

---
## 8. Platform Admin Architecture

Platform administration represents the FlowPilot software vendor control plane. It must be kept strictly decoupled from customer organization administration.

### 8.1 Scope & Responsibilities
- **Customer Organization Management:** Provisioning new customer tenants, assigning initial owners, updating service tiers, monitoring health.
- **Tenant Lifecycle Governance:** Suspending organizations due to non-payment, terms violation, or security quarantine; activating or archiving organizations.
- **Platform Monitoring & Telemetry:** Global API request rates, worker queue backlogs, total execution throughput, system error rates across tenants.
- **Vendor Support & Impersonation:** Regulated support access with explicit tenant consent and immutable platform audit logging.

### 8.2 Authorization Separation
- `is_superuser` on `User` is the cryptographic gate for platform access.
- Dedicated dependency: `require_platform_admin(current_user: User = Depends(get_current_active_user))`.
- Dedicated API route prefix: `/api/v1/platform/...`.
- **Isolation Rule:** A Platform Admin does NOT automatically hold an `OrganizationMember` role in customer organizations. Customer data is protected from arbitrary vendor inspection unless authorized support mode is activated.

---
### ASCII Diagram 9: Platform Admin vs Organization Admin Scope

```
+==================================================================================================+|
                                   TWO DISTINCT ADMINISTRATIVE PLANES                                |
+==================================================================================================+

             [ FLOWPILOT PLATFORM ADMIN ]                         [ CUSTOMER ORGANIZATION ADMIN ]
             (FlowPilot Software Vendor)                         (ABC Corporation / Customer Org)
                        |                                                  |
       +----------------+-----------------+                    +-----------------+-----------------+
       |                                 |                    |                                |
[ Tenant Lifecycle ]             [ Global Monitoring ]    [ Team Management ]              [ Workspace Assets ]** Provision new orgs             * System health metrics  * Invite employees (email)       * Build workflows
* Suspend / Resume orgs          * Celery queue depths    * Assign roles (Admin/Member)    * Run executions
* Manage subscription tiers      * Database pool usage    * Revoke / Remove members        * Connect integrations
* Platform-wide audit logs       * Global error rates     * Organization settings          * Human approvals

SCOPE: Platform-wide control plane                        SCOPE: Bounded strictly to own organization_id
URL:   /api/v1/platform/...                                URL:   /api/v1/organizationr/{org_id}/...
SECURITY CHECK: is_superuser == True                      SECURITY CHECK: require_permission(...)
```

---
## 9. Organization Admin Architecture

Organization administration belongs exclusively to the customer organization's designated administrators (`OWNER` and `ADMIN`).

### 9.1 Scope & Capabilities
- **Autonomous Member Management:** Invite team members, update member roles, remove members when offboarded.
- **Workflow & Automation Governance:** Create, update, publish, test, and archive workflows.
- **Execution & Approvals:** Trigger automated workflows, inspect step-by-step audit runs, approve or reject human checkpoints.
- **Integrations & Credentials:** Authorize organization-specific integrations (e.g., ABC Corp's Slack workspace, CRM tokens).
- **Tenant Audit & Compliance:** Inspect immutable audit logs of all actions performed within their organization.

### 9.2 Boundaries & Protections
- **Strictly Scoped:** All operations require `organization_id` in path and active membership validation.
- **Zero Platform Privilege:** An Organization Admin has **zeho** access to platform administration, other customer organizations, or infrastructure configurations.
- **Anti-Lockout Invariants:** An Organization Admin cannot demote or remove an `OWNER`. The organization must always retain at least one active `OWNER`.

---
## 10. Google OIDC Architecture

FlowPilot integrates Google authentication strictly through standard OpenID Connect (OIDC Core 1.0). Google serves solely to cryptographically prove user identity; FlowPilot remains the authoritative source of truth for user accounts, organization memberships, roles, permissions, and sessions.

### 10.1 Discovery, PKCE, and State Protection
1. **OIDC Discovery:** Discovers endpoints dynamically from `https://accounts.google.com/.well-known/openid-configuration`.
2. **PKCE (Proof Key for Code Exchange):** Implements RFC 7636 using `S256`. Client generates a cryptographically random `code_verifier` (43-128 chars) and hashes it to produce `code_challenge`.
3. **State & Nonce:** The backend generates random 32-byte `state` and `nonce` tokens, cached in Redis with a 10-minute TT\ (`flowslot:oidc:state:{state}`).
   - `state` protects against Cross-Site Request Forgery (CSRF).
   - `nonce` prevents replay attacks on the ID token.

### 10.2 Cryptographic Verification
Upon Google redirecting to the callback endpoint:
1. Backend verifies the returning `state` matches the Redis record.
2. Exchanges authorization code and `code_verifier` at Google's token endpoint for tokens.
3. Fetches Google's public JSON Web Key Set (JWKS) from `https://www.googleapis.com/oauth2/v3/certs` (cached with HTTP max-age).
4. Verifies `id_token` signature using RSA keys from JWKS.
5. Asserts standard claims:
   - `iss` in `["https://accounts.google.com", "accounts.google.com"]`
   - `aud == settings.GOOGLE_CLIENT_ID`
   - `exp > current_timestamp`
   - `nonce == stored_nonce`
6. Extracts `sub` (Google Subject ID), `email`, `name`, `email_verified`.

---
### ASCII Diagram 3: Google OIDC Authentication Flow

```
[ User Browser ]                  [ FlowPilot Backend ]                  [ Google Identity ]
       |                                  |                                       |
       | 1. Click "Sign in with Google"   |                                       |
       |---------------------------------->|                                       |
       |                                   | 2. Generate PKCE verifier/challenge|
       |                                   |    Generate state & nonce           |
       |                                   |    Save state in Redis (10m TTL)    |
       | 3. Redirect to Google Accounts    |                                       |
       |<-----------------------------------|                                       |
       |                                                                          |
       | 4. User Authenticates & Consent                                         |
       |------------------------------------------------------------------------------>|
       |                                                                          |
       | 5. Redirect callback with code & state                                   |
       |<------------------------------------------------------------------------------|
       |                                  |                                       |
       | 6. GET /auth/google/callback      |                                       |
       |    ?code=...&state=...            |                                       |
       |----------------------------------->|                                       |
       |                                   | 7. Validate state in Redis          |
       |                                  |                                       |
       |                                  | 8. POST token exchange             |
       |                                  |    {code, code_verifier, client_id}|
       |                                  |--------------------------------------->|
       |                                   |    Returns id_token & access_token  |
       |                                  |<---------------------------------------|
       |                                   |                                       |
       |                                   | 9. Verify id_token via JWKS         |
       |                                   |    Assert iss, aud, exp, nonce      |
       |                                  |                                       |
       |                                  | 10. Lookup external_identities      |
       |                                   |     WHERE provider='google'         |
       |                                  |       AND subject=sub               |
       |                                   |                                       |
       |                                   | 11. Create User or Issue Session    |
       |                                   |     Issue Dual FlowPilot JWTs       |
       | 12. 200 OK or Redirect /dashboard |                                       |
       |     Set-Cookie: refresh_token=... |                                       |
       |     Body: {access_token, user}    |                                       |
       |<-----------------------------------|                                       |
```

---
## 11. Session Architecture

FlowPilot adheres to a defense-in-depth web session architecture tailored for high-security B2B SaaS.

### 11.1 Dual-Token Lifecycle
1. **Access Token (JWT):**
   - 15-minute TTL.
   - Claims: `sub` (User UUID), `email`, `org_id` (Active Org UUID), `role` (Active Org Role), `jti`, `iat`, `exp`, `type="access"`.
   - **Frontend Storage:** Stored exclusively in memory (`apiClient.ts`). Never persisted to `localStorage` or `sessionStorage` (eliminating token exfiltration via XSS).
2. **Refresh Token (JWT):**
   - 7-day TTL.
   - Claims: `sub` (User UUID), `jti`, `iat`, `exp`, `type="refresh"`.
   - **Storage:** Dispatched in a hardened cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/api/v1/auth`).
3. **Atomic Lua Token Rotation:**
   - Every invocation of `/api/v1/auth/refresh` rotates the refresh token atomically in Redis.
   - Old `jti` is deleted and new `jti` is written in a single atomic transaction.
   - **Replay Detection:** If an invalidated or replayed refresh token is presented, the atomic script returns failure and all refresh tokens for that user session are revoked.

### 11.2 Active Organization Switching
To resolve the defect where token refresh defaulted to `user.memberships[0]`:
- Expose `POST /api/v1/auth/switch-org`:
  - Request body: `{ "organization_id": "<UUID>" }`
  - Validates that `current_user` has an active membership in the target organization.
  - Generates and returns a fresh Access Token containing the new `org_id` and `role` claims.
  - Updates the active organization in `AuthContext` and sets the `X-Organization-Id` header.
- During silent refresh (`POST /api/v1/auth/refresh`):
  - Accepts optional `X-Organization-Id` header or body param `active_organization_id`.
  - Reissues access token for the active tenant context rather than blindly resetting to index 0.

### ASCII Diagram 6: Organization Switching Flow

```
[ User in Browser ]              [ FlowPilot Backend ]              [ Postgres DB ]
         |                                 |                               |
         | 1. Selects "XYZ Corp" from      |                               |
         |    Header Dropdown              |                               |
         | 2. POST /auth/switch-org        |                               |
         |    {organization_id: "XYZ"}     |                               |
         |-------------------------------->|                               |
         |                                 | 3. Query OrganizationMember   |
         |                                 |    user_id == caller.id       |
         |                                 |    org_id == XYZ.id           |
         |                                 |------------------------------>|
         |                                 |    Returns active membership  |
         |                                 |<------------------------------|
         |                                 |                               |
         |                                 | 4. Generate new Access Token  |
         |                                 |    claims: {                  |
         |                                 |      sub: user.id,            |
         |                                 |      org_id: XYZ.id,          |
         |                                 |      role: XYZ_ROLE,          |
         |                                 |      type: "access"           |
         |                                 |    }                          |
         |                                 |                               |
         | 5. 200 OK Response              |                               |
         |    {access_token: "new_token"}  |                               |
         |<--------------------------------|                               |
         |                                 |                               |
         | 6. Update memoryAccessToken     |                               |
         |    Update AuthContext activeOrg |                               |
         |    All subsequent API calls use |                               |
         |    new token & XYZ context      |                               |
```

---

## 12. Tenant Isolation Architecture

Tenant isolation guarantees that a customer organization's data can NEVER be viewed, modified, or leaked to another customer organization, even if an attacker guesses or acquires valid object UUIDs.

### 12.1 Multi-Tenant Isolation Controls
1. **Server-Side Enforcement Boundary:**
   - Every tenant resource (`Workflow`, `WorkflowRun`, `ApprovalRequest`, `Integration`, `AuditLog`, `UsageRecord`, `IdempotencyRecord`) contains a direct `organization_id` foreign key.
   - The FastAPI dependency `get_org_context` validates that the caller holds an active membership in the target `organization_id`.
2. **OWASP Anti-Enumeration (404 Masking):**
   - If an authenticated user queries an organization they do not belong to (or a workflow belonging to another organization), the backend returns `404 Not Found`, NOT `403 Forbidden`.
   - This masks the existence of tenant resources and completely neutralizes tenant enumeration attacks.
3. **Database Query Scoping:**
   - Every SQL query unconditionally includes `WHERE organization_id == :target_org_id`.
   - Never rely on object ID lookup alone:
     ```python
     # SECURE: Multi-tenant scoped query
     stmt = select(Workflow).where(
         Workflow.id == workflow_id,
         Workflow.organization_id == organization_id
     )
     ```
4. **Celery Worker & Background Job Isolation:**
   - Celery task payloads explicitly carry `organization_id`.
   - Background tasks re-verify organization active status and re-scope all database operations within the tenant boundary before performing executions.

### ASCII Diagram 8: Tenant Isolation Boundary

```
+===================================================================================================+
|                                    CUSTOMER A: ABC CORPORATION                                    |
| [ ABC User ] -> Bearer JWT {org_id: ABC_UUID}                                                    |
|                                                                                                   |
|  Query: GET /organizations/ABC_UUID/workflows/WF_123                                              |
|   -> DB: SELECT * FROM workflows WHERE id = 'WF_123' AND organization_id = 'ABC_UUID'             |
|   -> Result: 200 OK (Authorized Tenant Data)                                                      |
+===================================================================================================+
                                                |
                                                | (Cross-Tenant Attack Attempt)
                                                v
+===================================================================================================+
|                                    CUSTOMER B: XYZ CORPORATION                                    |
| [ ABC User ] attempts access using known XYZ UUID:                                                |
|                                                                                                   |
|  Query: GET /organizations/XYZ_UUID/workflows/WF_999                                              |
|   -> FastAPI get_org_context: Check membership (user_id=ABC_User, org_id=XYZ_UUID)                |
|   -> Membership Check: FAILED                                                                     |
|   -> Action: STOP EXECUTION IMMEDIATELY                                                           |
|   -> Response: 404 NOT FOUND (OWASP Tenant Masking)                                               |
|                                                                                                   |
|  Result: ABC User CANNOT access XYZ assets under ANY circumstances.                               |
+===================================================================================================+
```

---
## 13. Database Architecture

The target database architecture evolves the existing PostgreSQL 16 schema with additive, non-destructive alterations and two new enterprise security tables.

### 13.1 Schema Modifications

#### 1. Table: `users` (Modified)
- `password_hash`: Altered from `nullable=False` to `nullable=True` (permits passwordless Google OIDC accounts).
- `email_verified`: Added `Boolean`, server_default `False`, nullable `False`.
- `status`: Added `String(50)`, default `'ACTIVE'`, nullable `False`.

```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';
```

#### 2. Table: `organizations` (Modified)
- `status`: Added `String(50)`, server_default `'ACTIVE'`, nullable `False` (`ACTIVE`, `SUSPENDED`, `ARCHIVED`).
- `tier`: Added `String(50)`, server_default `'FREE'`, nullable `False` (`FREE`, `PRO`, `ENTERPRISE`).
- `settings`: Added `JSONB`, server_default `'{}'`, nullable `False`.

```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tier VARCHAR(50) NOT NULL DEFAULT 'FREE';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ix_organizations_status ON organizations (status);
```

#### 3. Table: `organization_members` (Modified)
- `status`: Added `String(50)`, server_default `'ACTIVE'`, nullable `False` (`ACTIVE`, `SUSPENDED`, `INVITED`).

```sql
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';
```

#### 4. Table: `external_identities` (NEW Table)
Tracks federated OAuth/OIDC identities (Google OIDC and future SSO providers) mapped to FlowPilot users.
```sql
CREATE TABLE IF NOT EXISTS external_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,            -- e.g. 'google'
    issuer VARCHAR(255) NOT NULL,             -- e.g. 'https://accounts.google.com'
    subject VARCHAR(255) NOT NULL,            -- Google sub ID
    provider_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_external_identity UNIQUE (provider, issuer, subject)
);
CREATE INDEX IF NOT EXISTS ix_external_identities_user_id ON external_identities (user_id);
CREATE INDEX IF NOT EXISTS ix_external_identities_lookup ON external_identities (provider, subject);
```

#### 5. Table: `invitations` (NEW Table)
Stores cryptographically hashed invitation tokens for organization onboarding.
```sql
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
    token_hash VARCHAR(64) NOT NULL,           -- SHA-256 of raw secret token
    invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_invitations_org ON invitations (organization_id);
CREATE INDEX IF NOT EXISTS ix_invitations_email ON invitations (email);
CREATE INDEX IF NOT EXISTS ix_invitations_token_hash ON invitations (token_hash);
```

---

## 14. API Architecture

### 14.1 REST API Endpoint Specifications

#### A. Authentication & Identity (`/api/v1/auth`)
| Method | Path | Auth | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/auth/register` | Public | Self-service registration (Argon2id + optional Org) |
| `POST` | `/auth/login` | Public | Password authentication, returns Dual JWTs & cookie |
| `POST` | `/auth/refresh` | Cookie/Body | Rotates refresh token in Redis, issues new access token |
| `POST` | `/auth/switch-org` | Bearer | Switches active organization context, issues new access token |
| `POST` | `/auth/logout` | Bearer | Blacklists access token, deletes refresh token from Redis |
| `GET` | `/auth/me` | Bearer | Returns user profile, active org, and member org summaries |
| `GET` | `/auth/google/authorize` | Public | Initiates Google OIDC flow, redirects with PKCE challenge |
| `GET` | `/auth/google/callback` | Public | Validates OIDC callback, exchanges code, issues session |
| `POST` | `/auth/link-identity` | Bearer | Explicitly links external OIDC provider to active account |

#### B. Customer Organization Management (`/api/v1/organizations`)
| Method | Path | Auth | Required Permission | Description |
| :--- | :--- | :---: | :---: | :--- |
| `POST` | `/organizations` | Bearer | Logged in | Self-service org creation (creator = OWNER) |
| `GET` | `/organizations` | Bearer | Logged in | Lists user's organization memberships |
| `GET` | `/organizations/{id}` | Bearer | `org:view` | Returns organization details |
| `PATCH` | `/organizations/{id}` | Bearer | `org:update` | Updates org name, slug, or settings |
| `GET` | `/organizations/{id}/members` | Bearer | `member:view` | Lists all members and assigned roles |
| `PATCH` | `/organizations/{id}/members/{user_id}` | Bearer | `member:update_role` | Updates member role (Owner/Admin) |
| `DELETE` | `/organizations/{id}/members/{user_id}` | Bearer | `member:remove` | Removes member from organization |

#### C. Member Invitation System (`/api/v1/organizations/{id}/invitations`)
| Method | Path | Auth | Required Permission | Description |
| :--- | :--- | :---: | :---: | :--- |
| `POST` | `/organizations/{id}/invitations` | Bearer | `member:invite` | Creates invitation and dispatches link |
| `GET` | `/organizations/{id}/invitations` | Bearer | `member:view` | Lists pending invitations |
| `DELETE` | `/organizations/{id}/invitations/{inv_id}` | Bearer | `member:invite` | Revokes pending invitation |
| `GET` | `/invitations/{token}/verify` | Public | None | Validates token, returns org name & role |
| `POST` | `/invitations/{token}/accept` | Public/Bearer| None | Accepts invitation, binds user to org |

#### D. Platform Control Plane (`/api/v1/platform`)
| Method | Path | Auth | Required Scope | Description |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/platform/organizations` | Bearer | Platform Admin | Lists all customer tenants across platform |
| `POST` | `/platform/organizations` | Bearer | Platform Admin | Enterprise provisioning with initial owner |
| `PATCH` | `/platform/organizations/{id}/status`| Bearer | Platform Admin | Suspends, activates, or archives tenant |
| `PATCH` | `/platform/organizations/{id}/tier`  | Bearer | Platform Admin | Modifies tenant subscription tier |
| `GET` | `/platform/stats` | Bearer | Platform Admin | Multi-tenant system telemetry & metrics |

### ASCII Diagram 5: User Invitation Flow

```
[ Customer Org Admin ]                                  [ Invited Employee ]
         |                                                       |
         | 1. Settings -> Members -> Invite                      |
         |    POST /organizations/{id}/invitations               |
         |    {email: "jane@company.com", role: "MEMBER"}        |
         v                                                       |
[ FlowPilot Backend ]                                            |
         |                                                       |
         | 2. Generate random 32-byte secret token               |
         |    Hash token with SHA-256                            |
         |    Save to `invitations` table (expires in 7 days)    |
         v                                                       |
[ Dispatch Email Notification ]                                  |
         | Link: https://app.flowpilot.com/invite?token=SEC_TOKEN|
         +------------------------------------------------------>|
                                                                 |
                                                                 | 3. Clicks Invitation Link
                                                                 v
                                                       [ Accept Invitation Page ]
                                                                 |
                                                                 | 4. Chooses Auth Method:
                                                                 |    - Google OIDC
                                                                 |    - Email / Password
                                                                 v
                                                       [ FlowPilot Backend ]
                                                                 |
                                                                 | 5. Verifies SHA-256(SEC_TOKEN)
                                                                 |    Creates or resolves User
                                                                 |    Creates OrganizationMember
                                                                 |    role = MEMBER, status = ACTIVE
                                                                 |    Marks invitation ACCEPTED
                                                                 v
                                                       [ Redirects to Dashboard ]
                                                       [ Scoped to Invited Organization ]
```

---

## 15. Frontend Architecture

The React 18 / Vite frontend reflects backend permissions cleanly in the user experience while respecting that the backend remains the sole security boundary.

### 15.1 Context & State (`frontend/src/context/AuthContext.tsx`)
- Enhance `AuthContextType`:
  ```typescript
  interface AuthContextType {
    user: User | null;
    organizations: OrganizationSummary[];
    activeOrganization: OrganizationSummary | null;
    activeRole: OrganizationRole | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    hasPermission: (permission: string) => boolean;
    login: (payload: LoginPayload) => Promise<void>;
    loginWithGoogle: () => void;
    register: (payload: RegisterPayload) => Promise<void>;
    logout: () => Promise<void>;
    switchOrganization: (organizationId: string) => Promise<void>;
    refreshProfile: () => Promise<void>;
  }
  ```
- **Permission Helper:** `hasPermission(perm)` evaluates whether `activeRole` includes the capability. Used to render or disable UI controls gracefully (e.g. "Create Workflow" button hidden for `VIEWER`).

### 15.2 API Client (`frontend/src/services/apiClient.ts`)
- Update `requestTokenRefresh` to send the active organization ID in headers/body, ensuring rotated access tokens retain the user's active tenant selection.
- Update `switchOrganization` to invoke `POST /api/v1/auth/switch-org` and update in-memory tokens.

### 15.3 Settings Page: Members Tab (`frontend/src/pages/settings/SettingsPage.tsx`)
Replace the hardcoded mock row with an interactive tenant administration interface:
- **Active Members Table:** Fetches real members from `GET /api/v1/organizations/{id}/members`. Displays Name, Email, Role badge, Status badge, and Actions.
- **Invite Member Modal:** Triggered by "Invite Member" button (visible only to `OWNER` / `ADMIN`). Inputs: Email, Role dropdown (`ADMIN`, `MEMBER`, `VIEWER`).
- **Role Selector & Removal:** Inline dropdown to change member role (`PATCH .../members/{user_id}`). Remove confirmation modal with safety guard preventing removal of the last `OWNER`.
- **Pending Invitations Tab:** Lists pending invites with "Resend" and "Revoke" actions.

### 15.4 Dedicated UI Routes
- `/invite`: New page `AcceptInvitationPage.tsx` rendering invitation acceptance and onboarding.
- `/platform`: New route and page `PlatformAdminPage.tsx` protected by superuser check (`user?.is_superuser`), providing customer tenant provisioning and platform-wide monitoring.

---
## 16. Security Architecture

FlowPilot applies a comprehensive threat-modeled security posture addressing top SaaS vulnerability categories.

### 16.1 Threat Modeling & Mitigation Matrix

| Threat Vector | Potential Vulnerability | FlowPilot Mitigation Architecture |
| :--- | :--- | :--- |
| **IDOR / BOLA** | Attacker accesses another tenant's workflow by guessing UUID | Strict server-side query scoping (`WHERE organization_id == :id`) on all queries. FastAPI `get_org_context` validates caller's active membership. |
| **Tenant Enumeration** | Attacker discovers which organizations exist on the platform | Non-members receive `404 Not Found` (OWASP recommendation), never `403 Forbidden`. |
| **Pre-Account Takeover** | Attacker creates password account before victim signs in with Google | Account linking policy: Never auto-merge unauthenticated external identities. Require password auth before linking. |
| **XSS & Token Theft** | Malicious script steals JWT credentials from `localStorage` | Access tokens stored exclusively in memory (`apiClient.ts`). Refresh tokens stored in `HttpOnly` cookies. Strictest CSP enforced in middleware. |
| **CSRF** | Malicious site executes state-changing requests using cookie | Refresh endpoint verifies `Origin` header matches `ALLOWED_CORS_ORIGINS`. Refresh cookie set with `SameSite=Lax`. Sensitive POSTs require Bearer headers. |
| **Token Replay** | Stolen refresh token re-used by malicious actor | Atomic Redis Lua script rotation. If an already-rotated `jti` is presented, all refresh tokens for that user are immediately invalidated. |
| **Credential Stuffing** | Automated brute-force attacks against login and register | Sliding-window Redis rate limiting: `/auth/login` (5 req/min/IP), `/auth/register` (3 req/hr/IP), with fail-open resilience. |
| **Privilege Escalation** | Admin promotes themselves to Owner or removes Owner | Rigid invariant checks in `organizations.py`: Admins cannot grant Owner role; Admins cannot remove Owners; last Owner cannot be removed. |
| **Timing Attacks** | Password hash comparison leakage via response time variation | Constant-time Argon2id password verification (`argon2-cffi`) and constant-time token hash verification (`secrets.compare_digest`). |
| **Session Fixation** | Attacker pre-creates session identifier before login | Dual-token reissue on login and org-switch. Fresh `jti` generated on every state transition. |

---

## 17. Migration Strategy

To guarantee zero downtime and preserve data integrity, database alterations are executed via phased, backwards-compatible Alembic migrations.

### 17.1 Phased Migration Sequence
1. **Migration 0003: Additive Column Enhancements (`0003_add_auth_org_enhancements.py`):**
   - Alter `users.password_hash` to `nullable=True`.
   - Add `users.email_verified` (Boolean, default `False`).
   - Add `users.status` (String(50), default `'ACTIVE'`).
   - Add `organizations.status` (String(50), default `'ACTIVE'`).
   - Add `organizations.tier` (String(50), default `'FREE'`).
   - Add `organizations.settings` (JSONB, default `'{}'`).
   - Add `organization_members.status` (String(50), default `'ACTIVE'`).
   - **Backfill:** Set `email_verified=True` for all existing registered users.
2. **Migration 0004: Enterprise Security Tables (`0004_create_external_identities_and_invitations.py`):**
   - Create table `external_identities` with unique constraint `(provider, issuer, subject)`.
   - Create table `invitations` with unique indices on `token_hash` and `(organization_id, email)`.

### 17.2 Rollback Safety
Every migration defines complete `downgrade()` functions. All new columns include server defaults, allowing existing running backend instances to function without disruption while new instances roll out.

---

## 18. Testing Strategy

The security and multi-tenancy guarantees are validated across a dedicated multi-layer automated test suite.

### 18.1 Test Matrix
1. **Unit Tests (`backend/tests/unit/`):**
   - Password hashing and constant-time verification.
   - JWT encoding, claims decoding, expiration, and algorithm restriction.
   - OIDC ID token validation (issuer, audience, expiry, nonce, JWKS verification).
   - Permission calculator: Validates role-to-permission mapping matrix for all roles.
2. **Integration Tests (`backend/tests/integration/`):**
   - Alembic upgrade/downgrade validation.
   - Redis token rotation Lua script: Validates atomicity and replay attack invalidation.
   - Redis access token blacklist: Validates immediate revocation upon logout.
3. **Authorization & RBAC Tests (`backend/tests/api/test_rbac_authorization.py`):**
   - Tests every endpoint against all 4 roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
   - Asserts that `VIEWER` receives `403 Forbidden` on mutation endpoints (`POST /workflows`, `POST /executions`).
   - Asserts that `ADMIN` cannot remove an `OWNER` or grant `OWNER` role.
4. **Tenant Isolation Tests (`backend/tests/api/test_tenant_isolation.py`):**
   - Alice (Org A) and Bob (Org B) created with workflows and runs.
   - Alice attempts to access Bob's workflow by ID: Asserts `404 Not Found` (OWASP anti-enumeration).
   - Bob attempts to delete Alice's integration: Asserts `404 Not Found`.
5. **End-to-End Tests (`backend/tests/e2e/test_auth_tenant_lifecycle.py`):**
   - User signs up, creates org, invites second user as Member.
   - Member accepts invitation via secret token, logs in, and verifies active tenant context.
   - Member switches between multiple orgs, verifying reissued access token claims.

---

## 19. Future Enterprise SSO

FlowPilot's decoupled `external_identities` architecture is engineered to seamlessly incorporate enterprise Single Sign-On (SSO) providers.

### 19.1 Architecture Roadmap
1. **Supported Enterprise Providers:**
   - Microsoft Entra ID (Azure AD via OIDC / SAML 2.0)
   - Okta (OIDC / SAML 2.0)
   - PingFederate / OneLogin
2. **Customer Tenant SSO Routing:**
   - Organization settings store tenant IdP metadata (`issuer`, `client_id`, `sso_discovery_url`, `enforce_sso`).
   - Users enter their work email (e.g., `alex@enterprise.com`); the system detects the enterprise domain and routes the login flow directly to the customer's dedicated IdP.
3. **Just-In-Time (JIT) Provisioning:**
   - If an employee authenticates via enterprise SSO, FlowPilot automatically provisions their user account and binds them to the customer organization as `MEMBER`.

---

## 20. Future MFA / Passkeys

Following the core architecture rollout, FlowPilot will support advanced multi-factor authentication.

### 20.1 Multi-Factor Authentication Architecture
1. **TOTP (Time-Based One-Time Passwords):**
   - RFC 6238 implementation (Google Authenticator, Microsoft Authenticator, 1Password).
   - Secret generated server-side, encrypted at rest using AES-256-GCM (`app/core/encryption.py`), presented via QR code.
   - Single-use backup recovery codes hashed and stored securely.
2. **FIDO2 / WebAuthn Passkeys:**
   - Passwordless biometric login (Face ID, Touch ID, YubiKey).
   - Public key stored in FlowPilot; private key securely held in user's hardware authenticator.
3. **Step-Up Authentication:**
   - Enforce MFA prompts before high-risk actions (e.g., deleting an organization, transferring ownership, exporting tenant audit logs).

---
## 21. Phase-by-Phase Implementation Plan

Every phase below includes all 12 required architectural fields specifying objectives, current codebase state, exact required changes, affected files, schemas, APIs, security boundaries, tests, dependencies, risk levels, and migration requirements.

---

### PHASE 0 — CURRENT STATE AUDIT

1. **Objective:** Formulate a baseline technical audit of FlowPilot's existing authentication, multi-tenancy, database models, session tokens, and frontend components to ensure no breaking regressions occur.
2. **Current Implementation:** 
   - PostgreSQL 16 schema with 14 tables in `backend/alembic/versions/0001_initial_schema.py`.
   - Dual-token session in `app/core/security.py`: Argon2id password hashing, 30m JWT access token, 7d refresh token in Redis with Lua rotation, Redis access token blacklist, and HttpOnly cookies.
   - Organization tenant scoping enforced in `app/api/deps.py` (`get_org_context`) with OWASP 404 masking.
   - Resource routers (`workflows.py`, `executions.py`, `approvals.py`, etc.) nested under `/organizations/{organization_id}/...`.
   - Frontend in-memory token storage in `services/apiClient.ts` and `context/AuthContext.tsx`.
3. **Required Changes:** Document all 9 architectural gaps and defects identified during inspection: non-nullable `password_hash`, missing `invitations` table, missing `external_identities` table, hardcoded index 0 in `/auth/refresh`, missing `GET /members` and `PATCH /members` endpoints, static mock row in frontend Settings, and dormant `is_superuser`.
4. **Files Likely Affected:** Read-only audit of all files in `backend/app/` and `frontend/src/`.
5. **Database Changes:** None (audit phase only).
6. **API Changes:** None.
7. **Frontend Changes:** None.
8. **Security Considerations:** Ensure audit reveals all potential IDOR, BOLA, and enumeration surfaces without leaking credentials or secret keys.
9. **Tests Required:** Run existing unit, integration, and security suites to establish 100% green baseline.
10. **Dependencies on Previous Phases:** None.
11. **Risk Level:** Very Low (zero code modifications).
12. **Whether Migration is Required:** No.

---

### PHASE 1 — ORGANIZATION MODEL

1. **Objective:** Upgrade the `Organization` entity to support full enterprise lifecycle states (`ACTIVE`, `SUSPENDED`, `ARCHIVED`), subscription plan tiers, and JSONB organizational settings.
2. **Current Implementation:** `app/models/organization.py` only defines `id`, `name`, `slug`, `created_at`, `updated_at`. Lacks status, tier, or settings.
3. **Required Changes:**
   - Add `status` column (enum/string: `ACTIVE`, `SUSPENDED`, `ARCHIVED`) with index.
   - Add `tier` column (`FREE`, `PRO`, `ENTERPRISE`).
   - Add `settings` column (JSONB, default `{}`) for log retention, allowed invite domains, and security controls.
   - Update Pydantic schemas in `app/schemas/organization.py`.
4. **Files Likely Affected:**
   - `backend/app/models/organization.py`
   - `backend/app/schemas/organization.py`
   - `backend/app/routers/organizations.py`
   - `backend/alembic/versions/0003_add_auth_org_enhancements.py`
5. **Database Changes:**
   - `ALTER TABLE organizations ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';`
   - `ALTER TABLE organizations ADD COLUMN tier VARCHAR(50) NOT NULL DEFAULT 'FREE';`
   - `ALTER TABLE organizations ADD COLUMN settings JSONB NOT NULL DEFAULT '{}';`
   - `CREATE INDEX ix_organizations_status ON organizations (status);`
6. **API Changes:**
   - `GET /api/v1/organizations/{id}`: Returns `status`, `tier`, `settings`.
   - `PATCH /api/v1/organizations/{id}`: Permits `OWNER` / `ADMIN` to update allowed settings.
7. **Frontend Changes:**
   - Update `OrganizationSummary` interface in `frontend/src/types/auth.ts` to include `status` and `tier`.
   - Display organization status and tier in `SettingsPage.tsx` Organization tab.
8. **Security Considerations:** Prevent customer Organization Admins from modifying their own `tier` or overriding vendor-enforced `SUSPENDED` status.
9. **Tests Required:**
   - Unit test organization model instantiation and serialization.
   - API test updating org settings with permission enforcement.
10. **Dependencies on Previous Phases:** Phase 0.
11. **Risk Level:** Low (additive columns with server defaults).
12. **Whether Migration is Required:** Yes (Alembic migration 0003).

---

### PHASE 2 — USER / MEMBERSHIP / ROLE MODEL

1. **Objective:** Refactor user memberships and organization roles to support `OWNER`, `ADMIN`, `MEMBER`, and `VIEWER`, establish membership lifecycle statuses, and prepare `User` for external OIDC authentication.
2. **Current Implementation:**
   - `User` in `app/models/user.py` has `password_hash` non-nullable, lacks `email_verified` and `status`.
   - `OrganizationMember` in `app/models/membership.py` has `role` string (`OWNER`, `ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`), lacks `status`.
3. **Required Changes:**
   - Make `users.password_hash` nullable.
   - Add `users.email_verified` (Boolean, default False) and `users.status` (default 'ACTIVE').
   - Add `organization_members.status` (default 'ACTIVE').
   - Update `OrganizationRole` enum to standardize on `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` (mapping legacy `MANAGER` and `OPERATOR` to `MEMBER`).
   - Implement invariant check: Prevent removing the last `OWNER` of an organization.
4. **Files Likely Affected:**
   - `backend/app/models/user.py`
   - `backend/app/models/membership.py`
   - `backend/app/schemas/auth.py`
   - `backend/app/schemas/organization.py`
   - `backend/app/routers/organizations.py`
5. **Database Changes:**
   - `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`
   - `ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;`
   - `ALTER TABLE users ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';`
   - `ALTER TABLE organization_members ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';`
6. **API Changes:**
   - Update `UserResponse` and `UserMeResponse` schemas to include `email_verified` and `status`.
   - Implement `GET /api/v1/organizations/{id}/members` returning member list with roles and statuses.
   - Implement `PATCH /api/v1/organizations/{id}/members/{user_id}` for role updates.
7. **Frontend Changes:**
   - Update `User` and `OrganizationRole` types in `frontend/src/types/auth.ts`.
   - Update `AuthContext.tsx` to handle updated role definitions.
8. **Security Considerations:**
   - Enforce that `ADMIN` cannot grant `OWNER` role.
   - Enforce that `ADMIN` cannot remove or demote an `OWNER`.
   - Ensure the last `OWNER` cannot leave or delete their own role without ownership transfer.
9. **Tests Required:**
   - Test adding, listing, updating, and removing organization members.
   - Test anti-lockout invariant (rejecting removal of sole owner).
10. **Dependencies on Previous Phases:** Phase 1.
11. **Risk Level:** Medium (alters core User and Membership models).
12. **Whether Migration is Required:** Yes (Alembic migration 0003).

---

### PHASE 3 — ORGANIZATION CREATION

1. **Objective:** Unify organization creation to seamlessly accommodate both Self-Service SaaS signups and Platform Admin enterprise provisioning.
2. **Current Implementation:**
   - `POST /api/v1/organizations` creates an org and assigns current user as `OWNER`.
   - `POST /api/v1/auth/register` optionally creates an org during signup.
   - No enterprise provisioning endpoint exists.
3. **Required Changes:**
   - Enhance `POST /api/v1/organizations` to initialize organization with default settings and active status.
   - Create enterprise provisioning endpoint `POST /api/v1/platform/organizations`:
     - Creates organization with status `ACTIVE` and tier `ENTERPRISE`.
     - Creates an Owner Activation Invitation for the target customer email.
     - Automatically sends an activation onboarding email.
4. **Files Likely Affected:**
   - `backend/app/routers/organizations.py`
   - `backend/app/routers/platform.py` (new)
   - `backend/app/schemas/organization.py`
5. **Database Changes:** None (reuses Phase 1 and 2 schemas).
6. **API Changes:**
   - New endpoint: `POST /api/v1/platform/organizations` (Platform Admin scope).
7. **Frontend Changes:**
   - Add "Create New Organization" modal/form accessible from Header organization dropdown.
8. **Security Considerations:**
   - Slug generation must be sanitized against path traversal and SQL injection (`re.sub(r'[^a-z0-9-]', '', slug)`).
   - Rate limit organization creation to prevent tenant spamming.
9. **Tests Required:**
   - Test self-service creation assigns caller as `OWNER`.
   - Test platform provisioning creates tenant and dispatches owner activation.
10. **Dependencies on Previous Phases:** Phase 1, Phase 2.
11. **Risk Level:** Low.
12. **Whether Migration is Required:** No.

---

### PHASE 4 — INVITATION SYSTEM

1. **Objective:** Replace the broken member addition flow (which required target users to already exist in FlowPilot) with a cryptographic, email-based team invitation system.
2. **Current Implementation:** `POST /organizations/{id}/members` queries `User` table for matching email; returns 404 if the user does not exist. No invitations table or workflow exists.
3. **Required Changes:**
   - Create `invitations` table storing `organization_id`, `email`, `role`, `token_hash`, `invited_by_user_id`, `expires_at`, `status`.
   - Implement `POST /api/v1/organizations/{id}/invitations`:
     - Caller must have `member:invite` permission (`OWNER` or `ADMIN`).
     - Generates 32-byte cryptographically secure random token (`secrets.token_urlsafe(32)`).
     - Computes SHA-256 hash of token and stores in database with 7-day expiration.
     - Dispatches email containing invitation link: `https://app.flowpilot.com/invite?token=...`.
   - Implement `GET /api/v1/invitations/{token}/verify` to return org name, role, and inviter info for public UI display.
   - Implement `POST /api/v1/invitations/{token}/accept`:
     - Verifies token hash, expiration, and status `PENDING`.
     - If user is logged in: binds existing user account to organization with specified role.
     - If user is not logged in: guides user through Google OIDC or password setup, then binds membership.
     - Marks invitation `ACCEPTED` in an atomic database transaction.
4. **Files Likely Affected:**
   - `backend/app/models/invitation.py` (new)
   - `backend/app/schemas/invitation.py` (new)
   - `backend/app/routers/invitations.py` (new)
   - `backend/app/routers/organizations.py`
   - `backend/alembic/versions/0004_create_external_identities_and_invitations.py`
   - `frontend/src/pages/auth/AcceptInvitationPage.tsx` (new)
5. **Database Changes:**
   - Create `invitations` table with indices on `token_hash`, `(organization_id, email)`.
6. **API Changes:**
   - `POST /api/v1/organizations/{id}/invitations`
   - `GET /api/v1/organizations/{id}/invitations`
   - `DELETE /api/v1/organizations/{id}/invitations/{inv_id}`
   - `GET /api/v1/invitations/{token}/verify`
   - `POST /api/v1/invitations/{token}/accept`
7. **Frontend Changes:**
   - Create `AcceptInvitationPage.tsx` (`/invite` route) displaying invitation details and "Accept with Google" / "Create Password" options.
   - Update Settings Page Members tab to render "Invite Member" button and modal.
8. **Security Considerations:**
   - Raw invitation token is NEVER stored in database; only SHA-256 hash is persisted (protects against database dump exposure).
   - Single-use guarantee: Token is invalidated immediately upon acceptance.
   - Expired invitations (>7 days) are rejected automatically.
9. **Tests Required:**
   - Test invitation creation and token hash generation.
   - Test duplicate invitation prevention.
   - Test acceptance by new user and existing user.
   - Test expired token rejection.
10. **Dependencies on Previous Phases:** Phase 1, Phase 2.
11. **Risk Level:** High (critical onboarding workflow and new public-facing endpoints).
12. **Whether Migration is Required:** Yes (Alembic migration 0004).

---
### PHASE 5 — AUTHENTICATION HARDENING

1. **Objective:** Harden existing Email/Password and session mechanics, fix the active organization reset bug during token rotation, implement an explicit org-switching endpoint, and reinforce cookie/CSRF defenses.
2. **Current Implementation:**
   - Argon2id password hashing in `app/core/security.py`.
   - Refresh token rotation in `POST /auth/refresh` hardcodes active org to `user.memberships[0]`.
   - No explicit org-switching endpoint exists; switching orgs in frontend header does not update backend JWT claims.
3. **Required Changes:**
   - Implement `POST /api/v1/auth/switch-org`:
     - Accepts `organization_id`.
     - Validates caller membership in target organization.
     - Re-issues Access Token containing new `org_id` and `role` claims.
   - Update `POST /api/v1/auth/refresh`:
     - Reads requested active organization from request header `X-Organization-Id` or request body.
     - Validates user membership in that org and issues access token for that context (or falls back to previous valid token claim).
   - Ensure refresh cookie enforces `HttpOnly=True`, `SameSite="Lax"`, `Secure=True` in production, `Path="/api/v1/auth"`.
4. **Files Likely Affected:**
   - `backend/app/routers/auth.py`
   - `backend/app/core/security.py`
   - `backend/app/schemas/auth.py`
   - `frontend/src/context/AuthContext.tsx`
   - `frontend/src/services/apiClient.ts`
5. **Database Changes:** None.
6. **API Changes:**
   - New endpoint: `POST /api/v1/auth/switch-org`
   - Updated endpoint: `POST /api/v1/auth/refresh` (preserves active org context).
7. **Frontend Changes:**
   - Update `switchOrganization` in `AuthContext.tsx` to invoke `POST /auth/switch-org`.
   - Update `apiClient.ts` to include `X-Organization-Id` in refresh requests.
8. **Security Considerations:**
   - Prevent horizontal privilege escalation during org switching (verify membership in target org before issuing token).
   - Ensure old access token revocation if switching orgs mid-session.
9. **Tests Required:**
   - Test user belonging to Org A and Org B switching between them, asserting issued JWT contains correct `org_id` and `role`.
   - Test silent refresh preserving chosen active organization.
10. **Dependencies on Previous Phases:** Phase 2.
11. **Risk Level:** Medium (touches core session token issuance).
12. **Whether Migration is Required:** No.

---

### PHASE 6 — GOOGLE OIDC

1. **Objective:** Implement production-grade Google OpenID Connect (OIDC) authentication with standard discovery, PKCE, state/nonce verification, and defensive account linking.
2. **Current Implementation:** No external identity authentication exists in FlowPilot; login/register only accept username/password.
3. **Required Changes:**
   - Create `external_identities` table (`user_id`, `provider`, `issuer`, `subject`, `provider_email`).
   - Implement `GET /api/v1/auth/google/authorize`:
     - Generates cryptographically secure `state`, `nonce`, and PKCE `code_verifier` / `code_challenge`.
     - Stores `state`, `nonce`, `code_verifier` in Redis (10-minute TTL).
     - Redirects user to Google Accounts authorization URL.
   - Implement `GET /api/v1/auth/google/callback`:
     - Validates returning `state` against Redis.
     - Exchanges authorization code for tokens at Google's token endpoint using `code_verifier`.
     - Validates Google `id_token` signature against Google's public JWKS.
     - Asserts `iss`, `aud`, `exp`, and `nonce`.
     - Queries `external_identities` for `provider="google"` and `subject=sub`.
     - If identity exists: issues FlowPilot session.
     - If identity does not exist: checks if `email` exists in `users`. If exists, prompts for explicit password verification to link accounts; if new, creates `User` (with `password_hash=None`, `email_verified=True`) and links external identity.
4. **Files Likely Affected:**
   - `backend/app/models/external_identity.py` (new)
   - `backend/app/routers/auth.py`
   - `backend/app/core/config.py` (adds `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`)
   - `backend/alembic/versions/0004_create_external_identities_and_invitations.py`
   - `frontend/src/pages/auth/LoginPage.tsx`
   - `frontend/src/pages/auth/RegisterPage.tsx`
5. **Database Changes:**
   - Create `external_identities` table.
6. **API Changes:**
   - `GET /api/v1/auth/google/authorize`
   - `GET /api/v1/auth/google/callback`
   - `POST /api/v1/auth/link-identity`
7. **Frontend Changes:**
   - Add "Continue with Google" button to `LoginPage.tsx` and `RegisterPage.tsx`.
   - Handle OAuth callback and error states.
8. **Security Considerations:**
   - Strict defense against Pre-Account Takeover: Never auto-merge unauthenticated accounts.
   - PKCE `S256` prevents authorization code interception attacks.
   - Redis-backed `state` and `nonce` tokens prevent CSRF and ID token replay.
9. **Tests Required:**
   - Unit test Google ID token verification (mocking Google JWKS).
   - Test new user onboarding via Google OIDC.
   - Test defensive account linking rejection without password verification.
10. **Dependencies on Previous Phases:** Phase 2, Phase 5.
11. **Risk Level:** High (external cryptographic integration and account linking boundaries).
12. **Whether Migration is Required:** Yes (Alembic migration 0004).

---

### PHASE 7 — RBAC & PERMISSIONS

1. **Objective:** Transition backend authorization from static role string matching to a capability-based permission evaluation engine (`require_permission`), mapping `OWNER`, `ADMIN`, `MEMBER`, and `VIEWER` to fine-grained action permissions.
2. **Current Implementation:** `app/api/deps.py` defines `require_role(allowed_roles: List[OrganizationRole])` which directly checks string membership in a list. Routers perform ad-hoc checks.
3. **Required Changes:**
   - Define `Permission` enum in `app/core/permissions.py` (e.g. `WORKFLOW_CREATE`, `WORKFLOW_PUBLISH`, `EXECUTION_TRIGGER`, `MEMBER_INVITE`, `INTEGRATION_MANAGE`).
   - Create `ROLE_PERMISSIONS_MAP` dictionary defining complete capability sets for each role.
   - Implement `require_permission(permission: Permission)` dependency factory in `app/api/deps.py`:
     - Resolves `org_context`.
     - Validates that caller's active role possesses the required permission.
     - Raises `403 Forbidden` with detailed error detail if unauthorized.
   - Refactor resource routers (`workflows.py`, `executions.py`, `approvals.py`, `integrations.py`, `audit.py`) to use `require_permission(...)` instead of `require_role(...)`.
4. **Files Likely Affected:**
   - `backend/app/core/permissions.py` (new)
   - `backend/app/api/deps.py`
   - `backend/app/routers/workflows.py`
   - `backend/app/routers/executions.py`
   - `backend/app/routers/approvals.py`
   - `backend/app/routers/integrations.py`
   - `backend/app/routers/organizations.py`
   - `backend/app/routers/audit.py`
5. **Database Changes:** None (permissions are code-defined capabilities mapped to roles).
6. **API Changes:** Standardizes error responses: 403 Forbidden with `{ "detail": "Missing required permission: <perm>" }`.
7. **Frontend Changes:**
   - Expose `hasPermission(permission: string)` helper in `AuthContext.tsx`.
   - Update UI components to conditionally render or disable action buttons based on capabilities (e.g., disable "Run Workflow" for `VIEWER`).
8. **Security Considerations:**
   - Ensure backend remains the sole security boundary; frontend checks are purely UX affordances.
   - Protect against privilege escalation: `ADMIN` cannot execute actions reserved for `OWNER` (`org:delete`, `org:transfer_ownership`).
9. **Tests Required:**
   - Comprehensive matrix test asserting every API route against all 4 roles.
   - Verify `VIEWER` is completely prevented from modifying any resource.
10. **Dependencies on Previous Phases:** Phase 2, Phase 5.
11. **Risk Level:** Medium (broad refactoring of route dependencies).
12. **Whether Migration is Required:** No.

---

### PHASE 8 — TENANT ISOLATION

1. **Objective:** Audit, harden, and mathematically guarantee server-side tenant isolation across all entities, preventing IDOR, BOLA, and cross-tenant data leaks.
2. **Current Implementation:** Resources have `organization_id` foreign keys; `get_org_context` returns 404 for non-members. However, Celery background worker tasks and child models (`WorkflowVersion`, `WorkflowStep`) need explicit tenancy validation audits.
3. **Required Changes:**
   - Audit all database queries in `backend/app/routers/` to ensure unconditional filtering by `organization_id`.
   - Enforce that child resources (e.g., `WorkflowVersion`, `WorkflowStep`, `WorkflowRun`) verify that their parent workflow belongs to the requested `organization_id`.
   - Audit Celery task signatures (`app/workers/tasks.py`): Ensure task payloads contain `organization_id` and tasks re-verify organization active status before step execution.
   - Reinforce OWASP anti-enumeration: All cross-tenant unauthorized access attempts must return `404 Not Found`.
4. **Files Likely Affected:**
   - `backend/app/routers/workflows.py`
   - `backend/app/routers/executions.py`
   - `backend/app/routers/approvals.py`
   - `backend/app/routers/integrations.py`
   - `backend/app/workers/tasks.py`
5. **Database Changes:** None.
6. **API Changes:** None (enforces strict consistency across existing endpoints).
7. **Frontend Changes:** None.
8. **Security Considerations:**
   - Eliminate all possibilities of BOLA / IDOR vulnerabilities.
   - Ensure logs do not leak sensitive tenant payloads during cross-tenant rejection.
9. **Tests Required:**
   - Dedicated cross-tenant penetration test suite: Org A user attempting to read, update, or delete Org B workflows, versions, executions, approvals, integrations, and audit logs. All must return 404.
10. **Dependencies on Previous Phases:** Phase 1, Phase 7.
11. **Risk Level:** Medium (critical core isolation guarantee).
12. **Whether Migration is Required:** No.

---

### PHASE 9 — PLATFORM ADMIN

1. **Objective:** Establish the FlowPilot Platform Control Plane as a dedicated administrative layer separate from customer organization administration.
2. **Current Implementation:** `is_superuser` column exists on `User`, but has zero associated routes, dependencies, or UI controls in the entire system.
3. **Required Changes:**
   - Implement `require_platform_admin` dependency in `app/api/deps.py`:
     - Verifies `current_user.is_superuser == True`.
     - Rejects non-superusers with `403 Forbidden ("Platform administrator privileges required")`.
   - Create `backend/app/routers/platform.py`:
     - `GET /api/v1/platform/organizations`: Lists all customer tenants across the platform with status, tier, member count, and creation date.
     - `POST /api/v1/platform/organizations`: Provisions new enterprise tenant and dispatches owner activation.
     - `PATCH /api/v1/platform/organizations/{id}/status`: Suspends or activates a tenant.
     - `PATCH /api/v1/platform/organizations/{id}/tier`: Updates tenant subscription tier.
     - `GET /api/v1/platform/stats`: Aggregates platform-wide telemetry (active orgs, executions count, worker queue backlog).
   - Register platform router in `app/main.py`.
4. **Files Likely Affected:**
   - `backend/app/api/deps.py`
   - `backend/app/routers/platform.py` (new)
   - `backend/app/schemas/platform.py` (new)
   - `backend/app/main.py`
   - `frontend/src/pages/admin/PlatformAdminPage.tsx` (new)
   - `frontend/src/routes/AppRoutes.tsx`
5. **Database Changes:** None (leverages `User.is_superuser` and `Organization.status/tier`).
6. **API Changes:** New endpoint namespace: `/api/v1/platform/...`.
7. **Frontend Changes:**
   - Add `/platform` route in `AppRoutes.tsx` protected by a superuser guard.
   - Build `PlatformAdminPage.tsx` dashboard for organization provisioning, suspension toggling, and global telemetry monitoring.
   - Add Platform Admin link in user profile dropdown if `user.is_superuser == True`.
8. **Security Considerations:**
   - Platform Admin operations must be strictly logged in dedicated platform audit logs.
   - Platform Admin cannot read customer confidential integration tokens without explicit audited support session consent.
9. **Tests Required:**
   - Test platform admin endpoints accessible only by `is_superuser=True`.
   - Test tenant suspension immediately revokes execution triggering for customer users.
10. **Dependencies on Previous Phases:** Phase 1, Phase 2, Phase 3.
11. **Risk Level:** Medium (new global control plane).
12. **Whether Migration is Required:** No.

---
### PHASE 10 — FRONTEND UX

1. **Objective:** Modernize and complete the frontend user interface to support Google OIDC login, organization switching, team invitation acceptance, dynamic member management, and Platform Admin controls.
2. **Current Implementation:**
   - `LoginPage.tsx` & `RegisterPage.tsx` only support username/password.
   - `SettingsPage.tsx` has a hardcoded static row in the Members tab.
   - Header dropdown changes local state but does not request reissued backend JWT.
   - No invitation acceptance or platform admin pages exist.
3. **Required Changes:**
   - Update `LoginPage.tsx` and `RegisterPage.tsx`: Add "Continue with Google" button with OIDC authorization redirect.
   - Build `AcceptInvitationPage.tsx` (`/invite?token=...`): Renders organization name, invited role, and onboarding auth options.
   - Update `SettingsPage.tsx` Members tab: Dynamic table fetching `GET /organizations/{id}/members`, "Invite Member" modal, role update dropdown, and member removal modal with confirmation guards.
   - Update `Header.tsx`: Connect organization switcher to `switchOrganization(orgId)` which invokes backend `/auth/switch-org`.
   - Build `PlatformAdminPage.tsx`: Dedicated dashboard for tenant provisioning and platform stats.
4. **Files Likely Affected:**
   - `frontend/src/context/AuthContext.tsx`
   - `frontend/src/services/apiClient.ts`
   - `frontend/src/pages/auth/LoginPage.tsx`
   - `frontend/src/pages/auth/RegisterPage.tsx`
   - `frontend/src/pages/auth/AcceptInvitationPage.tsx` (new)
   - `frontend/src/pages/settings/SettingsPage.tsx`
   - `frontend/src/pages/admin/PlatformAdminPage.tsx` (new)
   - `frontend/src/components/layout/Header.tsx`
   - `frontend/src/routes/AppRoutes.tsx`
5. **Database Changes:** None.
6. **API Changes:** None (consumes APIs implemented in previous phases).
7. **Frontend Changes:** Comprehensive UI additions and interactive refactoring across auth, settings, header, and admin routes.
8. **Security Considerations:**
   - Validate that hiding UI components is solely for UX; the frontend is never trusted as the security boundary.
   - Sanitize all user inputs before rendering to prevent client-side XSS.
9. **Tests Required:**
   - Component tests for `LoginPage` (OIDC button render, password submit).
   - Component tests for `SettingsPage` Members tab (listing members, open invite modal).
   - Integration tests for `AuthContext` (switching organization updates active state).
10. **Dependencies on Previous Phases:** Phase 4, Phase 5, Phase 6, Phase 9.
11. **Risk Level:** Medium (broad frontend surface touch).
12. **Whether Migration is Required:** No.

---

### PHASE 11 — SECURITY

1. **Objective:** Complete an end-to-end security hardening review, enforce defense-in-depth HTTP headers, rate limit all public endpoints, and verify zero data leakage.
2. **Current Implementation:**
   - `SecurityHeadersMiddleware` in `app/core/middleware.py` sets HSTS, CSP, X-Frame-Options, X-Content-Type-Options.
   - Sliding-window Redis rate limiter in `app/core/rate_limit.py`.
3. **Required Changes:**
   - Apply rate limiters to all new public endpoints:
     - `public_oidc_rate_limiter` on `/auth/google/*` (20 req/min/IP).
     - `invitation_verify_rate_limiter` on `/invitations/*/verify` (30 req/min/IP).
     - `invitation_accept_rate_limiter` on `/invitations/*/accept` (10 req/min/IP).
   - Verify CSP headers allow Google OAuth redirects while restricting unapproved origins.
   - Validate constant-time comparison on all token hashes (`secrets.compare_digest`).
   - Audit error handling to prevent sensitive stack trace disclosure in production.
4. **Files Likely Affected:**
   - `backend/app/core/rate_limit.py`
   - `backend/app/core/middleware.py`
   - `backend/app/routers/auth.py`
   - `backend/app/routers/invitations.py`
5. **Database Changes:** None.
6. **API Changes:** Standardizes rate-limiting headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`).
7. **Frontend Changes:** Graceful UI handling for `429 Too Many Requests` responses.
8. **Security Considerations:**
   - Verify fail-open resilience in rate limiters to ensure Redis downtime does not disable legitimate authentication.
   - Ensure CSRF protections are active on all cookie-bearing endpoints.
9. **Tests Required:**
   - Security hardening test suite: Rate limit triggers, CSRF origin rejection, security response headers validation.
10. **Dependencies on Previous Phases:** Phase 5, Phase 6, Phase 10.
11. **Risk Level:** Low.
12. **Whether Migration is Required:** No.

---

### PHASE 12 — TESTING

1. **Objective:** Build an exhaustive automated test suite covering unit tests, integration tests, RBAC authorization matrices, tenant isolation boundaries, and end-to-end user journeys.
2. **Current Implementation:**
   - Test suite in `backend/tests/` with unit, api, integration, and security tests.
   - Lacks dedicated RBAC permission matrix tests and multi-org switching test coverage.
3. **Required Changes:**
   - Create `backend/tests/api/test_rbac_authorization.py`: Tests all routes against `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
   - Create `backend/tests/api/test_tenant_isolation.py`: Cross-tenant IDOR penetration tests asserting 404 responses.
   - Create `backend/tests/api/test_invitations.py`: Tests invitation lifecycle (create, verify, accept, expire, revoke).
   - Create `backend/tests/api/test_oidc.py`: Tests Google OIDC flow with mocked JWKS endpoints.
   - Create `backend/tests/api/test_org_switching.py`: Tests token re-issuance during active org transitions.
4. **Files Likely Affected:**
   - `backend/tests/api/test_rbac_authorization.py` (new)
   - `backend/tests/api/test_tenant_isolation.py` (new)
   - `backend/tests/api/test_invitations.py` (new)
   - `backend/tests/api/test_oidc.py` (new)
   - `backend/tests/api/test_org_switching.py` (new)
   - `frontend/src/tests/AuthFlow.test.tsx`
5. **Database Changes:** None.
6. **API Changes:** None.
7. **Frontend Changes:** Frontend Vitest / React Testing Library tests for new components.
8. **Security Considerations:** Ensure test fixtures use isolated synthetic test databases and never rely on hardcoded production secrets.
9. **Tests Required:** 100% passing across all new and existing test suites.
10. **Dependencies on Previous Phases:** All previous phases (Phases 0 through 11).
11. **Risk Level:** Low.
12. **Whether Migration is Required:** No.

---

### PHASE 13 — FUTURE ENTERPRISE SSO

1. **Objective:** Establish the architectural foundation to incorporate enterprise Single Sign-On (SAML 2.0 / OIDC) for Okta, Microsoft Entra ID, and custom enterprise Identity Providers.
2. **Current Implementation:** No enterprise SSO exists (Google OIDC is the first federated provider).
3. **Required Changes:**
   - Design tenant SSO configuration model: Organization settings store `sso_provider`, `idp_metadata_url`, `idp_entity_id`, `enforce_sso_for_domain`.
   - Design domain routing flow: Login screen prompts for work email; if domain matches configured tenant SSO, user is redirected to tenant-specific IdP.
   - Leverage `external_identities` table with `provider="entra"` or `provider="okta"`.
   - Design Just-In-Time (JIT) provisioning logic for enterprise employees.
4. **Files Likely Affected:**
   - `backend/app/models/organization.py`
   - `backend/app/models/external_identity.py`
   - `backend/app/routers/auth.py`
   - `frontend/src/pages/auth/LoginPage.tsx`
5. **Database Changes:** Reuses `external_identities` and `organizations.settings` JSONB.
6. **API Changes:** Future endpoints: `GET /api/v1/auth/sso/discover`, `POST /api/v1/auth/sso/saml/acs`.
7. **Frontend Changes:** Enterprise email domain discovery on login page.
8. **Security Considerations:**
   - Validate SAML assertion signatures and clock skew.
   - Enforce SSO bypass prevention if `enforce_sso` is enabled for a tenant.
9. **Tests Required:** Future SAML / OIDC provider integration tests.
10. **Dependencies on Previous Phases:** Phase 6 (Google OIDC establishes external identity architecture).
11. **Risk Level:** Medium.
12. **Whether Migration is Required:** No.

---

### PHASE 14 — MFA / PASSKEYS

1. **Objective:** Design multi-factor authentication (TOTP RFC 6238) and WebAuthn / FIDO2 Passkeys to harden high-security accounts and step-up administrative actions.
2. **Current Implementation:** Single-factor authentication (Password or Google OIDC).
3. **Required Changes:**
   - Design `mfa_factors` table (`user_id`, `factor_type`, `secret_encrypted`, `is_primary`, `last_used_at`).
   - Design TOTP registration flow (QR code display, secret encryption with AES-256-GCM via `app/core/encryption.py`, verification challenge).
   - Design WebAuthn Passkeys challenge/response protocol.
   - Design Step-Up Authentication dependency for destructive tenant actions (`require_mfa_step_up`).
4. **Files Likely Affected:**
   - `backend/app/models/mfa.py` (future)
   - `backend/app/routers/auth.py`
   - `backend/app/api/deps.py`
   - `frontend/src/pages/settings/SettingsPage.tsx`
5. **Database Changes:** Future `mfa_factors` table.
6. **API Changes:** Future endpoints: `POST /auth/mfa/totp/setup`, `POST /auth/mfa/totp/verify`, `POST /auth/mfa/passkey/register`.
7. **Frontend Changes:** Security tab MFA configuration UI in Settings.
8. **Security Considerations:**
   - TOTP secrets must be encrypted at rest using AES-256-GCM.
   - Single-use recovery codes must be securely hashed.
9. **Tests Required:** Future TOTP verification and step-up challenge tests.
10. **Dependencies on Previous Phases:** Phase 5, Phase 7.
11. **Risk Level:** Medium.
12. **Whether Migration is Required:** Yes (future migration).

---
## 22. Risks and Trade-offs

| Architectural Decision | Trade-Off & Risk | Mitigation Strategy |
| :--- | :--- | :--- |
| **In-Memory Access Tokens vs LocalStorage** | Improved XSS security vs tab-synchronization friction (new browser tabs trigger silent refresh). | Silent refresh via HttpOnly cookie is fast (<50ms) and automatic in `apiClient.ts`, providing seamless UX across tabs while maintaining total immunity to token theft. |
| **Defensive Account Linking vs Auto-Merge** | Prevents Pre-Account Takeover attacks vs added user step when connecting Google to an existing password account. | Clear UI feedback explaining that password verification is required to safeguard existing workspace assets. |
| **Shared Database vs Schema-per-Tenant** | Lower infrastructure cost and operational simplicity vs reliance on logical query scoping for tenant isolation. | Strict server-side query scoping (`WHERE organization_id == :id`), FastAPI dependency guards, automated multi-tenant penetration tests, and OWASP 404 masking guarantee isolation. |
| **Centralized Identity vs Per-Tenant Identity** | Single sign-on across customer workspaces vs identity shared across organizations. | Centralized global user identity models real-world enterprise multi-membership (e.g. consultants, partners, enterprise groups), with zero credential leakage between tenants. |

---

## 23. Final Recommended Architecture

The final recommended architecture elevates FlowPilot to an enterprise-grade multi-tenant B2B SaaS platform with the following converged properties:
1. **Separation of Concerns:** Clear demarcation between the FlowPilot Platform Control Plane (vendor superadmin) and the Customer Organization Tenant Plane (autonomous customer admin).
2. **Sovereign Centralized Identity:** Users have one global FlowPilot identity (`User`) and can belong to multiple organizations (`OrganizationMember`) with distinct roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
3. **Hardened Dual Authentication:** Argon2id email/password authentication alongside industry-standard Google OpenID Connect (OIDC) with PKCE and defensive account linking.
4. **Backend-Enforced Authorization:** Capability-based permissions (`require_permission`) evaluated server-side. The frontend reflects permissions for UX but is never the security boundary.
5. **Rigorous Server-Side Tenant Isolation:** Every query scoped by `organization_id`; unauthorized cross-tenant queries return `404 Not Found` to mask tenant existence.
6. **Robust Dual-Token Web Sessions:** 15-minute in-memory access tokens, 7-day HttpOnly SameSite=Lax rotated refresh tokens with atomic Redis Lua scripts, and an explicit `/auth/switch-org` endpoint that reissues tokens scoped to the active tenant.
7. **Complete Onboarding & Lifecycle:** Dual provisioning (Self-Service SaaS and Enterprise assisted), cryptographic token invitations with SHA-256 storage, and interactive member administration.

---

## 24. Implementation Readiness

### 24.1 What is Already Correct in FlowPilot
- **Password Security:** Argon2id hashing parameters (`memory_cost=64MB`, `time_cost=3`, `parallelism=4`) are state-of-the-art.
- **Session Foundations:** JWT encoding with HS256, atomic Lua refresh token rotation in Redis, and Redis access token blacklisting provide an exceptional foundation.
- **Frontend Token Hygiene:** Access tokens and refresh tokens are stored in-memory in `apiClient.ts`, completely avoiding vulnerable `localStorage` patterns.
- **Resource Tenant Scoping:** Core entities (`workflows`, `workflow_runs`, `approval_requests`, `integrations`, `audit_logs`, `usage_records`, `idempotency_records`) already have direct `organization_id` foreign keys.
- **OWASP Anti-Enumeration:** `get_org_context` in `app/api/deps.py` already returns `404 Not Found` when a user queries an organization they do not belong to.
- **Container Infrastructure:** Docker Compose, PostgreSQL 16, Redis 7, Celery workers, and Vite frontend are fully functional and stable.

### 24.2 What Must Change
1. **Database Schema:**
   - Make `users.password_hash` nullable (allows Google OIDC).
   - Add `users.email_verified` and `users.status`.
   - Add `organizations.status`, `organizations.tier`, and `organizations.settings`.
   - Add `organization_members.status`.
   - Create `external_identities` table.
   - Create `invitations` table.
2. **Active Organization Session Tracking:**
   - Implement `POST /api/v1/auth/switch-org` to re-issue access tokens scoped to switched organizations.
   - Fix `/api/v1/auth/refresh` to preserve the user's active tenant rather than resetting to `user.memberships[0]`.
3. **Invitation System:**
   - Implement token-based invitations (`POST /organizations/{id}/invitations`, `GET /invitations/{token}/verify`, `POST /invitations/{token}/accept`).
   - Remove the requirement that users must already exist before being added to an organization.
4. **Member Management Endpoints:**
   - Implement `GET /api/v1/organizations/{id}/members` and `PATCH /api/v1/organizations/{id}/members/{user_id}`.
5. **RBAC Engine:**
   - Transition from string role checks to fine-grained capability permissions (`require_permission`).
6. **Platform Admin Layer:**
   - Implement `require_platform_admin` dependency and `/api/v1/platform/...` routes for enterprise provisioning and global monitoring.
7. **Google OIDC:**
   - Implement authorization code flow with PKCE, state/nonce protection, Google JWKS verification, and defensive account linking.
8. **Frontend Interface:**
   - Connect Header organization switcher to `/auth/switch-org`.
   - Build dynamic Members tab in `SettingsPage.tsx` with invitation modal and role changer.
   - Add "Continue with Google" to `LoginPage` and `RegisterPage`.
   - Build `AcceptInvitationPage.tsx` and `PlatformAdminPage.tsx`.

### 24.3 What Can Remain Unchanged
- Workflow execution engine (`app/engine/workflow_engine.py`, `condition_evaluator.py`, `executors.py`, `registry.py`).
- Celery worker task queues and background orchestration (`app/workers/celery_app.py`, `tasks.py`).
- AI service providers abstraction (`OpenAI`, `Anthropic`, `Mock` in `app/services/ai/`).
- Integrations core executors (Slack, Mock CRM, Webhooks).
- Human approval request state transitions and database models (`app/models/approval.py`).
- Analytics calculations and SLA monitoring panels.
- Security headers middleware and sliding-window Redis rate limiter core.

### 24.4 Highest-Risk Changes
1. **Alembic Migration to Nullable Password Hash:** Must ensure existing users with password hashes remain completely functional and unaltered while allowing OIDC users to have `NULL` password hashes.
2. **JWT Refresh Rotation Scoping:** Changing `/auth/refresh` and adding `/auth/switch-org` alters core token issuance; must prevent regression in session longevity or cross-tab synchronization.
3. **Defensive Account Linking Logic:** Flaws in identity linking can lead to Pre-Account Takeover vulnerabilities; strict cryptographic checks and explicit password verification must be verified.
4. **RBAC Transition:** Refactoring route dependencies across all routers to `require_permission` must be thoroughly regression tested to avoid unintended authorization lockouts.

### 24.5 Recommended Implementation Order
```
Step 1:  Alembic Migrations (0003 & 0004) -> Schema preparation
Step 2:  Organization & Member API enhancements (GET/PATCH members, status, settings)
Step 3:  Authentication Session Hardening (switch-org endpoint, active org refresh fix)
Step 4:  Invitation System (Backend models, token hashing, email dispatch, acceptance endpoints)
Step 5:  RBAC Capability Engine (Permission enum, role matrix, route refactoring)
Step 6:  Tenant Isolation Hardening & Cross-Tenant Test Suite
Step 7:  Platform Admin Control Plane (Routes, provisioning, superuser guard)
Step 8:  Google OIDC Implementation (Discovery, PKCE, state/nonce, account linking)
Step 9:  Frontend Integration (Org switcher, Settings members tab, OIDC buttons, Invite page)
Step 10: End-to-End Verification & Penetration Testing
```

### 24.6 Decisions & Questions for User Approval
1. **Google OIDC Client Credentials:** Confirm if Google OAuth Client ID and Secret are already provisioned in Google Cloud Console, or if mock/development credentials should be used initially.
2. **Email Dispatch Provider:** Confirm the preferred transactional email provider for dispatching invitation and activation links (e.g., SMTP, Resend, SendGrid, Amazon SES, or local console/mock logging during development).
3. **Legacy Role Deprecation:** Confirm mapping legacy roles (`MANAGER`, `OPERATOR`) to `MEMBER` to standardize on `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.

---

> **END OF ARCHITECTURAL SPECIFICATION AND IMPLEMENTATION PLAN**  
> *Ready for user review and approval prior to code implementation.*
