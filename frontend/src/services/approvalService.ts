import { apiRequest } from './apiClient';
import {
  ApprovalDecisionPayload,
  ApprovalListResponse,
  ApprovalRequest,
  ApprovalStatus,
} from '../types/approval';

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
  return apiRequest<ApprovalListResponse>(endpoint, {
    method: 'GET',
  });
}

export async function getApproval(
  organizationId: string,
  approvalId: string
): Promise<ApprovalRequest> {
  const endpoint = `/api/v1/organizations/${organizationId}/approvals/${approvalId}`;
  return apiRequest<ApprovalRequest>(endpoint, {
    method: 'GET',
  });
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
