import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, Wrench, ArrowRight, ShieldCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { AIRunExplainResponse } from '../../types/workflowAI';
import { applyProposalAsNewDraft, explainRunWithAI } from '../../services/workflowService';
import { ProposalDiffSummary } from '../workflow/ai/ProposalDiffSummary';

interface RunExplainPanelProps {
  organizationId: string;
  workflowId: string;
  runId: string;
  canEdit?: boolean;
}

/** "Explain & fix with AI" for a failed run. Fixes are always applied as a NEW draft, never in place. */
export const RunExplainPanel: React.FC<RunExplainPanelProps> = ({ organizationId, workflowId, runId, canEdit = true }) => {
  const navigate = useNavigate();
  const { showToast, showError } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AIRunExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleExplain = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setResult(await explainRunWithAI(organizationId, workflowId, runId));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The AI helper could not look at this run right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    const fix = result?.suggested_fix;
    if (!fix || !fix.valid || isApplying) return;
    setIsApplying(true);
    try {
      await applyProposalAsNewDraft(organizationId, workflowId, result?.base_version_id, fix);
      setApplied(true);
      showToast({
        type: 'success',
        title: 'New draft created',
        message: 'The fix is saved as a new draft. Your live workflow is unchanged until you publish it.',
        action: { label: 'Open in editor', onClick: () => navigate(`/workflows/${workflowId}`) },
      });
    } catch (err) {
      showError(err instanceof Error && err.message ? err.message : 'Could not save the fix as a draft.', 'Fix not applied');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <section aria-label="AI help for this failed run" className="border-t border-warm-200 dark:border-charcoal-800 pt-4 space-y-4">
      {!result && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-warm-700 dark:text-charcoal-300">
            <span className="font-medium text-warm-900 dark:text-charcoal-100">Not sure what went wrong?</span> AI can
            explain it in plain language and suggest a fix you can review first.
          </p>
          <button
            type="button"
            onClick={handleExplain}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium disabled:opacity-60 transition cursor-pointer flex-shrink-0"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{isLoading ? 'Looking into it…' : 'Explain & fix with AI'}</span>
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-5 text-sm animate-in fade-in duration-200" aria-live="polite">
          <div>
            <h3 className="flex items-center gap-1.5 font-semibold text-warm-900 dark:text-charcoal-100">
              <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              What happened
            </h3>
            <p className="mt-1 text-warm-700 dark:text-charcoal-300 leading-relaxed whitespace-pre-wrap">{result.explanation}</p>
            {!result.used_ai && (
              <p className="mt-1 text-xs text-warm-500 dark:text-charcoal-400">
                This is a quick summary because the AI helper was not available.
              </p>
            )}
          </div>

          {result.failed_steps.length > 0 && (
            <div>
              <h3 className="font-semibold text-warm-900 dark:text-charcoal-100">Where it stopped</h3>
              <ul className="mt-1 space-y-2">
                {result.failed_steps.map((f) => (
                  <li key={f.step_key}>
                    <div className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      {f.name}
                    </div>
                    <div className="pl-5 text-warm-700 dark:text-charcoal-300">{f.error}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.next_steps.length > 0 && (
            <div>
              <h3 className="font-semibold text-warm-900 dark:text-charcoal-100">What you can do</h3>
              <ul className="mt-1 space-y-1">
                {result.next_steps.map((n) => (
                  <li key={n} className="flex items-start gap-1.5 text-warm-700 dark:text-charcoal-300">
                    <ArrowRight className="w-3.5 h-3.5 mt-1 flex-shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.suggested_fix && (
            <div className="border-t border-warm-200 dark:border-charcoal-800 pt-4 space-y-3">
              <h3 className="flex items-center gap-1.5 font-semibold text-warm-900 dark:text-charcoal-100">
                <Wrench className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                Suggested fix
              </h3>
              <ProposalDiffSummary proposal={result.suggested_fix} />

              {!result.suggested_fix.valid && (
                <p role="alert" className="text-red-700 dark:text-red-400">
                  This fix has a problem and cannot be applied: {result.suggested_fix.errors.join(' ')}
                </p>
              )}

              {applied ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 font-medium text-brand-700 dark:text-brand-400">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Saved as a new draft
                  </span>
                  <Link to={`/workflows/${workflowId}`} className="font-medium text-brand-700 dark:text-brand-400 underline underline-offset-2">
                    Open in editor
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={!result.suggested_fix.valid || isApplying || !canEdit}
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
        </div>
      )}
    </section>
  );
};
