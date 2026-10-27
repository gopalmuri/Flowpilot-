import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { HeroLifecycleDemo } from './HeroLifecycleDemo';

const TRUST_POINTS = [
  'Human-in-the-loop approvals',
  'Deterministic workflow execution',
  'Complete execution traceability',
];

export const LandingHero: React.FC = () => (
  <section className="lp-section pt-12 lg:pt-20" aria-labelledby="lp-hero-title">
    <div className="lp-container grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14">
      <div>
        <p className="lp-eyebrow lp-enter">AI-powered business workflow control</p>
        <h1 id="lp-hero-title" className="lp-h1 mt-4 lp-enter" style={{ ['--lp-delay' as string]: '60ms' }}>
          Turn business requests into controlled execution.
        </h1>
        <p className="lp-lead mt-5 lp-enter" style={{ ['--lp-delay' as string]: '120ms' }}>
          FlowPilot transforms business requests into governed workflows with AI-assisted decisions, deterministic
          rules, human approvals, and end-to-end execution visibility.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row lp-enter" style={{ ['--lp-delay' as string]: '180ms' }}>
          <Link to="/register" className="lp-btn lp-btn--primary">
            Get Started
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <a href="#how-it-works" className="lp-btn lp-btn--secondary">
            Explore How It Works
          </a>
        </div>
        <ul className="list-none m-0 mt-8 p-0 grid gap-2.5 lp-enter" style={{ ['--lp-delay' as string]: '240ms' }}>
          {TRUST_POINTS.map((t) => (
            <li key={t} className="flex items-center gap-2.5 text-[15px]" style={{ color: 'var(--lp-text-2)' }}>
              <CheckCircle2 className="w-4 h-4 flex-none" style={{ color: 'var(--lp-brand-text)' }} aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="lp-enter min-w-0" style={{ ['--lp-delay' as string]: '200ms' }}>
        <HeroLifecycleDemo />
      </div>
    </div>
  </section>
);
