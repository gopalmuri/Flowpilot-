import React from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import {
  DurationMetrics,
  ExecutionVolumeMetrics,
  SLAMetrics,
} from '../../types/analytics';

interface AnalyticsOverviewCardsProps {
  volume?: ExecutionVolumeMetrics | null;
  duration?: DurationMetrics | null;
  sla?: SLAMetrics | null;
  isLoading?: boolean;
}

export const AnalyticsOverviewCards: React.FC<AnalyticsOverviewCardsProps> = ({
  volume,
  duration,
  sla,
  isLoading = false,
}) => {
  const formatDurationMs = (ms?: number | null): string => {
    if (ms === undefined || ms === null || isNaN(ms)) return '0.0s';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-5 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750/80 shadow-lg animate-pulse space-y-3"
          >
            <div className="h-4 w-28 bg-warm-200 dark:bg-charcoal-800 rounded" />
            <div className="h-8 w-20 bg-warm-200 dark:bg-charcoal-800 rounded" />
            <div className="h-3 w-36 bg-warm-100 dark:bg-charcoal-850 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const vol = volume || {
    total: 0,
    terminal: 0,
    in_flight: 0,
    success_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    running_count: 0,
    pending_count: 0,
    waiting_approval_count: 0,
    success_rate: 0,
    failure_rate: 0,
    cancellation_rate: 0,
  };

  const dur = duration || {
    avg_duration_ms: 0,
    p50_duration_ms: 0,
    p95_duration_ms: 0,
    p99_duration_ms: 0,
  };

  const slaData = sla || {
    monitored_count: 0,
    healthy_count: 0,
    warning_count: 0,
    breached_count: 0,
    not_applicable_count: 0,
    sla_compliance_rate: 0,
    sla_healthy_rate: 0,
    sla_breach_rate: 0,
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
      {/* 1. Total Volume & In-Flight */}
      <a
        href="/executions"
        title="View execution telemetry"
        className="p-5 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750/80 shadow-lg relative overflow-hidden group hover:border-brand-500/50 hover:shadow-xl transition-all block"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-warm-500 dark:text-charcoal-400 uppercase tracking-wider flex items-center gap-1">
            <span>Total Executions</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-brand-600 dark:text-brand-400" />
          </span>
          <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-600 dark:text-brand-400">
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-warm-900 dark:text-charcoal-100 tracking-tight font-mono">
            {vol.total.toLocaleString()}
          </span>
          {vol.in_flight > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-brand-600 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-800/60">
              {vol.in_flight} in-flight
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-warm-500 dark:text-charcoal-400 border-t border-warm-200 dark:border-charcoal-750/60 pt-2.5">
          <span title="Running" className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
            {vol.running_count} running
          </span>
          <span title="Pending" className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            {vol.pending_count} pending
          </span>
          <span title="Waiting Approval" className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            {vol.waiting_approval_count} approval
          </span>
        </div>
      </a>

      {/* 2. Success & Failure Rates */}
      <a
        href="/executions?status=FAILED"
        title="View failed executions"
        className="p-5 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750/80 shadow-lg relative overflow-hidden group hover:border-rose-500/40 hover:shadow-xl transition-all block"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-warm-500 dark:text-charcoal-400 uppercase tracking-wider flex items-center gap-1">
            <span>Success Rate</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-rose-500" />
          </span>
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-brand-600 dark:text-brand-400 tracking-tight font-mono">
            {vol.terminal > 0 ? `${vol.success_rate.toFixed(1)}%` : '0.0%'}
          </span>
          <span className="text-[11px] text-warm-500 dark:text-charcoal-400">
            of {vol.terminal} terminal
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-warm-500 dark:text-charcoal-400 border-t border-warm-200 dark:border-charcoal-750/60 pt-2.5">
          <span className="text-rose-600 dark:text-rose-400 font-mono font-medium">
            {vol.failure_rate.toFixed(1)}% fail ({vol.failed_count})
          </span>
          <span className="text-warm-500 dark:text-charcoal-400 font-mono">
            {vol.cancellation_rate.toFixed(1)}% cancel ({vol.cancelled_count})
          </span>
        </div>
      </a>

      {/* 3. Latency & Duration Percentiles */}
      <div className="p-5 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750/80 shadow-lg relative overflow-hidden group hover:border-warm-300 dark:border-charcoal-700 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-warm-500 dark:text-charcoal-400 uppercase tracking-wider">
            Latency (P95 / Avg)
          </span>
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-warm-900 dark:text-charcoal-100 tracking-tight font-mono">
            {formatDurationMs(dur.p95_duration_ms)}
          </span>
          <span className="text-[11px] text-warm-500 dark:text-charcoal-400 font-mono">
            p95
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-warm-500 dark:text-charcoal-400 border-t border-warm-200 dark:border-charcoal-750/60 pt-2.5">
          <span>Avg: <strong className="text-warm-800 dark:text-charcoal-200 font-mono">{formatDurationMs(dur.avg_duration_ms)}</strong></span>
          <span>p50: <strong className="text-warm-800 dark:text-charcoal-200 font-mono">{formatDurationMs(dur.p50_duration_ms)}</strong></span>
          <span>p99: <strong className="text-warm-800 dark:text-charcoal-200 font-mono">{formatDurationMs(dur.p99_duration_ms)}</strong></span>
        </div>
      </div>

      {/* 4. SLA Compliance & Health */}
      <a
        href="#sla-panel"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('sla-panel')?.scrollIntoView({ behavior: 'smooth' });
        }}
        title="View SLA Monitoring breakdown"
        className="p-5 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750/80 shadow-lg relative overflow-hidden group hover:border-brand-500/50 hover:shadow-xl transition-all block cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-warm-500 dark:text-charcoal-400 uppercase tracking-wider flex items-center gap-1">
            <span>SLA Compliance</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-brand-600 dark:text-brand-400" />
          </span>
          <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-600 dark:text-brand-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-brand-600 dark:text-brand-400 tracking-tight font-mono">
            {slaData.monitored_count > 0 ? `${slaData.sla_compliance_rate.toFixed(1)}%` : 'N/A'}
          </span>
          {slaData.breached_count > 0 ? (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30 flex items-center gap-1">
              <span className="text-rose-500">⚠</span>
              {slaData.breached_count} breach{slaData.breached_count > 1 ? 'es' : ''}
            </span>
          ) : (
            <span className="text-[11px] text-warm-500 dark:text-charcoal-400">
              {slaData.monitored_count} monitored runs
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-warm-500 dark:text-charcoal-400 border-t border-warm-200 dark:border-charcoal-750/60 pt-2.5">
          <span>Healthy: <strong className="text-brand-600 dark:text-brand-400 font-mono">{slaData.healthy_count}</strong></span>
          <span>Warning: <strong className="text-amber-500 font-mono">{slaData.warning_count}</strong></span>
          <span>Breached: <strong className="text-rose-500 font-mono">{slaData.breached_count}</strong></span>
        </div>
      </a>
    </div>
  );
};
