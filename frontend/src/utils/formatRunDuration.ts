const WAITING = new Set(['PAUSED', 'WAITING_APPROVAL']);
const ACTIVE = new Set(['PENDING', 'QUEUED', 'RUNNING']);

export interface DurationSource {
  status?: string;
  duration_ms?: number | null;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

/**
 * Human-readable run duration. A run that is paused for approval or still running
 * has no final duration yet, so we describe its state instead of a growing number.
 */
export function formatRunDuration(run: DurationSource): string {
  const status = (run.status || '').toUpperCase();
  if (WAITING.has(status)) return 'Waiting for approval';
  if (ACTIVE.has(status)) return 'In progress';
  if (run.duration_ms === undefined || run.duration_ms === null) return '-';
  return formatMs(run.duration_ms);
}
