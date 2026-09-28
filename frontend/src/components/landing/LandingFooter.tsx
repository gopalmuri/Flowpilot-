import React from 'react';
import { Link } from 'react-router-dom';
import { ThemeSwitcher } from '../ui/ThemeSwitcher';

export const LandingFooter: React.FC = () => {
  return (
    <footer className="bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-8 border-b border-[var(--border-subtle)]">
          {/* Brand info */}
          <div className="space-y-2">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-600 dark:bg-brand-500 text-white flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3.5 h-3.5 text-white"
                >
                  <polygon points="12 2 19 8 12 14 5 8 12 2" />
                  <polyline points="5 15 12 21 19 15" />
                </svg>
              </div>
              <span className="font-extrabold text-sm tracking-tight text-[var(--text-primary)]">
                FlowPilot
              </span>
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--brand-soft)] text-[var(--brand-text)] font-semibold">
                Control Plane
              </span>
            </Link>
            <p className="text-xs text-[var(--text-secondary)] max-w-sm">
              B2B workflow orchestration control plane. Turn business requests into governed execution across validation, AI, rules, approvals, and actions.
            </p>
          </div>

          {/* Quick Links */}
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <a href="#hero-workflow" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              Product
            </a>
            <a href="#how-it-works" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              How It Works
            </a>
            <a href="#ai-control" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              AI &amp; Rules
            </a>
            <a href="#security" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              Security
            </a>
            <Link to="/status" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              System Status
            </Link>
          </div>

          {/* Theme & Status */}
          <div className="flex items-center gap-3">
            <ThemeSwitcher compact={true} />
            <Link
              to="/status"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-brand-500/40 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span>Operational</span>
            </Link>
          </div>
        </div>

        {/* Bottom copyright */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] font-mono text-[var(--text-muted)]">
          <div>
            &copy; {new Date().getFullYear()} FlowPilot Systems Inc. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <span>Deterministic Control Plane</span>
            <span>&bull;</span>
            <span>Tenant Isolation Enforced</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
