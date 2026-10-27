import React, { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, X, Minus } from 'lucide-react';
import { DEMO_SCENARIO, DEMO_TRACE_REF, LIFECYCLE_STAGES } from './landingContent';
import { usePrefersReducedMotion } from './motion';

type Decision = 'approved' | 'rejected';
type StageState = 'pending' | 'running' | 'done' | 'rejected' | 'skipped';

const TOTAL = LIFECYCLE_STAGES.length;
const APPROVE_INDEX = LIFECYCLE_STAGES.findIndex((s) => s.id === 'approve');
const EXECUTE_INDEX = LIFECYCLE_STAGES.findIndex((s) => s.id === 'execute');
const TICK_MS = 750;

const STATE_LABEL: Record<StageState, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Completed',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

const stateOf = (i: number, progress: number, playing: boolean, decision: Decision): StageState => {
  if (i < progress) {
    if (i === APPROVE_INDEX && decision === 'rejected') return 'rejected';
    if (i === EXECUTE_INDEX && decision === 'rejected') return 'skipped';
    return 'done';
  }
  if (i === progress && playing) return 'running';
  return 'pending';
};

const chipClass = (s: StageState) =>
  s === 'done' ? 'lp-chip lp-chip--ok' : s === 'running' ? 'lp-chip lp-chip--run' : s === 'rejected' ? 'lp-chip lp-chip--bad' : 'lp-chip';

const dotClass = (s: StageState) =>
  s === 'done' ? 'lp-dot lp-dot--done' : s === 'running' ? 'lp-dot lp-dot--run' : s === 'rejected' ? 'lp-dot lp-dot--bad' : 'lp-dot';

/**
 * Illustrative lifecycle demo. Pure local state: it never calls the backend or an AI service, and it is labelled as a
 * demonstration so it cannot be mistaken for a real execution.
 */
export const HeroLifecycleDemo: React.FC = () => {
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(TOTAL); // starts fully played so the content is complete without JS timing
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(APPROVE_INDEX);
  const [decision, setDecision] = useState<Decision>('approved');
  const [follow, setFollow] = useState(false); // while playing, the detail panel follows the running stage until the visitor picks one

  const replay = (nextDecision: Decision = decision) => {
    setDecision(nextDecision);
    setSelected(0);
    setProgress(0);
    setFollow(true);
    setPlaying(true);
  };

  // One-time autoplay after mount for visitors who have not asked to reduce motion.
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && !reduced) {
      setSelected(0);
      setProgress(0);
      setFollow(true);
      setPlaying(true);
    }
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    if (progress >= TOTAL) {
      setPlaying(false);
      setSelected(APPROVE_INDEX);
      return undefined;
    }
    const t = window.setTimeout(() => {
      setProgress((p) => p + 1);
      if (follow) setSelected(Math.min(progress + 1, TOTAL - 1));
    }, TICK_MS);
    return () => window.clearTimeout(t);
  }, [playing, progress, follow]);

  const stage = LIFECYCLE_STAGES[selected];
  const states = useMemo(
    () => LIFECYCLE_STAGES.map((_, i) => stateOf(i, progress, playing, decision)),
    [progress, playing, decision]
  );
  const selectedState = states[selected];
  const overall =
    playing ? 'Running' : progress >= TOTAL ? (decision === 'approved' ? 'Completed (demo)' : 'Stopped at approval (demo)') : 'Ready';

  const stageDetail =
    stage.id === 'approve'
      ? decision === 'approved'
        ? `${stage.detail} In this demo the approver approves.`
        : `${stage.detail} In this demo the approver rejects, so nothing is executed.`
      : stage.id === 'execute' && decision === 'rejected'
        ? 'Skipped. The request was rejected, so the action never runs.'
        : stage.detail;

  return (
    <section className="lp-card p-4 sm:p-5" aria-labelledby="lp-demo-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="lp-demo-title" className="text-[15px] font-semibold">
            Request lifecycle
          </h2>
          <p className="lp-label">{DEMO_SCENARIO}</p>
        </div>
        <span className="lp-chip lp-chip--plan">Illustrative demo</span>
      </div>

      <div className="mt-4 lp-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress / TOTAL})` }} />
      </div>
      <p className="lp-label mt-1.5 flex justify-between">
        <span>
          {Math.min(progress, TOTAL)} of {TOTAL} stages
        </span>
        <span>{overall}</span>
      </p>

      <ol className="list-none m-0 mt-3 p-0 grid gap-1" aria-label="Lifecycle stages">
        {LIFECYCLE_STAGES.map((s, i) => {
          const st = states[i];
          return (
            <li key={s.id}>
              <button
                type="button"
                className="lp-stage"
                aria-pressed={selected === i}
                onClick={() => {
                  setFollow(false);
                  setSelected(i);
                }}
              >
                <span className={dotClass(st)} aria-hidden="true">
                  {st === 'done' ? <Check className="w-3.5 h-3.5" /> : st === 'rejected' ? <X className="w-3.5 h-3.5" /> : st === 'skipped' ? <Minus className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-medium">{s.name}</span>
                </span>
                <span className="lp-label hidden sm:inline">{s.kind}</span>
                <span className={chipClass(st)}>{STATE_LABEL[st]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        key={`${stage.id}-${decision}`}
        className="lp-swap mt-3 rounded-lg p-3.5"
        style={{ background: 'var(--lp-surface-2)', border: '1px solid var(--lp-border)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold">
            {selected + 1}. {stage.name}
          </h3>
          <span className={chipClass(selectedState)}>{STATE_LABEL[selectedState]}</span>
        </div>
        <p className="lp-body mt-1.5">{stageDetail}</p>
        <p className="lp-label lp-mono mt-2">trace: {DEMO_TRACE_REF} (sample reference)</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Demo approver decision">
          <span className="lp-label mr-1">Approver</span>
          {(['approved', 'rejected'] as Decision[]).map((d) => (
            <button
              key={d}
              type="button"
              className="lp-tab"
              style={{ minHeight: 44 }}
              aria-pressed={decision === d}
              onClick={() => replay(d)}
            >
              {d === 'approved' ? 'Approves' : 'Rejects'}
            </button>
          ))}
        </div>
        <button type="button" className="lp-btn lp-btn--secondary lp-btn--sm" onClick={() => replay()}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Replay
        </button>
      </div>
      <p className="lp-label mt-3">
        Sample data, played locally in your browser. No real request is run and no AI or backend service is called.
      </p>
    </section>
  );
};
