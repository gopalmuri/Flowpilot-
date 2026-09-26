import { apiRequest } from './apiClient';
import { AuditLog, AuditLogListResponse } from '../types/audit';

export interface AuditLogFilterOptions {
  action?: string;
  resourceType?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export async function listAuditLogs(
  organizationId: string,
  options: AuditLogFilterOptions = {}
): Promise<AuditLogListResponse> {
  const {
    action,
    resourceType,
    search,
    fromDate,
    toDate,
    page = 1,
    pageSize = 20,
  } = options;

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  if (action) params.append('action', action);
  if (resourceType) params.append('resource_type', resourceType);
  if (search) params.append('search', search);
  if (fromDate) params.append('from_date', fromDate);
  if (toDate) params.append('to_date', toDate);

  const endpoint = `/api/v1/organizations/${organizationId}/audit-logs?${params.toString()}`;
  return apiRequest<AuditLogListResponse>(endpoint, {
    method: 'GET',
  });
}

export async function getAuditLogDetail(
  organizationId: string,
  auditId: string
): Promise<AuditLog> {
  const endpoint = `/api/v1/organizations/${organizationId}/audit-logs/${auditId}`;
  return apiRequest<AuditLog>(endpoint, {
    method: 'GET',
  });
}
