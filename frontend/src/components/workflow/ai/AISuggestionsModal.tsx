import React, { useEffect, useRef, useState } from 'react';
import { Lightbulb, X, Loader2, AlertTriangle, Info, OctagonAlert, CheckCircle2, ShieldCheck } from 'lucide-react';
import { AISuggestionSeverity, AISuggestionsResponse, AIWorkflowStats } from '../../../types/workflowAI';
import { WorkflowVersionDetail } from '../../../types/workflow';
import { applyProposalAsNewDraft, getAISuggestions } from '../../../services/workflowService';
import { ProposalDiffSummary } from './ProposalDiffSummary';

interface AISuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  workflowId: string;
  canEdit: boolean;
  /** Called with the new draft version after "Apply as new draft" succeeds. */
  onDraftApplied: (version: WorkflowVersionDetail) => void;
}

const SEVERITY_STYLE: Record<AISuggestionSeverity, { label: string; box: string; icon: React.ElementType; iconClass: string }> = {
  critical: {
    label: 'Needs attention',
    box: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/60',
    icon: OctagonAlert,
    iconClass: 'text-red-600 dark:text-red-400',
  },
  warning: {
    label: 'Worth a look',
    box: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60',
    icon: AlertTriangle,
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    label: 'Good to know',
    box: 'bg-warm-50 dark:bg-charcoal-850 border-warm-200 dark:border-charcoal-750',
    icon: Info,
    iconClass: 'text-teal-600 dark:text-teal-400',
  },
};

/** Turns raw numbers into sentences a non-technical person can read at a glance. */
export function describeStats(stats: AIWorkflowStats): string[] {
  const lines: string[] = [];
  const days = stats.window_days;
  if (stats.total_runs === 0) {
    lines.push(`This workflow has not run in the last ${days} days.`);
  } else {
    const pct = Math.round(stats.failure_rate * 100);
    lines.push(
      `${pct}% of runs failed in the last ${days} days (${stats.failed_runs} of ${stats.total_runs}).`
    );
  }
  if (stats.pending_approvals > 0) {
    lines.push(
      `${stats.pending_approvals} ${stats.pending_approvals === 1 ? 'approval is' : 'approvals are'} waiting for a decision.`
    );
  }
  if (typeof stats.avg_approval_wait_hours === 'number') {
    lines.push(`Approvals take about ${Math.round(stats.avg_approval_wait_hours * 10) / 10} hours on average.`);
  }
  return lines;
}

function failingStepLabel(row: Record<string, unknown>): string {
  const name = row.name ?? row.step_name ?? row.step_key;
  const count = row.failures ?? row.count ?? row.failed_runs;
  const label = typeof name === 'string' && name ? name : 'A step';
  return typeof count === 'number' ? `${label} (${count} ${count === 1 ? 'failure' : 'failures'})` : label;
}

export const AISuggestionsModal: React.FC<AISuggestionsModalProps> = ({
  isOpen,
  onClose,
  organizationId,
  workflowId,
  canEdit,
  onDraftApplied,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<AISuggestionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Runs only when the person opens the panel (a click), never in the background.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setData(null);
    setApplied(false);
    setApplyError(null);
    getAISuggestions(organizationId, workflowId)
      .then((res) => !cancelled && setData(res))
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : 'Could not load suggestions right now.');
      })
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, organizationId, workflowId]);

  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleApply = async () => {
    const proposal = data?.proposal;
    if (!proposal || !proposal.valid || isApplying) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      const version = await applyProposalAsNewDraft(organizationId, workflowId, data?.base_version_id, proposal);
      setApplied(true);
      onDraftApplied(version);
    } catch (err) {
      setApplyError(err instanceof Error && err.message ? err.message : 'Could not save the change as a draft.');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-suggestions-title"
        className="w-full max-w-lg bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl shadow-modal max-h-[90vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-warm-200 dark:border-charcoal-800">
          <div>
            <h2 id="ai-suggestions-title" className="flex items-center gap-2 text-base font-bold text-warm-900 dark:text-charcoal-100">
              <Lightbulb className="w-4 h-4 text-amber-500" aria-hidden="true" />
              Ideas to improve this workflow
            </h2>
            <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-0.5">Based on how it has been running lately.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close suggestions"
            className="p-1.5 rounded-lg text-warm-500 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4" aria-live="polite">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-warm-700 dark:text-charcoal-300 py-6 justify-center" role="status">
              <Loader2 className="w-4 h-4 animate-spin text-teal-600" aria-hidden="true" />
              Looking at recent runs…
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}

          {data && (
            <>
              <div className="p-3 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 space-y-1">
                {describeStats(data.stats).map((line) => (
                  <p key={line} className="text-sm text-warm-800 dark:text-charcoal-200">
                    {line}
                  </p>
                ))}
                {data.stats.top_failing_steps.length > 0 && (
                  <p className="text-xs text-warm-600 dark:text-charcoal-400">
                    Most often stuck: {data.stats.top_failing_steps.map(failingStepLabel).join(', ')}.
                  </p>
                )}
              </div>

              {data.suggestions.length === 0 ? (
                <p className="text-sm text-warm-700 dark:text-charcoal-300">
                  Nothing to suggest right now. This workflow looks healthy.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {data.suggestions.map((s) => {
                    const sev = SEVERITY_STYLE[s.severity] ?? SEVERITY_STYLE.info;
                    const Icon = sev.icon;
                    return (
                      <li key={s.id} className={`p-3 rounded-xl border ${sev.box}`}>
                        <div className="flex items-start gap-2.5">
                          <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${sev.iconClass}`} aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">{s.title}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wide text-warm-600 dark:text-charcoal-400">
                                {sev.label}
                              </span>
                            </div>
                            <p className="text-xs text-warm-700 dark:text-charcoal-300 mt-0.5 leading-relaxed">{s.detail}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {data.proposal && (
                <div className="p-3 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 space-y-2.5">
                  <div className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Suggested change</div>
                  <ProposalDiffSummary proposal={data.proposal} />
                  {!data.proposal.valid && (
                    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
                      This change has a problem and cannot be applied: {data.proposal.errors.join(' ')}
                    </p>
                  )}
                  {applyError && (
                    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
                      {applyError}
                    </p>
                  )}
                  {applied ? (
                    <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 dark:text-brand-400">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Saved as a new draft and opened in the editor.
                    </p>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <button
                        type="button"
                        onClick={handleApply}
                        disabled={!data.proposal.valid || isApplying || !canEdit}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        {isApplying && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                        <span>Apply as new draft</span>
                      </button>
                      <span className="inline-flex items-center gap-1 text-[11px] text-warm-600 dark:text-charcoal-400">
                        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                        Your live workflow is not changed.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {!data.used_ai && (
                <p className="text-[11px] text-warm-500 dark:text-charcoal-400">
                  These ideas come from your run numbers only; the AI helper was not available.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
