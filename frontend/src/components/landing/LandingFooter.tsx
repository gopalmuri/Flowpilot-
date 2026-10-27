import React from 'react';
import { Link } from 'react-router-dom';
import { LandingLogo } from './LandingLogo';
import { FOOTER_PRODUCT_LINKS } from './landingContent';

const linkClass = 'inline-flex items-center min-h-[44px] text-[14px] hover:underline';

export const LandingFooter: React.FC = () => (
  <footer style={{ background: 'var(--lp-surface)', borderTop: '1px solid var(--lp-border)' }}>
    <div className="lp-container py-12">
      <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <LandingLogo />
          <p className="lp-body max-w-sm">
            FlowPilot turns business requests into governed workflows with AI-assisted decisions, deterministic rules,
            human approvals, and execution visibility.
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--lp-muted)' }}>
            Product
          </h2>
          <ul className="list-none m-0 mt-2 p-0" style={{ color: 'var(--lp-text-2)' }}>
            {FOOTER_PRODUCT_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className={linkClass}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Account">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--lp-muted)' }}>
            Account
          </h2>
          <ul className="list-none m-0 mt-2 p-0" style={{ color: 'var(--lp-text-2)' }}>
            <li>
              <Link to="/login" className={linkClass}>
                Sign In
              </Link>
            </li>
            <li>
              <Link to="/register" className={linkClass}>
                Get Started
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <p className="lp-label mt-10 pt-6" style={{ borderTop: '1px solid var(--lp-border)' }}>
        &copy; {new Date().getFullYear()} FlowPilot. All rights reserved.
      </p>
    </div>
  </footer>
);
