import { apiRequest } from './apiClient';
import type {
  AIBuilderCreateRequest,
  AIBuilderCreateResponse,
  AICatalogStep,
  AIRunExplainResponse,
  AISuggestionsResponse,
  AIWorkflowAssistRequest,
  AIWorkflowAssistResponse,
  AIWorkflowProposal,
  AIWorkflowTemplate,
} from '../types/workflowAI';
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
  // The backend reads base_version_id from the JSON body (WorkflowVersionCreateRequest).
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions`;
  return apiRequest<WorkflowVersionSummary>(endpoint, {
    method: 'POST',
    body: JSON.stringify(baseVersionId ? { base_version_id: baseVersionId } : {}),
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

export async function assistWorkflowWithAI(
  organizationId: string,
  workflowId: string,
  payload: import('../types/workflowAI').AIWorkflowAssistRequest,
  signal?: AbortSignal
): Promise<import('../types/workflowAI').AIWorkflowAssistResponse> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/ai-assist`;
  return apiRequest<import('../types/workflowAI').AIWorkflowAssistResponse>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function simulatePayloadWithAI(
  organizationId: string,
  workflowId: string,
  payload: import('../types/workflowAI').AISimulatePayloadRequest,
  signal?: AbortSignal
): Promise<import('../types/workflowAI').AISimulatePayloadResponse> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/ai-simulate-payload`;
  return apiRequest<import('../types/workflowAI').AISimulatePayloadResponse>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function simulateWorkflowRunWithAI(
  organizationId: string,
  workflowId: string,
  payload: import('../types/workflowAI').AISimulateExecutionRequest,
  signal?: AbortSignal
): Promise<import('../types/workflowAI').AISimulateExecutionResponse> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/ai-simulate-run`;
  return apiRequest<import('../types/workflowAI').AISimulateExecutionResponse>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

const orgWorkflowsBase = (organizationId: string) => `/api/v1/organizations/${organizationId}/workflows`;

export async function getAICatalog(organizationId: string): Promise<AICatalogStep[]> {
  return apiRequest<AICatalogStep[]>(`${orgWorkflowsBase(organizationId)}/catalog`, { method: 'GET' });
}

export async function getAITemplates(organizationId: string): Promise<AIWorkflowTemplate[]> {
  return apiRequest<AIWorkflowTemplate[]>(`${orgWorkflowsBase(organizationId)}/templates`, { method: 'GET' });
}

export async function buildWorkflowWithAI(
  organizationId: string,
  payload: AIWorkflowAssistRequest,
  signal?: AbortSignal
): Promise<AIWorkflowAssistResponse> {
  return apiRequest<AIWorkflowAssistResponse>(`${orgWorkflowsBase(organizationId)}/ai-builder`, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function createDraftFromAIProposal(
  organizationId: string,
  payload: AIBuilderCreateRequest
): Promise<AIBuilderCreateResponse> {
  return apiRequest<AIBuilderCreateResponse>(`${orgWorkflowsBase(organizationId)}/ai-builder/create`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function explainRunWithAI(
  organizationId: string,
  workflowId: string,
  runId: string
): Promise<AIRunExplainResponse> {
  return apiRequest<AIRunExplainResponse>(
    `${orgWorkflowsBase(organizationId)}/${workflowId}/runs/${runId}/ai-explain`,
    { method: 'POST' }
  );
}

export async function getAISuggestions(
  organizationId: string,
  workflowId: string
): Promise<AISuggestionsResponse> {
  return apiRequest<AISuggestionsResponse>(`${orgWorkflowsBase(organizationId)}/${workflowId}/ai-suggestions`, {
    method: 'POST',
  });
}

/**
 * Applies an AI proposal as a NEW draft version cloned from `baseVersionId`.
 * Published/active versions are never edited in place.
 */
export async function applyProposalAsNewDraft(
  organizationId: string,
  workflowId: string,
  baseVersionId: string | null | undefined,
  proposal: AIWorkflowProposal
): Promise<WorkflowVersionDetail> {
  const draft = await createWorkflowVersion(organizationId, workflowId, baseVersionId ?? undefined);
  return updateWorkflowVersion(organizationId, workflowId, draft.id, {
    steps: proposal.steps,
    connections: proposal.connections,
  });
}
