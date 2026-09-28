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
  CheckSquare,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import {
  WorkflowRunDetail,
  WorkflowStepRun,
  WorkflowRunStatus,
  WorkflowStepRunStatus,
  ExecutionApprovalSummary,
} from '../../types/execution';
import { resumeExecution } from '../../services/executionService';
import { useAuth } from '../../context/AuthContext';

interface ExecutionTimelineDrawerProps {
  run: WorkflowRunDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onCancel?: (runId: string) => void;
  isCancelling?: boolean;
}

// Utility to safely mask secrets in payload
function maskSensitivePayload(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitivePayload);

  const masked: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('token') ||
      lower.includes('api_key') ||
      lower.includes('auth') ||
      lower.includes('credential') ||
      lower.includes('private')
    ) {
      masked[key] = '••••••••';
    } else if (typeof val === 'object' && val !== null) {
      masked[key] = maskSensitivePayload(val);
    } else {
      masked[key] = val;
    }
  }
  return masked;
}

export const ExecutionTimelineDrawer: React.FC<ExecutionTimelineDrawerProps> = ({
  run,
  isOpen,
  onClose,
  onCancel,
  isCancelling = false,
}) => {
  const { activeOrganization } = useAuth();
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [copiedCorrId, setCopiedCorrId] = useState<boolean>(false);
  const [isResuming, setIsResuming] = useState<boolean>(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  if (!isOpen || !run) return null;

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  const handleCopyCorrelationId = () => {
    navigator.clipboard.writeText(run.correlation_id);
    setCopiedCorrId(true);
    setTimeout(() => setCopiedCorrId(false), 2000);
  };

  const handleResumeRun = async () => {
    if (!activeOrganization || !run) return;
    setIsResuming(true);
    setResumeMessage(null);
    try {
      await resumeExecution(activeOrganization.id, run.id, true, 'Resumed via Control Plane');
      setResumeMessage('Resumption dispatched to engine.');
      setTimeout(() => setResumeMessage(null), 3000);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to resume execution.');
    } finally {
      setIsResuming(false);
    }
  };

  const getStatusBadge = (status: WorkflowRunStatus | WorkflowStepRunStatus) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-brand-600 dark:text-brand-400 border border-brand-600 dark:border-brand-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            COMPLETED
          </span>
        );
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800/60">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            RUNNING
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
            PENDING
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            <PauseCircle className="w-3.5 h-3.5" />
            PAUSED (APPROVAL)
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60">
            <AlertCircle className="w-3.5 h-3.5" />
            FAILED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-warm-500 dark:text-charcoal-400 border border-slate-500/20">
            <Ban className="w-3.5 h-3.5" />
            CANCELLED
          </span>
        );
      case 'SKIPPED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-600/10 text-warm-500 dark:text-charcoal-400 border border-slate-600/20">
            SKIPPED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warm-200 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300">
            {status}
          </span>
        );
    }
  };

  const canCancel = run.status === 'RUNNING' || run.status === 'PENDING' || run.status === 'PAUSED';
  const failedStep = run.step_runs?.find((s) => s.status === 'FAILED');

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white dark:bg-charcoal-900 border-l border-warm-300 dark:border-charcoal-750 h-full shadow-modal flex flex-col animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-warm-200 dark:border-charcoal-750 bg-warm-50/50 dark:bg-charcoal-850/50 flex items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-warm-500 dark:text-charcoal-400">
                Execution Observability
              </span>
              <span className="text-warm-300 dark:text-charcoal-700">&bull;</span>
              <span className="text-[10px] font-mono text-warm-500 dark:text-charcoal-400">
                {run.trigger_type}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-warm-900 dark:text-charcoal-100 tracking-tight truncate">
                {run.workflow_name || 'Lead Routing Pipeline'}
              </h2>
              {getStatusBadge(run.status)}
            </div>

            {/* Correlation ID with Copy Button */}
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-xs font-mono text-warm-600 dark:text-charcoal-400 bg-warm-100 dark:bg-charcoal-800 px-2 py-0.5 rounded border border-warm-200 dark:border-charcoal-700">
                {run.correlation_id}
              </span>
              <button
                type="button"
                onClick={handleCopyCorrelationId}
                className="p-1 rounded text-warm-500 hover:text-warm-800 dark:text-charcoal-400 dark:hover:text-charcoal-100 transition-colors"
                title="Copy Correlation ID"
              >
                {copiedCorrId ? <Check className="w-3.5 h-3.5 text-brand-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              {copiedCorrId && (
                <span className="text-[10px] text-brand-600 dark:text-brand-400 font-semibold animate-in fade-in">
                  Copied!
                </span>
              )}

              {run.workflow_id && (
                <a
                  href={`/workflows/${run.workflow_id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 dark:text-brand-400 hover:underline ml-2"
                >
                  <span>View Workflow</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close execution details"
            className="p-1.5 rounded-lg text-warm-500 hover:text-warm-800 dark:text-charcoal-400 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Metadata KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-warm-100/60 dark:bg-charcoal-850/60 border border-warm-200 dark:border-charcoal-750 text-xs">
            <div>
              <span className="text-warm-500 dark:text-charcoal-400 text-[10px] uppercase font-bold tracking-wider block">
                Started
              </span>
              <span className="font-semibold text-warm-900 dark:text-charcoal-100 text-[11px] font-mono">
                {run.started_at ? new Date(run.started_at).toLocaleTimeString() : 'N/A'}
              </span>
            </div>

            <div>
              <span className="text-warm-500 dark:text-charcoal-400 text-[10px] uppercase font-bold tracking-wider block">
                Completed
              </span>
              <span className="font-semibold text-warm-900 dark:text-charcoal-100 text-[11px] font-mono">
                {run.completed_at ? new Date(run.completed_at).toLocaleTimeString() : 'In-flight'}
              </span>
            </div>

            <div>
              <span className="text-warm-500 dark:text-charcoal-400 text-[10px] uppercase font-bold tracking-wider block">
                Duration
              </span>
              <span className="font-semibold text-warm-900 dark:text-charcoal-100 text-[11px] font-mono">
                {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(2)}s` : 'N/A'}
              </span>
            </div>

            <div>
              <span className="text-warm-500 dark:text-charcoal-400 text-[10px] uppercase font-bold tracking-wider block">
                Step Count
              </span>
              <span className="font-semibold text-warm-900 dark:text-charcoal-100 text-[11px]">
                {run.step_runs?.length || 0} steps
              </span>
            </div>
          </div>

          {/* Visual DAG Progression Pipeline Strip */}
          {run.step_runs && run.step_runs.length > 0 && (
            <div className="p-3.5 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 space-y-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-warm-500 dark:text-charcoal-400 block">
                Progress Pipeline
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 text-xs">
                {run.step_runs.map((step, idx) => (
                  <React.Fragment key={step.id}>
                    <div
                      onClick={() => toggleStep(step.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-all ${
                        step.status === 'COMPLETED'
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-brand-200 dark:border-brand-800 text-brand-800 dark:text-brand-300'
                          : step.status === 'FAILED'
                          ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                          : step.status === 'RUNNING'
                          ? 'bg-brand-50 dark:bg-brand-950/40 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
                          : 'bg-warm-100 dark:bg-charcoal-800 border-warm-200 dark:border-charcoal-700 text-warm-600 dark:text-charcoal-400'
                      }`}
                    >
                      {step.status === 'COMPLETED' ? (
                        <CheckCircle2 className="w-3 h-3 text-brand-600 dark:text-brand-400 flex-shrink-0" />
                      ) : step.status === 'FAILED' ? (
                        <XCircle className="w-3 h-3 text-red-600 dark:text-red-400 flex-shrink-0" />
                      ) : step.status === 'RUNNING' ? (
                        <Loader2 className="w-3 h-3 text-brand-600 animate-spin flex-shrink-0" />
                      ) : (
                        <Clock className="w-3 h-3 text-warm-400 flex-shrink-0" />
                      )}
                      <span className="capitalize">{step.step_type ? step.step_type.toLowerCase().replace(/_/g, " ") : `Step ${idx + 1}`}</span>
                    </div>
                    {idx < run.step_runs.length - 1 && (
                      <ArrowRight className="w-3 h-3 text-warm-400 dark:text-charcoal-600 flex-shrink-0" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Diagnostic Failure Banner (If run or step failed) */}
          {(run.status === 'FAILED' || failedStep) && (
            <div className="p-4 rounded-xl bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 space-y-2.5">
              <div className="flex items-center gap-2 text-red-800 dark:text-red-300 font-semibold text-xs">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                <span>Execution Diagnostic &bull; Failure Root Cause</span>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-red-700 dark:text-red-400 font-medium">Failed at step:</span>
                  <span className="font-mono font-bold text-red-900 dark:text-red-200">
                    {failedStep?.step_key || 'Unknown step'} ({failedStep?.step_type || 'TASK'})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-red-700 dark:text-red-400 font-medium">Error Category:</span>
                  <span className="font-mono text-red-800 dark:text-red-300">
                    {failedStep?.error_message?.includes('timeout')
                      ? 'TIMEOUT'
                      : failedStep?.error_message?.includes('validation')
                      ? 'VALIDATION_FAILED'
                      : 'STEP_EXECUTION_ERROR'}
                  </span>
                </div>

                <div className="mt-2 p-2.5 rounded-lg bg-white/80 dark:bg-charcoal-900/80 border border-red-200 dark:border-red-800/40 font-mono text-[11px] text-red-700 dark:text-red-300 overflow-x-auto">
                  {failedStep?.error_message || 'Step encountered an unhandled exception or failed condition rule.'}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyCorrelationId}
                  className="px-2.5 py-1 rounded bg-white dark:bg-charcoal-900 border border-red-200 dark:border-red-800/60 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy Correlation ID</span>
                </button>

                {run.status === 'PAUSED' && (
                  <button
                    type="button"
                    disabled={isResuming}
                    onClick={handleResumeRun}
                    className="px-2.5 py-1 rounded bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 flex items-center gap-1"
                  >
                    {isResuming ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    <span>Resume Execution</span>
                  </button>
                )}
              </div>
              {resumeMessage && (
                <span className="text-xs text-brand-600 font-medium block">{resumeMessage}</span>
              )}
            </div>
          )}

          {/* Human Review & Approvals History */}
          {run.approvals && run.approvals.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-warm-700 dark:text-charcoal-300 flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-amber-600 dark:text-amber-500" />
                <span>Approval Review History ({run.approvals.length})</span>
              </h3>

              <div className="space-y-2">
                {run.approvals.map((appr: ExecutionApprovalSummary) => (
                  <div
                    key={appr.id}
                    className="p-3.5 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-warm-900 dark:text-charcoal-100">
                          {appr.reviewer_name || 'Authorized Reviewer'}
                        </span>
                        <span className="text-warm-500 dark:text-charcoal-400 font-mono text-[11px]">
                          ({appr.reviewer_email})
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          appr.status === 'APPROVED'
                            ? 'bg-brand-100 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        {appr.status}
                      </span>
                    </div>

                    {appr.comment && (
                      <p className="text-warm-700 dark:text-charcoal-300 italic bg-white dark:bg-charcoal-900 p-2 rounded-lg border border-warm-200 dark:border-charcoal-750">
                        "{appr.comment}"
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-warm-500 dark:text-charcoal-400 pt-1">
                      <span>Requested: {new Date(appr.created_at).toLocaleString()}</span>
                      {appr.resolved_at && (
                        <span>Resolved: {new Date(appr.resolved_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Initial Trigger Payload */}
          {run.trigger_payload && (
            <div className="rounded-xl border border-warm-200 dark:border-charcoal-750 overflow-hidden bg-warm-100/50 dark:bg-charcoal-850/50 text-xs">
              <div className="px-4 py-2.5 bg-warm-200/60 dark:bg-charcoal-800/40 flex items-center justify-between font-semibold text-warm-800 dark:text-charcoal-200">
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                  <span>Initial Trigger Payload</span>
                </span>
                <span className="text-[10px] font-mono text-warm-500 dark:text-charcoal-400">
                  Sanitized
                </span>
              </div>
              <pre className="p-3 text-[11px] font-mono text-warm-700 dark:text-charcoal-300 overflow-x-auto bg-warm-50 dark:bg-charcoal-950">
                {JSON.stringify(maskSensitivePayload(run.trigger_payload), null, 2)}
              </pre>
            </div>
          )}

          {/* Step Timeline (Strict title match for test: Step Execution Timeline (count)) */}
          <div>
            <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-600 dark:text-brand-400" />
              <span>Step Execution Timeline ({run.step_runs?.length || 0})</span>
            </h3>

            {!run.step_runs || run.step_runs.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-warm-200/50 dark:bg-charcoal-800/20 border border-warm-200 dark:border-charcoal-750 text-warm-500 dark:text-charcoal-400 text-xs">
                No step executions recorded for this run yet.
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-warm-200 dark:before:bg-charcoal-800">
                {run.step_runs.map((step: WorkflowStepRun) => {
                  const isExpanded = !!expandedSteps[step.id];
                  return (
                    <div key={step.id} className="relative group">
                      {/* Timeline Node Dot */}
                      <div
                        className={`absolute -left-6 top-2 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-white dark:bg-charcoal-900 ${
                          step.status === 'COMPLETED'
                            ? 'border-brand-600 dark:border-brand-500 text-brand-600'
                            : step.status === 'RUNNING'
                            ? 'border-brand-600 dark:border-brand-500 text-brand-600'
                            : step.status === 'FAILED'
                            ? 'border-red-500 text-red-500'
                            : 'border-warm-300 dark:border-charcoal-700 text-warm-500'
                        }`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            step.status === 'COMPLETED'
                              ? 'bg-brand-600 dark:bg-brand-500'
                              : step.status === 'RUNNING'
                              ? 'bg-brand-500 animate-ping'
                              : step.status === 'FAILED'
                              ? 'bg-red-500'
                              : 'bg-warm-400 dark:bg-charcoal-600'
                          }`}
                        />
                      </div>

                      {/* Step Card */}
                      <div className="rounded-xl border border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-850 overflow-hidden transition hover:border-warm-300 dark:hover:border-charcoal-700">
                        <div
                          onClick={() => toggleStep(step.id)}
                          className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-warm-900 dark:text-charcoal-100 text-xs sm:text-sm">
                                {step.step_key || 'Step'}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-warm-100 dark:bg-charcoal-800 text-warm-600 dark:text-charcoal-400 border border-warm-200 dark:border-charcoal-700">
                                {step.step_type || 'TASK'}
                              </span>
                            </div>
                            <span className="text-[11px] text-warm-500 dark:text-charcoal-400 mt-1 block">
                              Duration: {step.execution_time_ms != null ? `${step.execution_time_ms}ms` : 'N/A'}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            {getStatusBadge(step.status)}
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-warm-500 dark:text-charcoal-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-warm-500 dark:text-charcoal-400" />
                            )}
                          </div>
                        </div>

                        {/* Collapsible Step Details */}
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-warm-200 dark:border-charcoal-750/60 pt-3 space-y-3 text-xs">
                            {step.error_message && (
                              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800/40 dark:text-red-300 font-mono text-[11px]">
                                {step.error_message}
                              </div>
                            )}

                            {step.output_data && Object.keys(step.output_data).length > 0 && (
                              <div>
                                <span className="text-warm-500 dark:text-charcoal-400 text-[11px] block mb-1 font-medium">
                                  Output Data
                                </span>
                                <pre className="p-2.5 rounded-lg bg-warm-50 dark:bg-charcoal-950 font-mono text-[11px] text-warm-700 dark:text-charcoal-300 overflow-x-auto">
                                  {JSON.stringify(step.output_data, null, 2)}
                                </pre>
                              </div>
                            )}

                            {step.input_data && Object.keys(step.input_data).length > 0 && (
                              <div>
                                <span className="text-warm-500 dark:text-charcoal-400 text-[11px] block mb-1 font-medium">
                                  Input Data (Sanitized)
                                </span>
                                <pre className="p-2.5 rounded-lg bg-warm-50 dark:bg-charcoal-950 font-mono text-[11px] text-warm-700 dark:text-charcoal-300 overflow-x-auto">
                                  {JSON.stringify(maskSensitivePayload(step.input_data), null, 2)}
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
          <div className="p-4 border-t border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-900/80 flex items-center justify-between">
            <span className="text-xs text-warm-500 dark:text-charcoal-400">Run is currently active.</span>
            <button
              type="button"
              onClick={() => onCancel(run.id)}
              disabled={isCancelling}
              title="Cancel Execution"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60 hover:bg-rose-500/20 transition disabled:opacity-50 cursor-pointer"
            >
              {isCancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
              <span>Cancel Execution</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
