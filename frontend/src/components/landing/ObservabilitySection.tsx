import React, { useRef, useState } from 'react';
import { TIMELINE_EVENTS, OBSERVABILITY_ITEMS, GOVERNANCE_ITEMS, type TimelineEvent } from './landingContent';
import { CapabilityList } from './CapabilityList';
import { Reveal } from './motion';

const chip = (s: TimelineEvent['status']) =>
  s === 'ok' ? 'lp-chip lp-chip--ok' : s === 'bad' ? 'lp-chip lp-chip--bad' : 'lp-chip lp-chip--plan';

export const ObservabilitySection: React.FC = () => {
  const [selected, setSelected] = useState(TIMELINE_EVENTS.length - 2);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const event = TIMELINE_EVENTS[selected];

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = TIMELINE_EVENTS.length - 1;
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(last, selected + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, selected - 1);
    else return;
    e.preventDefault();
    setSelected(next);
    btnRefs.current[next]?.focus();
  };

  return (
    <section id="observability" className="lp-anchor lp-section" aria-labelledby="lp-obs-title">
      <div className="lp-container">
        <Reveal className="max-w-2xl">
          <h2 id="lp-obs-title" className="lp-h2">
            Nothing disappears after execution.
          </h2>
          <p className="lp-lead mt-4">
            Track workflow activity with execution history, traceable decisions, and governance controls.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Reveal className="lp-card p-5 sm:p-6">
            <h3 className="text-[18px] font-semibold mb-4">Observability</h3>
            <CapabilityList items={OBSERVABILITY_ITEMS} />
          </Reveal>
          <Reveal delay={100} className="lp-card p-5 sm:p-6">
            <h3 className="text-[18px] font-semibold mb-4">Governance</h3>
            <CapabilityList items={GOVERNANCE_ITEMS} />
          </Reveal>
        </div>
        <p className="lp-label mt-4">Every capability shown is implemented unless it is marked Planned.</p>

        <Reveal className="lp-card mt-10 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[18px] font-semibold">Execution timeline</h3>
              <p className="lp-label">Select an event to inspect it.</p>
            </div>
            <span className="lp-chip lp-chip--plan">Illustrative demo</span>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
            <ol className="list-none m-0 p-0 grid gap-1" aria-label="Execution events" onKeyDown={onKeyDown}>
              {TIMELINE_EVENTS.map((ev, i) => (
                <li key={ev.id} className="lp-reveal-seq" style={{ ['--lp-delay' as string]: `${i * 70}ms` }}>
                  <button
                    ref={(el) => {
                      btnRefs.current[i] = el;
                    }}
                    type="button"
                    className="lp-stage"
                    aria-pressed={selected === i}
                    aria-current={selected === i ? 'step' : undefined}
                    onClick={() => setSelected(i)}
                  >
                    <span className={ev.status === 'pause' ? 'lp-dot lp-dot--run' : 'lp-dot lp-dot--done'} aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-[15px] font-medium">{ev.title}</span>
                    <span className={chip(ev.status)}>{ev.statusLabel}</span>
                  </button>
                </li>
              ))}
            </ol>

            <div
              key={event.id}
              className="lp-swap rounded-lg p-4 self-start"
              style={{ background: 'var(--lp-surface-2)', border: '1px solid var(--lp-border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[16px] font-semibold">{event.title}</h4>
                <span className={chip(event.status)}>{event.statusLabel}</span>
              </div>
              <p className="lp-body mt-2">{event.detail}</p>
              <dl className="mt-3 grid gap-1.5 text-[14px] m-0">
                {event.fields.map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-3">
                    <dt className="lp-label min-w-[7.5rem]">{k}</dt>
                    <dd className="m-0 lp-mono" style={{ color: 'var(--lp-text)' }}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <p className="lp-label mt-4">
            Sample events for a sample request. This is a demonstration, not live data from your account.
          </p>
        </Reveal>
      </div>
    </section>
  );
};
