import React from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { ThemeSwitcher } from '../ui/ThemeSwitcher';

interface AuthLayoutProps {
  children: React.ReactNode;
  categoryTag?: string;
  headline?: React.ReactNode;
  supportingText?: string;
  showcase?: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-[var(--bg-app)] text-[var(--text-primary)] font-sans relative selection:bg-brand-500/20 selection:text-brand-600 dark:selection:text-brand-400 overflow-x-hidden transition-colors duration-150">
      {/* Subtle Ambient Background Depth */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[350px] bg-brand-500/5 dark:bg-brand-400/5 blur-3xl pointer-events-none rounded-full" />

      {/* Top Utility Bar with ThemeSwitcher */}
      <header className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between relative z-10">
        <Link 
          to="/" 
          className="text-xs font-mono text-[var(--text-secondary)] hover:text-brand-600 dark:hover:text-brand-400 transition-colors flex items-center gap-1.5"
        >
          <span>&larr; Back to FlowPilot</span>
        </Link>
        <ThemeSwitcher />
      </header>

      {/* Main Centered Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-6 sm:py-10 relative z-10 w-full">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex flex-col items-center group focus:outline-none">
            {/* Geometric Orchestration Logo Icon */}
            <div className="w-12 h-12 rounded-xl bg-brand-600 dark:bg-brand-500 flex items-center justify-center text-white shadow-sm mb-3 group-hover:scale-105 transition-transform duration-200">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6 text-white"
              >
                <polygon points="12 2 19 8 12 14 5 8 12 2" />
                <polyline points="5 15 12 21 19 15" />
              </svg>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight text-[var(--text-primary)]">
                FlowPilot
              </span>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--brand-soft)] text-[var(--brand-text)] border border-brand-200 dark:border-brand-700/60">
                Control Plane
              </span>
            </div>
          </Link>
        </div>

        {/* Centered Auth Card Container */}
        <div className="w-full max-w-[460px]">
          {children}
        </div>

        {/* Subtle Workspace Security Footer */}
        <footer className="mt-8 text-center text-xs text-[var(--text-muted)] font-mono flex items-center justify-center gap-2">
          <Shield className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
          <span>FlowPilot Platform &bull; Secure Organization Workspace</span>
        </footer>
      </main>

      {/* Empty bottom spacer for balanced vertical alignment */}
      <div className="py-2" />
    </div>
  );
};
