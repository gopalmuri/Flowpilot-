import { apiRequest } from './apiClient';
import {
  ApprovalApiResponse,
  ApprovalDecisionPayload,
  ApprovalListApiResponse,
  ApprovalListResponse,
  ApprovalRequest,
  ApprovalReview,
  ApprovalStatus,
} from '../types/approval';

/**
 * Maps the backend approval payload onto the shape the UI consumes.
 * Keeping this in one place means components never depend on raw API field names.
 */
export function normalizeApproval(raw: ApprovalApiResponse): ApprovalRequest {
  const expiresAt =
    typeof raw.time_remaining_seconds === 'number'
      ? new Date(Date.now() + raw.time_remaining_seconds * 1000).toISOString()
      : null;

  return {
    id: raw.id,
    organization_id: raw.organization_id,
    workflow_run_id: raw.workflow_run_id,
    step_id: raw.step_id,
    step_key: raw.step_key || raw.payload_snapshot?.step_key || 'approval',
    workflow_name: raw.workflow_name ?? null,
    status: raw.status,
    required_role: raw.approver_role ?? null,
    context_snapshot: raw.payload_snapshot ?? {},
    requested_at: raw.created_at,
    resolved_at: raw.resolved_at ?? null,
    resolved_by_user_id: raw.reviewed_by ?? null,
    decision_comment: raw.comment ?? null,
    expires_at: expiresAt,
    draft_id: raw.draft_id ?? null,
    draft_status: raw.draft_status ?? null,
  };
}

export async function listApprovals(
  organizationId: string,
  status?: ApprovalStatus,
  page: number = 1,
  pageSize: number = 20
): Promise<ApprovalListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  if (status) {
    params.append('status', status);
  }

  const endpoint = `/api/v1/organizations/${organizationId}/approvals?${params.toString()}`;
  const raw = await apiRequest<ApprovalListApiResponse>(endpoint, {
    method: 'GET',
  });
  return { ...raw, items: (raw.items || []).map(normalizeApproval) };
}

export async function getApproval(
  organizationId: string,
  approvalId: string
): Promise<ApprovalRequest> {
  const endpoint = `/api/v1/organizations/${organizationId}/approvals/${approvalId}`;
  return normalizeApproval(
    await apiRequest<ApprovalApiResponse>(endpoint, {
      method: 'GET',
    })
  );
}

export async function approveRequest(
  organizationId: string,
  approvalId: string,
  payload?: ApprovalDecisionPayload
): Promise<ApprovalRequest> {
  const endpoint = `/api/v1/organizations/${organizationId}/approvals/${approvalId}/approve`;
  return apiRequest<ApprovalRequest>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export async function rejectRequest(
  organizationId: string,
  approvalId: string,
  payload?: ApprovalDecisionPayload
): Promise<ApprovalRequest> {
  const endpoint = `/api/v1/organizations/${organizationId}/approvals/${approvalId}/reject`;
  return apiRequest<ApprovalRequest>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

const approvalBase = (organizationId: string, approvalId: string) =>
  `/api/v1/organizations/${organizationId}/approvals/${approvalId}`;

/** Everything a reviewer needs: original message, AI analysis and the versioned reply draft. */
export async function getApprovalReview(
  organizationId: string,
  approvalId: string
): Promise<ApprovalReview> {
  return apiRequest<ApprovalReview>(`${approvalBase(organizationId, approvalId)}/review`, {
    method: 'GET',
  });
}

/** Saves a manager edit as a new draft version. Editing an approved draft invalidates its approval. */
export async function saveDraftEdit(
  organizationId: string,
  approvalId: string,
  content: string,
  reviewedVersion: number
): Promise<ApprovalReview> {
  return apiRequest<ApprovalReview>(`${approvalBase(organizationId, approvalId)}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content, reviewed_version: reviewedVersion }),
  });
}

export async function requestDraftRevision(
  organizationId: string,
  approvalId: string,
  instructions: string
): Promise<ApprovalReview> {
  return apiRequest<ApprovalReview>(`${approvalBase(organizationId, approvalId)}/request-revision`, {
    method: 'POST',
    body: JSON.stringify({ instructions }),
  });
}

export async function regenerateDraft(
  organizationId: string,
  approvalId: string,
  reviewedVersion: number
): Promise<ApprovalReview> {
  return apiRequest<ApprovalReview>(`${approvalBase(organizationId, approvalId)}/draft/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ reviewed_version: reviewedVersion }),
  });
}
