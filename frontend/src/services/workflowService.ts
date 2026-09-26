import { apiRequest } from './apiClient';
import {
  Workflow,
  WorkflowListResponse,
  WorkflowVersionSummary,
  WorkflowVersionDetail,
  WorkflowValidationResult,
  WorkflowCreateRequest,
  WorkflowUpdateRequest,
  WorkflowVersionUpdateRequest,
  WorkflowStatus,
} from '../types/workflow';

export async function listWorkflows(
  organizationId: string,
  options?: { page?: number; pageSize?: number; status?: WorkflowStatus | string } | number,
  pageSizeArg?: number,
  statusArg?: WorkflowStatus | string
): Promise<WorkflowListResponse> {
  let page = 1;
  let pageSize = 20;
  let status: string | undefined;

  if (typeof options === 'object' && options !== null) {
    page = options.page ?? 1;
    pageSize = options.pageSize ?? 20;
    status = options.status;
  } else if (typeof options === 'number') {
    page = options;
    pageSize = pageSizeArg ?? 20;
    status = statusArg;
  }

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (status) params.append('status', status);

  const endpoint = `/api/v1/organizations/${organizationId}/workflows?${params.toString()}`;
  return apiRequest<WorkflowListResponse>(endpoint, {
    method: 'GET',
  });
}

export async function getWorkflow(
  organizationId: string,
  workflowId: string
): Promise<Workflow> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}`;
  return apiRequest<Workflow>(endpoint, {
    method: 'GET',
  });
}

export async function createWorkflow(
  organizationId: string,
  payload: WorkflowCreateRequest
): Promise<Workflow> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows`;
  return apiRequest<Workflow>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateWorkflow(
  organizationId: string,
  workflowId: string,
  payload: WorkflowUpdateRequest
): Promise<Workflow> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}`;
  return apiRequest<Workflow>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteWorkflow(
  organizationId: string,
  workflowId: string
): Promise<void> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}`;
  return apiRequest<void>(endpoint, {
    method: 'DELETE',
  });
}

export async function enableWorkflow(
  organizationId: string,
  workflowId: string
): Promise<Workflow> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/enable`;
  return apiRequest<Workflow>(endpoint, {
    method: 'POST',
  });
}

export async function disableWorkflow(
  organizationId: string,
  workflowId: string
): Promise<Workflow> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/disable`;
  return apiRequest<Workflow>(endpoint, {
    method: 'POST',
  });
}

export async function archiveWorkflow(
  organizationId: string,
  workflowId: string
): Promise<Workflow> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/archive`;
  return apiRequest<Workflow>(endpoint, {
    method: 'POST',
  });
}

export async function listWorkflowVersions(
  organizationId: string,
  workflowId: string
): Promise<WorkflowVersionSummary[]> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions`;
  return apiRequest<WorkflowVersionSummary[]>(endpoint, {
    method: 'GET',
  });
}

export async function getWorkflowVersion(
  organizationId: string,
  workflowId: string,
  versionId: string
): Promise<WorkflowVersionDetail> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions/${versionId}`;
  return apiRequest<WorkflowVersionDetail>(endpoint, {
    method: 'GET',
  });
}

export async function createWorkflowVersion(
  organizationId: string,
  workflowId: string,
  baseVersionId?: string
): Promise<WorkflowVersionSummary> {
  const params = baseVersionId ? `?base_version_id=${baseVersionId}` : '';
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions${params}`;
  return apiRequest<WorkflowVersionSummary>(endpoint, {
    method: 'POST',
  });
}

export async function updateWorkflowVersion(
  organizationId: string,
  workflowId: string,
  versionId: string,
  payload: WorkflowVersionUpdateRequest
): Promise<WorkflowVersionDetail> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions/${versionId}`;
  return apiRequest<WorkflowVersionDetail>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function validateWorkflowVersion(
  organizationId: string,
  workflowId: string,
  versionId: string
): Promise<WorkflowValidationResult> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions/${versionId}/validate`;
  return apiRequest<WorkflowValidationResult>(endpoint, {
    method: 'POST',
  });
}

export async function publishWorkflowVersion(
  organizationId: string,
  workflowId: string,
  versionId: string
): Promise<WorkflowVersionSummary> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions/${versionId}/publish`;
  return apiRequest<WorkflowVersionSummary>(endpoint, {
    method: 'POST',
  });
}
