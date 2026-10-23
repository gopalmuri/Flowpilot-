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
    <section
      aria-label="AI help for this failed run"
      className="p-4 rounded-xl bg-teal-50/60 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800/50 space-y-3"
    >
      {!result && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-warm-700 dark:text-charcoal-300">
            <div className="font-semibold text-warm-900 dark:text-charcoal-100">Not sure what went wrong?</div>
            AI can explain it in plain language and suggest a fix you can review first.
          </div>
          <button
            type="button"
            onClick={handleExplain}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold disabled:opacity-60 transition cursor-pointer flex-shrink-0"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{isLoading ? 'Looking into it…' : 'Explain & fix with AI'}</span>
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 text-xs animate-in fade-in duration-200" aria-live="polite">
          <div>
            <div className="flex items-center gap-1.5 font-semibold text-warm-900 dark:text-charcoal-100">
              <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              What happened
            </div>
            <p className="mt-1 text-warm-700 dark:text-charcoal-300 leading-relaxed whitespace-pre-wrap">{result.explanation}</p>
            {!result.used_ai && (
              <p className="mt-1 text-[11px] text-warm-500 dark:text-charcoal-400">
                This is a quick summary because the AI helper was not available.
              </p>
            )}
          </div>

          {result.failed_steps.length > 0 && (
            <div className="space-y-1.5">
              <div className="font-semibold text-warm-900 dark:text-charcoal-100">Where it stopped</div>
              <ul className="space-y-1.5">
                {result.failed_steps.map((f) => (
                  <li key={f.step_key} className="p-2 rounded-lg bg-white/80 dark:bg-charcoal-900/70 border border-red-200 dark:border-red-800/40">
                    <div className="flex items-center gap-1.5 font-medium text-red-800 dark:text-red-300">
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      {f.name}
                    </div>
                    <div className="mt-0.5 text-warm-700 dark:text-charcoal-300">{f.error}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.next_steps.length > 0 && (
            <div className="space-y-1">
              <div className="font-semibold text-warm-900 dark:text-charcoal-100">What you can do</div>
              <ul className="space-y-1">
                {result.next_steps.map((n) => (
                  <li key={n} className="flex items-start gap-1.5 text-warm-700 dark:text-charcoal-300">
                    <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.suggested_fix && (
            <div className="p-3 rounded-lg bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 space-y-2.5">
              <div className="flex items-center gap-1.5 font-semibold text-warm-900 dark:text-charcoal-100">
                <Wrench className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                Suggested fix
              </div>
              <ProposalDiffSummary proposal={result.suggested_fix} />

              {!result.suggested_fix.valid && (
                <p role="alert" className="text-red-700 dark:text-red-400">
                  This fix has a problem and cannot be applied: {result.suggested_fix.errors.join(' ')}
                </p>
              )}

              {applied ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700 dark:text-brand-400">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Saved as a new draft
                  </span>
                  <Link
                    to={`/workflows/${workflowId}`}
                    className="font-semibold text-brand-700 dark:text-brand-400 underline underline-offset-2"
                  >
                    Open in editor
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={!result.suggested_fix.valid || isApplying || !canEdit}
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
        </div>
      )}
    </section>
  );
};
