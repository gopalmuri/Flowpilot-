import React from 'react';
import { StepLatencyItem } from '../../types/analytics';
import { formatDurationMs } from '../../services/analyticsService';
import { Activity, Flame, ShieldAlert } from 'lucide-react';

interface StepLatencyBreakdownProps {
  items: StepLatencyItem[];
  sortBy: string;
  onSortChange: (newSort: string) => void;
  isLoading?: boolean;
}

export const StepLatencyBreakdown: React.FC<StepLatencyBreakdownProps> = ({
  items,
  sortBy,
  onSortChange,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-left space-y-4 animate-pulse">
        <div className="h-5 w-44 bg-slate-800 rounded" />
        <div className="h-48 bg-slate-800/40 rounded-xl" />
      </div>
    );
  }

  const maxLatency = Math.max(...items.map((it) => Math.max(it.p95_execution_time_ms, it.avg_execution_time_ms)), 50);

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 shadow-xl text-left space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            <Flame className="w-4 h-4 text-rose-400" />
            Step Latency & Bottleneck Analysis
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Identify the slowest step executions and highest failure rates across workflows
          </p>
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => onSortChange('avg_latency')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              sortBy === 'avg_latency'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Avg Latency
          </button>
          <button
            onClick={() => onSortChange('p95_latency')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              sortBy === 'p95_latency'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            P95 Latency
          </button>
          <button
            onClick={() => onSortChange('failure_rate')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              sortBy === 'failure_rate'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Failure Rate
          </button>
          <button
            onClick={() => onSortChange('execution_count')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              sortBy === 'execution_count'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Volume
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="py-10 text-center text-slate-500">
          <Activity className="w-8 h-8 mx-auto mb-2 text-slate-600 opacity-60" />
          <p className="text-xs">No step execution metrics found for the selected filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((step, idx) => {
            const avgPct = Math.min((step.avg_execution_time_ms / maxLatency) * 100, 100);
            const p95Pct = Math.min((step.p95_execution_time_ms / maxLatency) * 100, 100);

            return (
              <div
                key={`${step.step_key}-${idx}`}
                className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-all space-y-2 group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors">
                      {step.step_key}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                      {step.step_type}
                    </span>
                    {step.name && (
                      <span className="text-xs text-slate-400 truncate max-w-[200px]">
                        ({step.name})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-slate-400">
                      {step.total_executions} runs
                    </span>
                    {step.failed_count > 0 && (
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {step.failure_rate.toFixed(1)}% fail ({step.failed_count})
                      </span>
                    )}
                    <span className="text-slate-300">
                      Avg: <strong className="text-cyan-400">{formatDurationMs(step.avg_execution_time_ms)}</strong>
                    </span>
                    <span className="text-slate-300">
                      P95: <strong className="text-violet-400">{formatDurationMs(step.p95_execution_time_ms)}</strong>
                    </span>
                  </div>
                </div>

                {/* Horizontal Latency Bar (Native SVG) */}
                <div className="w-full bg-slate-900 rounded-full h-2 relative overflow-hidden">
                  {/* P95 Bar Background */}
                  <div
                    className="h-full bg-violet-500/30 absolute left-0 top-0 transition-all duration-500 rounded-full"
                    style={{ width: `${Math.max(p95Pct, 2)}%` }}
                  />
                  {/* Avg Bar Foreground */}
                  <div
                    className="h-full bg-cyan-400 absolute left-0 top-0 transition-all duration-500 rounded-full"
                    style={{ width: `${Math.max(avgPct, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
