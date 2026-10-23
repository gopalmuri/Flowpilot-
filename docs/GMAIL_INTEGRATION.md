# Gmail integration (inbound, read-only)

FlowPilot can connect a Gmail mailbox to an organization, read new incoming mail, and feed it into the same pipeline
as the portfolio form: conversation, workflow, AI analysis, reply draft, human approval. **Sending from Gmail is not
implemented.** The mailbox grant is read-only, and replies still go to the mock outbound provider.

> **What has and has not been verified.** Everything here is covered by automated tests that use fake Google
> implementations and mocked `google-api-python-client` / `google-auth` objects. **No test has talked to Google.** The
> Google Cloud steps below follow Google's documented setup but have not been executed against a real project by this
> project's authors. Treat the first real connection as a verification step (checklist at the end).

## How it works

```
Admin clicks "Connect Gmail"
   |  POST /organizations/{org}/gmail/authorize   (owner/admin only)
   v
Server stores a single-use, hashed OAuth state bound to (organization, user) and sets a nonce cookie
   |  browser is sent to Google's consent screen (read-only scope, PKCE, offline access)
   v
Google redirects to  GET /api/v1/gmail/oauth/callback?code=...&state=...
   |  state valid + unused + unexpired + nonce cookie matches + user still owner/admin
   |  code exchanged; scopes checked; refresh token required
   |  mailbox = address Google returns from users.getProfile  (never a submitted address)
   v
Integration (type GMAIL) + gmail_accounts row created; tokens stored AES-GCM encrypted; watch registered
   v
New mail  ->  Gmail watch  ->  Pub/Sub push (OIDC-verified)  ->  marks the mailbox "needs sync"
                                         (or: periodic poll, when Pub/Sub is not configured)
   v
Sync worker: history.list from the stored historyId -> messages.get(raw) -> parse -> filter -> ingest_message
   v
Conversation / InboundMessage -> configured workflow -> AI_ANALYZE_MESSAGE -> reply draft -> approval queue
```

Google login for FlowPilot users and Gmail mailbox authorization are separate. This integration never asks for
identity scopes; the mailbox identity comes from the Gmail API itself.

### Policies
- **Initial sync:** only mail that arrives *after* the mailbox is connected (the history baseline is taken at connect
  time). Optional bounded backfill: set `backfill_days` (0 to 7) in the integration config before the first sync.
- **Reconnecting a disconnected mailbox** takes a fresh baseline: mail that arrived while it was disconnected is not
  back-filled. Reconnecting reuses the same integration, so conversation history stays attached.
- **One organization per mailbox.** A mailbox connected in one organization cannot be connected in another until it is
  disconnected. A reconnect must be the same mailbox.
- **Not ingested:** messages labelled SENT, DRAFT, SPAM or TRASH, mail not in the inbox, mail from the mailbox itself,
  and machine-generated mail (`Auto-Submitted`, `Precedence: bulk/junk/list`, `List-Id`, `X-Autoreply`,
  mailer-daemon/no-reply senders). This also prevents reply loops once sending exists.
- **Content safety:** MIME is parsed with the standard `email` package; HTML is reduced to plain text with
  BeautifulSoup (scripts, styles, iframes and visually hidden elements are dropped); links are never followed; attachments
  are never opened or stored (name, type and size only); messages over 10 MB are ingested from Gmail's snippet only.
- **Deduplication:** by (organization, channel `GMAIL`, Gmail message id), enforced by a database unique key. Replays,
  duplicate notifications and crash recovery therefore cannot create a second message or workflow run.
- **Threading metadata kept** (in `inbound_messages.provider_metadata`): Gmail thread id (also the conversation's
  external id), Gmail message id, `Message-ID`, `In-Reply-To`, `References`, To/Cc/Reply-To, labels, `historyId`,
  attachment metadata.

## Google Cloud setup

1. **Project.** Create or choose a Google Cloud project.
2. **Enable APIs.** Gmail API and Cloud Pub/Sub API (APIs & Services -> Library).
3. **OAuth consent screen** (Google Auth platform -> Branding/Audience/Data access):
   - App name, support email, authorized domain(s), developer contact.
   - Scope to add: `https://www.googleapis.com/auth/gmail.readonly`. This is the only scope FlowPilot requests. It is
     enough for `users.watch`, `users.history.list` and `users.messages.get`. (`gmail.send` will be requested later, by
     reconnecting, when sending is approved.)
   - **`gmail.readonly` is a restricted scope.** A public app needs Google's OAuth verification and may need a third
     party security assessment before general use. While the app is in *Testing* mode, only listed test users can connect,
     and **refresh tokens expire after 7 days**, so mailboxes show "Reconnect required" weekly. An *Internal* app (Google
     Workspace organization) avoids verification.
4. **Credentials -> Create OAuth client ID -> Web application.**
   - Authorized redirect URI: exactly the value of `GOOGLE_OAUTH_REDIRECT_URI`, e.g.
     `https://api.example.com/api/v1/gmail/oauth/callback` (local: `http://localhost:8000/api/v1/gmail/oauth/callback`).
   - Copy the client ID and secret into the environment file the backend actually reads (see "Where the settings go"
     below), never into the frontend, chat or source control.
5. **Pub/Sub (optional but recommended for production; without it FlowPilot polls).**
   - Create a topic, e.g. `gmail-notifications`.
   - Grant **`gmail-api-push@system.gserviceaccount.com`** the role **Pub/Sub Publisher** on that topic (this is how Gmail
     is allowed to publish).
   - Create a service account for push authentication, e.g. `flowpilot-gmail-push`. The account that creates the
     subscription needs permission to act as it, and the Pub/Sub service agent
     (`service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com`) needs *Service Account Token Creator* on it.
   - Create a **push subscription** on the topic: endpoint `https://api.example.com/api/v1/gmail/pubsub`, authentication
     enabled with that service account and an **audience** (use the endpoint URL).
   - The endpoint must be reachable from Google over public HTTPS. For local development use a tunnel (ngrok,
     cloudflared) or skip Pub/Sub and rely on polling.

## Where the settings go and how to reload them

- **Docker Compose stack (the normal local setup):** the repository-root **`.env`** (`E:\flowpilot\.env`). Compose passes
  it to `backend`, `celery_worker` and `celery_beat` through `env_file`. `backend/.env` is **not** read by the containers.
- **Running the backend directly with the venv:** `backend/.env`.
- **Containers read the file only when they are created.** After editing it, recreate the three services that use
  Google settings (the worker needs the client ID and secret to refresh tokens, and beat shares the image):
  `docker compose up -d --force-recreate backend celery_worker celery_beat`. Postgres, Redis and the frontend do not need it.
- Check without printing values: `docker exec flowpilot-backend env | grep -E '^GOOGLE_OAUTH_' | sed 's/=.*/=<present>/'`.

## Configuration (all optional for startup and for the test suite)

| Variable | Purpose |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth web client. Without them, "Connect Gmail" is disabled and the card says so. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Must equal the registered redirect URI. |
| `FRONTEND_URL` | Where the callback sends the browser back (default `http://localhost:5173`). |
| `GMAIL_PUBSUB_TOPIC` | `projects/<project>/topics/<topic>`. If unset, no watch is registered (polling only). |
| `GMAIL_PUBSUB_SUBSCRIPTION` | `projects/<project>/subscriptions/<sub>`. If set, pushes naming another subscription are rejected. |
| `GMAIL_PUBSUB_AUDIENCE` | Audience configured on the push subscription. **Required** for the push endpoint to accept anything. |
| `GMAIL_PUBSUB_SERVICE_ACCOUNT` | Service-account email the push token must belong to. **Required.** |
| `GMAIL_POLL_INTERVAL_SECONDS` | Safety poll for missed notifications (default 120). |
| `GMAIL_WATCH_RENEW_BEFORE_HOURS` | Renew a watch this long before it expires (default 24). |
| `GMAIL_RESYNC_WINDOW_DAYS` | How far back a controlled resync looks after an invalid historyId (default 3). |
| `GMAIL_MAX_MESSAGES_PER_SYNC`, `GMAIL_SYNC_LEASE_SECONDS`, `GMAIL_API_NUM_RETRIES`, `GMAIL_MAX_RAW_BYTES`, `GMAIL_OAUTH_STATE_TTL_SECONDS` | Limits and timeouts. |

If `GMAIL_PUBSUB_AUDIENCE` or `GMAIL_PUBSUB_SERVICE_ACCOUNT` is missing, the push endpoint answers **503** to every
request. It never falls back to accepting unauthenticated pushes.

## Watch lifecycle and recovery

- **Registration.** Connecting registers `users.watch` on INBOX to `GMAIL_PUBSUB_TOPIC`; Google's returned expiration
  (about 7 days) is stored (`watch_expiration`).
- **Renewal.** Beat task `tasks.renew_gmail_watches` (every 30 minutes) re-registers watches that are missing, failed or
  within `GMAIL_WATCH_RENEW_BEFORE_HOURS` of expiring. Each registration first takes a per-mailbox compare-and-swap
  lease, so two jobs (or a renewal racing a connect) cannot register the same mailbox twice, even if more than one
  scheduler ever ran. Exactly one `celery_beat` service must run (see `DEPLOYMENT.md`).
- **Notifications.** A valid push sets `sync_requested_at` on the mailbox (the durable signal) and enqueues
  `tasks.sync_gmail_mailbox`. Duplicate pushes are harmless: one sync reads everything since the stored historyId.
- **Missed notifications / worker outages.** `tasks.sync_due_gmail_mailboxes` (every 30 s) enqueues a sync for every
  mailbox with a pending notification **or** not synced for `GMAIL_POLL_INTERVAL_SECONDS`. So missed pushes, lost Celery
  messages, a worker restart or a missing Pub/Sub configuration all converge without manual action.
- **One sync at a time per mailbox** (lease with expiry). A worker that dies mid-sync holds the lease until it expires;
  the stored historyId only advances after a fully successful pass, and deduplication absorbs the re-read.
- **Expired or invalid historyId** (Gmail keeps roughly a week): a controlled resync takes a fresh baseline *first*,
  then lists a bounded recent window (`GMAIL_RESYNC_WINDOW_DAYS`) and ingests anything unseen; it is audited as
  `gmail.resync`.
- **Rate limits / transient errors:** `googleapiclient` retries 429/5xx with backoff (`GMAIL_API_NUM_RETRIES`); what is
  left is recorded and the sync is retried by Celery with exponential backoff (honouring `Retry-After` when known). The
  mailbox stays marked for sync, so nothing is lost.
- **Revoked or expired credentials** (`invalid_grant`, 401, permission removed): the mailbox is marked
  *Reconnect required*, the integration status becomes `ERROR`, syncing stops (no retry storm) and an audit event is
  written. Reconnecting with the same Google account restores it.
- **Disconnect** (use this, not delete): stops the watch and asks Google to revoke the grant (best effort), then discards the stored
  credentials, marks the integration `DISCONNECTED` and stops all synchronisation and notification handling. Conversation
  history is kept. (Deleting the integration through the generic API also revokes the grant, but then removes the
  integration's conversations and messages.)

## Local development

1. Fill `GOOGLE_OAUTH_*` in the repository-root `.env` (redirect URI `http://localhost:8000/api/v1/gmail/oauth/callback`:
   API port 8000 + prefix `/api/v1` + route `/gmail/oauth/callback`) and recreate the containers as above. Leave the
   Pub/Sub variables empty: the mailbox is then checked every `GMAIL_POLL_INTERVAL_SECONDS` and the card shows
   "Push not configured".
2. Start the stack (backend, `celery_worker`, **`celery_beat`**, frontend). Without beat nothing polls.
3. **Verify the scheduler is really running** (a compose file alone does not prove it):
   - The Gmail card shows a warning when no heartbeat has been seen, and the status API returns
     `scheduler.healthy` / `scheduler.last_tick`.
   - Beat stamps `flowpilot:beat:last_tick` in Redis every 30 s:
     `docker compose exec redis redis-cli GET flowpilot:beat:last_tick`.
   - List the configured schedule:
     `python -c "from app.workers.celery_app import celery_app as c; print(c.conf.beat_schedule)"`.
   - Beat logs `Scheduler: Sending due task ...` lines.
4. Open Integrations -> Gmail -> Connect Gmail, approve read-only access with a test user, pick the workflow that new
   mail should start, send yourself an email from another account, and watch it appear in the approvals queue.

## Production

- Rebuild images (new dependencies: `google-auth`, `google-auth-oauthlib`, `google-api-python-client`, `requests`,
  `beautifulsoup4`) and run migrations (`0008_gmail_integration`).
- Set the variables above, publish the API over HTTPS at the redirect/push URLs, and run exactly one `celery_beat`.
- Behind a reverse proxy, forward the real scheme/host so the registered redirect URI matches, and keep the
  `flowpilot_gmail_nonce` cookie working: it is `HttpOnly`, `SameSite=Lax`, scoped to `/api/v1/gmail/oauth` and `Secure`
  in production. The frontend and API should share a site (same registrable domain).
- Rotate `ENCRYPTION_KEY` with care: stored tokens are encrypted with it (and bound to the organization id).

## Security model

| Property | How |
|---|---|
| Least privilege | Only `gmail.readonly`; grants with extra or missing scopes are refused and revoked. |
| CSRF / replay on OAuth | Random single-use state stored hashed, 10 min expiry, bound to organization + user, plus a browser nonce cookie. A mismatched nonce does not burn the real flow. |
| Tenant derivation | The callback has no session, so the organization comes only from the state row; the user must still be owner/admin. Pub/Sub pushes derive the organization from our own `gmail_accounts` row, never from the payload. |
| Mailbox identity | From `users.getProfile` for the tokens just issued. A submitted address is ignored. One mailbox, one organization (partial unique index). |
| Tokens | AES-256-GCM in `Integration.credentials_encrypted`, bound to the organization id (another organization's key context cannot decrypt). Never returned by any API, never logged, never in audit details, never sent to the frontend. Refreshed tokens are re-encrypted and stored. |
| Push authenticity | Google-signed OIDC bearer token verified with `google-auth`: signature, audience, `email_verified`, and the configured service account. Not configured means 503, not open. |
| Content | HTML sanitised to text, hidden text removed, attachments never opened, prompt-injection handling unchanged downstream (AI analysis and the human approval gate). |
| No outbound | Read-only scope; the outbound provider for Gmail conversations is still the mock. |

Known risks: the restricted-scope verification process; a stolen `ENCRYPTION_KEY` plus database access exposes tokens;
Google Testing-mode tokens expire weekly; a compromised Redis/Celery broker could enqueue sync tasks (they only read
from mailboxes already connected).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Google shows `redirect_uri_mismatch` | `GOOGLE_OAUTH_REDIRECT_URI` differs from the URI registered in Google Cloud (scheme, host, port and path must match). |
| Google shows "Access blocked" | App in Testing mode and the Google account is not a listed test user, or the app is not verified. |
| Redirect back with `reason=no_refresh_token` | Google did not issue a refresh token. Remove the app at myaccount.google.com/permissions and connect again. |
| `reason=browser_mismatch` | The flow was finished in a different browser/profile, or the nonce cookie was blocked (check `SameSite`/third-party cookie settings and that the frontend and API share a site). |
| `reason=state_expired` / `state_reused` | The consent took longer than 10 minutes, or the callback URL was opened twice. Start again. |
| `reason=mailbox_in_use` | That mailbox is connected to another organization. Disconnect it there first. |
| `reason=mailbox_mismatch` | Reconnect must use the same Google account. |
| Card shows "Reconnect required" | Google no longer accepts the grant (revoked, password reset, 7-day Testing-mode expiry, scope removed). Click Reconnect. |
| Card shows "scheduler not running" | Start `celery_beat` (one instance) and check `redis-cli GET flowpilot:beat:last_tick`. |
| Watch `FAILED` (`permission_denied`) | The Gmail push service account lacks *Pub/Sub Publisher* on the topic, or `GMAIL_PUBSUB_TOPIC` is wrong. |
| Pushes get 401 | Wrong `GMAIL_PUBSUB_AUDIENCE` / `GMAIL_PUBSUB_SERVICE_ACCOUNT`, or the subscription has no authentication. 503 means these are unset. |
| Mail is stored but nothing starts | No workflow selected on the Gmail card (`no_workflow_configured`) or the workflow is not active/published. |
| Old mail is missing after connecting | By design: only mail arriving after connection is ingested. Use `backfill_days` (before the first sync) if needed. |
| `gmail.resync` audit events | The stored historyId expired (mailbox idle for about a week, or an outage). Handled automatically. |
| Duplicate-looking work | There is none by design; deduplication is by Gmail message id. Check `gmail_accounts.last_sync_error`. |

## Live verification log

Executed on 2026-10-17 against real Google with one test Google Cloud project (FlowPilot, External, Testing mode) and one
test user. Only what is listed under "Verified live" was observed against Google; everything else is still covered by fakes.

**Verified live**
- The authorization URL built by the app is accepted by Google (redirect to sign-in, no `redirect_uri_mismatch` or
  `invalid_client`).
- Consent as the listed test user; the callback validated state, nonce, expiry and role; the code exchange succeeded and
  returned exactly the `gmail.readonly` scope with a refresh token.
- The mailbox address stored is the one Google reported; tokens are stored AES-GCM encrypted, decrypt only with that
  organization's context, and appear in no API response.
- A real sync against the Gmail API completed (empty history, no error) from the polling task, with Pub/Sub unconfigured.
- Token refresh works against Google (a stored refresh token minted a new access token).
- Disconnect revokes at Google: the same refresh token was accepted before and rejected with `invalid_grant` after;
  credentials were discarded from the database and the watch call was made.
- The scheduler heartbeat reports healthy while beat runs and unhealthy about two minutes after it stops.

**Found by the live run and fixed**
- **Credentials were being written to the container log.** `requests_oauthlib` logs the token request (authorization
  code, PKCE verifier) and the full token response (access and refresh token) at DEBUG, and uvicorn's access log prints the
  callback URL including `code` and `state`. Mocked tests could not show this because only the real libraries log it.
  Fix: every log record and traceback now passes through a redacting formatter (`app/core/logging.py`), credential-logging
  libraries are held at WARNING, the Celery worker and beat get the same hardening, and the revoke call sends the token in
  the POST body instead of the URL. Tests drive the real `requests_oauthlib` and prove the leak without the fix and none
  with it. The exposed refresh token was revoked at Google (verified) and the old container logs were discarded.
- If you ran a build before this fix, assume the logs of that container contain tokens: disconnect the mailbox (which
  revokes it) and recreate the container.

**Not yet verified live**: receiving and ingesting a real email, thread and header preservation on real mail, attachment
metadata, history expiry and rate-limit handling against Google, revoked-credential handling on a real sync, and
everything about Pub/Sub (topic, IAM, OIDC token verification, watch renewal).

## First live verification checklist (remaining items)

1. Connect a test mailbox as a listed test user; confirm the consent screen shows only "Read all resources and mail
   settings" for Gmail read-only, and the card shows the correct mailbox address.
2. Send a mail to it; confirm it appears in Approvals (poll mode first, then with Pub/Sub).
3. Let a watch approach expiry (or call `tasks.renew_gmail_watches`) and confirm `watch_expiration` moves.
4. Revoke access in the Google account; confirm "Reconnect required" within one sync interval.
5. Disconnect; confirm the app disappears from the Google account's third-party access list.
