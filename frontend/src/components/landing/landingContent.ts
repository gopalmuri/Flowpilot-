/**
 * Copy and data for the landing page. Every capability listed in ARCHITECTURE / OBSERVABILITY / GOVERNANCE carries a
 * status and the backend evidence behind it. Anything not implemented is marked 'planned' and rendered as such.
 */

export const NAV_LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Observability', href: '#observability' },
] as const;

export const ANCHOR_IDS = ['product', 'how-it-works', 'architecture', 'observability'] as const;

export type CapabilityStatus = 'available' | 'planned';

export interface Capability {
  name: string;
  detail: string;
  status: CapabilityStatus;
}

/* ---------------------------- Hero lifecycle demo --------------------------- */

export type StageId = 'request' | 'validate' | 'classify' | 'rules' | 'approve' | 'execute' | 'audit';

export interface LifecycleStage {
  id: StageId;
  name: string;
  kind: string;
  detail: string;
}

export const DEMO_SCENARIO = 'High-risk refund request (sample data)';
export const DEMO_TRACE_REF = 'demo-trace-0001';

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    id: 'request',
    name: 'Request',
    kind: 'Intake',
    detail: 'A sample refund request of $4,800 for order A-1042 arrives and a trace reference is attached to it.',
  },
  {
    id: 'validate',
    name: 'Validate',
    kind: 'Data check',
    detail: 'Required fields (customer, order, amount) are checked before anything else runs.',
  },
  {
    id: 'classify',
    name: 'AI Classify',
    kind: 'AI-assisted',
    detail: 'AI suggests a category, "refund exception". It recommends. It does not approve or execute anything.',
  },
  {
    id: 'rules',
    name: 'Apply Rules',
    kind: 'Deterministic',
    detail: 'A configured rule compares the amount with the refund limit. The result is fixed by the rule, not by AI.',
  },
  {
    id: 'approve',
    name: 'Approve',
    kind: 'Human decision',
    detail: 'The request is routed to a person. The workflow pauses here until a decision is recorded.',
  },
  {
    id: 'execute',
    name: 'Execute',
    kind: 'Action',
    detail: 'Only after approval does the refund action run, and its outcome is recorded.',
  },
  {
    id: 'audit',
    name: 'Audit',
    kind: 'Record',
    detail: 'The decision, who made it and every step transition are written to the audit trail.',
  },
];

/* ------------------------------ Problem section ----------------------------- */

export const PROBLEMS = [
  {
    key: 'handoffs',
    title: 'Manual Handoffs',
    body: 'Requests move between teams and applications, creating delays and inconsistent follow-through.',
  },
  {
    key: 'bottlenecks',
    title: 'Decision Bottlenecks',
    body: 'Business rules, AI recommendations, and approval requirements need a clear and consistent execution path.',
  },
  {
    key: 'visibility',
    title: 'Limited Execution Visibility',
    body: 'Teams need traceable decisions, execution status, and evidence of what happened at every step.',
  },
] as const;

/* ------------------------------ Product examples ---------------------------- */

export interface ProductExample {
  id: string;
  tab: string;
  problem: string;
  steps: string[];
  outcome: string;
}

export const EXAMPLES: ProductExample[] = [
  {
    id: 'lead',
    tab: 'Enterprise Lead Intake',
    problem: 'New leads arrive from several places, and the right sales team rarely sees them in time.',
    steps: [
      'Receive a new lead',
      'Classify company size',
      'Apply routing rules',
      'Notify the appropriate sales team',
    ],
    outcome: 'Every lead reaches the right team through the same rules, with a record of how it was routed.',
  },
  {
    id: 'refund',
    tab: 'High-Risk Refund Exception',
    problem: 'Refunds outside policy get decided in chat threads, with no consistent evidence of why.',
    steps: [
      'Receive a refund request',
      'Evaluate policy and risk conditions',
      'Route exceptions for human approval',
      'Record the decision and outcome',
    ],
    outcome: 'Exceptions get a human decision, and the decision and its outcome are on the record.',
  },
  {
    id: 'access',
    tab: 'Production Access Escalation',
    problem: 'Urgent access requests tempt teams to skip checks, and nobody can later show who approved what.',
    steps: [
      'Receive an access request',
      'Validate requester permissions',
      'Require the appropriate approval',
      'Record the execution and audit trail',
    ],
    outcome: 'Access is granted only after the required approval, with the execution and audit trail recorded.',
  },
];

/* -------------------------------- Orchestration ----------------------------- */

export const ORCHESTRATION = [
  { n: 1, title: 'Request', body: 'Capture an incoming business request.' },
  { n: 2, title: 'Understand', body: 'Validate inputs and extract relevant information.' },
  { n: 3, title: 'Decide', body: 'Apply AI-assisted classification and deterministic business rules.' },
  { n: 4, title: 'Control', body: 'Enforce permissions, approvals, and governance policies.' },
  { n: 5, title: 'Execute', body: 'Run approved actions and record the outcome.' },
] as const;

/* ---------------------------------- Architecture ---------------------------- */
/* Evidence (backend): AI_CLASSIFICATION, AI_EXTRACT_DATA, AI_ANALYZE_MESSAGE step executors in app/engine/executors.py;
   CONDITION executor + condition_evaluator.py; require_role in app/api/deps.py; HUMAN_APPROVAL + approvals router;
   idempotent webhook intake + recovery.py; AuditLog model. No context-enrichment step exists. */

export const AI_LAYER: Capability[] = [
  { name: 'Classification', detail: 'Suggests a category for a request.', status: 'available' },
  { name: 'Entity extraction', detail: 'Pulls named fields out of free text.', status: 'available' },
  { name: 'Intent interpretation', detail: 'Analyses inbound messages into a summary, category and urgency.', status: 'available' },
  { name: 'Context enrichment', detail: 'Adding outside context to a request.', status: 'planned' },
];

export const CONTROL_LAYER: Capability[] = [
  { name: 'Business rules', detail: 'Configured conditions decide the route.', status: 'available' },
  { name: 'Permissions', detail: 'Role-based access on who may do what.', status: 'available' },
  { name: 'Approval steps', detail: 'Workflows pause for a human decision.', status: 'available' },
  { name: 'Execution controls', detail: 'Duplicate webhook requests are not run twice, and stalled approvals are recovered.', status: 'available' },
  { name: 'Audit records', detail: 'Actions are written to an audit log.', status: 'available' },
];

/* ------------------------- Observability and governance --------------------- */
/* Evidence: correlation_id + WorkflowRun/WorkflowStepRun (status, input/output, error_message, execution_time_ms) in
   app/models/workflow_run.py; Celery retry_backoff on run/resume/webhook tasks and outbound delivery retries in
   app/workers/tasks.py + app/models/outbound.py; org-scoped queries (organization_id) throughout engine and routers;
   require_role (app/api/deps.py); PAUSED step runs until approval (workflow_engine.py); AuditLog model. */

export const OBSERVABILITY_ITEMS: Capability[] = [
  { name: 'Execution traceability', detail: 'Each run carries a correlation id.', status: 'available' },
  { name: 'Step transition history', detail: 'Every step run keeps its status and timing.', status: 'available' },
  { name: 'Execution status', detail: 'Runs and steps show running, paused, failed or completed.', status: 'available' },
  { name: 'Errors and retries', detail: 'Failed steps keep their error. Background tasks and outbound deliveries retry with backoff.', status: 'available' },
  { name: 'Structured execution records', detail: 'Step inputs and outputs are stored as structured data.', status: 'available' },
];

export const GOVERNANCE_ITEMS: Capability[] = [
  { name: 'Tenant isolation', detail: 'Workflows, runs and approvals are scoped to an organization.', status: 'available' },
  { name: 'Role-based access control', detail: 'Owner, admin, manager, operator and viewer roles.', status: 'available' },
  { name: 'Approval enforcement', detail: 'A run stays paused until the approval is decided.', status: 'available' },
  { name: 'Deterministic execution', detail: 'Steps follow the workflow graph and its configured rules.', status: 'available' },
  { name: 'Audit logging', detail: 'Who did what, and to which resource, is recorded.', status: 'available' },
];

export interface TimelineEvent {
  id: string;
  title: string;
  status: 'ok' | 'pause' | 'bad';
  statusLabel: string;
  detail: string;
  fields: [string, string][];
}

export const TIMELINE_EVENTS: TimelineEvent[] = [
  {
    id: 'received',
    title: 'Request received',
    status: 'ok',
    statusLabel: 'Completed',
    detail: 'The trigger step accepted the request and started a run.',
    fields: [['Correlation id', 'demo-trace-0001'], ['Step', 'Trigger']],
  },
  {
    id: 'validated',
    title: 'Input validated',
    status: 'ok',
    statusLabel: 'Completed',
    detail: 'Required fields were present, so the run continued.',
    fields: [['Step', 'Validate data'], ['Input', 'customer, order, amount']],
  },
  {
    id: 'classified',
    title: 'AI classification',
    status: 'ok',
    statusLabel: 'Completed',
    detail: 'AI returned a suggested category. The output is stored with the step run.',
    fields: [['Step', 'AI classification'], ['Output', 'category: refund exception']],
  },
  {
    id: 'rule',
    title: 'Rule evaluated',
    status: 'ok',
    statusLabel: 'Completed',
    detail: 'The amount exceeded the configured limit, so the approval branch was taken.',
    fields: [['Step', 'Condition'], ['Result', 'approval required']],
  },
  {
    id: 'approval',
    title: 'Awaiting approval',
    status: 'pause',
    statusLabel: 'Paused',
    detail: 'The run is paused. Nothing after this step runs until a person decides.',
    fields: [['Step', 'Human approval'], ['Run status', 'paused']],
  },
  {
    id: 'decision',
    title: 'Decision recorded',
    status: 'ok',
    statusLabel: 'Completed',
    detail: 'The decision was recorded in the audit log and the run resumed.',
    fields: [['Audit action', 'approval decided'], ['Resource', 'approval request']],
  },
];

/* ---------------------------------- Footer ---------------------------------- */

export const FOOTER_PRODUCT_LINKS = [
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Observability', href: '#observability' },
] as const;
