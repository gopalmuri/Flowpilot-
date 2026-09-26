import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { SLAMonitoringResponse } from '../../types/analytics';

interface SLAMonitoringPanelProps {
  data?: SLAMonitoringResponse;
  isLoading?: boolean;
}

export const SLAMonitoringPanel: React.FC<SLAMonitoringPanelProps> = ({
  data,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-left space-y-4 animate-pulse">
        <div className="h-5 w-44 bg-slate-800 rounded" />
        <div className="h-44 bg-slate-800/40 rounded-xl" />
      </div>
    );
  }

  const summary = data?.summary || {
    monitored_count: 0,
    healthy_count: 0,
    warning_count: 0,
    breached_count: 0,
    not_applicable_count: 0,
    sla_compliance_rate: 0,
    sla_healthy_rate: 0,
    sla_breach_rate: 0,
  };

  const workflows = data?.workflows || [];
  const totalActiveBreaches = workflows.reduce((acc, wf) => acc + wf.current_active_breaches, 0);

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 shadow-xl text-left space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Service Level Agreement (SLA) Health
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Query-derived threshold tracking against configured duration targets
          </p>
        </div>

        {totalActiveBreaches > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold animate-pulse">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>{totalActiveBreaches} Active In-Flight SLA Breach{totalActiveBreaches > 1 ? 'es' : ''}</span>
          </div>
        )}
      </div>

      {/* Summary KPI Pills */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Compliance Rate */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>SLA Compliance Rate</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">
              {summary.monitored_count > 0 ? `${summary.sla_compliance_rate.toFixed(1)}%` : 'N/A'}
            </span>
            <span className="text-[10px] text-slate-500">within target</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {summary.healthy_count + summary.warning_count} of {summary.monitored_count} monitored runs
          </p>
        </div>

        {/* Healthy Rate */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Healthy Rate (Optimal)</span>
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-cyan-400">
              {summary.monitored_count > 0 ? `${summary.sla_healthy_rate.toFixed(1)}%` : 'N/A'}
            </span>
            <span className="text-[10px] text-slate-500">below warning</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {summary.healthy_count} optimal, {summary.warning_count} at risk
          </p>
        </div>

        {/* Breach Rate */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>SLA Breach Rate</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-rose-400">
              {summary.monitored_count > 0 ? `${summary.sla_breach_rate.toFixed(1)}%` : '0.0%'}
            </span>
            <span className="text-[10px] text-slate-500">exceeded target</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {summary.breached_count} runs breached SLA
          </p>
        </div>
      </div>

      {/* Per Workflow SLA Status Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800/80">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold text-[10px]">
            <tr>
              <th className="py-2.5 px-4">Workflow</th>
              <th className="py-2.5 px-4">SLA Targets</th>
              <th className="py-2.5 px-4">Evaluated Runs</th>
              <th className="py-2.5 px-4">Compliance Status</th>
              <th className="py-2.5 px-4 text-right">Configure</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/30">
            {workflows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  No workflows found.
                </td>
              </tr>
            ) : (
              workflows.map((wf) => (
                <tr key={wf.workflow_id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4">
                    <span className="font-medium text-slate-200 block">{wf.workflow_name}</span>
                    {wf.active_version_number ? (
                      <span className="text-[10px] font-mono text-slate-400">
                        v{wf.active_version_number} active
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500 italic">No published version</span>
                    )}
                  </td>

                  <td className="py-3 px-4 font-mono text-xs">
                    {wf.sla_enabled && wf.target_seconds ? (
                      <div className="space-y-0.5">
                        <span className="text-slate-300">Target: {wf.target_seconds}s</span>
                        <span className="text-slate-500 block text-[10px]">
                          Warn: {wf.warning_threshold_seconds}s
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-500 italic text-[11px]">Disabled / None</span>
                    )}
                  </td>

                  <td className="py-3 px-4 font-mono text-xs">
                    {wf.total_evaluated > 0 ? (
                      <div className="space-y-0.5">
                        <span className="text-slate-200">{wf.total_evaluated} evaluated</span>
                        <div className="flex gap-2 text-[10px]">
                          <span className="text-emerald-400">{wf.healthy_count} healthy</span>
                          <span className="text-amber-400">{wf.warning_count} warn</span>
                          <span className="text-rose-400">{wf.breached_count} breach</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-500">0 runs</span>
                    )}
                  </td>

                  <td className="py-3 px-4">
                    {wf.sla_enabled && wf.total_evaluated > 0 ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono ${
                            wf.compliance_rate >= 95
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : wf.compliance_rate >= 80
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {wf.compliance_rate.toFixed(1)}% compliant
                        </span>
                        {wf.current_active_breaches > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[10px] font-mono border border-rose-500/30">
                            {wf.current_active_breaches} active breach
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500 text-[11px]">N/A</span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right">
                    <Link
                      to={`/workflows/${wf.workflow_id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
                    >
                      <span>Configure</span>
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
