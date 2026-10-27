import React, { useRef, useState } from 'react';
import { EXAMPLES } from './landingContent';
import { Reveal } from './motion';

export const ExamplesSection: React.FC = () => {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const example = EXAMPLES[active];

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = EXAMPLES.length - 1;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = active === last ? 0 : active + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = active === 0 ? last : active - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section id="product" className="lp-anchor lp-band lp-section" aria-labelledby="lp-examples-title">
      <div className="lp-container">
        <Reveal className="max-w-2xl">
          <h2 id="lp-examples-title" className="lp-h2">
            See FlowPilot in action across high-stakes requests.
          </h2>
          <p className="lp-lead mt-4">
            Three example workflows, shown as demonstrations. They do not connect to your systems.
          </p>
        </Reveal>

        <Reveal className="mt-8" delay={80}>
          <div
            role="tablist"
            aria-label="Example workflows"
            className="grid gap-2 sm:inline-grid sm:grid-flow-col"
            onKeyDown={onKeyDown}
          >
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`lp-tab-${ex.id}`}
                aria-selected={active === i}
                aria-controls={`lp-panel-${ex.id}`}
                tabIndex={active === i ? 0 : -1}
                className="lp-tab"
                onClick={() => setActive(i)}
              >
                {ex.tab}
              </button>
            ))}
          </div>

          <div
            key={example.id}
            role="tabpanel"
            id={`lp-panel-${example.id}`}
            aria-labelledby={`lp-tab-${example.id}`}
            tabIndex={0}
            className="lp-swap lp-card mt-4 grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_1.2fr]"
          >
            <div className="space-y-6">
              <div>
                <p className="lp-label font-semibold uppercase tracking-[0.08em]">The problem</p>
                <p className="mt-1.5 text-[16px] leading-relaxed">{example.problem}</p>
              </div>
              <div>
                <p className="lp-label font-semibold uppercase tracking-[0.08em]">The outcome</p>
                <p className="mt-1.5 text-[16px] leading-relaxed">{example.outcome}</p>
              </div>
            </div>
            <div>
              <p className="lp-label font-semibold uppercase tracking-[0.08em]">Workflow</p>
              <ol className="list-none m-0 mt-3 p-0 grid gap-2">
                {example.steps.map((s, i) => (
                  <li
                    key={s}
                    className="flex items-center gap-3 rounded-lg px-3 min-h-[48px]"
                    style={{ background: 'var(--lp-surface-2)', border: '1px solid var(--lp-border)' }}
                  >
                    <span className="lp-dot lp-dot--run" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="text-[15px] font-medium">{s}</span>
                  </li>
                ))}
              </ol>
              <p className="lp-label mt-3">Demonstration of a workflow you could build. Not connected to any system.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
