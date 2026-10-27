import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FlaskConical,
  GitBranch,
  Loader2,
  MinusCircle,
  PauseCircle,
  Wand2,
  X,
  Play,
} from 'lucide-react';
import { WorkflowConnectionSchema, WorkflowStepSchema } from '../../../types/workflow';
import { AISimulateExecutionResponse } from '../../../types/workflowAI';
import { simulateProposalPayload, simulateProposalRun } from '../../../services/workflowService';
import { btn, focusRing, iconBtn } from './styles';

interface WorkflowTestPanelProps {
  organizationId: string;
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
  /** When true, testing is unavailable; `disabledReason` says why. */
  disabled?: boolean;
  disabledReason?: string;
  onClose: () => void;
  className?: string;
}

type Scenario = 'happy_path' | 'edge_case' | 'failure';

const SCENARIOS: Array<{ id: Scenario; label: string; hint: string }> = [
  { id: 'happy_path', label: 'Happy path', hint: 'Everything goes as expected' },
  { id: 'edge_case', label: 'Edge case', hint: 'Unusual but valid data' },
  { id: 'failure', label: 'Failure', hint: 'Data that should be rejected' },
];

const STATUS: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
  SUCCESS: { label: 'Worked', cls: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', cls: 'text-red-700 dark:text-red-400', Icon: AlertTriangle },
  WAITING_APPROVAL: { label: 'Waits for a person', cls: 'text-amber-800 dark:text-amber-300', Icon: PauseCircle },
  SKIPPED: { label: 'Skipped', cls: 'text-warm-600 dark:text-charcoal-400', Icon: MinusCircle },
};

const OUTCOME: Record<string, { text: string; box: string; Icon: React.ElementType }> = {
  COMPLETED: {
    text: 'Everything would run through to the end.',
    box: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    Icon: CheckCircle2,
  },
  TERMINATED_EARLY: {
    text: 'It would stop early, before reaching the last step.',
    box: 'border-warm-300 bg-warm-50 text-warm-900 dark:border-charcoal-700 dark:bg-charcoal-850 dark:text-charcoal-100',
    Icon: MinusCircle,
  },
  HALTED_ON_ERROR: {
    text: 'It would hit an error and stop.',
    box: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
    Icon: AlertTriangle,
  },
  PENDING_APPROVAL: {
    text: 'It would pause for a person to approve.',
    box: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    Icon: PauseCircle,
  },
};

const LIMIT_PATTERN = /limit|too many|quota|for today|tomorrow|429/i;
const errText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** Dry run of the working workflow. Uses the real simulate endpoints; nothing is sent or stored. */
export const WorkflowTestPanel: React.FC<WorkflowTestPanelProps> = ({
  organizationId,
  steps,
  connections,
  disabled = false,
  disabledReason,
  onClose,
  className = '',
}) => {
  const [scenario, setScenario] = useState<Scenario>('happy_path');
  const [payloadText, setPayloadText] = useState('');
  const [payloadSummary, setPayloadSummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AISimulateExecutionResponse | null>(null);
  const [ranSignature, setRanSignature] = useState<string | null>(null);

  const signature = useMemo(() => JSON.stringify({ steps, connections }), [steps, connections]);

  const parse = useMemo((): { value: Record<string, unknown> | null; error: string | null } => {
    if (!payloadText.trim()) return { value: null, error: null };
    try {
      const v: unknown = JSON.parse(payloadText);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        return { value: null, error: 'The sample data must be an object, like { "name": "Ana" }.' };
      }
      return { value: v as Record<string, unknown>, error: null };
    } catch {
      return { value: null, error: 'This is not valid JSON yet. Check for missing quotes, commas or brackets.' };
    }
  }, [payloadText]);

  const nameFor = (id: string, fallback: string) => steps.find((s) => s.step_key === id)?.name || fallback;

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await simulateProposalPayload(organizationId, { steps, connections, scenario });
      setPayloadText(JSON.stringify(res.payload, null, 2));
      setPayloadSummary(res.summary);
      setResult(null);
    } catch (err) {
      setError(errText(err, 'Could not make sample data right now.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const run = async () => {
    if (!parse.value) return;
    setIsRunning(true);
    setError(null);
    const sigAtRun = signature;
    try {
      const res = await simulateProposalRun(organizationId, { steps, connections, payload: parse.value });
      setResult(res);
      setRanSignature(sigAtRun);
    } catch (err) {
      setError(errText(err, 'The test could not run right now.'));
    } finally {
      setIsRunning(false);
    }
  };

  const outcome = result ? OUTCOME[result.overall_outcome] ?? OUTCOME.TERMINATED_EARLY : null;
  const stale = result !== null && ranSignature !== signature;
  const isLimit = error ? LIMIT_PATTERN.test(error) : false;

  return (
    <section
      aria-labelledby="test-panel-title"
      className={`flex flex-col border-t border-warm-300 bg-white shadow-elevated dark:border-charcoal-750 dark:bg-charcoal-900 ${className}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-warm-200 px-5 py-3 dark:border-charcoal-800">
        <div>
          <h2 id="test-panel-title" className="flex items-center gap-2 text-base font-semibold text-warm-900 dark:text-charcoal-100">
            <FlaskConical className="w-4 h-4" aria-hidden="true" />
            Test workflow
          </h2>
          <p className="text-sm font-medium text-brand-700 dark:text-brand-400">Dry run: nothing is sent or saved</p>
        </div>
        <button type="button" onClick={onClose} className={iconBtn} aria-label="Close test panel">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {disabled && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {disabledReason || 'Fix the problems in this workflow to test it.'}
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-warm-800 dark:text-charcoal-200">Scenario</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SCENARIOS.map((s) => (
              <label
                key={s.id}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-brand-500/40 ${
                  scenario === s.id
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                    : 'border-warm-300 hover:bg-warm-50 dark:border-charcoal-700 dark:hover:bg-charcoal-850'
                }`}
              >
                <input
                  type="radio"
                  name="test-scenario"
                  className="sr-only"
                  checked={scenario === s.id}
                  onChange={() => setScenario(s.id)}
                />
                <span className="block font-medium text-warm-900 dark:text-charcoal-100">{s.label}</span>
                <span className="block text-warm-600 dark:text-charcoal-400">{s.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="test-payload" className="text-sm font-medium text-warm-800 dark:text-charcoal-200">
              Sample data (you can edit it)
            </label>
            <button type="button" onClick={generate} disabled={disabled || isGenerating} className={btn.secondary}>
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 className="w-4 h-4" aria-hidden="true" />
              )}
              {isGenerating ? 'Generating…' : 'Generate sample data'}
            </button>
          </div>
          {payloadSummary && <p className="text-sm text-warm-600 dark:text-charcoal-400">{payloadSummary}</p>}
          <textarea
            id="test-payload"
            rows={7}
            spellCheck={false}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            aria-invalid={Boolean(parse.error)}
            aria-describedby={parse.error ? 'test-payload-error' : undefined}
            placeholder={'{\n  "name": "Ana"\n}'}
            className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-warm-900 placeholder:text-warm-400 dark:bg-charcoal-950 dark:text-charcoal-100 dark:placeholder:text-charcoal-600 ${
              parse.error ? 'border-red-400 dark:border-red-500/60' : 'border-warm-300 dark:border-charcoal-700'
            } ${focusRing}`}
          />
          {parse.error && (
            <p id="test-payload-error" role="alert" className="text-sm text-red-700 dark:text-red-400">
              {parse.error}
            </p>
          )}
          <button
            type="button"
            onClick={run}
            disabled={disabled || isRunning || !parse.value}
            className={btn.primary}
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
            {isRunning ? 'Testing…' : 'Run test'}
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className={`flex items-start gap-2 text-sm ${
              isLimit ? 'text-amber-800 dark:text-amber-300' : 'text-red-700 dark:text-red-400'
            }`}
          >
            {isLimit ? (
              <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            )}
            {error}
          </p>
        )}

        {result && outcome && (
          <div aria-live="polite" className="space-y-3">
            {stale && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                The workflow has changed since this test. Run it again to see current results.
              </p>
            )}
            <div className={`rounded-lg border px-4 py-3 ${outcome.box} ${stale ? 'opacity-70' : ''}`}>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <outcome.Icon className="w-4 h-4" aria-hidden="true" />
                {outcome.text}
              </p>
              <p className="mt-1 text-sm">{result.simulation_summary}</p>
            </div>
            <ol className={`divide-y divide-warm-200 rounded-lg border border-warm-300 dark:divide-charcoal-800 dark:border-charcoal-750 ${stale ? 'opacity-70' : ''}`}>
              {result.steps.map((st) => {
                const meta = STATUS[st.status] ?? STATUS.SKIPPED;
                const Icon = meta.Icon;
                const failure =
                  st.status === 'FAILED' && typeof st.simulated_output?.error === 'string'
                    ? (st.simulated_output.error as string)
                    : null;
                const hasOutput = st.simulated_output && Object.keys(st.simulated_output).length > 0;
                return (
                  <li key={st.step_id} className="px-3.5 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-warm-900 dark:text-charcoal-100">{nameFor(st.step_id, st.step_name)}</span>
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${meta.cls}`}>
                        <Icon className="w-4 h-4" aria-hidden="true" />
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 text-warm-700 dark:text-charcoal-300">{st.reasoning}</p>
                    {failure && (
                      <p className="mt-1 text-red-700 dark:text-red-400">
                        <span className="font-medium">Error: </span>
                        {failure}
                      </p>
                    )}
                    {st.branch_taken && (
                      <p className="mt-1 inline-flex items-center gap-1.5 font-medium text-warm-700 dark:text-charcoal-300">
                        <GitBranch className="w-4 h-4" aria-hidden="true" />
                        Took the "{st.branch_taken}" path
                      </p>
                    )}
                    {hasOutput && (
                      <details className="mt-1.5">
                        <summary className={`cursor-pointer rounded text-warm-600 hover:text-warm-900 dark:text-charcoal-400 dark:hover:text-charcoal-100 ${focusRing}`}>
                          View simulated output
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded-md bg-warm-100 p-2 font-mono text-xs text-warm-800 dark:bg-charcoal-950 dark:text-charcoal-200">
                          {JSON.stringify(st.simulated_output, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
};
