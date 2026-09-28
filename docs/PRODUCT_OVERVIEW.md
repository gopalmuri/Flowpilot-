# FlowPilot — Product Overview

> **B2B Workflow Orchestration Control Plane**  
> *Release Candidate (RC-1.0) Product Specification*

---

## 1. Product Mission & Value Proposition

FlowPilot bridges the operational gap between **automation velocity** and **enterprise safety**. While legacy automation tools break on unstructured requests and experimental AI agents pose severe financial and legal liabilities, FlowPilot provides a unified control plane where modern AI is harnessed for semantic understanding while deterministic business rules and human approvers govern all mutating actions.

### Core Problems Solved

1. **Elimination of Fragmented Manual Handoffs**: Automatically ingests requests from webhooks, forms, and APIs, ending the practice of copy-pasting customer requests between spreadsheets and chat threads.
2. **Deterministic Governance over AI**: Strictly bounds LLM outputs into structured JSON contracts evaluated against deterministic code. AI models never execute downstream actions directly.
3. **Guaranteed SLA Adherence**: Embeds countdown timers, warning thresholds, and automated escalation paths directly into the workflow lifecycle.
4. **Complete Execution Auditability**: Maintains tamper-evident SHA-256 audit trails for compliance auditors, incident investigators, and executive stakeholders.

---

## 2. Core Product Modules

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FLOWPILOT CONTROL PLANE                         │
├─────────────────────┬─────────────────────┬────────────────────────────┤
│  WORKFLOW BUILDER   │   AI & RULE ENGINE  │    HUMAN APPROVAL GATE     │
│  - Visual Canvas    │  - Semantic Parsing │   - Role-Based Sign-off    │
│  - Versioned DAGs   │  - JSON Schema      │   - SLA Countdown Window   │
│  - SLA Thresholds   │  - Deterministic IF │   - Contextual Metadata    │
├─────────────────────┼─────────────────────┼────────────────────────────┤
│ INTEGRATION HUB     │ TELEMETRY & RUNS    │    AUDIT & GOVERNANCE      │
│  - Slack Dispatch   │  - Step Latencies   │   - SHA-256 Hash Chain     │
│  - Mock CRM Sync    │  - Correlation IDs  │   - Tenant Isolation       │
│  - Secure Webhooks  │  - Real-Time Logs   │   - Strict Granular RBAC   │
└─────────────────────┴─────────────────────┴────────────────────────────┘
```

### Module 1: Versioned Workflow Builder & Catalog
- **Catalog Management**: Filter and organize workflows by status (`ACTIVE`, `DRAFT`, `ARCHIVED`).
- **Immutable Versioning**: Published versions are permanently frozen to ensure runtime predictability. Edits occur on isolated `DRAFT` versions.
- **DAG Validator**: Verifies graph integrity, cycle absence, trigger placement, and step parameter completeness before publication is permitted.

### Module 2: Bounded AI Classification Engine
- **Pluggable Architecture**: Supports OpenAI (`gpt-4o`, `gpt-4o-mini`), Anthropic (`claude-3-5-sonnet`), and internal zero-latency Mock AI providers for deterministic testing.
- **Structured Extraction**: Transforms free-form email, ticket, or webhook text into typed parameters (deal size, seat count, compliance level, urgency).
- **Confidence Scoring**: Emits confidence certainty scores (`0.00` to `1.00`). Low confidence triggers automated fallback branches.

### Module 3: Deterministic Rule Evaluator
- **Zero-Bias Logic**: Evaluates explicit conditions (`equals`, `not_equals`, `greater_than`, `less_than`, `contains`, `in_list`) against extracted parameters.
- **Compound Logic**: Supports nested `AND` / `OR` condition blocks.
- **Branch Determinism**: Calculates the exact path with zero probabilistic drift.

### Module 4: Human-in-the-Loop Approval Inbox
- **Approval Queue**: Centralized operational inbox displaying pending requests awaiting sign-off.
- **Role Assignment**: Enforces approvals by authorized roles (e.g., `OWNER`, `ADMIN`, `MANAGER`).
- **Dual-State Resolution**: Approvers inspect full payload context, record review comments, and execute either `APPROVE` (resumes workflow) or `REJECT` (terminates execution with failure audit).

### Module 5: Integration Connectors
- **Mock CRM Service**: Simulates enterprise CRM operations (Lead creation, Opportunity creation, Customer status mutation) with realistic latency and error simulation.
- **Slack Notification Service**: Formats and dispatches operational alert cards with contextual run badges and direct dashboard deep-links.
- **Authenticated Webhook Egress**: Emits cryptographically signed HMAC payloads to external enterprise endpoints.

### Module 6: Live Execution Telemetry & Diagnostics
- **Step-by-Step Visualization**: Follows workflow runs from `PENDING` $\rightarrow$ `RUNNING` $\rightarrow$ `PAUSED` $\rightarrow$ `COMPLETED` / `FAILED`.
- **Latency Breakdown**: Measures millisecond execution duration for individual steps to identify operational bottlenecks.
- **Payload Inspection**: Allows operators to inspect step inputs and outputs with sensitive token masking.

### Module 7: SLA Monitoring & Analytics Dashboard
- **Volume Metrics**: Total executions, success rates, failure rates, and active queues.
- **Latency Percentiles**: Tracks P50, P95, and P99 latency percentiles over 24-hour, 7-day, and 30-day windows.
- **SLA Breach Monitoring**: Flags runs exceeding warning thresholds (e.g. 75% of target window) or full SLA breaches.

### Module 8: Audit Ledger & Security Controls
- **Append-Only Event Ledger**: Records every mutating system event with timestamp, actor UUID, IP address, and cryptographic signature.
- **Multi-Tenant Boundaries**: Every database query is strictly scoped by tenant organization ID.
