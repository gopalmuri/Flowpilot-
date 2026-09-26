import { apiRequest } from './apiClient';
import {
  Integration,
  IntegrationCreatePayload,
  IntegrationListResponse,
  IntegrationTestResult,
  IntegrationUpdatePayload,
} from '../types/integration';

export async function listIntegrations(organizationId: string): Promise<IntegrationListResponse> {
  const endpoint = `/api/v1/organizations/${organizationId}/integrations`;
  return apiRequest<IntegrationListResponse>(endpoint, {
    method: 'GET',
  });
}

export async function getIntegration(
  organizationId: string,
  integrationId: string
): Promise<Integration> {
  const endpoint = `/api/v1/organizations/${organizationId}/integrations/${integrationId}`;
  return apiRequest<Integration>(endpoint, {
    method: 'GET',
  });
}

export async function createIntegration(
  organizationId: string,
  payload: IntegrationCreatePayload
): Promise<Integration> {
  const endpoint = `/api/v1/organizations/${organizationId}/integrations`;
  return apiRequest<Integration>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateIntegration(
  organizationId: string,
  integrationId: string,
  payload: IntegrationUpdatePayload
): Promise<Integration> {
  const endpoint = `/api/v1/organizations/${organizationId}/integrations/${integrationId}`;
  return apiRequest<Integration>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteIntegration(
  organizationId: string,
  integrationId: string
): Promise<void> {
  const endpoint = `/api/v1/organizations/${organizationId}/integrations/${integrationId}`;
  return apiRequest<void>(endpoint, {
    method: 'DELETE',
  });
}

export async function testIntegration(
  organizationId: string,
  integrationId: string
): Promise<IntegrationTestResult> {
  const endpoint = `/api/v1/organizations/${organizationId}/integrations/${integrationId}/test`;
  return apiRequest<IntegrationTestResult>(endpoint, {
    method: 'POST',
  });
}
