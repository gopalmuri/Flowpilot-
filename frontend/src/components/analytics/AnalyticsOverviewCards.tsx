import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { DurationMetrics, ExecutionVolumeMetrics, SLAMetrics } from '../../types/analytics';
import { formatDurationMs } from '../../services/analyticsService';

interface AnalyticsOverviewCardsProps {
  volume?: ExecutionVolumeMetrics;
  duration?: DurationMetrics;
  sla?: SLAMetrics;
  isLoading?: boolean;
}

export const AnalyticsOverviewCards: React.FC<AnalyticsOverviewCardsProps> = ({
  volume,
  duration,
  sla,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse space-y-3"
          >
            <div className="flex justify-between items-center">
              <div className="h-4 w-24 bg-slate-800 rounded" />
              <div className="w-8 h-8 rounded-xl bg-slate-800" />
            </div>
            <div className="h-8 w-16 bg-slate-800 rounded" />
            <div className="h-3 w-32 bg-slate-800 rounded" />
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
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Total Executions
          </span>
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white tracking-tight font-mono">
            {vol.total.toLocaleString()}
          </span>
          {vol.in_flight > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              {vol.in_flight} in-flight
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400 border-t border-slate-800/60 pt-2.5">
          <span title="Running" className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
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
      </div>

      {/* 2. Success & Failure Rates */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Success Rate
          </span>
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-emerald-400 tracking-tight font-mono">
            {vol.terminal > 0 ? `${vol.success_rate.toFixed(1)}%` : '0.0%'}
          </span>
          <span className="text-[11px] text-slate-400">
            of {vol.terminal} terminal
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400 border-t border-slate-800/60 pt-2.5">
          <span className="text-rose-400 font-mono font-medium">
            {vol.failure_rate.toFixed(1)}% fail ({vol.failed_count})
          </span>
          <span className="text-slate-400 font-mono">
            {vol.cancellation_rate.toFixed(1)}% cancel ({vol.cancelled_count})
          </span>
        </div>
      </div>

      {/* 3. Latency & Duration Percentiles */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Latency (P95 / Avg)
          </span>
          <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white tracking-tight font-mono">
            {formatDurationMs(dur.p95_duration_ms)}
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            p95
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400 border-t border-slate-800/60 pt-2.5">
          <span>Avg: <strong className="text-slate-200 font-mono">{formatDurationMs(dur.avg_duration_ms)}</strong></span>
          <span>p50: <strong className="text-slate-200 font-mono">{formatDurationMs(dur.p50_duration_ms)}</strong></span>
          <span>p99: <strong className="text-slate-200 font-mono">{formatDurationMs(dur.p99_duration_ms)}</strong></span>
        </div>
      </div>

      {/* 4. SLA Compliance & Health */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            SLA Compliance
          </span>
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-cyan-400 tracking-tight font-mono">
            {slaData.monitored_count > 0 ? `${slaData.sla_compliance_rate.toFixed(1)}%` : 'N/A'}
          </span>
          {slaData.breached_count > 0 ? (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-rose-400" />
              {slaData.breached_count} breach{slaData.breached_count > 1 ? 'es' : ''}
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">
              {slaData.monitored_count} monitored runs
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400 border-t border-slate-800/60 pt-2.5">
          <span>Healthy: <strong className="text-emerald-400 font-mono">{slaData.healthy_count}</strong></span>
          <span>Warning: <strong className="text-amber-400 font-mono">{slaData.warning_count}</strong></span>
          <span>Breached: <strong className="text-rose-400 font-mono">{slaData.breached_count}</strong></span>
        </div>
      </div>
    </div>
  );
};
