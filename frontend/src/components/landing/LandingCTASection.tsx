import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './motion';

export const LandingCTASection: React.FC = () => (
  <section className="lp-section pt-0 lg:pt-8" aria-labelledby="lp-cta-title">
    <div className="lp-container">
      <Reveal
        className="rounded-2xl px-6 py-14 text-center sm:px-12"
        style={{ background: 'var(--lp-brand-soft)', border: '1px solid var(--lp-brand-border)' }}
      >
        <h2 id="lp-cta-title" className="lp-h2 mx-auto max-w-2xl">
          Bring your business requests under control.
        </h2>
        <p className="lp-lead mx-auto mt-4">
          Build workflows that combine automation, AI-assisted decisions, human control, and complete execution
          visibility.
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link to="/register" className="lp-btn lp-btn--primary">
            Get Started
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <Link to="/login" className="lp-btn lp-btn--secondary">
            Sign In
          </Link>
        </div>
      </Reveal>
    </div>
  </section>
);
