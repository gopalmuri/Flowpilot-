export type GmailHealth = 'healthy' | 'degraded' | 'needs_reauth' | 'disconnected';

/** A connected mailbox as the API reports it. There are no tokens or credentials in this shape. */
export interface GmailAccount {
  integration_id: string;
  organization_id: string;
  organization_name?: string | null;
  mailbox: string;
  integration_status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  health: GmailHealth;
  health_reasons: string[];
  connected_at: string;
  disconnected_at?: string | null;
  granted_scopes: string[];
  workflow_id?: string | null;
  sync_state: string;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  last_notification_at?: string | null;
  watch_status: 'NONE' | 'NOT_CONFIGURED' | 'ACTIVE' | 'FAILED' | 'EXPIRED';
  watch_expiration?: string | null;
  watch_error?: string | null;
}

export interface GmailAccountsResponse {
  items: GmailAccount[];
  oauth_configured: boolean;
  pubsub_configured: boolean;
  poll_interval_seconds: number;
  scheduler: { last_tick?: string | null; healthy: boolean };
}
