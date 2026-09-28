import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  ShieldCheck,
} from 'lucide-react';
import { WorkflowPerformanceItem } from '../../types/analytics';
import { formatDurationMs } from '../../services/analyticsService';

interface WorkflowPerformanceTableProps {
  items: WorkflowPerformanceItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string) => void;
  onPageChange: (newPage: number) => void;
  isLoading?: boolean;
}

export const WorkflowPerformanceTable: React.FC<WorkflowPerformanceTableProps> = ({
  items,
  total,
  page,
  pageSize,
  totalPages,
  sortBy,
  sortOrder: _sortOrder,
  onSortChange,
  onPageChange,
  isLoading = false,
}) => {
  const renderSortIcon = (columnKey: string) => {
    const isActive = sortBy === columnKey;
    return (
      <ArrowUpDown
        className={`w-3.5 h-3.5 ml-1 transition-colors ${
          isActive ? 'text-brand-600 dark:text-brand-400' : 'text-warm-600 dark:text-charcoal-400 group-hover:text-warm-500 dark:text-charcoal-400'
        }`}
      />
    );
  };

  return (
    <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750 shadow-xl text-left space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 tracking-tight flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-brand-600 dark:text-brand-400" />
            Workflow Execution & SLA Breakdown
          </h3>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-0.5">
            Comparative performance, failure rates, and SLA compliance per workflow
          </p>
        </div>

        <div className="text-xs text-warm-500 dark:text-charcoal-400 font-mono">
          Showing {items.length > 0 ? (page - 1) * pageSize + 1 : 0} -{' '}
          {Math.min(page * pageSize, total)} of {total} workflows
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-warm-200 dark:border-charcoal-750/80">
        <table className="w-full text-left text-xs">
          <thead className="bg-warm-50 dark:bg-charcoal-850 text-warm-500 dark:text-charcoal-400 border-b border-warm-200 dark:border-charcoal-750 uppercase tracking-wider font-semibold text-[10px]">
            <tr>
              <th className="py-3 px-4">Workflow Name</th>
              <th
                className="py-3 px-4 cursor-pointer hover:text-warm-800 dark:text-charcoal-200 group select-none"
                onClick={() => onSortChange('executions')}
              >
                <div className="flex items-center">
                  Executions
                  {renderSortIcon('executions')}
                </div>
              </th>
              <th
                className="py-3 px-4 cursor-pointer hover:text-warm-800 dark:text-charcoal-200 group select-none"
                onClick={() => onSortChange('failure_rate')}
              >
                <div className="flex items-center">
                  Success / Fail Rate
                  {renderSortIcon('failure_rate')}
                </div>
              </th>
              <th
                className="py-3 px-4 cursor-pointer hover:text-warm-800 dark:text-charcoal-200 group select-none"
                onClick={() => onSortChange('avg_duration')}
              >
                <div className="flex items-center">
                  Duration (Avg / P95)
                  {renderSortIcon('avg_duration')}
                </div>
              </th>
              <th
                className="py-3 px-4 cursor-pointer hover:text-warm-800 dark:text-charcoal-200 group select-none"
                onClick={() => onSortChange('breaches')}
              >
                <div className="flex items-center">
                  SLA Compliance
                  {renderSortIcon('breaches')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-200 dark:divide-charcoal-750/60 bg-white dark:bg-charcoal-900/30">
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={5} className="py-4 px-4">
                    <div className="h-4 bg-warm-100 dark:bg-charcoal-800 rounded w-full" />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-warm-400 dark:text-charcoal-500">
                  No workflows found for this organization.
                </td>
              </tr>
            ) : (
              items.map((wf) => (
                <tr
                  key={wf.workflow_id}
                  className="hover:bg-warm-100 dark:bg-charcoal-800/40 transition-colors group"
                >
                  {/* Workflow Name */}
                  <td className="py-3.5 px-4">
                    <Link
                      to={`/workflows/${wf.workflow_id}`}
                      className="font-medium text-warm-800 dark:text-charcoal-200 hover:text-brand-600 dark:text-brand-400 transition-colors flex items-center gap-2"
                    >
                      <span>{wf.workflow_name}</span>
                      {wf.active_version_number && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-warm-100 dark:bg-charcoal-800 text-warm-500 dark:text-charcoal-400 border border-warm-300 dark:border-charcoal-700">
                          v{wf.active_version_number}
                        </span>
                      )}
                    </Link>
                  </td>

                  {/* Executions */}
                  <td className="py-3.5 px-4 font-mono font-medium text-warm-700 dark:text-charcoal-300">
                    {wf.total_executions.toLocaleString()}
                    {wf.in_flight_count > 0 && (
                      <span className="ml-2 text-[10px] text-brand-600 dark:text-brand-400">
                        ({wf.in_flight_count} active)
                      </span>
                    )}
                  </td>

                  {/* Success / Fail Rate */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-brand-600 dark:text-brand-400 font-semibold">
                          {wf.success_rate.toFixed(1)}% succ
                        </span>
                        {wf.failed_count > 0 && (
                          <span className="text-rose-400">
                            {wf.failure_rate.toFixed(1)}% fail
                          </span>
                        )}
                      </div>
                      <div className="w-28 h-1.5 bg-warm-100 dark:bg-charcoal-800 rounded-full overflow-hidden flex">
                        <div
                          className="bg-emerald-500 h-full"
                          style={{ width: `${Math.min(wf.success_rate, 100)}%` }}
                        />
                        <div
                          className="bg-rose-500 h-full"
                          style={{ width: `${Math.min(wf.failure_rate, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Duration */}
                  <td className="py-3.5 px-4 font-mono text-warm-700 dark:text-charcoal-300">
                    <div>{formatDurationMs(wf.avg_duration_ms)} <span className="text-warm-400 dark:text-charcoal-500 text-[10px]">avg</span></div>
                    <div className="text-warm-500 dark:text-charcoal-400 text-[11px]">{formatDurationMs(wf.p95_duration_ms)} <span className="text-warm-400 dark:text-charcoal-500 text-[10px]">p95</span></div>
                  </td>

                  {/* SLA Status */}
                  <td className="py-3.5 px-4">
                    {wf.has_sla ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono ${
                            wf.sla_compliance_rate >= 95
                              ? 'bg-emerald-500/15 text-brand-600 dark:text-brand-400 border border-emerald-500/30'
                              : wf.sla_compliance_rate >= 80
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          {wf.sla_compliance_rate.toFixed(1)}%
                        </span>
                        {wf.sla_breach_count > 0 && (
                          <span className="text-rose-400 text-[11px] font-mono flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3 text-rose-400" />
                            {wf.sla_breach_count}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-warm-400 dark:text-charcoal-500 text-[11px] italic">No SLA configured</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-warm-300 dark:border-charcoal-700 bg-warm-100 dark:bg-charcoal-800 text-xs text-warm-700 dark:text-charcoal-300 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-xs text-warm-500 dark:text-charcoal-400 font-mono">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-warm-300 dark:border-charcoal-700 bg-warm-100 dark:bg-charcoal-800 text-xs text-warm-700 dark:text-charcoal-300 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none transition-colors flex items-center gap-1"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
