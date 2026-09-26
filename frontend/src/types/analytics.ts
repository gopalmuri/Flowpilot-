export interface SLAConfig {
  target_seconds: number;
  warning_threshold_seconds: number;
  enabled: boolean;
}

export interface SLAUpdateRequest {
  target_seconds: number;
  warning_threshold_seconds: number;
  enabled: boolean;
}

export interface SLAVersionResponse {
  workflow_id: string;
  version_id: string;
  version_number: number;
  status: string;
  sla: SLAConfig;
}

export interface ExecutionVolumeMetrics {
  total: number;
  terminal: number;
  in_flight: number;
  success_count: number;
  failed_count: number;
  cancelled_count: number;
  running_count: number;
  pending_count: number;
  waiting_approval_count: number;
  success_rate: number;
  failure_rate: number;
  cancellation_rate: number;
}

export interface DurationMetrics {
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
}

export interface SLAMetrics {
  monitored_count: number;
  healthy_count: number;
  warning_count: number;
  breached_count: number;
  not_applicable_count: number;
  sla_compliance_rate: number;
  sla_healthy_rate: number;
  sla_breach_rate: number;
}

export interface AnalyticsOverviewResponse {
  organization_id: string;
  workflow_id?: string | null;
  time_range: string;
  start_time: string;
  end_time: string;
  volume: ExecutionVolumeMetrics;
  duration: DurationMetrics;
  sla: SLAMetrics;
}

export interface TimeSeriesBucket {
  timestamp: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  cancelled_count: number;
  in_flight_count: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
}

export interface TimeSeriesResponse {
  organization_id: string;
  workflow_id?: string | null;
  start_time: string;
  end_time: string;
  granularity: 'hourly' | 'daily' | 'weekly' | string;
  buckets: TimeSeriesBucket[];
}

export interface WorkflowPerformanceItem {
  workflow_id: string;
  workflow_name: string;
  status: string;
  active_version_number?: number | null;
  total_executions: number;
  success_count: number;
  failed_count: number;
  cancelled_count: number;
  in_flight_count: number;
  success_rate: number;
  failure_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  has_sla: boolean;
  sla_compliance_rate: number;
  sla_breach_count: number;
}

export interface WorkflowPerformanceResponse {
  items: WorkflowPerformanceItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface StepLatencyItem {
  step_key: string;
  step_type: string;
  name?: string | null;
  total_executions: number;
  failed_count: number;
  failure_rate: number;
  avg_execution_time_ms: number;
  p95_execution_time_ms: number;
  p99_execution_time_ms: number;
}

export interface StepLatencyResponse {
  items: StepLatencyItem[];
  total: number;
  limit: number;
  sort_by: string;
}

export interface SLAMonitoringItem {
  workflow_id: string;
  workflow_name: string;
  active_version_number?: number | null;
  sla_enabled: boolean;
  target_seconds?: number | null;
  warning_threshold_seconds?: number | null;
  total_evaluated: number;
  healthy_count: number;
  warning_count: number;
  breached_count: number;
  compliance_rate: number;
  healthy_rate: number;
  breach_rate: number;
  current_active_breaches: number;
}

export interface SLAMonitoringResponse {
  summary: SLAMetrics;
  workflows: SLAMonitoringItem[];
}
