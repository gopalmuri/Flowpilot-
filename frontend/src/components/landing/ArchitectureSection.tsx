import React from 'react';
import { ArrowDown, ArrowRight, Sparkles, ShieldCheck } from 'lucide-react';
import { AI_LAYER, CONTROL_LAYER } from './landingContent';
import { CapabilityList } from './CapabilityList';
import { Reveal } from './motion';

export const ArchitectureSection: React.FC = () => (
  <section id="architecture" className="lp-anchor lp-band lp-section" aria-labelledby="lp-arch-title">
    <div className="lp-container">
      <Reveal className="max-w-2xl">
        <h2 id="lp-arch-title" className="lp-h2">
          AI understands. Control decides.
        </h2>
        <p className="lp-lead mt-4">
          Separate AI-assisted interpretation from deterministic business rules and controlled execution. AI assists
          with interpretation and recommendations. Deterministic application logic enforces the configured rules and
          execution permissions.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        <Reveal className="lp-card p-5 sm:p-6" style={{ borderColor: 'var(--lp-brand-border)' }}>
          <div className="flex items-center gap-3">
            <span className="lp-icon">
              <Sparkles className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-[18px] font-semibold">AI layer</h3>
              <p className="lp-label">Interprets and recommends</p>
            </div>
          </div>
          <div className="mt-4">
            <CapabilityList items={AI_LAYER} />
          </div>
        </Reveal>

        <Reveal delay={160} className="flex items-center justify-center lg:flex-col gap-2 py-1 lg:px-2">
          <span className="lp-label text-center max-w-[11rem]">Recommendations, not decisions</span>
          <ArrowDown className="w-5 h-5 lg:hidden" style={{ color: 'var(--lp-brand-text)' }} aria-hidden="true" />
          <ArrowRight className="w-5 h-5 hidden lg:block" style={{ color: 'var(--lp-brand-text)' }} aria-hidden="true" />
        </Reveal>

        <Reveal delay={320} className="lp-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="lp-icon">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-[18px] font-semibold">Control layer</h3>
              <p className="lp-label">Decides, enforces and records</p>
            </div>
          </div>
          <div className="mt-4">
            <CapabilityList items={CONTROL_LAYER} />
          </div>
        </Reveal>
      </div>
      <p className="lp-label mt-4">Every capability shown is implemented unless it is marked Planned.</p>
    </div>
  </section>
);
