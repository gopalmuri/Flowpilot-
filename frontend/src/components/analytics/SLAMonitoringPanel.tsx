import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
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
      <div id="sla-panel" className="p-6 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750 text-left space-y-4 animate-pulse">
        <div className="h-5 w-44 bg-warm-100 dark:bg-charcoal-800 rounded" />
        <div className="h-44 bg-warm-100 dark:bg-charcoal-800 rounded-xl" />
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
    <div id="sla-panel" className="p-6 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750 shadow-xl text-left space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand-600 dark:text-brand-400" />
            Service Level Agreement (SLA) Health
          </h3>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-0.5">
            Query-derived threshold tracking against configured duration targets
          </p>
        </div>

        {totalActiveBreaches > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-red-600 dark:text-red-400 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4" />
            <span>{totalActiveBreaches} Active Breach{totalActiveBreaches > 1 ? 'es' : ''} Detected</span>
          </div>
        )}
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Compliance Rate */}
        <div className="p-4 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750/80">
          <div className="flex items-center justify-between text-xs text-warm-500 dark:text-charcoal-400">
            <span>Overall SLA Compliance</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-brand-600 dark:text-brand-400">
              {summary.monitored_count > 0 ? `${summary.sla_compliance_rate.toFixed(1)}%` : 'N/A'}
            </span>
            <span className="text-[10px] text-warm-400 dark:text-charcoal-500">within target</span>
          </div>
          <p className="text-[11px] text-warm-400 dark:text-charcoal-500 mt-1">
            {summary.healthy_count + summary.warning_count} of {summary.monitored_count} monitored runs
          </p>
        </div>

        {/* Healthy Rate */}
        <div className="p-4 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750/80">
          <div className="flex items-center justify-between text-xs text-warm-500 dark:text-charcoal-400">
            <span>Healthy Rate (Optimal)</span>
            <Clock className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-brand-600 dark:text-brand-400">
              {summary.monitored_count > 0 ? `${summary.sla_healthy_rate.toFixed(1)}%` : 'N/A'}
            </span>
            <span className="text-[10px] text-warm-400 dark:text-charcoal-500">below warning</span>
          </div>
          <p className="text-[11px] text-warm-400 dark:text-charcoal-500 mt-1">
            {summary.healthy_count} optimal, {summary.warning_count} at risk
          </p>
        </div>

        {/* Breach Rate */}
        <div className="p-4 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750/80">
          <div className="flex items-center justify-between text-xs text-warm-500 dark:text-charcoal-400">
            <span>SLA Breach Rate</span>
            <ShieldAlert className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">
              {summary.monitored_count > 0 ? `${summary.sla_breach_rate.toFixed(1)}%` : '0.0%'}
            </span>
            <span className="text-[10px] text-warm-400 dark:text-charcoal-500">exceeded target</span>
          </div>
          <p className="text-[11px] text-warm-400 dark:text-charcoal-500 mt-1">
            {summary.breached_count} runs breached SLA
          </p>
        </div>
      </div>

      {/* Per Workflow SLA Status Table */}
      <div className="overflow-x-auto rounded-xl border border-warm-200 dark:border-charcoal-750/80">
        <table className="w-full text-left text-xs">
          <thead className="bg-warm-50 dark:bg-charcoal-850 text-warm-500 dark:text-charcoal-400 border-b border-warm-200 dark:border-charcoal-750 uppercase tracking-wider font-semibold text-[10px]">
            <tr>
              <th className="py-2.5 px-4">Workflow</th>
              <th className="py-2.5 px-4">SLA Targets</th>
              <th className="py-2.5 px-4">Evaluated Runs</th>
              <th className="py-2.5 px-4">Compliance Status</th>
              <th className="py-2.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-white dark:bg-charcoal-900/30">
            {workflows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-warm-400 dark:text-charcoal-500">
                  No workflows found.
                </td>
              </tr>
            ) : (
              workflows.map((wf) => (
                <tr key={wf.workflow_id} className="hover:bg-warm-100 dark:bg-charcoal-800 transition-colors">
                  <td className="py-3 px-4">
                    <span className="font-medium text-warm-800 dark:text-charcoal-200 block">{wf.workflow_name}</span>
                    {wf.active_version_number ? (
                      <span className="text-[10px] font-mono text-warm-500 dark:text-charcoal-400">
                        v{wf.active_version_number} active
                      </span>
                    ) : (
                      <span className="text-[10px] text-warm-400 dark:text-charcoal-500 italic">No published version</span>
                    )}
                  </td>

                  <td className="py-3 px-4 font-mono text-xs">
                    {wf.sla_enabled && wf.target_seconds ? (
                      <div className="space-y-0.5">
                        <span className="text-warm-700 dark:text-charcoal-300">Target: {wf.target_seconds}s</span>
                        <span className="text-warm-400 dark:text-charcoal-500 block text-[10px]">
                          Warn: {wf.warning_threshold_seconds}s
                        </span>
                      </div>
                    ) : (
                      <span className="text-warm-400 dark:text-charcoal-500 italic text-[11px]">Disabled / None</span>
                    )}
                  </td>

                  <td className="py-3 px-4 font-mono text-xs">
                    {wf.total_evaluated > 0 ? (
                      <div className="space-y-0.5">
                        <span className="text-warm-800 dark:text-charcoal-200">{wf.total_evaluated} evaluated</span>
                        <div className="flex gap-2 text-[10px]">
                          <span className="text-brand-600 dark:text-brand-400">{wf.healthy_count} healthy</span>
                          <span className="text-amber-600 dark:text-amber-400">{wf.warning_count} warn</span>
                          <span className="text-red-600 dark:text-red-400">{wf.breached_count} breach</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-warm-400 dark:text-charcoal-500">0 runs</span>
                    )}
                  </td>

                  <td className="py-3 px-4">
                    {wf.sla_enabled && wf.total_evaluated > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono ${
                            wf.compliance_rate >= 95
                              ? 'bg-emerald-500/15 text-brand-600 dark:text-brand-400 border border-emerald-500/30'
                              : wf.compliance_rate >= 80
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                              : 'bg-rose-500/15 text-red-600 dark:text-red-400 border border-rose-500/30'
                          }`}
                        >
                          {wf.compliance_rate.toFixed(1)}% compliant
                        </span>
                        {wf.breached_count > 0 && (
                          <Link
                            to={`/executions?workflowId=${wf.workflow_id}&status=FAILED`}
                            className="px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-red-600 dark:text-red-400 text-[10px] font-mono border border-rose-500/30 transition-colors"
                            title="Inspect breached executions"
                          >
                            {wf.breached_count} breach{wf.breached_count > 1 ? 'es' : ''} &rarr;
                          </Link>
                        )}
                      </div>
                    ) : (
                      <span className="text-warm-400 dark:text-charcoal-500 text-[11px]">N/A</span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/executions?workflowId=${wf.workflow_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-700 text-warm-700 dark:text-charcoal-300 text-xs font-medium transition-colors border border-warm-300 dark:border-charcoal-700"
                        title="View workflow executions"
                      >
                        <Layers className="w-3 h-3 text-warm-500 dark:text-charcoal-400" />
                        <span>Runs</span>
                      </Link>
                      <Link
                        to={`/workflows/${wf.workflow_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50 text-brand-700 dark:text-brand-300 text-xs font-medium transition-colors border border-brand-200 dark:border-brand-800/60"
                        title="Configure workflow and SLA targets"
                      >
                        <span>Configure</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
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
