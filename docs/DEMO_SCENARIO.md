# FlowPilot — Canonical Product Demonstration Scenario

> **"Enterprise Lead Intake Pipeline" Walkthrough Manual**  
> *Release Candidate (RC-1.0) Canonical Demonstration Guide*

---

## 1. Scenario Context & Inbound Request

**Scenario**: Acme Corporation submits an inbound inquiry via their enterprise onboarding form.

### Inbound Payload:
```json
{
  "company": "Acme Corporation",
  "contact_name": "Sarah Lin",
  "contact_email": "sarah.lin@acme.corp",
  "employees": 500,
  "deal_value": 50000,
  "requirements": "Need enterprise workflow automation with SSO SAML, custom security controls, and dedicated integration support.",
  "urgency": "high"
}
```

---

## 2. Canonical Execution Flow

```
[Inbound Webhook Payload]
         │
         ▼
[01. Ingestion & HMAC Signature Check] ──► Validated (SHA-256 HMAC)
         │
         ▼
[02. Bounded AI Classification]        ──► Intent: Enterprise Expansion (0.96 Conf)
         │                                  Extracted: { Seats: 500, Value: $50,000 }
         ▼
[03. Deterministic Rule Evaluation]    ──► deal_value > $25,000 AND seats >= 250 
         │                                  Result: TRUE (Gated)
         ▼
[04. Human Approval Pause]             ──► Status: WAITING_APPROVAL
         │                                  Approver: Operations Director / VP
         │
         ├── Approver signs off in /approvals with comment: "Verified Acme credentials."
         │
         ▼
[05. Downstream Execution Actions]     ──► CRM Lead #8819 Created ($50,000 ARR)
         │                                  Slack Alert Dispatched to #enterprise-wins
         ▼
[06. Terminal Completion & Audit]      ──► Status: COMPLETED
         │                                  Audit: sha256:d82f91c0b3e14c7aa551
         ▼
[07. SLA Telemetry Recorded]           ──► Duration: 84ms (Within 15-minute SLA Target)
```

---

## 3. Demonstration Step-by-Step Script

### Step 1: The Public Landing Page Experience
1. Open `http://localhost:5173/`.
2. Direct audience attention to the hero heading: *"Turn business requests into controlled execution."* with the continuous moving emerald gradient.
3. Observe the continuous 9-stage pipeline visual:
   - Highlight the **intentional 1.8-second pause** at Human Approval.
   - Note: *"FlowPilot does not allow AI to blindly mutate corporate systems. Notice how the data packet completely halts until approval is granted."*
4. Scroll to **Interactive Scenario Switcher** and click through *High-Risk Refund* and *Production Access* to showcase domain adaptability.

### Step 2: Authentication & Operational Entry
1. Click **Sign In** and authenticate with demo credentials (`rc_test_dfefd6@flowpilot.io` / `Password123!`).
2. Land on `/dashboard`. Show the multi-tenant badge (*Acme RC Systems*) and real-time operational KPI cards.

### Step 3: Workflow Inspection
1. Navigate to `/workflows`.
2. Open `Enterprise Lead Intake Pipeline`.
3. Demonstrate the published DAG steps:
   - `WEBHOOK_TRIGGER` $\rightarrow$ `AI_CLASSIFICATION` $\rightarrow$ `CONDITION` $\rightarrow$ `HUMAN_APPROVAL` $\rightarrow$ `MOCK_CRM_CREATE` $\rightarrow$ `SLACK_NOTIFICATION`.

### Step 4: Live Webhook Dispatch
1. Dispatch an inbound request using curl:
   ```bash
   curl -X POST http://localhost:8000/api/v1/webhooks/{webhook_key} \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Timestamp: $(date +%s)" \
     -H "X-Webhook-Signature: {computed_hmac}" \
     -d '{"company": "Acme Corporation", "employees": 500, "deal_value": 50000, "requirements": "SSO SAML required"}'
   ```
2. System returns `status: 200 OK` with unique `workflow_run_id`.

### Step 5: Human-in-the-Loop Approval Action
1. Navigate to `/approvals`.
2. Notice the pending approval card for Acme Corporation.
3. Inspect inbound parameters, AI extraction scores, and matching enterprise rules.
4. Input decision note: *"Enterprise lead verified by RevOps. Approved for CRM ingestion."*
5. Click **Approve**.

### Step 6: Telemetry, Audit & SLA Verification
1. Navigate to `/executions`:
   - Locate the execution run.
   - View step timeline: all steps marked green with millisecond latency breakdowns.
2. Navigate to `/audit-logs`:
   - Inspect the immutable audit record containing actor UUID, timestamp, and SHA-256 signature.
3. Navigate to `/analytics`:
   - Show volume counter incremented, 100% success rate, and SLA compliance confirmed.

---

## 4. Demonstrating Failure-Path Protection

To prove enterprise reliability, demonstrate negative handling:
1. **Invalid HMAC Signature**: Send request with altered signature $\rightarrow$ rejected with `401 Unauthorized`.
2. **Duplicate Webhook**: Re-send identical payload with same `Idempotency-Key` $\rightarrow$ returned existing run ID without duplicate CRM record creation.
3. **Approval Rejection**: Reject an unverified request in `/approvals` $\rightarrow$ run terminates immediately with status `FAILED` / `REJECTED`, preventing downstream CRM and Slack execution.
