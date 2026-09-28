# FlowPilot — Workflow Orchestration Engine

> **Execution Engine, DAG Traversal, and State Machine Specification**  
> *Release Candidate (RC-1.0) Engineering Guide*

---

## 1. Engine Core Principles

The FlowPilot Workflow Engine executes versioned Directed Acyclic Graphs (DAGs) with strict idempotency and transactional state transitions.

Key design guarantees:
1. **Zero Uncontrolled Concurrency**: Steps execute strictly in topological dependency order.
2. **Deterministic Branching**: Edge evaluation is binary and deterministic based on upstream outputs.
3. **Pausable State Machine**: When a node requiring human authorization is encountered, execution suspends, records checkpoint data, and gracefully releases worker threads.
4. **Idempotent Step Handlers**: Step runners are designed to be safely replayable without side-effect duplication.

---

## 2. Supported Step Types

| Step Type Enum | Category | Execution Behavior | Output Schema |
| :--- | :--- | :--- | :--- |
| `WEBHOOK_TRIGGER` | Ingest | Accepts JSON payload from verified HTTP POST | Full inbound JSON payload |
| `AI_CLASSIFICATION`| Parse | Calls configured LLM provider to extract structured categories | `{ category, confidence, entities: {} }` |
| `CONDITION` | Logic | Evaluates boolean expression against upstream context | `{ result: boolean, matched_branch: str }` |
| `HUMAN_APPROVAL` | Gate | Halts workflow run; creates pending approval entity | `{ status: "APPROVED"\|"REJECTED", note }` |
| `MOCK_CRM_CREATE` | Mutation| Simulates CRM entity creation (Lead, Opp, Contact) | `{ crm_id, entity_type, status: "created" }` |
| `SLACK_NOTIFICATION`| Egress| Dispatches formatted Slack notification block | `{ delivered: true, channel, timestamp }` |
| `HTTP_REQUEST` | Egress | Dispatches authenticated HTTP POST to external API | `{ status_code, response_body }` |

---

## 3. Condition Evaluation Grammar

The condition evaluation engine (`app/engine/condition_evaluator.py`) supports explicit parameter pathing using dot-notation:

```json
{
  "logic": "AND",
  "conditions": [
    {
      "field": "ai_classify.category",
      "operator": "equals",
      "value": "enterprise"
    },
    {
      "field": "ai_classify.entities.seats",
      "operator": "greater_or_equal",
      "value": 250
    },
    {
      "field": "webhook_inbound.deal_value",
      "operator": "greater_than",
      "value": 25000
    }
  ]
}
```

### Supported Operators:
- `equals` / `not_equals`: String, numeric, or boolean strict equality.
- `greater_than` / `greater_or_equal`: Numeric comparisons.
- `less_than` / `less_or_equal`: Numeric comparisons.
- `contains`: Substring inclusion check in string or array.
- `in_list`: Value membership in an array of literals.

---

## 4. Workflow Run State Machine

```
               [Trigger Received]
                       │
                       ▼
                 ┌───────────┐
                 │  PENDING  │
                 └─────┬─────┘
                       │ Celery Task Picked Up
                       ▼
                 ┌───────────┐
                 │  RUNNING  │◄──────────────────┐
                 └─────┬─────┘                   │
                       │                         │
         ┌─────────────┴─────────────┐           │
         │                           │           │
         │ Human Approval Step       │ Error     │ Approver Clicks
         ▼                           ▼           │ "APPROVE"
   ┌───────────┐               ┌───────────┐     │
   │  PAUSED   │               │  FAILED   │     │
   │ (WAITING) │               └───────────┘     │
   └─────┬─────┘                                 │
         │                                       │
         ├───────────────────────────────────────┘
         │
         │ Approver Clicks "REJECT" or Timeout
         ▼
   ┌───────────┐
   │ TERMINAL  │ ──► [Run Marked FAILED / REJECTED]
   └───────────┘
         │
         ▼
   ┌───────────┐
   │ COMPLETED │ (All steps finished successfully)
   └───────────┘
```

---

## 5. DAG Validation Rules

Before a workflow draft can be published via `POST /versions/{id}/publish`, the DAG validator enforces:
1. **Single Trigger**: Must contain exactly one `WEBHOOK_TRIGGER` node.
2. **Acyclicity Check**: Depth-First Search (DFS) ensures the graph contains zero cyclic loops.
3. **No Dangling Nodes**: Every non-trigger step must have at least one incoming connection.
4. **Conditional Edge Completeness**: Condition nodes must define outbound edges for both `true` and `false` evaluations.
5. **Approval Edge Resolution**: Human approval nodes must define paths for both `approved` and `rejected` resolution states.
