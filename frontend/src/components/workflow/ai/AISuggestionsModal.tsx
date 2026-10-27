import React, { useEffect, useRef, useState } from 'react';
import { Lightbulb, X, Loader2, CheckCircle2, ShieldCheck } from 'lucide-react';
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

const SEVERITY_STYLE: Record<AISuggestionSeverity, { label: string; dot: string }> = {
  critical: { label: 'Needs attention', dot: 'bg-red-500' },
  warning: { label: 'Worth a look', dot: 'bg-amber-500' },
  info: { label: 'Good to know', dot: 'bg-teal-500' },
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
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 id="ai-suggestions-title" className="flex items-center gap-2 text-base font-semibold text-warm-900 dark:text-charcoal-100">
              <Lightbulb className="w-4 h-4 text-amber-500" aria-hidden="true" />
              Ideas to improve this workflow
            </h2>
            <p className="text-sm text-warm-600 dark:text-charcoal-400 mt-0.5">Based on how it has been running lately.</p>
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

        <div className="px-5 pb-5 overflow-y-auto space-y-5" aria-live="polite">
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
              <div className="border-t border-warm-200 dark:border-charcoal-800 pt-4">
                {data.stats.total_runs > 0 && (
                  <dl className="grid grid-cols-3 gap-4 mb-3">
                    <div>
                      <dd className="text-2xl font-semibold text-warm-900 dark:text-charcoal-100">{data.stats.total_runs}</dd>
                      <dt className="text-xs text-warm-600 dark:text-charcoal-400">runs</dt>
                    </div>
                    <div>
                      <dd className="text-2xl font-semibold text-warm-900 dark:text-charcoal-100">{data.stats.failed_runs}</dd>
                      <dt className="text-xs text-warm-600 dark:text-charcoal-400">failed</dt>
                    </div>
                    <div>
                      <dd className="text-2xl font-semibold text-warm-900 dark:text-charcoal-100">{data.stats.pending_approvals}</dd>
                      <dt className="text-xs text-warm-600 dark:text-charcoal-400">waiting for approval</dt>
                    </div>
                  </dl>
                )}
                {describeStats(data.stats).map((line) => (
                  <p key={line} className="text-sm text-warm-700 dark:text-charcoal-300">
                    {line}
                  </p>
                ))}
                {data.stats.top_failing_steps.length > 0 && (
                  <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-1">
                    Most often stuck: {data.stats.top_failing_steps.map(failingStepLabel).join(', ')}.
                  </p>
                )}
              </div>

              {data.suggestions.length === 0 ? (
                <p className="text-sm text-warm-700 dark:text-charcoal-300">
                  Nothing to suggest right now. This workflow looks healthy.
                </p>
              ) : (
                <ul className="divide-y divide-warm-200 dark:divide-charcoal-800 border-t border-warm-200 dark:border-charcoal-800">
                  {data.suggestions.map((s) => {
                    const sev = SEVERITY_STYLE[s.severity] ?? SEVERITY_STYLE.info;
                    return (
                      <li key={s.id} className="py-3 flex items-start gap-3">
                        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${sev.dot}`} aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-warm-900 dark:text-charcoal-100">
                            {s.title}
                            <span className="ml-2 text-xs font-normal text-warm-500 dark:text-charcoal-400">{sev.label}</span>
                          </div>
                          <p className="text-sm text-warm-600 dark:text-charcoal-400 mt-0.5 leading-relaxed">{s.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {data.proposal && (
                <div className="border-t border-warm-200 dark:border-charcoal-800 pt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Suggested change</h3>
                  <ProposalDiffSummary proposal={data.proposal} />
                  {!data.proposal.valid && (
                    <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                      This change has a problem and cannot be applied: {data.proposal.errors.join(' ')}
                    </p>
                  )}
                  {applyError && (
                    <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                      {applyError}
                    </p>
                  )}
                  {applied ? (
                    <p className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-400">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      Saved as a new draft and opened in the editor.
                    </p>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <button
                        type="button"
                        onClick={handleApply}
                        disabled={!data.proposal.valid || isApplying || !canEdit}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        {isApplying && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                        <span>Apply as new draft</span>
                      </button>
                      <span className="inline-flex items-center gap-1 text-xs text-warm-500 dark:text-charcoal-400">
                        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                        Your live workflow is not changed.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {!data.used_ai && (
                <p className="text-xs text-warm-500 dark:text-charcoal-400">
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
