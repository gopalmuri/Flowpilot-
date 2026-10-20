import { apiRequest } from './apiClient';
import { GmailAccountsResponse } from '../types/gmail';

const base = (organizationId: string) => `/api/v1/organizations/${organizationId}/gmail`;

export async function listGmailAccounts(organizationId: string): Promise<GmailAccountsResponse> {
  return apiRequest<GmailAccountsResponse>(`${base(organizationId)}/accounts`, { method: 'GET' });
}

/**
 * Asks the server to start Google's consent flow. The server returns the Google URL; the browser is then sent there.
 * No token ever reaches the frontend: Google redirects back to the server, which redirects here with a status flag.
 */
export async function startGmailAuthorization(
  organizationId: string,
  options: { integrationId?: string; workflowId?: string } = {}
): Promise<string> {
  const body: Record<string, string> = {};
  if (options.integrationId) body.integration_id = options.integrationId;
  if (options.workflowId) body.workflow_id = options.workflowId;
  const res = await apiRequest<{ authorization_url: string }>(`${base(organizationId)}/authorize`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.authorization_url;
}

export async function syncGmailNow(organizationId: string, integrationId: string): Promise<void> {
  await apiRequest<{ status: string }>(`${base(organizationId)}/accounts/${integrationId}/sync`, {
    method: 'POST',
  });
}

export async function disconnectGmail(organizationId: string, integrationId: string): Promise<void> {
  await apiRequest<{ status: string }>(`${base(organizationId)}/accounts/${integrationId}/disconnect`, {
    method: 'POST',
  });
}
