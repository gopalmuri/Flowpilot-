export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export interface ApprovalRequest {
  id: string;
  organization_id: string;
  workflow_run_id: string;
  step_run_id?: string;
  step_id?: string;
  step_key: string;
  workflow_name?: string | null;
  status: ApprovalStatus;
  required_role: string | null;
  assigned_to_user_id?: string | null;
  context_snapshot: Record<string, any>;
  requested_at: string;
  resolved_at?: string | null;
  resolved_by_user_id?: string | null;
  decision_comment?: string | null;
  expires_at?: string | null;
  /** Set when the approval authorises an AI reply draft. */
  draft_id?: string | null;
  draft_status?: DraftStatus | null;
}

/** Approval exactly as the backend serialises it (see backend/app/schemas/approval.py). */
export interface ApprovalApiResponse {
  id: string;
  organization_id: string;
  workflow_run_id: string;
  step_id: string;
  status: ApprovalStatus;
  payload_snapshot?: Record<string, any>;
  reviewed_by?: string | null;
  comment?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string;
  time_remaining_seconds?: number | null;
  approver_role?: string | null;
  workflow_name?: string | null;
  step_key?: string | null;
  draft_id?: string | null;
  draft_status?: DraftStatus | null;
}

export interface ApprovalListApiResponse {
  items: ApprovalApiResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApprovalListResponse {
  items: ApprovalRequest[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApprovalDecisionPayload {
  comment?: string;
  /** Draft version the reviewer actually saw (required to approve a reply draft). */
  reviewed_version?: number;
  /** Reviewer-edited text; when present it becomes the approved version. */
  edited_content?: string;
}

/** Draft lifecycle as the backend reports it (see backend/app/services/inbound/drafts.py). */
export type DraftStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVISION_REQUESTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SENDING'
  | 'SENT'
  | 'SEND_FAILED';

export interface DraftVersion {
  version_number: number;
  author_type: 'AI' | 'HUMAN';
  author_user_id?: string | null;
  content: string;
  content_hash: string;
  created_at: string;
  is_approved: boolean;
}

export interface ReviewMessage {
  channel: string;
  sender_name?: string | null;
  sender_address?: string | null;
  subject?: string | null;
  text: string;
  received_at: string;
}

export interface ReviewAnalysis {
  category?: string | null;
  summary?: string | null;
  requirements: string[];
  missing_information: string[];
  urgency?: string | null;
  recommended_action?: string | null;
  confidence?: number | null;
  uncertainty_notes?: string | null;
  injection_suspected: boolean;
  needs_human_attention: boolean;
  risk_flags: string[];
  is_fallback: boolean;
  provider?: string | null;
  model?: string | null;
}

export interface ReviewDraft {
  id: string;
  status: DraftStatus;
  current_version: number;
  approved_version?: number | null;
  revision_instructions?: string | null;
  decision_comment?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  risk_flags: string[];
  versions: DraftVersion[];
}

export interface ApprovalReview {
  approval_id: string;
  approval_status: ApprovalStatus;
  is_reapproval: boolean;
  message?: ReviewMessage | null;
  analysis?: ReviewAnalysis | null;
  draft?: ReviewDraft | null;
  delivery?: DeliverySummary | null;
}

/** Outbound delivery of the approved text. SENT means the provider accepted it; it is not a delivery receipt. */
export type DeliveryStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT'
  | 'UNKNOWN_OUTCOME'
  | 'CANCELLED';

export interface DeliverySummary {
  id: string;
  status: DeliveryStatus;
  status_label: string;
  version_number: number;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at?: string | null;
  sent_at?: string | null;
  provider_message_id?: string | null;
  error?: { category?: string | null; code?: string | null; detail?: string | null } | null;
}
