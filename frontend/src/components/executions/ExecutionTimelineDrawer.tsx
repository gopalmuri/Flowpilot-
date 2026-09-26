import React, { useState } from 'react';
import {
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Terminal,
  PauseCircle,
  Ban,
  Activity,
  CheckSquare,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  WorkflowRunDetail,
  WorkflowStepRun,
  WorkflowRunStatus,
  WorkflowStepRunStatus,
  ExecutionApprovalSummary,
} from '../../types/execution';

interface ExecutionTimelineDrawerProps {
  run: WorkflowRunDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onCancel?: (runId: string) => void;
  isCancelling?: boolean;
}

export const ExecutionTimelineDrawer: React.FC<ExecutionTimelineDrawerProps> = ({
  run,
  isOpen,
  onClose,
  onCancel,
  isCancelling = false,
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  if (!isOpen || !run) return null;

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  const getStatusBadge = (status: WorkflowRunStatus | WorkflowStepRunStatus) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            COMPLETED
          </span>
        );
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            RUNNING
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
            PENDING
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <PauseCircle className="w-3.5 h-3.5" />
            PAUSED (APPROVAL)
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            FAILED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
            <Ban className="w-3.5 h-3.5" />
            CANCELLED
          </span>
        );
      case 'SKIPPED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-600/10 text-slate-400 border border-slate-600/20">
            SKIPPED
          </span>
        );
      default:
        return null;
    }
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            APPROVED
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3 h-3" />
            REJECTED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3 h-3" />
            PENDING
          </span>
        );
    }
  };

  const calculateDuration = (started: string, completed?: string | null) => {
    if (!completed) return 'In progress';
    const s = new Date(started).getTime();
    const c = new Date(completed).getTime();
    const diff = c - s;
    if (diff < 1000) return `${diff}ms`;
    return `${(diff / 1000).toFixed(2)}s`;
  };

  const canCancel = run.status === 'RUNNING' || run.status === 'PENDING' || run.status === 'PAUSED';

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full text-slate-200">
        {/* Drawer Header */}
        <div className="px-6 py-5 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white tracking-tight">
                  {run.workflow_name || 'Execution Details'}
                </h2>
                {getStatusBadge(run.status)}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">Run: {run.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 text-xs">
            <div>
              <span className="text-slate-400 block mb-1">Trigger Type</span>
              <span className="font-medium text-slate-200 uppercase">{run.trigger_type}</span>
            </div>
            <div>
              <span className="text-slate-400 block mb-1">Duration</span>
              <span className="font-medium text-slate-200">
                {run.duration_ms != null ? `${run.duration_ms}ms` : calculateDuration(run.started_at, run.completed_at)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block mb-1">Started</span>
              <span className="font-medium text-slate-200">{new Date(run.started_at).toLocaleTimeString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block mb-1">Correlation ID</span>
              <span className="font-mono text-slate-200 truncate block" title={run.correlation_id}>
                {run.correlation_id || 'N/A'}
              </span>
            </div>
          </div>

          {/* Error Banner if Failed */}
          {run.error_message && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-rose-400">
                <AlertCircle className="w-4 h-4" />
                Execution Error
              </div>
              <p className="font-mono whitespace-pre-wrap">{run.error_message}</p>
            </div>
          )}

          {/* Human Approvals Section */}
          {run.approvals && run.approvals.length > 0 && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-indigo-300 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                  Human Approval Records ({run.approvals.length})
                </span>
              </div>
              <div className="space-y-2">
                {run.approvals.map((appr: ExecutionApprovalSummary) => (
                  <div key={appr.id} className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-medium text-slate-200">
                          {appr.reviewer_name || appr.reviewer_email || (appr.status === 'PENDING' ? 'Awaiting Review' : 'Authorized Approver')}
                        </span>
                      </div>
                      {getApprovalBadge(appr.status)}
                    </div>
                    {appr.comment && (
                      <p className="text-slate-300 text-[11px] italic bg-slate-950/50 p-2 rounded border border-slate-800/80">
                        "{appr.comment}"
                      </p>
                    )}
                    <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1">
                      <span>Requested: {new Date(appr.created_at).toLocaleString()}</span>
                      {appr.resolved_at && <span>Resolved: {new Date(appr.resolved_at).toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trigger Payload Accordion */}
          {run.trigger_payload && Object.keys(run.trigger_payload).length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden text-xs">
              <div className="px-4 py-3 bg-slate-800/30 flex items-center justify-between font-medium text-slate-300">
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  Initial Trigger Payload
                </span>
              </div>
              <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto">
                {JSON.stringify(run.trigger_payload, null, 2)}
              </pre>
            </div>
          )}

          {/* Step Timeline */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              Step Execution Timeline ({run.step_runs?.length || 0})
            </h3>

            {(!run.step_runs || run.step_runs.length === 0) ? (
              <div className="p-8 text-center rounded-xl bg-slate-800/20 border border-slate-800 text-slate-400 text-xs">
                No step executions recorded for this run yet.
              </div>
            ) : (
              <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {run.step_runs.map((step: WorkflowStepRun) => {
                  const isExpanded = !!expandedSteps[step.id];
                  return (
                    <div key={step.id} className="relative group">
                      {/* Timeline Node Dot */}
                      <div
                        className={`absolute -left-6 top-1 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-slate-900 ${
                          step.status === 'COMPLETED'
                            ? 'border-emerald-500 text-emerald-400'
                            : step.status === 'RUNNING'
                            ? 'border-indigo-500 text-indigo-400'
                            : step.status === 'FAILED'
                            ? 'border-rose-500 text-rose-400'
                            : 'border-slate-700 text-slate-500'
                        }`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            step.status === 'COMPLETED'
                              ? 'bg-emerald-400'
                              : step.status === 'RUNNING'
                              ? 'bg-cyan-400 animate-ping'
                              : step.status === 'FAILED'
                              ? 'bg-rose-400'
                              : 'bg-slate-500'
                          }`}
                        />
                      </div>

                      {/* Step Card */}
                      <div className="rounded-xl border border-slate-800 bg-slate-800/30 overflow-hidden transition hover:border-slate-700">
                        <div
                          onClick={() => toggleStep(step.id)}
                          className="p-4 flex items-center justify-between cursor-pointer select-none"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white text-sm">
                                {step.step_key || 'Step'}
                              </span>
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                                {step.step_type || 'TASK'}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400 mt-1 block">
                              Duration: {step.execution_time_ms != null ? `${step.execution_time_ms}ms` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            {getStatusBadge(step.status)}
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </div>

                        {/* Collapsible Details */}
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-slate-800/60 pt-3 space-y-3 text-xs">
                            {step.error_message && (
                              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono text-[11px]">
                                {step.error_message}
                              </div>
                            )}

                            {step.output_data && Object.keys(step.output_data).length > 0 && (
                              <div>
                                <span className="text-slate-400 text-[11px] block mb-1 font-medium">Output Data</span>
                                <pre className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 overflow-x-auto">
                                  {JSON.stringify(step.output_data, null, 2)}
                                </pre>
                              </div>
                            )}

                            {step.input_data && Object.keys(step.input_data).length > 0 && (
                              <div>
                                <span className="text-slate-400 text-[11px] block mb-1 font-medium">Input Data</span>
                                <pre className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 overflow-x-auto">
                                  {JSON.stringify(step.input_data, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer Actions */}
        {canCancel && onCancel && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between">
            <span className="text-xs text-slate-400">Run is currently active.</span>
            <button
              onClick={() => onCancel(run.id)}
              disabled={isCancelling}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition disabled:opacity-50"
            >
              {isCancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
              Cancel Execution
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
