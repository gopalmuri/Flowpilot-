import { apiRequest } from './apiClient';
import {
  WorkflowRunDetail,
  WorkflowRunListResponse,
  WorkflowRunStatus,
  WorkflowRun,
} from '../types/execution';

export interface ExecutionFilterOptions {
  status?: WorkflowRunStatus;
  workflowId?: string;
  triggerType?: string;
  correlationId?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export async function listExecutions(
  organizationId: string,
  statusOrOptions?: WorkflowRunStatus | ExecutionFilterOptions,
  page: number = 1,
  pageSize: number = 20
): Promise<WorkflowRunListResponse> {
  const params = new URLSearchParams();

  if (typeof statusOrOptions === 'object' && statusOrOptions !== null) {
    const opts = statusOrOptions as ExecutionFilterOptions;
    params.append('page', String(opts.page || 1));
    params.append('page_size', String(opts.pageSize || 20));
    if (opts.status) params.append('status', opts.status);
    if (opts.workflowId) params.append('workflow_id', opts.workflowId);
    if (opts.triggerType) params.append('trigger_type', opts.triggerType);
    if (opts.correlationId) params.append('correlation_id', opts.correlationId);
    if (opts.search) params.append('search', opts.search);
    if (opts.fromDate) params.append('from_date', opts.fromDate);
    if (opts.toDate) params.append('to_date', opts.toDate);
  } else {
    params.append('page', String(page));
    params.append('page_size', String(pageSize));
    if (statusOrOptions) {
      params.append('status', statusOrOptions);
    }
  }

  const endpoint = `/api/v1/organizations/${organizationId}/runs?${params.toString()}`;
  return apiRequest<WorkflowRunListResponse>(endpoint, {
    method: 'GET',
  });
}

export async function getExecutionDetail(
  organizationId: string,
  runId: string
): Promise<WorkflowRunDetail> {
  const endpoint = `/api/v1/organizations/${organizationId}/runs/${runId}`;
  return apiRequest<WorkflowRunDetail>(endpoint, {
    method: 'GET',
  });
}

export async function cancelExecution(
  organizationId: string,
  runId: string
): Promise<WorkflowRun> {
  const endpoint = `/api/v1/organizations/${organizationId}/runs/${runId}/cancel`;
  return apiRequest<WorkflowRun>(endpoint, {
    method: 'POST',
  });
}

export async function triggerExecution(
  organizationId: string,
  workflowId: string,
  triggerPayload: Record<string, any> = {},
  asyncDispatch: boolean = true
): Promise<WorkflowRunDetail> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/runs?async_dispatch=${asyncDispatch}`;
  return apiRequest<WorkflowRunDetail>(endpoint, {
    method: 'POST',
    body: JSON.stringify({ trigger_payload: triggerPayload }),
  });
}
