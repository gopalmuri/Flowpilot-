export interface AuditLog {
  id: string;
  organization_id: string;
  user_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, any>;
  ip_address?: string | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLog[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
