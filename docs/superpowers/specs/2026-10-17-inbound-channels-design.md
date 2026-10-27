# Inbound Channels: Email, WhatsApp and Website Forms That Start Workflows

| | |
|---|---|
| **Status** | DRAFT: awaiting your review. Nothing is implemented. |
| **Date** | 2026-10-17 |
| **Path** | Architectural (new subsystem); spec, then implementation plan, then build |

## 1. Goal

When a person contacts the business through **Gmail, WhatsApp, or the portfolio website's contact form** and the message is **related to the business's products**, FlowPilot automatically starts a workflow. The workflow creates the lead, notifies the team, and **drafts a reply that a human approves before it is sent** back on the same channel. Unrelated messages never start a workflow, and the reason is recorded.

### Decisions already made with the owner

| Topic | Decision |
|---|---|
| Replies | **Approval first:** AI drafts, a person approves in `/approvals`, then it is sent |
| Gmail | Personal `@gmail.com`. Use **IMAP/SMTP with a Google App Password** (no Google Cloud project, no 7-day token expiry). Keep a provider interface so Gmail OAuth can be added later |
| WhatsApp | Only a personal number exists, which cannot be connected officially. Use the **Twilio WhatsApp Sandbox** now; a Meta business number later through the same interface |
| AI | **Grok** now (OpenAI-compatible API); other providers later by configuration |
| Website | The site has its own backend/form service (stack not yet known, see §12) |
| Order | AI provider, then inbound core + website form, then Gmail, then WhatsApp |

### Non-goals (this spec)

Gmail OAuth/API, Gmail push notifications, Meta WhatsApp Cloud API, unofficial WhatsApp libraries (ban risk, against WhatsApp terms), attachments, multi-turn conversations, editing a draft before approving it, and acting on the owner's behalf without approval.

## 2. How it works (user view)

```
 Gmail inbox ─┐ (checked every minute)
 WhatsApp ────┼─►  Inbound Message ─► safety filters ─► "Is this about our products?" (AI)
 Website form ┘     (normalised)       duplicates,         │
                                       auto-replies,       ├─ no  ► status IGNORED + reason   (no workflow)
                                       own mail, spam      └─ yes ► workflow run starts:
                                                                     classify ► rule ► CRM lead ► Slack
                                                                     ► AI drafts reply ► HUMAN APPROVAL
                                                                     ► send reply on the same channel
```

A new **Inbox Log** page lists every inbound message as `IGNORED`, `TRIGGERED` or `ERROR` with the AI's reason, so the owner can always see why something did or did not run. A **Simulate message** button creates a test message without any real account.

## 3. Architecture

All three sources produce the same normalised record and share one pipeline. Everything is organization-scoped.

### 3.1 Normalised message (the workflow's trigger payload)

```
channel: EMAIL | WHATSAPP | WEBSITE
from: sender address / phone      name: display name (optional)
subject: (email/website)          text: body (truncated to 10,000 chars)
received_at, message_id (external), source_integration_id
```

Downstream steps use `{{trigger.text}}`, `{{trigger.from}}`, etc. uniformly regardless of channel.

### 3.2 New components

| Component | Responsibility |
|---|---|
| `InboundMessage` model | One row per received message: org, channel, external id, sender, subject, text, status, relevance result, linked run, timestamps. **Unique `(organization_id, channel, external_id)`** = duplicate protection |
| `InboundPipeline` service | Dedupe, safety filters, relevance check, create run (reuses the existing run-start path used by `process_webhook_event`) |
| `RelevanceService` | Asks the AI whether the message relates to the configured product description; returns `{relevant, confidence, reason}` |
| `MailboxProvider` interface | `GmailImapProvider` now; Gmail OAuth later. Methods: fetch new, send reply |
| `WhatsAppProvider` interface | `TwilioSandboxProvider` now; Meta Cloud later. Methods: verify inbound, send |
| Celery beat scheduler | New `celery_beat` service and `beat_schedule` (none exists today); runs `tasks.poll_mailboxes` every 60 s |
| Public form endpoint | `POST /api/v1/public/forms/{form_key}` (see §6) |
| Twilio webhook | `POST /api/v1/channels/twilio/whatsapp/{channel_key}` with signature validation |
| Inbox Log API + UI | List, detail, simulate, filter by status/channel |

### 3.3 New workflow step types

| Step | Purpose |
|---|---|
| `INBOUND_MESSAGE_TRIGGER` | Trigger. Config: `sources` (integration ids), `product_description` (free text the AI compares against), `min_confidence` (default 0.7), `on_ai_failure` (`hold` default or `ignore`) |
| `AI_DRAFT_REPLY` | AI writes a reply to `trigger.text` in the business's tone; output `draft` (shown in the approval) |
| `SEND_EMAIL` | Sends through the connected mailbox. `reply_to_trigger: true` replies to the original sender and threads it (`In-Reply-To`/`References`) |
| `SEND_WHATSAPP` | Sends through the connected WhatsApp provider; `reply_to_trigger: true` |

Reply steps in `reply_to_trigger` mode may **only** send to the original sender (prevents the workflow being used as a spam relay).

### 3.4 Existing pieces reused unchanged

Workflow engine, `HUMAN_APPROVAL`, approvals UI, `AI_CLASSIFICATION`, `CONDITION`, CRM and Slack steps, audit log, encrypted integration credentials (`core/encryption.py`), RBAC, tenant isolation, the existing signed webhook (still available for server-to-server use).

## 4. Data model

| Table / change | Notes |
|---|---|
| `inbound_messages` (new) | As §3.2. Indexes on `(organization_id, created_at)` and the unique key. Retention: configurable, default 90 days, purged by a scheduled task |
| `integrations.type` | Add `GMAIL_IMAP`, `TWILIO_WHATSAPP`, `WEBSITE_FORM`. Credentials encrypted (existing mechanism): Gmail `{email, app_password}`, Twilio `{account_sid, auth_token}` |
| Mailbox cursor | `integrations.config.last_uid` per mailbox; first connect starts from "now" (history is **not** processed) |
| Alembic migration | `0004` (additive only; renumber if the auth plan's `0004` lands first) |

## 5. Relevance check and AI safety

- Input: the message and the configured `product_description`. Output must be strict JSON `{relevant: bool, confidence: 0..1, reason: str}`; anything else is an error.
- **The message is untrusted data.** It is delimited in the prompt, the model is told to ignore instructions inside it, and the output is validated against the schema. The model's output can only set `relevant/confidence/reason`; it cannot trigger any action by itself.
- Run starts only if `relevant` and `confidence >= min_confidence`.
- AI failure or timeout: status `ERROR`, and by default the message is **held for review** in the Inbox Log (not silently dropped, not auto-started).
- Cheap pre-filters run **before** the AI (saves cost): duplicates, own address, `Auto-Submitted`/`Precedence: bulk`/`List-Unsubscribe` headers, `no-reply` senders, empty body.
- Prompts/replies never include other messages or secrets.

### AI provider generalisation (Phase 1)

`OpenAIProvider` hard-codes `https://api.openai.com/v1/chat/completions`. It becomes an OpenAI-compatible provider taking `base_url`, `api_key`, `model` from settings, so Grok (`https://api.x.ai/v1`) and later others work by configuration. New settings: `GROK_API_KEY`, `GROK_BASE_URL`, `GROK_MODEL`; `AI_PROVIDER=grok` is accepted by the factory. Keys live only in `.env`.

## 6. Website form endpoint

`POST /api/v1/public/forms/{form_key}` accepts JSON or form-encoded `{name, email, message, subject?}`.

| Protection | Detail |
|---|---|
| Origin allow-list | Per form (`allowed_origins`); CORS headers and preflight handled in the route, rejecting other origins |
| Spam | Hidden honeypot field; rate limit per IP + form key (default 10/min); body ≤ 16 KB; basic email format check |
| Abuse path | Optional CAPTCHA (Cloudflare Turnstile) as a later switch |
| Result | Creates an `InboundMessage` (channel WEBSITE) and returns `202` quickly; processing is asynchronous |
| Alternative | If the site's own backend can make an HTTP request, it can call the **existing HMAC-signed webhook** today, with no public form endpoint needed |

The owner receives a ready snippet (HTML form + `fetch`) with the `form_key` filled in.

## 7. Gmail (IMAP/SMTP) details

- Connect form takes the Gmail address and an App Password; **Test connection** logs in to `imap.gmail.com:993` and `smtp.gmail.com:465`; credentials are stored encrypted and never returned (`has_credentials` flag, as Slack does today).
- Poller (every 60 s per connected mailbox): select INBOX, `UID > last_uid`, fetch headers + text body, parse with the standard-library `email` package, create messages, advance the cursor. Blocking `imaplib` calls run in a worker thread with timeouts. Per-run cap (e.g. 25 messages) prevents floods.
- No new Python packages (`imaplib`, `smtplib`, `email` are standard library).
- Outgoing: `smtplib` over SSL, replying with threading headers; per-organization send limit (default 20/hour) as a runaway guard.
- Failure handling: failed login marks the integration `ERROR` and surfaces it in the UI; transient network errors retry on the next poll.

## 8. WhatsApp (Twilio Sandbox) details

- Owner joins the sandbox once by sending Twilio's join code from their personal WhatsApp.
- Inbound: Twilio posts form-encoded data to the channel URL. The handler **validates `X-Twilio-Signature`** (HMAC-SHA1 over URL + sorted params using the auth token, constant-time compare) before doing anything, then creates an `InboundMessage` and returns an empty TwiML `200`.
- Outbound: Twilio REST API via `httpx` (already a dependency). Free-form replies are allowed within WhatsApp's 24-hour customer-service window; outside it a template is required (noted in the UI).
- Local development needs a public HTTPS tunnel (e.g. cloudflared or ngrok) so Twilio can reach the webhook.

## 9. Security and privacy

| Concern | Control |
|---|---|
| Mailbox credentials | Encrypted at rest; masked in all responses; scoped per organization; owner can revoke the App Password in Google at any time |
| Tenant isolation | New tables carry `organization_id`; all routes are `/organizations/{id}/...` with the existing membership gate, except the public form/Twilio routes which resolve the organization from an unguessable key and nothing else |
| Authorization | Managing channels: ADMIN and above (same as integrations). Viewing the Inbox Log (contains personal data): MANAGER and above |
| Prompt injection | §5 |
| Reply loops / spam relay | Never reply to automated senders or ourselves; replies only to the original sender; approval before send; per-org send cap |
| Duplicates | Unique external id per channel |
| Personal data | Truncated body only, no attachments, retention purge, no bodies in logs |
| Public endpoints | Origin allow-list, rate limit, signature validation, size limits, constant-time comparisons |
| Audit | Channel connected/disconnected, message triggered, reply sent/approved are audited |

## 10. Build order (each phase tested and reviewed before the next)

| Phase | Deliverable | Needs from the owner |
|---|---|---|
| **1** | Grok through a generalised OpenAI-compatible provider; verify real classification | Grok API key in `.env` |
| **2** | Inbound core: `InboundMessage`, pipeline, `RelevanceService`, `INBOUND_MESSAGE_TRIGGER`, `AI_DRAFT_REPLY`, Inbox Log UI, simulate button, beat scheduler; **website form endpoint** + snippet | Portfolio site stack (§12) |
| **3** | Gmail: connect form, IMAP poller, `SEND_EMAIL` with threading | Google App Password (2-Step Verification on, IMAP enabled) |
| **4** | WhatsApp: Twilio webhook + `SEND_WHATSAPP` | Twilio account, sandbox joined, public tunnel |
| Later | Gmail OAuth, Meta WhatsApp Cloud, push notifications, draft editing | n/a |

The demo pipeline gains an inbound trigger and an approved-reply branch so `make run-demo` exercises the path using **Simulate message**.

## 11. Testing

- Unit: normaliser, pre-filters (auto-reply/no-reply/own address), relevance JSON parsing including malformed and injection samples, Twilio signature (known vectors), origin allow-list, honeypot, duplicate key.
- Provider fakes: `MailboxProvider` and `WhatsAppProvider` have in-memory fakes so the pipeline is tested without the network; one manual live smoke script per provider.
- Integration: simulate message, then relevant, then run, then approval, then (fake) send; irrelevant, then ignored with reason; duplicate ignored; AI failure, then held; reply restricted to the original sender; cross-tenant access to Inbox Log and form keys returns 404.
- Frontend: connect-mailbox form, Inbox Log states, trigger/reply step config forms.
- Browser check (scratch Playwright, not added to the project): simulate, then approve, then see the outcome.

## 12. Open items and assumptions

1. **Portfolio stack** (Node/Next.js, PHP, Formspree, EmailJS, other): decides whether the site posts to the public form endpoint or its backend calls the signed webhook. Needed before Phase 2's website part.
2. **Grok model name** to use (`GROK_MODEL`), taken from the owner's xAI account.
3. Assumed defaults, adjustable: poll interval 60 s, confidence threshold 0.7, retention 90 days, send cap 20/hour, Inbox Log visible to MANAGER+.
4. Gmail may change App Password or IMAP availability; the provider interface is the mitigation.
5. This spec adds migration `0004`; if the authentication plan's migrations are approved first, numbers are shifted accordingly.
6. Not committed: per the owner's instruction, this file stays in the working tree until they say otherwise.
