import { apiRequest } from './apiClient';
import {
  AnalyticsOverviewResponse,
  SLAMonitoringResponse,
  SLAUpdateRequest,
  SLAVersionResponse,
  StepLatencyResponse,
  TimeSeriesResponse,
  WorkflowPerformanceResponse,
} from '../types/analytics';

export interface AnalyticsFilterOptions {
  workflowId?: string;
  range?: string;
  startTime?: string;
  endTime?: string;
}

export interface WorkflowPerformanceFilterOptions extends AnalyticsFilterOptions {
  sortBy?: 'executions' | 'failure_rate' | 'avg_duration' | 'breaches';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface StepLatencyFilterOptions extends AnalyticsFilterOptions {
  limit?: number;
  sortBy?: 'avg_latency' | 'p95_latency' | 'failure_rate' | 'execution_count';
}

/**
 * Converts a local date or date string into an exact UTC ISO-8601 string.
 */
export function toUtcIsoString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString();
}

/**
 * Formats a UTC ISO timestamp into a user-friendly browser-local datetime string.
 */
export function formatToLocalDateTime(utcIsoString: string): string {
  try {
    const d = new Date(utcIsoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return utcIsoString;
  }
}

/**
 * Formats milliseconds into human-readable duration (e.g. "124ms", "2.4s", "1m 12s").
 */
export function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Fetches executive KPI overview: volume counts, duration percentiles, and SLA compliance.
 */
export async function getAnalyticsOverview(
  organizationId: string,
  options: AnalyticsFilterOptions = {}
): Promise<AnalyticsOverviewResponse> {
  const params = new URLSearchParams();
  if (options.workflowId) params.append('workflow_id', options.workflowId);
  if (options.range) params.append('range', options.range);
  if (options.startTime) params.append('start_time', options.startTime);
  if (options.endTime) params.append('end_time', options.endTime);

  const endpoint = `/api/v1/organizations/${organizationId}/analytics/overview?${params.toString()}`;
  return apiRequest<AnalyticsOverviewResponse>(endpoint, { method: 'GET' });
}

/**
 * Fetches continuous zero-filled time series buckets for volume and latency trends.
 */
export async function getTimeSeries(
  organizationId: string,
  options: AnalyticsFilterOptions & { granularity?: string } = {}
): Promise<TimeSeriesResponse> {
  const params = new URLSearchParams();
  if (options.workflowId) params.append('workflow_id', options.workflowId);
  if (options.range) params.append('range', options.range);
  if (options.startTime) params.append('start_time', options.startTime);
  if (options.endTime) params.append('end_time', options.endTime);
  if (options.granularity) params.append('granularity', options.granularity);

  const endpoint = `/api/v1/organizations/${organizationId}/analytics/time-series?${params.toString()}`;
  return apiRequest<TimeSeriesResponse>(endpoint, { method: 'GET' });
}

/**
 * Fetches paginated per-workflow performance metrics and SLA compliance.
 */
export async function getWorkflowPerformance(
  organizationId: string,
  options: WorkflowPerformanceFilterOptions = {}
): Promise<WorkflowPerformanceResponse> {
  const params = new URLSearchParams({
    page: String(options.page || 1),
    page_size: String(options.pageSize || 20),
    sort_by: options.sortBy || 'executions',
    sort_order: options.sortOrder || 'desc',
  });
  if (options.range) params.append('range', options.range);
  if (options.startTime) params.append('start_time', options.startTime);
  if (options.endTime) params.append('end_time', options.endTime);

  const endpoint = `/api/v1/organizations/${organizationId}/analytics/workflows?${params.toString()}`;
  return apiRequest<WorkflowPerformanceResponse>(endpoint, { method: 'GET' });
}

/**
 * Fetches bounded step latency and failure metrics to identify bottlenecks (max 100).
 */
export async function getStepLatency(
  organizationId: string,
  options: StepLatencyFilterOptions = {}
): Promise<StepLatencyResponse> {
  const params = new URLSearchParams({
    limit: String(options.limit || 20),
    sort_by: options.sortBy || 'avg_latency',
  });
  if (options.workflowId) params.append('workflow_id', options.workflowId);
  if (options.range) params.append('range', options.range);
  if (options.startTime) params.append('start_time', options.startTime);
  if (options.endTime) params.append('end_time', options.endTime);

  const endpoint = `/api/v1/organizations/${organizationId}/analytics/steps?${params.toString()}`;
  return apiRequest<StepLatencyResponse>(endpoint, { method: 'GET' });
}

/**
 * Fetches organization and per-workflow SLA monitoring metrics.
 */
export async function getSLAMonitoring(
  organizationId: string,
  options: AnalyticsFilterOptions = {}
): Promise<SLAMonitoringResponse> {
  const params = new URLSearchParams();
  if (options.workflowId) params.append('workflow_id', options.workflowId);
  if (options.range) params.append('range', options.range);
  if (options.startTime) params.append('start_time', options.startTime);
  if (options.endTime) params.append('end_time', options.endTime);

  const endpoint = `/api/v1/organizations/${organizationId}/analytics/sla?${params.toString()}`;
  return apiRequest<SLAMonitoringResponse>(endpoint, { method: 'GET' });
}

/**
 * Configures SLA thresholds on a draft workflow version.
 */
export async function updateVersionSLA(
  organizationId: string,
  workflowId: string,
  versionId: string,
  payload: SLAUpdateRequest
): Promise<SLAVersionResponse> {
  const endpoint = `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions/${versionId}/sla`;
  return apiRequest<SLAVersionResponse>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
