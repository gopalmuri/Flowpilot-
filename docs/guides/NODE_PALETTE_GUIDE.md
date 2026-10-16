# FlowPilot — Node Palette Mastery Guide

> **Target Audience:** Workflow Designers, Operators, Product Managers, and System Engineers.  
> **System Scope:** Complete technical and functional breakdown of all 8 nodes in the FlowPilot Workflow Builder.  
> **Verification Basis:** Verified directly against FlowPilot frontend UI (`NodeConfigPanel.tsx`) and backend execution engine (`executors.py`, `workflow_engine.py`).

---

## 1. Operational Overview & Node Classification Matrix

FlowPilot implements a Directed Acyclic Graph (DAG) orchestration engine where nodes are connected via directional edges. Each node fulfills a specific role in the enterprise automation lifecycle:

| Classification | Node Name | Runtime Engine Role |
| :--- | :--- | :--- |
| **TRIGGER** | `Webhook Trigger` | Inbound automated HTTP trigger from external applications |
| **TRIGGER** | `Manual Trigger` | On-demand UI operator trigger with manual JSON payload |
| **PROCESSING** | `Data Validation` | Fail-fast schema & mandatory field verification |
| **INTELLIGENCE** | `AI Classification` | LLM semantic understanding & structured category tagging |
| **DECISION** | `Condition Rule` | Mathematical & string comparison for DAG branch selection |
| **GOVERNANCE** | `Human Approval` | State machine pause for human authorization checkpoint |
| **ACTION** | `Mock CRM Entity` | External database record upsert / entity creation |
| **NOTIFICATION** | `Slack Notification` | Outbound communication to chat channels with templates |

---

## 2. Deep Node-by-Node Reference

---

### Node 1: WEBHOOK TRIGGER

#### 1. What is this node?
The **Webhook Trigger** is an inbound entry-point node that listens for real-time HTTP requests sent from external third-party software (such as customer portals, e-commerce storefronts, or payment processors).

#### 2. Why does FlowPilot need this node?
Workflows cannot run in isolation. External systems need a secure, automated way to start a business process without requiring an operator to sit in front of the screen.

#### 3. When should I use it?
Use it when an external application needs to start a workflow automatically the moment an event happens (e.g., an enterprise customer signs up on your website).

#### 4. What data does it receive?
It receives an HTTP request containing:
- **Headers:** Content-Type, Authorization, or HMAC signatures.
- **Body:** JSON payload with business fields (e.g., `company_name`, `contact_email`, `credit_limit_requested`).

#### 5. What does it do with the input?
1. Sanitizes the inbound JSON payload (stripping dangerous injection patterns).
2. Generates an execution `correlation_id` for end-to-end tracing.
3. Writes the initial payload into the workflow execution context.

#### 6. What does it produce?
A standardized trigger dictionary available to all downstream nodes:
```json
{
  "trigger_type": "WEBHOOK_TRIGGER",
  "payload": {
    "company_name": "Apex Global Logistics Inc",
    "contact_email": "finance@apexlogistics.com",
    "credit_limit_requested": 150000,
    "annual_revenue": 12500000
  },
  "received_at": "2026-10-03T08:00:00Z"
}
```

#### 7. What can I configure in the UI?
When you click the Webhook Trigger node, the **Node Configuration Panel** displays:
- **Node Title & Key:** Operational label (`name`) and unique identifier (`step_key`).
- **Allowed HTTP Methods:** Checkboxes for `POST`, `GET`, `PUT` (Default: `POST`).
  - *Why required:* Enforces API protocol discipline.
  - *If misconfigured:* External requests using an unselected method are rejected with `405 Method Not Allowed`.

#### 8. How does it connect to another node?
- **Previous Node:** None (Triggers have no input handle; they can only be the start).
- **Current Node:** `Webhook Trigger`
- **Next Node:** Typically connects directly to `Data Validation` or `AI Classification`.

#### 9. FlowPilot B2B Example
An enterprise sales portal makes an HTTP POST request to FlowPilot's webhook URL:
```bash
POST /api/v1/webhooks/wh_live_8f3a9e21
{"company_name": "Apex Global", "credit_limit_requested": 150000}
```
FlowPilot immediately captures this request and wakes up the workflow.

---

### Node 2: MANUAL TRIGGER

#### 1. What is this node?
The **Manual Trigger** is an on-demand entry-point node designed for operator-initiated runs directly from the FlowPilot web interface.

#### 2. Why does FlowPilot need this node?
Before deploying a workflow to receive live customer traffic, operators need a controlled way to test workflows with sample data. Operators also use it for internal workflows that run on-demand (e.g., periodic batch reconciliation).

#### 3. When should I use it?
Use it during workflow development, staging testing, or for back-office tasks that humans trigger manually rather than via an external webhook.

#### 4. What data does it receive?
It receives the JSON payload entered by the operator in the **"Execute Workflow"** modal dialog when clicking the **"Run"** button in the top toolbar.

#### 5. What does it do with the input?
Validates that the entered string is valid JSON, sanitizes it, and passes it into the engine as `ctx.trigger_payload`.

#### 6. What does it produce?
```json
{
  "trigger_type": "MANUAL_TRIGGER",
  "payload": { ...operator_json... },
  "received_at": "2026-10-03T08:05:00Z"
}
```

#### 7. What can I configure in the UI?
- **Node Title & Step Key:** Standard node labels.
- *(Note: No extra network settings are needed because this node is triggered internally from the UI).*

#### 8. How does it connect to another node?
- **Previous Node:** None (Entry point only).
- **Current Node:** `Manual Trigger`
- **Next Node:** Connects to `Data Validation` or processing steps.

#### 9. FlowPilot B2B Example
A Workflow Engineer wants to verify if the credit approval logic works. They open the workflow, click **"Run"**, paste test account JSON, and trigger an immediate run.

---

### Node 3: DATA VALIDATION

#### 1. What is this node?
The **Data Validation** node is a deterministic quality gateway that verifies whether the incoming business data contains all mandatory fields before any heavy processing, AI analysis, or external API calls take place.

#### 2. Why does FlowPilot need this node?
If an external webhook sends empty or broken data (e.g., missing an email address or company name), running AI models or CRM upserts will waste tokens and fail with cryptic errors. Validation acts as a "fail-fast" shield.

#### 3. When should I use it?
Immediately after the trigger node (Webhook or Manual Trigger) to ensure incoming payloads adhere to business requirements.

#### 4. What data does it receive?
The full upstream payload dictionary (`ctx.trigger_payload` or output of previous steps).

#### 5. What does it do with the input?
It scans the payload against your configured list of required field names:
- **If all fields exist and are non-null:** Returns `COMPLETED`.
- **If any field is missing or empty:** The node immediately sets its status to `FAILED` with an explicit error: `"Validation failed: missing required fields: contact_email"`. The entire workflow run stops and halts execution.

#### 6. What does it produce?
On success:
```json
{
  "valid": true,
  "validated_fields": ["company_name", "credit_limit_requested", "contact_email"],
  "data": { ...sanitized_clean_payload... }
}
```

#### 7. What can I configure in the UI?
- **Required Fields:** A comma-separated list of field names.
  - *Example:* `company_name, contact_email, credit_limit_requested`
  - *Why required:* Tells FlowPilot which keys must be present.
  - *If misconfigured:* If you type a field name that the external system never sends, every execution will fail at this node.

#### 8. How does it connect to another node?
```
[Webhook Trigger] ──> [Data Validation] ──> [AI Classification]
```

#### 9. FlowPilot B2B Example
A signup payload arrives with `company_name` and `credit_limit_requested`, but the user skipped `contact_email`. The Data Validation node catches this in under 2 milliseconds, fails the run with a clear message, and prevents invalid records from entering your CRM.

---

### Node 4: AI CLASSIFICATION

#### 1. What is this node?
The **AI Classification** node uses a Large Language Model (LLM) to read unstructured or semi-structured business text and categorize it into structured, deterministic labels with an associated confidence score.

#### 2. Why does FlowPilot need this node?
Computers cannot easily interpret fuzzy human text (e.g., assessing credit risk from company descriptions or categorizing a lead as Enterprise vs. SMB). This node translates messy text into clean categories that subsequent rules can evaluate.

#### 3. When should I use it?
Use it when a decision requires semantic judgment—such as credit risk grading, lead tiering, or intent classification.

#### 4. What data does it receive?
Text extracted from the workflow context:
- Company description, financial notes, deal notes, or the prompt template configured in the node.

#### 5. What does it do with the input?
1. Packages the text with a structured prompt.
2. Calls the selected LLM provider (e.g., Gemini, Claude, or GPT).
3. Enforces a strict JSON Schema response from the model.
4. **Important Architecture Rule:** The AI *only* analyzes and categorizes. It does **not** execute actions or branch the workflow itself. FlowPilot's engine uses the AI's output to make deterministic routing decisions.

#### 6. What does it produce?
A structured JSON object:
```json
{
  "category": "HIGH_RISK",
  "confidence": 0.94,
  "priority": "HIGH",
  "reasoning": "Requested credit limit exceeds 1% of annual revenue with high leverage ratios.",
  "tokens_used": 142
}
```

#### 7. What can I configure in the UI?
- **AI Classification Model:** Dropdown to select the model:
  - `Gemini 1.5 Pro` / `Gemini 1.5 Flash`
  - `GPT-4o Mini`
  - `Claude 3.5 Sonnet`
- **Prompt / Instructions:** Text area defining the classification criteria.
  - *Example:* `Classify this commercial customer as LOW_RISK, MEDIUM_RISK, or HIGH_RISK based on their requested limit and revenue.`
  - *Why required:* Guides the LLM's classification logic.
  - *If misconfigured:* Ambiguous prompts result in low-confidence or unexpected category names.

#### 8. How does it connect to another node?
```
[Data Validation] ──> [AI Classification] ──> [Condition Rule]
```

#### 9. FlowPilot B2B Example
The node reads `credit_limit_requested: 150000` and `annual_revenue: 12500000`. The LLM classifies the deal as `category: "HIGH_LIMIT"` with a confidence of `0.96`.

---

### Node 5: CONDITION RULE

#### 1. What is this node?
The **Condition Rule** is a deterministic decision node that evaluates an exact logical expression against workflow data and splits the execution path into separate branches (`true` vs. `false`).

#### 2. Why does FlowPilot need this node?
Workflows are rarely linear. High-value enterprise customers require executive review, while low-risk accounts should be automated immediately. The Condition Rule provides branching logic.

#### 3. When should I use it?
Whenever you need an "IF / ELSE" branch in your business process.

#### 4. What data does it receive?
Any field from the trigger payload, validation output, or upstream step data (e.g., `credit_limit_requested` or `steps.ai.category`).

#### 5. What does it do with the input?
It evaluates the configured field against an operator and target value using safe evaluation logic (no unsafe `eval()`):
- If the comparison evaluates to `true`, the engine activates the **`true`** outgoing edge.
- If it evaluates to `false`, the engine activates the **`false`** outgoing edge and marks unselected downstream steps as `SKIPPED`.

#### 6. What does it produce?
```json
{
  "evaluation_result": true,
  "selected_branch": "true"
}
```

#### 7. What can I configure in the UI?
- **Evaluation Field (dot-notated):** Path to the value (e.g., `credit_limit_requested` or `category`).
- **Operator:** Comparison dropdown:
  - `Equal (==)`
  - `Not Equal (!=)`
  - `Greater Than (>)`
  - `Greater Than or Equal (>=)`
  - `Less Than (<)`
  - `Less Than or Equal (<=)`
  - `Contains`
- **Comparison Target Value:** Value to test against (e.g., `100000` or `HIGH_LIMIT`).

#### 8. How does it connect to another node?
A Condition Rule has **one input handle** and **two outgoing connection branches**:
```
                        ┌─── [true] ───> [Human Approval]
[Condition Rule] ───────┤
                        └─── [false] ──> [Mock CRM Entity] (Direct Approval)
```

#### 9. FlowPilot B2B Example
- **Field:** `credit_limit_requested`
- **Operator:** `Greater Than (>)`
- **Value:** `100000`
- **Evaluation:** Since the customer requested `$150,000`, the rule returns `true`, routing the execution to human review.

---

### Node 6: HUMAN APPROVAL

#### 1. What is this node?
The **Human Approval** node is a governance checkpoint that pauses autonomous execution until an authorized human user logs into FlowPilot and explicitly clicks **"Approve"** or **"Reject"**.

#### 2. Why does FlowPilot need this node?
Certain business operations have legal, financial, or regulatory liability. Organizations cannot allow an AI or script to disburse high credit lines or sign enterprise contracts without human accountability.

#### 3. When should I use it?
Use it for sensitive transactions: large credits, contract sign-offs, data deletions, or high-risk exceptions flagged by AI.

#### 4. What data does it receive?
A snapshot of the entire workflow context up to this point (customer details, AI risk scores, financial metrics).

#### 5. What does it do with the input?
1. Pauses the Celery worker for this execution.
2. Sets the step status to `PAUSED` and the overall run status to `PAUSED (WAITING_APPROVAL)`.
3. Creates a record in the **Approvals** table with a full snapshot of the business data.
4. Emits an immutable audit log (`approval.requested`).
5. Waits for human action. When approved, it unpauses the execution and resumes the pipeline.

#### 6. What does it produce?
```json
{
  "status": "APPROVED",
  "selected_branch": "approved",
  "reviewed_by": "gopalmuri1919@gmail.com",
  "reviewed_at": "2026-10-03T08:10:00Z",
  "comment": "Financial statements verified, credit limit approved."
}
```

#### 7. What can I configure in the UI?
- **Required Approver Role:**
  - `Manager or higher` (Role: `MANAGER`)
  - `Admin or higher` (Role: `ADMIN`)
  - `Owner only` (Role: `OWNER`)
- **Approval Request Title:** Display title shown on the Approvals dashboard (e.g., `Enterprise Credit Limit Review`).
- **Timeout (Hours):** How long before an unresolved request expires (Default: 24 hours).

#### 8. How does it connect to another node?
```
[Condition Rule (true)] ──> [Human Approval] ──> [Mock CRM Entity]
```

#### 9. FlowPilot B2B Example
The customer requested $150,000. FlowPilot pauses execution and notifies the Credit Manager. The manager opens the **Approvals** screen, inspects the company financials, enters a sign-off note, and clicks **"Approve"**. FlowPilot immediately resumes the pipeline.

---

### Node 7: MOCK CRM ENTITY

#### 1. What is this node?
The **Mock CRM Entity** node is an integration action node that simulates an external customer relationship management (CRM) database (like Salesforce, HubSpot, or a relational customer registry).

#### 2. Why does FlowPilot need this node?
It allows you to develop, test, and demonstrate complete end-to-end B2B sales and onboarding pipelines locally without requiring paid API keys, OAuth credentials, or risk of polluting a live production CRM.

#### 3. When should I use it?
Use it when an approved customer record needs to be created, upserted, or tagged in your system of record.

#### 4. What data does it receive?
Customer attributes gathered from earlier steps: `company_name`, `contact_email`, `credit_limit_requested`, along with AI classification tags (`category`, `priority`).

#### 5. What does it do with the input?
1. Extracts required customer fields automatically or uses custom mapping.
2. Simulates an atomic database upsert with realistic latency.
3. Generates a unique CRM ID and returns the created record.

#### 6. What does it produce?
```json
{
  "crm_id": "crm_lead_9f41b2e8",
  "status": "CREATED",
  "entity_type": "lead",
  "attributes": {
    "company": "Apex Global Logistics Inc",
    "email": "finance@apexlogistics.com",
    "deal_size": 150000,
    "category": "HIGH_LIMIT"
  },
  "created_at": "2026-10-03T08:10:05Z"
}
```

#### 7. What can I configure in the UI?
- **Target Entity Type:** Dropdown selection:
  - `Lead`
  - `Contact`
  - `Deal`
- *(Optional field mapping configuration).*

#### 8. How does it connect to another node?
```
[Human Approval] ──> [Mock CRM Entity] ──> [Slack Notification]
```

#### 9. FlowPilot B2B Example
Once the human officer approves the customer, this step runs and creates a permanent Lead entity (`crm_lead_9f41b2e8`) tagged with status `APPROVED`.

---

### Node 8: SLACK NOTIFICATION

#### 1. What is this node?
The **Slack Notification** node is an outbound communication node that posts formatted messages and structured data cards to a designated Slack channel.

#### 2. Why does FlowPilot need this node?
To keep human teams informed in real time. Rather than making sales, support, and finance teams check a dashboard every 5 minutes, FlowPilot pushes critical updates directly into their communication channels.

#### 3. When should I use it?
Use it as a terminal action to notify teams of successful onboarding, escalation alerts, or workflow completions.

#### 4. What data does it receive?
The entire accumulated workflow context (trigger payload, validation status, AI risk level, CRM ID, and approver comments).

#### 5. What does it do with the input?
1. Interpolates template placeholders (e.g., replaces `{{company_name}}` with `Apex Global Logistics Inc`).
2. Formats a Slack message (or Block Kit summary card).
3. Delivers the message to the Slack webhook (in mock or live mode).

#### 6. What does it produce?
```json
{
  "delivered": true,
  "channel": "#sales-ops",
  "message": "Enterprise Account Provisioned: Apex Global Logistics Inc ($150,000 Limit)",
  "timestamp": "2026-10-03T08:10:07Z"
}
```

#### 7. What can I configure in the UI?
- **Target Slack Channel:** The destination channel name (e.g., `#sales-ops` or `#alerts`).
- **Message Content / Template:** The message body supporting dynamic variables.
  - *Example:* `Enterprise account provisioned for {{company_name}}. Credit Limit: ${{credit_limit_requested}}. Status: ACTIVE.`
  - *Why required:* Defines what the team reads in Slack.

#### 8. How does it connect to another node?
- **Previous Node:** Connects from `Mock CRM Entity` or `Human Approval`.
- **Current Node:** `Slack Notification`
- **Next Node:** None (typically the final node in the pipeline).

#### 9. FlowPilot B2B Example
Posts a notification to `#sales-ops`:
> **New Enterprise Customer Onboarded**  
> **Company:** Apex Global Logistics Inc  
> **Credit Limit:** $150,000 (Approved by Credit Officer)  
> **CRM ID:** `crm_lead_9f41b2e8`

---

## 3. The Complete End-to-End Data Chain

Here is the exact data transformation across the entire pipeline:

```
[1. Webhook Trigger]
    Input:  Raw HTTP POST from website
    Action: Sanitizes JSON payload
    Output: { "company_name": "Apex Global", "credit_limit": 150000, "email": "finance@apex.com" }
       │
       ▼
[2. Data Validation]
    Input:  Trigger output
    Action: Verifies company_name, credit_limit, and email exist
    Output: { "valid": true, "data": { ... } }
       │
       ▼
[3. AI Classification]
    Input:  Customer financials and requested limit
    Action: LLM categorizes deal tier
    Output: { "category": "HIGH_LIMIT", "confidence": 0.96 }
       │
       ▼
[4. Condition Rule]
    Input:  credit_limit_requested = 150000
    Action: Compares: credit_limit > 100000 ?
    Output: { "selected_branch": "true" }
       │
       ▼
[5. Human Approval]
    Input:  Snapshot of customer data + AI rating
    Action: PAUSES run until Manager clicks "Approve"
    Output: { "status": "APPROVED", "reviewed_by": "gopalmuri1919@gmail.com" }
       │
       ▼
[6. Mock CRM Entity]
    Input:  Approved customer data
    Action: Upserts Lead into CRM database
    Output: { "crm_id": "crm_lead_9f41b2e8", "status": "CREATED" }
       │
       ▼
[7. Slack Notification]
    Input:  CRM ID + Company Name + Approved Status
    Action: Posts formatted card to #sales-ops
    Output: { "delivered": true, "channel": "#sales-ops" }
```

---

## 4. Key Architectural Distinctions

### 1. Webhook Trigger vs. Manual Trigger
- **Webhook Trigger:** Runs automatically when an external third-party software makes an HTTP call. Used for production automation.
- **Manual Trigger:** Runs only when a human operator clicks the **"Run"** button in the FlowPilot UI. Used for testing and internal ad-hoc jobs.

### 2. Data Validation vs. AI Classification
- **Data Validation:** Rigid, deterministic checks (e.g., *"Is the email field present?"*). Takes 1 ms.
- **AI Classification:** Fuzzy, semantic understanding (e.g., *"What is the risk level of this customer's business model?"*). Uses an LLM.

### 3. AI Classification vs. Condition Rule
- **AI Classification:** Translates unstructured text into structured tags (`HIGH_RISK`, `LOW_RISK`). It **cannot** branch the workflow.
- **Condition Rule:** Reads those structured tags and actually splits the graph execution path into `true` or `false` branches.

### 4. Condition Rule vs. Human Approval
- **Condition Rule:** Fully automated software decision based on strict mathematical rules (evaluates in milliseconds).
- **Human Approval:** Halts the workflow and waits for a real person to review the case and make a discretionary judgment.

### 5. Mock CRM Entity vs. Slack Notification
- **Mock CRM Entity:** Updates a **system of record** (stores customer data, creates IDs).
- **Slack Notification:** Informs a **team of humans** in their daily chat application.

---

## 5. The Simple Mental Model

1. **TRIGGER** $\rightarrow$ *How does the workflow start?* (Webhook from outside or Manual "Run" from UI).
2. **PROCESS** $\rightarrow$ *Is the data complete?* (Data Validation checks required keys).
3. **AI** $\rightarrow$ *What does the AI understand?* (AI Classification assigns risk/lead tiers).
4. **DECISION** $\rightarrow$ *Which path should we take?* (Condition Rule evaluates `>` or `==`).
5. **GOVERNANCE** $\rightarrow$ *Does a human need to approve?* (Human Approval pauses for manager review).
6. **ACTION** $\rightarrow$ *What gets created?* (Mock CRM Entity creates customer record).
7. **NOTIFICATION** $\rightarrow$ *Who needs to know?* (Slack Notification posts confirmation to `#sales-ops`).
