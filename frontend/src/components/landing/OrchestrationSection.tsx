import React from 'react';
import { ArrowDown, ArrowRight, Inbox, ScanSearch, Scale, ShieldCheck, Play } from 'lucide-react';
import { ORCHESTRATION } from './landingContent';
import { Reveal } from './motion';

const ICONS = [Inbox, ScanSearch, Scale, ShieldCheck, Play];

export const OrchestrationSection: React.FC = () => (
  <section id="how-it-works" className="lp-anchor lp-section" aria-labelledby="lp-how-title">
    <div className="lp-container">
      <Reveal className="max-w-2xl">
        <h2 id="lp-how-title" className="lp-h2">
          One control plane for the entire workflow.
        </h2>
      </Reveal>

      <Reveal as="div" className="mt-10">
        <ol className="list-none m-0 p-0 grid gap-3 lg:grid-cols-5 lg:gap-0">
          {ORCHESTRATION.map((s, i) => {
            const Icon = ICONS[i];
            const last = i === ORCHESTRATION.length - 1;
            return (
              <li key={s.n} className="relative lg:pr-6">
                <div className="lp-card lp-card--hover h-full p-5">
                  <div className="flex items-center gap-3">
                    <span className="lp-icon">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <span className="lp-label lp-mono font-semibold">0{s.n}</span>
                  </div>
                  <h3 className="mt-4 text-[18px] font-semibold">{s.title}</h3>
                  <p className="lp-body mt-1.5">{s.body}</p>
                </div>
                {!last && (
                  <>
                    <span
                      className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 w-6 items-center justify-center"
                      style={{ color: 'var(--lp-brand-text)' }}
                      aria-hidden="true"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </span>
                    <span
                      className="lg:hidden flex justify-center pt-3"
                      style={{ color: 'var(--lp-brand-text)' }}
                      aria-hidden="true"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </Reveal>
    </div>
  </section>
);
