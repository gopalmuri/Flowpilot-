# Multi-Channel Communication Automation: Phase 0 Audit and Plan

Status: Phases 0-5 implemented and verified with mocks only (Phase 5: Gmail connection and inbound ingestion; no live Google verification); see sections 8-11. This plan supersedes the earlier
`docs/superpowers/specs/2026-10-17-inbound-channels-design.md` (personal Gmail/IMAP + Twilio sandbox). The brief now
requires Gmail OAuth + Pub/Sub, the official WhatsApp Cloud API, and a portfolio form, all multi-tenant.

## 1. What exists and will be reused

| Need | Existing piece (verified in repo) | Reuse |
|---|---|---|
| Tenant binding | `Organization`, `OrganizationMember`, `require_role`, `get_org_context` | As is |
| Connection storage | `Integration` (`type`, `status`, `credentials_encrypted` AES-256-GCM, `config` JSON) | New types `GMAIL`, `WHATSAPP_BUSINESS`, `PORTFOLIO_FORM` |
| Secrets at rest | `core/encryption.py` | Encrypt OAuth tokens and WhatsApp tokens |
| Signed inbound events | `services/webhook_service.py` (HMAC + timestamp), `routers/webhooks.py` tenant webhook | Same HMAC scheme for the portfolio backend |
| Dedup / idempotent run start | `models/idempotency.py`, `get_or_create_idempotent_run`, `tasks.process_webhook_event` | Key = `channel:external_message_id` |
| Background work | Celery + Redis (queues: default, workflows, webhooks, maintenance); `task_acks_late` | New queues `inbound`, `outbound`; add Celery beat |
| Workflow engine | DAG engine, `STEP_EXECUTOR_REGISTRY`, `StepType`, PAUSED runs, `resume_run` | New executors registered the same way |
| Human approval | `ApprovalRequest`, `HumanApprovalExecutor`, approve/reject routes, role check, expiry | Extend approve with `edited_content` |
| AI | `services/ai` (provider factory, mock/openai/anthropic, `classify` only) | Add `analyze_message` + `draft_reply`; Grok through the OpenAI-compatible provider with `base_url` |
| Audit | `AuditLog`, `approval.*` events | New `inbound.*`, `reply.*` events |
| UI | `IntegrationsPage`, `ApprovalsPage`, executions pages, `integrationService.ts`, `approvalService.ts` | Extend, do not redesign |

## 2. Gaps found (documented, not invented)

1. No inbound message, conversation or reply-draft model. New tables are required (no equivalent exists).
2. AI layer only classifies leads (`classify`). Requirement extraction and drafting are new methods and schemas.
3. No real outbound step. Only `MOCK_CRM_CREATE` and `SLACK_NOTIFICATION` (mock) exist.
4. Approval API accepts only a comment. It cannot edit content, and there is no "request revision".
5. No Celery beat. Needed for Gmail watch renewal and history reconciliation.
6. No notification system besides the mock Slack step. Plan: in-app (the Approvals page) first, Slack optional.
7. Config has no Google/Meta settings. Added as optional placeholders; the app must still boot and test without them.
8. Known issue (auth plan F-01): a Viewer can read a workflow's `secret_token`. Inbound secrets in this work are stored encrypted in `Integration` and never returned by APIs.
9. Tests currently write to the dev database (pre-existing). New tests must use mocked providers and not send real messages.

## 3. Data model (migration `0004`, additive only)

- `conversations`: id, organization_id, integration_id, channel, external_conversation_id (Gmail thread id / WhatsApp wa_id / form submission), sender_identity, status, timestamps. Unique `(organization_id, integration_id, channel, external_conversation_id)`.
- `inbound_messages`: id, organization_id, conversation_id, integration_id, channel, external_message_id, sender_name, sender_address, subject, text_content, received_at, processing_status, workflow_run_id, correlation_id. Unique `(organization_id, channel, external_message_id)` is the dedup guard. Index `(organization_id, received_at)`.
- `reply_drafts`: id, organization_id, conversation_id, source_message_id, ai_analysis (JSON), draft_content, approved_content, content_hash, approval_status (DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, REVISION_REQUESTED), send_status (NOT_SENT, SENDING, SENT, FAILED, UNCERTAIN), approved_by, approved_at, sent_at, outbound_message_id, attempt_count, error_category, error_detail, approval_request_id. Unique `(source_message_id)` while active, to block double drafts.
- Tokens and secrets stay in `Integration.credentials_encrypted`. No new secret columns.
- Retention: message body purge job (default 90 days), config-driven.

## 4. Pipeline and workflow

```
adapter (verify, normalise) -> persist InboundMessage (unique key = dedup) -> start run via existing idempotent path
run: trigger -> AI_ANALYZE_MESSAGE -> CONDITION (deterministic rules) -> AI_DRAFT_REPLY (persists ReplyDraft)
     -> HUMAN_APPROVAL (draft id in approval context) -> SEND_REPLY
```

New step types (minimal, no duplicates of existing nodes): `AI_ANALYZE_MESSAGE`, `AI_DRAFT_REPLY`, `SEND_REPLY`.
Trigger reuses `WEBHOOK_TRIGGER`. `SEND_REPLY` is a thin executor that picks a `ChannelSender` adapter
(`PortfolioEmailSender`, `GmailSender`, `WhatsAppSender`) from the conversation's channel. It never switches channels.

Safety rules enforced in code, not in prompts:
- AI output is a validated Pydantic schema. Message text is passed as delimited, untrusted data. AI has no tool or network access.
- `SEND_REPLY` sends only if the draft is `APPROVED` and `send_status` moves `NOT_SENT -> SENDING` in one conditional UPDATE (atomic consume). The body sent is `approved_content`. Editing after approval resets approval.
- Uncertain outcome (timeout after request): mark `UNCERTAIN`, reconcile with the provider (Gmail sent-thread lookup by RFC Message-ID header; WhatsApp status webhook) before any retry.
- Per-org outbound rate cap and a hard check that the sending integration belongs to the draft's organization.

## 5. Phases (each ends with tests and a summary; nothing committed without your say-so)

| Phase | Scope | Needs external creds? |
|---|---|---|
| 1 | Models + migration `0004`, `PORTFOLIO_FORM` integration, `POST /api/v1/inbound/portfolio/{integration_key}` (HMAC, size limit, rate limit, honeypot, dedup), starts a run | No |
| 2 | `AI_ANALYZE_MESSAGE`, Grok provider (`GROK_*` settings), injection tests, mock provider | Grok key for live only |
| 3 | `AI_DRAFT_REPLY`, approval edit/reject/request-revision, atomic consume, Approvals UI draft view | No |
| 4 | `SEND_REPLY` + `PortfolioEmailSender` (SMTP via configured business mailbox, mock in tests) | SMTP creds for live |
| 5 | Gmail OAuth (scopes `gmail.readonly`, `gmail.send`), watch + Pub/Sub push, history sync, beat renewal, threaded send | Google Cloud project |
| 6 | WhatsApp Cloud API: webhook verify + `X-Hub-Signature-256`, inbound, status webhooks, 24h window and template send | Meta app and number |
| 7 | Integrations cards for three channels, conversation/execution observability | No |
| 8 | Tenant isolation suite, concurrency tests, retention job, docs, CI | No |

Reorder note: Phase 4 (portfolio reply) comes before Gmail so the full loop is provable end to end with only a
mail server, before any Google or Meta approval is involved.

## 6. Risks and external dependencies

- Google: `gmail.readonly` is a restricted scope. A public multi-tenant app needs Google verification and a security assessment. While in "Testing" mode only listed test users can connect and refresh tokens expire after 7 days. Pub/Sub push needs a public HTTPS URL (a tunnel in development).
- Meta: production needs a verified business, an app in Live mode and a number that is not tied to the normal WhatsApp app (or coexistence). Free-form replies are allowed only within 24 h of the customer's last message. If an approval takes longer, send must switch to an approved template or stop and alert the manager.
- Live Gmail and WhatsApp connectivity cannot be claimed as verified until tested with real authorised credentials. Until then every provider sits behind a mock.
- Migration number `0004` may collide with the auth-plan migrations. Whichever lands first takes `0004`.
- Approvals page currently keys off `payload_snapshot`; the draft view must be additive so existing approvals keep working.

## 7. Configuration added (placeholders only, all optional)

`GROK_API_KEY`, `GROK_BASE_URL`, `GROK_MODEL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_AUDIENCE`, `META_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN`, `PUBLIC_BASE_URL`. Real values go in the local `.env` only.

## 8. Phase 2 status: Grok message analysis (implemented, verified with mocks only)

Changes from the plan above, and why:
- One step instead of two: `AI_ANALYZE_MESSAGE` does the analysis and the draft in a single model call. A separate
  `AI_DRAFT_REPLY` step is no longer planned; Phase 3 consumes the stored `ReplyDraft`.
- `reply_drafts` was created now (migration `0005`) with only what a review-only draft needs: content, status `DRAFT`,
  `generated_by`, `risk_flags`. Approval, edit, approved-content and send-tracking columns arrive with Phases 3/4.
  Analysis is stored on `inbound_messages.ai_analysis` (+ `analyzed_at`), not in a new table.
- Verified business facts come from the step config `business_profile` (max 6000 chars). The draft may state only
  facts from it. Empty profile means the draft states no capabilities at all.

Provider abstraction: `BaseAIProvider.generate_json()` added (default raises `NotImplementedError`). Implemented for
OpenAI-compatible providers (`OpenAIProvider`, `GrokProvider(OpenAIProvider)`) and `MockAIProvider`. Anthropic does not
implement it yet; selecting it degrades to human review (`provider_unsupported`).

Safety enforced in code: fenced and truncated untrusted text; strict Pydantic validation with unknown keys dropped;
injection heuristics plus model self-report, either of which discards the draft and escalates; a scan that flags prices,
timelines, guarantees and links in a draft that are not in the profile; any provider failure becomes an
"escalate to human" result. The step never sends and never approves. The executor reads the message scoped to the run's
organization, so a forged id from another tenant returns "Inbound message not found". Re-running the step reuses the
stored analysis (no second model call, no duplicate draft).

Outstanding before live use:
1. `GROK_MODEL` is intentionally unset. It must be confirmed by the owner. With `AI_PROVIDER=grok` and no model,
   analysis degrades to human review (`missing_configuration`).
2. `GROK_API_KEY` goes in the local `.env` only.
3. A live Grok call has not been made; behaviour against the real API (including `response_format: json_object`
   support for the chosen model) is unverified.
4. The workflow builder UI does not list `AI_ANALYZE_MESSAGE` yet (Phase 7). Workflows containing it can be created
   through the API.
5. The approval screen does not show the analysis or draft yet (Phase 3).

## 9. Phase 3 status: human approval and reply editing (implemented; no sending exists)

One approval system: the existing `ApprovalRequest` + `HUMAN_APPROVAL` pause/resume. A reply draft is bound to it
through `approval_context.draft_id`, which the approval step copies from the run's own upstream step output.

### Draft state machine (`reply_drafts.status`)
| From | Action | To |
|---|---|---|
| DRAFT | workflow reaches the approval step (idempotent link) | PENDING_APPROVAL |
| PENDING_APPROVAL | approve (optionally with the reviewer's edit) | APPROVED (this is the "ready for sending" state) |
| PENDING_APPROVAL / REVISION_REQUESTED | reject | REJECTED (final) |
| PENDING_APPROVAL | request revision (instructions) | REVISION_REQUESTED (approval stays pending, run stays paused) |
| REVISION_REQUESTED / PENDING_APPROVAL | manual edit or AI regeneration creates a new version | PENDING_APPROVAL |
| APPROVED | any edit: approval invalidated, new PENDING approval opened | PENDING_APPROVAL |
| PENDING_APPROVAL / REVISION_REQUESTED | approval expires / run cancelled | EXPIRED / CANCELLED |

`READY_FOR_SENDING` was not added: `APPROVED` with `approved_version_number == current_version_number` is the single
gate (`drafts.is_sendable`). Phase 4 must consume it with a conditional `APPROVED -> SENDING` update.

### Integrity rules (all enforced server-side, all tested)
- Actor and organization come from the authenticated session and path membership; request bodies reject unknown
  fields. VIEWER and roles below the step's `approver_role` get 403; another tenant's approval id is 404.
- Approval requires `reviewed_version`; a stale version gets 409. With `edited_content`, the edit becomes the approved
  version. The exact approved text is an immutable row in `reply_draft_versions` (insert-only; a database trigger
  rejects UPDATE) with its SHA-256, and the draft records who approved which version and when.
- Editing after approval clears the approved version, opens a new approval (history of the old one is kept) and
  `is_sendable` turns false until the new one is approved. A re-approval does not resume the workflow a second time.
- Atomicity: the decision, the exact approved version, the audit rows and the resume claim commit in one transaction
  inside `WorkflowEngine.resume_run` via an `on_decision` hook, under row locks (run, then approval, then draft).
  The hook runs only for the request that wins; losers are idempotent only if they repeat the identical decision.
- Restart recovery: `approval_requests.resume_claimed_at/resume_completed_at`. A decided approval with a stale claim
  is resumed by `recover_stalled_resumes` using a compare-and-swap on the claim, so concurrent recoveries resume it
  once. Triggers: worker start (`worker_ready`) and a 120 s beat entry.
- Audit (ids, version numbers, hashes; never message or draft text): `reply_draft.submitted_for_approval`,
  `.edited`, `.revised`, `.approved`, `.rejected`, `.revision_requested`, `.approval_invalidated`, `.expired`,
  `.cancelled`, plus `approval.workflow_resumed` (with `recovered`).

### API additions (under `/organizations/{org}/approvals/{id}`)
`GET /review`, `PUT /draft`, `POST /request-revision`, `POST /draft/regenerate`; `approve` accepts `reviewed_version`
and `edited_content`; list/detail responses carry `draft_id` and `draft_status`. Migration `0006`.

### Known limitations and outstanding items
1. No outbound sending exists. Phase 4 must gate on `is_sendable`, atomically consume APPROVED, and block edits once
   a send starts (today an APPROVED draft can still be edited, which invalidates the approval).
2. No notification infrastructure exists beyond the mock Slack step, so none was invented. Reviewers find drafts in the
   Approvals queue; a `SLACK_NOTIFICATION` step can precede the approval. Only the submission event is idempotent.
3. No self-approval policy existed, so none is enforced: a reviewer may approve their own edit.
4. Recovery re-runs the traversal; a step that was interrupted mid-execution runs again. Steps with external effects
   (Phase 4 sending) need their own idempotency.
5. `celery beat` is not in the compose files; without it recovery runs at worker start only.
6. Approval timeouts keep running during revision loops. A revision request does not extend the deadline.
7. The UI shows approver as a short user id (the API exposes ids, not names). Approval responses still expose the
   trigger payload to VIEWERs (pre-existing, tracked in the auth plan).
8. Concurrency is verified with concurrent requests inside one process against real Postgres row locks; a
   multi-process or multi-host soak test has not been run.
9. Frontend role ranks were extended with MANAGER and OPERATOR to match the backend.

## 10. Phase 4 status: safe outbound delivery foundation (implemented with the mock provider only)

No live Gmail, WhatsApp or SMTP call exists. `get_provider` returns only the in-memory `MockOutboundProvider`; any other
provider name is refused (`provider_not_enabled`). Nothing sends without the approval gate.

### Delivery record (`outbound_deliveries`, migration `0007`)
One row per (draft, approved version), enforced by a unique constraint, so the same approved text is consumed once.
Holds ids, the content hash, channel, destination, non-secret provider context (thread id, from address, phone number
id), idempotency key (`delivery:{draft}:{version}`), attempt counters, timestamps, provider message id and a short safe
error. It never stores the message body (read from the immutable version row at send time) or credentials.

| State | Meaning |
|---|---|
| PENDING | committed intent to send (this row is the outbox entry) |
| CLAIMED | one worker owns it and has consumed the approval; provider not called yet |
| SENDING | committed immediately before the provider call |
| SENT | the provider ACCEPTED the message. Never reported as "delivered" |
| FAILED_RETRYABLE | definitively not accepted; retry after backoff (bounded) |
| FAILED_PERMANENT | rejected, retries exhausted, or destination/account unusable |
| UNKNOWN_OUTCOME | may have been accepted; never auto-resent |
| CANCELLED | the gate failed at claim time, or an operator cancelled before it started |

Draft states added: SENDING (blocks edits), SENT, SEND_FAILED (needs a person; editing opens a fresh approval).

### Authorisation gate (`check_gate`), run at creation AND again under row locks at claim time
Draft in this organization and APPROVED (or SENDING for this same delivery's later attempts); approved version equals
the current version; the immutable version row exists, hashes to its recorded hash and matches the delivery's hash;
the draft's approval request is APPROVED (not expired, rejected, cancelled or superseded) and a human decision is
recorded; the workflow run belongs to the organization and to that approval; the destination, channel and sending
account are re-resolved and must equal what the delivery recorded (`resolve_route`). The same approved version cannot be
consumed twice (unique key + claim). Lock order: run, approval, draft, delivery.

### Routing (no invented data, no channel switching)
Portfolio form: replies from the form's configured `reply_integration_id` (an `EMAIL_SENDER` integration of the same
organization, validated on save and again at send) to the exact address the visitor submitted. Gmail: the connected
mailbox and the original thread id. WhatsApp: the connected business phone number id and the validated recipient. A
missing or unverifiable account/destination stops the delivery with a stable error code. Gmail and WhatsApp routing is
exercised in tests on synthetic conversations only; no Gmail/WhatsApp inbound or sending exists yet.

### Outbox and dispatch
`create_delivery` only writes the row. `dispatch_due` (Celery task every 15 s, plus a best-effort nudge from the
`SEND_REPLY` step) marks due rows enqueued and hands them to Celery. A row that was enqueued but never claimed is
re-enqueued after 60 s, so a committed request cannot be lost between the database and the broker. Duplicate tasks are
harmless: only one can win the claim. New workflow step `SEND_REPLY` creates the delivery and completes as "queued".
A re-approved edit (after the run finished) creates its own delivery through the same gate.

### Failure classification and reconciliation
TRANSIENT (not accepted) retries with exponential backoff up to `OUTBOUND_MAX_ATTEMPTS`. PERMANENT is final. UNCERTAIN
(timeout, lost response, unexpected error) triggers reconciliation: provider has it, so SENT; provider has no record,
trusted only if the provider is authoritative and `OUTBOUND_RECONCILE_GRACE_SECONDS` have passed, so retry; otherwise
UNKNOWN_OUTCOME. An administrator resolves UNKNOWN_OUTCOME after checking the provider (`SENT`, or `NOT_SENT` which
authorises exactly one more attempt).

### Recovery strategy (worker start and every 60 s)
- CLAIMED with an expired lease: the provider was never called, so release to PENDING (compare-and-swap).
- SENDING with an expired lease: the worker died around the call, so UNKNOWN_OUTCOME (`worker_lost_during_send`), then reconcile.
- UNKNOWN_OUTCOME: reconcile if the provider supports it. Never resend on a guess.
- A slow worker whose claim was released cannot send: moving to SENDING is a compare-and-swap on its claim.

### Scheduler
`celery_beat` added to both compose files (one instance, fixed container name, schedule file in `/tmp`); how to start
it locally and in production is in `LOCAL_DEVELOPMENT.md` and `DEPLOYMENT.md`. Queue `outbound` added.

### API and audit
`GET /deliveries`, `GET /deliveries/{id}`, `POST .../cancel`, `.../retry` (MANAGER+), `.../reconcile` (ADMIN+); review
responses include the delivery summary. Audit events `outbound.delivery_created|claimed|attempt_started|sent|
failed_retryable|failed_permanent|unknown_outcome|reconciled|cancelled|refused|stale_claim_released` carry ids, version,
attempt, provider result and timestamps, never text or addresses. `delivery_sent` records `provider_accepted: true` and
`delivery_confirmed: false`.

### Bug found and fixed while testing
The gate re-reads rows with `populate_existing`; called from the re-approval transaction it overwrote unflushed
approval/draft changes and silently refused the delivery. `create_after_reapproval` now flushes first (covered by a test).

### Known limitations and outstanding items
1. Mock only. Real Gmail/WhatsApp/SMTP providers, credentials handling, OAuth and live inbound are a later phase.
2. Exactly-once delivery to a provider is not claimed and cannot be: at most one local delivery record and one local
   claim are guaranteed. Whether a provider that accepted a message but lost the response dedupes depends on the
   provider; hence reconcile-or-surface. Reconciliation needs a provider lookup that Phase 5/6 must implement per
   provider (Gmail sent-mail search by Message-ID, WhatsApp status webhooks). Until then such outcomes are UNKNOWN_OUTCOME.
3. WhatsApp's 24 hour customer-service window and template rules are not enforced yet; the recipient and inbound time
   are in the context for the Phase 6 provider.
4. A CANCELLED delivery (operator, or invalidated approval) is final for that version; to send, edit and re-approve.
5. The workflow builder UI does not list `AI_ANALYZE_MESSAGE`/`SEND_REPLY` yet; there is no deliveries screen, only the
   delivery summary inside the reply review.
6. Retry backoff has no jitter. Several workers share the relay; `FOR UPDATE SKIP LOCKED` prevents double enqueue.
7. The test suite writes into the dev database (pre-existing). The new tests cancel the in-flight deliveries they create.
8. Concurrency is verified with concurrent tasks in one process on real Postgres locks, not across processes or hosts.
9. `.env`/compose variable-name mismatches for production (`FIELD_ENCRYPTION_KEY`) noted earlier are unchanged.

## 11. Phase 5 plan and status: Gmail connection and inbound ingestion (outbound stays mocked)

### Audit findings (what is reused, what is new)
- Reused unchanged: `Integration` (type, status, `credentials_encrypted` AES-GCM with the organization id as AAD), tenant
  membership and `require_role`, `ingest_message` -> `Conversation`/`InboundMessage` -> workflow -> `AI_ANALYZE_MESSAGE` ->
  draft -> approval, the Phase 4 delivery service (its Gmail routing already expects an integration of type `GMAIL` with
  `config.email_address`), Celery queues and the single `celery_beat` service from Phase 4.
- Gaps: no OAuth code, no Google libraries installed (`google-auth`, `google-auth-oauthlib`, `google-api-python-client`,
  `beautifulsoup4` were added to `requirements.txt`), `IntegrationType` has no `GMAIL` (a GMAIL row would have crashed the
  integrations list), `inbound_messages` had nowhere to keep reply headers, and no mailbox/sync state existed.

### Design
1. **Connection.** Server-side OAuth 2.0 authorization-code flow with PKCE. Scope: `gmail.readonly` only (sufficient for
   `users.watch`, `history.list` and `messages.get`; `gmail.send` will be requested by reconnecting in the sending phase).
   State is a random single-use value stored hashed in `oauth_states`, bound to the organization, the initiating user and
   (optionally) the integration being reconnected, with a 10 minute expiry and a browser nonce cookie. The callback has no
   bearer token, so the organization comes only from the state row and the user's owner/admin role is re-checked there.
   The mailbox identity is the address Google returns from `users.getProfile`, never a submitted one. A mailbox can be
   connected to one organization at a time (partial unique index); a reconnect must return the same mailbox.
2. **State.** `gmail_accounts` (1:1 with the integration): mailbox, last processed `historyId`, watch status/expiration,
   sync state, last sync/error, sync lease, "sync requested" marker (the outbox for notifications). Tokens stay only in
   `Integration.credentials_encrypted`.
3. **Ingestion.** Pub/Sub push notification (OIDC-verified) marks the mailbox dirty and enqueues a sync; a periodic task
   also syncs dirty mailboxes and polls every `GMAIL_POLL_INTERVAL_SECONDS`, so missed notifications, a missing Pub/Sub
   configuration (local development) and worker outages all recover. A sync takes a per-mailbox lease, reads
   `history.list` from the stored `historyId`, fetches each new message as raw RFC 822, parses it with the standard
   library `email` package (HTML reduced to text with BeautifulSoup, hidden elements dropped), filters sent/draft/spam/
   auto-generated mail, and calls the existing `ingest_message`. An expired `historyId` triggers a bounded resync.
4. **Watch.** `users.watch` on INBOX to `GMAIL_PUBSUB_TOPIC`, expiration persisted, renewed by a beat task when within 24 h
   of expiry, with a per-mailbox compare-and-swap lease so concurrent renewals cannot double-run.
5. **Threading metadata.** `Conversation.external_conversation_id` = Gmail thread id, `external_message_id` = Gmail message
   id, and `inbound_messages.provider_metadata` keeps Message-ID, In-Reply-To, References, To/Cc, Reply-To, labels,
   `historyId` and attachment metadata (names, types, sizes only; attachments are never opened or stored).
6. **Observability.** Gmail card on the Integrations page, a beat heartbeat so "the scheduler is not running" is visible,
   audit events for connect, reconnect, disconnect, auth failure, resync and watch changes (ids and codes only).
7. **Tests** use fake Gmail, OAuth and Pub/Sub verifier implementations behind the same interfaces, plus tests of the real
   Google adapter against mocked `googleapiclient` objects. No test reaches Google. Automated tests now run against an
   isolated `<database>_test` database that is created and migrated on demand.

### Boundaries kept
No WhatsApp. No Gmail sending (the sending scope is not requested; outbound still resolves to the mock provider). No SMTP.
Approval is unchanged. Live Google behaviour is unverified until authorised credentials are used.

### Phase 5 implementation notes (what was built; verification status below)

Code: `app/services/gmail/` (`types`, `errors`, `client` real Google adapter, `oauth` real OAuth adapter, `mime`, `accounts`,
`sync`, `watch`, `pubsub`, `deps`), `app/routers/gmail.py`, `app/models/gmail.py` (`GmailAccount`, `OAuthState`),
`app/core/scheduler_health.py`, migration `0008`, Celery tasks `sync_gmail_mailbox`, `sync_due_gmail_mailboxes`,
`renew_gmail_watches`, `scheduler_heartbeat` (all in the single `celery_beat` schedule), a Gmail card on the Integrations
page, and `docs/GMAIL_INTEGRATION.md` (Google Cloud setup, consent and scopes, environment variables, Pub/Sub, watch
renewal, history sync and recovery, local and production setup, troubleshooting, first-live-verification checklist).

Decisions made while building (not in the original design):
- Mailbox state is a separate `gmail_accounts` table rather than columns on `integrations`, so the partial unique index
  on the connected mailbox address can map a push notification to exactly one organization.
- Sending is untouched: the grant is `gmail.readonly` only, the provider for Gmail conversations is still the mock, and a
  test asserts no send call and no send scope. The Phase 4 routing for `GMAIL` (thread id, mailbox, destination) was
  confirmed to work on conversations created by the real ingestion path.
- Test isolation: the suite now runs against `<database>_test` (created and migrated on demand by `tests/conftest.py`;
  `FLOWPILOT_TEST_USE_DEV_DB=1` opts out). Previously every test wrote into the development database.
- The generic integrations API can no longer create a `GMAIL` integration or change its credentials/status; deleting one
  revokes the grant first. `IntegrationType` gained `GMAIL` (a Gmail row would otherwise have broken the integrations list).
- A scheduler heartbeat (Redis key stamped every 30 s by beat) exists so the UI and API can say "the scheduler is not
  running" instead of silently not syncing.

### Outstanding items / known limitations (Phase 5)
1. **Live Google behaviour is unverified.** OAuth consent, token exchange, `users.watch`, `history.list`, `messages.get`,
   token revocation and Pub/Sub OIDC verification have only been exercised with fakes and mocked library objects. The
   checklist at the end of `docs/GMAIL_INTEGRATION.md` is the first live test. The Pub/Sub IAM steps (token creator role,
   `actAs`) follow Google's documentation and have not been executed.
2. `gmail.readonly` is a restricted scope: public use needs Google OAuth verification and possibly a security assessment;
   in Testing mode refresh tokens expire after 7 days (mailboxes show "Reconnect required" weekly).
3. Sending needs the `gmail.send` scope, a reconnect, a real outbound provider with Gmail sent-mail reconciliation (Phase 4
   left that lookup to the provider), and a decision on `Reply-To` versus `From` (both are stored).
4. The Docker images must be rebuilt for the new dependencies; `requirements.txt` was updated, images were not rebuilt here.
5. Attachments are recorded as metadata only; there is no attachment content handling or virus scanning by design.
6. A single sync processes every message in the history window (no per-sync cap on the history path, only on resync and
   backfill lists); a very large burst is bounded only by the sync lease and Gmail rate limits.
7. The OAuth nonce cookie assumes the frontend and API share a site. Cross-site deployments would need a different binding.
8. An intermittent failure of one frontend test was seen twice (while the backend suite was starting) and could not be
   reproduced in nine further runs; the test was not identified.


### Phase 5.1 live verification (2026-10-17) - in progress
Verified live: OAuth consent and callback, token exchange (exact scope `gmail.readonly`), encrypted storage, verified
mailbox identity, real polling sync call, token refresh, disconnect revoking the grant at Google (`invalid_grant` after),
scheduler heartbeat both ways. Found and fixed: real OAuth libraries and uvicorn were logging tokens, codes and callback
parameters (see docs/GMAIL_INTEGRATION.md, "Live verification log"). Remaining: real inbound email ingestion, recovery
cases against Google, Pub/Sub. No outbound sending has been enabled at any point.
