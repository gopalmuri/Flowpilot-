export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export interface ApprovalRequest {
  id: string;
  organization_id: string;
  workflow_run_id: string;
  step_run_id: string;
  step_key: string;
  status: ApprovalStatus;
  required_role: string;
  assigned_to_user_id?: string | null;
  context_snapshot: Record<string, any>;
  requested_at: string;
  resolved_at?: string | null;
  resolved_by_user_id?: string | null;
  decision_comment?: string | null;
  expires_at?: string | null;
}

export interface ApprovalListResponse {
  items: ApprovalRequest[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApprovalDecisionPayload {
  comment?: string;
}
