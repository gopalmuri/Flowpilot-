export enum StepType {
  WEBHOOK_TRIGGER = 'WEBHOOK_TRIGGER',
  MANUAL_TRIGGER = 'MANUAL_TRIGGER',
  VALIDATE_DATA = 'VALIDATE_DATA',
  AI_CLASSIFICATION = 'AI_CLASSIFICATION',
  CONDITION = 'CONDITION',
  MOCK_CRM_CREATE = 'MOCK_CRM_CREATE',
  SLACK_NOTIFICATION = 'SLACK_NOTIFICATION',
  HUMAN_APPROVAL = 'HUMAN_APPROVAL',
}

export const WorkflowStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export const WorkflowVersionStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
} as const;
export type WorkflowVersionStatus = (typeof WorkflowVersionStatus)[keyof typeof WorkflowVersionStatus];

export interface WorkflowStep {
  id: string;
  workflow_version_id: string;
  step_key: string;
  step_type: StepType | string;
  name: string;
  config: Record<string, any>;
  ui_position: { x: number; y: number };
  created_at?: string;
  updated_at?: string;
}

export interface WorkflowConnection {
  id: string;
  workflow_version_id: string;
  source_step_id: string;
  target_step_id: string;
  source_step_key?: string;
  target_step_key?: string;
  condition_label?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkflowVersionSummary {
  id: string;
  workflow_id: string;
  version_number: number;
  status: WorkflowVersionStatus | string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowVersionDetail {
  id: string;
  workflow_id: string;
  version_number: number;
  status: WorkflowVersionStatus | string;
  definition: Record<string, any>;
  created_by: string;
  created_at: string;
  updated_at: string;
  steps: WorkflowStep[];
  connections: WorkflowConnection[];
}

export interface Workflow {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  status: WorkflowStatus | string;
  active_version_id?: string | null;
  webhook_key?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  version_count?: number;
  active_version?: WorkflowVersionSummary | null;
}

export interface WorkflowListResponse {
  items: Workflow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface WorkflowCreateRequest {
  name: string;
  description?: string;
}

export interface WorkflowUpdateRequest {
  name?: string;
  description?: string;
}

export interface WorkflowStepSchema {
  step_key: string;
  step_type: string;
  name: string;
  config: Record<string, any>;
  ui_position: { x: number; y: number };
}

export interface WorkflowConnectionSchema {
  source_step_key: string;
  target_step_key: string;
  condition_label?: string | null;
}

export interface WorkflowVersionUpdateRequest {
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
}
