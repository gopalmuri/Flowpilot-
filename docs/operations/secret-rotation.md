# FlowPilot - Secret Management & Rotation Runbook

## 1. Classification of Secrets

FlowPilot manages five distinct categories of security credentials:

1. **Application Session Key (`SECRET_KEY`)**: Signs HMAC-SHA256 JWT access tokens and HttpOnly refresh cookies.
2. **Field Encryption Key (`FIELD_ENCRYPTION_KEY`)**: Symmetric key encrypting integration credentials and sensitive payload fields in PostgreSQL.
3. **Webhook HMAC Signing Tokens (`secret_token`)**: Tenant-scoped secrets for verifying inbound webhook payloads.
4. **Third-Party API Keys**: OpenAI, Anthropic, Slack, and CRM OAuth credentials.
5. **Datastore Credentials**: PostgreSQL and Redis access credentials.

---

## 2. JWT Secret Key Rotation (`SECRET_KEY`)

When rotating `SECRET_KEY`:
1. Existing refresh tokens and active JWTs will be invalidated upon restart.
2. In production with high traffic, plan rotation during scheduled maintenance windows or deploy with dual-key validation:
   - Accept tokens signed by either `SECRET_KEY` or `PREVIOUS_SECRET_KEY`.
   - Issue all new tokens using `SECRET_KEY`.
   - After token TTL expiry (default 7 days for refresh cookies), decommission `PREVIOUS_SECRET_KEY`.

---

## 3. Database Field Encryption Key Rotation (`FIELD_ENCRYPTION_KEY`)

FlowPilot encrypts sensitive fields using AES-256-GCM / Fernet. To rotate this key without data loss:

1. **Step 1 - Add Candidate Key**:
   Configure environment with:
   - `FIELD_ENCRYPTION_KEY`: New 32-byte hex key.
   - `PREVIOUS_FIELD_ENCRYPTION_KEY`: Current active key.
2. **Step 2 - Run Re-encryption Migration Script**:
   Run the background re-encryption worker to decrypt existing records with the previous key and re-encrypt with the new primary key:
   ```bash
   python -m app.scripts.rotate_field_keys --dry-run=false
   ```
3. **Step 3 - Verify & Remove Previous Key**:
   Verify that all integration credentials decrypt successfully, then unset `PREVIOUS_FIELD_ENCRYPTION_KEY`.

---

## 4. Webhook Signing Secret Rotation

Each workflow webhook trigger may define an independent `secret_token`.
1. Navigate to the Workflow Builder for the target workflow.
2. Create a new draft version.
3. Update the `secret_token` in the Webhook Trigger node configuration.
4. Save and publish the draft version.
5. Update the external webhook sender (e.g. Stripe, GitHub, Shopify) with the new HMAC secret.

---

## 5. Third-Party API Key Rotation

- **AI Providers (OpenAI, Anthropic)**:
  Update the environment variable `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` and perform a rolling restart:
  ```bash
  docker compose -f docker-compose.prod.yml up -d --no-deps backend celery_worker
  ```
- **Slack / CRM Integrations**:
  Manage credentials through the Integrations UI (`/integrations`). Disconnect and reconnect with new OAuth tokens.

---

## 6. Emergency Compromise Runbook

In the event of an active key leak:
1. **Immediate Revocation**: Generate and deploy a new `SECRET_KEY` immediately. This forces all active sessions to terminate globally.
2. **Datastore Password Reset**: Reset PostgreSQL and Redis passwords; restart containers with updated connection strings.
3. **Audit Log Inspection**: Review `audit_logs` for unauthorized executions or configuration changes during the compromise window.
