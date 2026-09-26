export type WorkflowRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PAUSED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkflowStepRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export interface WorkflowStepRun {
  id: string;
  workflow_run_id: string;
  step_id: string;
  step_key?: string;
  step_type?: string;
  status: WorkflowStepRunStatus;
  input_data?: Record<string, any>;
  output_data?: Record<string, any>;
  error_message?: string | null;
  execution_time_ms?: number | null;
  started_at: string;
  completed_at?: string | null;
}

export interface ExecutionApprovalSummary {
  id: string;
  workflow_run_id: string;
  step_id: string;
  status: string;
  reviewed_by?: string | null;
  reviewer_email?: string | null;
  reviewer_name?: string | null;
  comment?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface WorkflowRun {
  id: string;
  organization_id: string;
  workflow_id: string;
  workflow_version_id: string;
  workflow_name?: string | null;
  status: WorkflowRunStatus;
  trigger_type: string;
  trigger_payload: Record<string, any>;
  correlation_id: string;
  error_message?: string | null;
  duration_ms?: number | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunDetail extends WorkflowRun {
  step_runs: WorkflowStepRun[];
  approvals: ExecutionApprovalSummary[];
}

export interface WorkflowRunListResponse {
  items: WorkflowRun[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
