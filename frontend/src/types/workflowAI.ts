import { WorkflowStepSchema, WorkflowConnectionSchema } from './workflow';

export type AIMessageRole = 'user' | 'assistant' | 'system';

export interface AIChatMessage {
  role: AIMessageRole;
  content: string;
}

export interface AIWorkflowDiffSummary {
  added_steps: string[];
  removed_steps: string[];
  modified_steps: string[];
  reconnected_edges: string[];
}

export interface AIWorkflowProposal {
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
  diff_summary: AIWorkflowDiffSummary;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AIClarificationQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface AITemplateSuggestion {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export type AISetupKind = 'integration' | 'config' | 'info';
export type AISetupAction = 'connect_gmail' | 'open_integrations' | 'edit_step';

export interface AISetupItem {
  id: string;
  kind: AISetupKind;
  title: string;
  detail: string;
  step_key?: string | null;
  action?: AISetupAction | null;
  blocking: boolean;
}

export type AIAssistMode = 'proposal' | 'clarification' | 'explanation' | 'suggestion' | 'error';

export interface AIWorkflowAssistRequest {
  prompt: string;
  conversation_history: AIChatMessage[];
  current_steps: WorkflowStepSchema[];
  current_connections: WorkflowConnectionSchema[];
  workflow_name?: string;
  workflow_description?: string;
}

export interface AIWorkflowAssistResponse {
  mode: AIAssistMode;
  message: string;
  proposal?: AIWorkflowProposal | null;
  clarification_questions: AIClarificationQuestion[];
  template_suggestions: AITemplateSuggestion[];
  summary?: string | null;
  suggested_name?: string | null;
  setup_needed?: AISetupItem[];
  unsupported?: string[];
  repair_attempts?: number;
  tokens_used: number;
  latency_ms: number;
  provider: string;
  model: string;
}

export type AISimulateScenario = 'happy_path' | 'edge_case' | 'failure' | 'custom';

export interface AISimulatePayloadRequest {
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
  scenario?: string;
  custom_instruction?: string;
}

export interface AISimulatePayloadResponse {
  scenario: string;
  payload: Record<string, any>;
  summary: string;
  target_trigger?: string | null;
}

export interface AISimulateExecutionStep {
  step_id: string;
  step_name: string;
  step_type: string;
  status: 'SUCCESS' | 'SKIPPED' | 'WAITING_APPROVAL' | 'FAILED';
  branch_taken?: string | null;
  simulated_output: Record<string, any>;
  reasoning: string;
}

export interface AISimulateExecutionRequest {
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
  payload: Record<string, any>;
}

export interface AISimulateExecutionResponse {
  overall_outcome: 'COMPLETED' | 'TERMINATED_EARLY' | 'HALTED_ON_ERROR' | 'PENDING_APPROVAL';
  simulation_summary: string;
  active_step_ids: string[];
  steps: AISimulateExecutionStep[];
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// Prompt-first builder: catalog, templates, create, explain, suggestions
// ---------------------------------------------------------------------------

export interface AICatalogStep {
  step_type: string;
  label: string;
  category: string;
  description: string;
  example_config: Record<string, unknown>;
  edge_labels: string[];
  is_trigger: boolean;
  is_mock: boolean;
  needs_integration?: string | null;
}

export interface AIWorkflowTemplate {
  id: string;
  title: string;
  description: string;
  prompt: string;
  category: string;
  uses: string[];
}

export interface AIBuilderCreateRequest {
  name: string;
  description?: string;
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
}

export interface AIBuilderCreateResponse {
  workflow_id: string;
  version_id: string;
  name: string;
  status: string;
  valid: boolean;
  warnings: string[];
}

export interface AIRunFailedStep {
  step_key: string;
  name: string;
  step_type: string;
  error: string;
}

export interface AIRunExplainResponse {
  run_id: string;
  run_status: string;
  explanation: string;
  next_steps: string[];
  failed_steps: AIRunFailedStep[];
  suggested_fix?: AIWorkflowProposal | null;
  base_version_id?: string | null;
  used_ai: boolean;
}

export interface AIWorkflowStats {
  window_days: number;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  failure_rate: number;
  pending_approvals: number;
  avg_approval_wait_hours?: number | null;
  top_failing_steps: Array<Record<string, unknown>>;
}

export type AISuggestionSeverity = 'info' | 'warning' | 'critical';

export interface AIImprovementSuggestion {
  id: string;
  title: string;
  detail: string;
  severity: AISuggestionSeverity;
}

export interface AISuggestionsResponse {
  workflow_id: string;
  stats: AIWorkflowStats;
  suggestions: AIImprovementSuggestion[];
  proposal?: AIWorkflowProposal | null;
  base_version_id?: string | null;
  used_ai: boolean;
}
