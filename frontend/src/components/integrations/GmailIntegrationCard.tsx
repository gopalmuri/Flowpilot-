import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail, RefreshCw, Unplug } from 'lucide-react';
import { GmailAccount, GmailAccountsResponse, GmailHealth } from '../../types/gmail';
import {
  disconnectGmail,
  listGmailAccounts,
  startGmailAuthorization,
  syncGmailNow,
} from '../../services/gmailService';
import { updateIntegration } from '../../services/integrationService';
import { listWorkflows } from '../../services/workflowService';

interface GmailIntegrationCardProps {
  organizationId: string;
  organizationName?: string;
  canManage: boolean; // owner / admin: connect, reconnect, disconnect, choose the workflow
  canSync: boolean; // owner / admin / manager: view status, synchronise now
  onFeedback: (type: 'success' | 'error', message: string) => void;
}

const HEALTH_BADGE: Record<GmailHealth, { label: string; tone: string }> = {
  healthy: { label: 'Healthy', tone: 'bg-emerald-500/10 text-brand-600 dark:text-brand-400 border-brand-600 dark:border-brand-500/20' },
  degraded: { label: 'Needs attention', tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60' },
  needs_reauth: { label: 'Reconnect required', tone: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60' },
  disconnected: { label: 'Disconnected', tone: 'bg-slate-500/10 text-warm-500 dark:text-charcoal-400 border-slate-500/20' },
};

const REASON_TEXT: Record<string, string> = {
  scheduler_not_running: 'The background scheduler is not running, so mail will not be synchronised until it is started.',
  sync_stale: 'No successful synchronisation for a long time.',
  watch_failed: 'The mailbox watch could not be registered.',
  watch_expired: 'The mailbox watch has expired.',
  watch_not_active: 'The mailbox watch is not active.',
  no_workflow_configured: 'No workflow is selected, so incoming mail is stored but nothing is started.',
  reauthorization_required: 'Google no longer accepts the saved authorization. Reconnect the mailbox.',
};

export const OAUTH_REASON_TEXT: Record<string, string> = {
  access_denied: 'Google access was not granted.',
  invalid_state: 'The connection request was not recognised. Start again.',
  state_reused: 'That connection request was already used. Start again.',
  state_expired: 'The connection request expired. Start again.',
  browser_mismatch: 'The connection must be finished in the same browser that started it.',
  not_authorized: 'Only an owner or admin of this organization can connect a mailbox.',
  mailbox_in_use: 'That mailbox is already connected to a FlowPilot organization.',
  mailbox_mismatch: 'Reconnect with the same Google account that was connected before.',
  missing_scope: 'FlowPilot needs permission to read the mailbox.',
  unexpected_scope: 'More access than FlowPilot needs was granted, so it was refused.',
  no_refresh_token: 'Google did not issue a long-lived authorization. Try again and approve all prompts.',
  token_exchange_failed: 'Google could not complete the sign-in. Try again.',
  profile_failed: 'The mailbox could not be verified. Try again.',
  profile_unauthorized: 'The mailbox could not be verified. Try again.',
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : null);

function watchText(a: GmailAccount, pollSeconds: number): string {
  switch (a.watch_status) {
    case 'ACTIVE':
      return a.watch_expiration ? `Active until ${fmt(a.watch_expiration)}` : 'Active';
    case 'NOT_CONFIGURED':
      return `Push not configured: checking every ${Math.round(pollSeconds / 60)} min`;
    case 'FAILED':
      return `Failed${a.watch_error ? ` (${a.watch_error})` : ''}`;
    case 'EXPIRED':
      return 'Expired';
    default:
      return 'Not registered';
  }
}

export const GmailIntegrationCard: React.FC<GmailIntegrationCardProps> = ({
  organizationId,
  organizationName,
  canManage,
  canSync,
  onFeedback,
}) => {
  const [data, setData] = useState<GmailAccountsResponse | null>(null);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canSync) return;
    try {
      setLoadError(null);
      setData(await listGmailAccounts(organizationId));
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load Gmail status.');
    }
  }, [organizationId, canSync]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    listWorkflows(organizationId, { pageSize: 100 })
      .then((res) =>
        setWorkflows(
          (res.items || [])
            .filter((w: any) => w.status === 'ACTIVE')
            .map((w: any) => ({ id: w.id, name: w.name }))
        )
      )
      .catch(() => setWorkflows([]));
  }, [organizationId, canManage]);

  const run = async (key: string, action: () => Promise<void>, success?: string) => {
    setBusy(key);
    try {
      await action();
      if (success) onFeedback('success', success);
      await load();
    } catch (err: any) {
      onFeedback('error', err?.message || 'The Gmail action failed.');
    } finally {
      setBusy(null);
    }
  };

  const connect = (integrationId?: string, workflowId?: string) =>
    run('connect', async () => {
      const url = await startGmailAuthorization(organizationId, { integrationId, workflowId });
      window.location.assign(url);
    });

  const active = (data?.items ?? []).filter((a) => a.health !== 'disconnected');
  const scheduler = data?.scheduler;

  return (
    <div
      className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 flex flex-col gap-4 md:col-span-2"
      data-testid="gmail-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-600 dark:text-brand-400">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Gmail</h3>
            <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-0.5">
              Read incoming mail from a connected mailbox and start your workflow. Replies are drafted for your approval;
              nothing is sent from Gmail yet.
            </p>
          </div>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800/60 font-medium whitespace-nowrap">
          Inbound &bull; read-only
        </span>
      </div>

      {!canSync && (
        <p className="text-xs text-warm-500 dark:text-charcoal-400">Ask an owner, admin or manager to view Gmail status.</p>
      )}
      {loadError && (
        <p className="text-xs text-rose-500" role="alert">
          {loadError}
        </p>
      )}
      {data && !data.oauth_configured && (
        <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
          Google OAuth is not configured on this server, so mailboxes cannot be connected yet. See docs/GMAIL_INTEGRATION.md.
        </p>
      )}
      {scheduler && !scheduler.healthy && active.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300 text-xs flex gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            The background scheduler (Celery Beat) has not reported in. Mailboxes are only synchronised while it runs.
            {scheduler.last_tick ? ` Last heartbeat ${fmt(scheduler.last_tick)}.` : ' No heartbeat has been seen.'}
          </span>
        </div>
      )}

      {active.map((a) => {
        const badge = HEALTH_BADGE[a.health];
        const reasons = a.health_reasons.filter((r) => !(r === 'scheduler_not_running'));
        return (
          <div key={a.integration_id} className="p-4 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 space-y-3" data-testid="gmail-account">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-warm-900 dark:text-charcoal-100 font-mono">{a.mailbox}</div>
                <div className="text-[11px] text-warm-500 dark:text-charcoal-400">
                  Owned by {a.organization_name || organizationName || 'this organization'} &bull; connected {fmt(a.connected_at)}
                </div>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.tone}`} data-testid="gmail-health">
                {badge.label}
              </span>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-[11px] text-warm-500 dark:text-charcoal-400">Mailbox watch</dt>
                <dd className="text-warm-800 dark:text-charcoal-200" data-testid="gmail-watch">{watchText(a, data?.poll_interval_seconds ?? 120)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-warm-500 dark:text-charcoal-400">Last successful sync</dt>
                <dd className="text-warm-800 dark:text-charcoal-200" data-testid="gmail-last-sync">{fmt(a.last_sync_at) ?? 'Never'}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-warm-500 dark:text-charcoal-400">Last error</dt>
                <dd className="text-warm-800 dark:text-charcoal-200">{a.last_sync_error ?? 'None'}</dd>
              </div>
            </dl>

            {reasons.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300 space-y-0.5" data-testid="gmail-reasons">
                {reasons.map((r) => (
                  <li key={r}>{REASON_TEXT[r] ?? (r.startsWith('sync_error:') ? `Last sync failed (${r.slice(11)})` : r)}</li>
                ))}
              </ul>
            )}

            {canManage && (
              <div>
                <label htmlFor={`gmail-wf-${a.integration_id}`} className="block text-[11px] text-warm-500 dark:text-charcoal-400 mb-1">
                  Workflow started by new mail
                </label>
                <select
                  id={`gmail-wf-${a.integration_id}`}
                  value={a.workflow_id ?? ''}
                  disabled={busy !== null}
                  onChange={(e) =>
                    void run(
                      'workflow',
                      async () => {
                        await updateIntegration(organizationId, a.integration_id, { config: { workflow_id: e.target.value } });
                      },
                      'Workflow updated.'
                    )
                  }
                  className="w-full sm:w-72 px-3 py-2 bg-white dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-xl text-xs"
                >
                  <option value="" disabled>
                    Select a published workflow
                  </option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {canSync && a.health !== 'needs_reauth' && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run('sync', () => syncGmailNow(organizationId, a.integration_id), 'Synchronisation requested.')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-750 text-warm-700 dark:text-charcoal-300 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync now
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void connect(a.integration_id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Reconnect
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm(`Disconnect ${a.mailbox}? FlowPilot will stop reading it and revoke its access.`)) {
                      void run('disconnect', () => disconnectGmail(organizationId, a.integration_id), `${a.mailbox} disconnected.`);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/60 disabled:opacity-50"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              )}
            </div>
          </div>
        );
      })}

      {canManage && (
        <div>
          <button
            type="button"
            disabled={busy !== null || (data !== null && !data.oauth_configured)}
            onClick={() => void connect()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 rounded-xl shadow-subtle transition-colors disabled:opacity-50"
          >
            <Mail className="w-3.5 h-3.5" />
            {active.length > 0 ? 'Connect another mailbox' : 'Connect Gmail'}
          </button>
          <p className="mt-1.5 text-[11px] text-warm-400 dark:text-charcoal-500">
            You will be sent to Google to approve read-only access. FlowPilot never sees your Google password.
          </p>
        </div>
      )}
    </div>
  );
};
