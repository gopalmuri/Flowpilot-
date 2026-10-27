import React from 'react';
import { Route, GitBranch, Eye } from 'lucide-react';
import { PROBLEMS } from './landingContent';
import { Reveal } from './motion';

const ICONS = { handoffs: Route, bottlenecks: GitBranch, visibility: Eye } as const;

export const ProblemSection: React.FC = () => (
  <section className="lp-section pt-0 lg:pt-8" aria-labelledby="lp-problem-title">
    <div className="lp-container">
      <Reveal className="max-w-2xl">
        <h2 id="lp-problem-title" className="lp-h2">
          Business requests rarely stop at one system.
        </h2>
        <p className="lp-lead mt-4">
          Requests cross applications, business rules, teams, and approvals. Without a unified control layer,
          execution becomes difficult to track and govern.
        </p>
      </Reveal>
      <ul className="list-none m-0 mt-10 p-0 grid gap-4 md:grid-cols-3">
        {PROBLEMS.map((p, i) => {
          const Icon = ICONS[p.key];
          return (
            <Reveal as="li" key={p.key} delay={i * 80} className="lp-card lp-card--hover p-6">
              <span className="lp-icon">
                <Icon className="w-5 h-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[18px] font-semibold">{p.title}</h3>
              <p className="lp-body mt-2">{p.body}</p>
            </Reveal>
          );
        })}
      </ul>
    </div>
  </section>
);
