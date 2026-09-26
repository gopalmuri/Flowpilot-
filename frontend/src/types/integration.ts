export type IntegrationType = 'MOCK_CRM' | 'SLACK';
export type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface Integration {
  id: string;
  organization_id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  has_credentials: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface IntegrationListResponse {
  items: Integration[];
  total: number;
}

export interface IntegrationCreatePayload {
  name: string;
  type: IntegrationType;
  credentials?: Record<string, any>;
  config?: Record<string, any>;
}

export interface IntegrationUpdatePayload {
  name?: string;
  status?: IntegrationStatus;
  credentials?: Record<string, any>;
  clear_credentials?: boolean;
  config?: Record<string, any>;
}

export interface IntegrationTestResult {
  status: 'healthy' | 'error';
  latency_ms: number;
  message: string;
  tested_at: string;
}
