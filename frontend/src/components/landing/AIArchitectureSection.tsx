import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  ShieldCheck, 
  ArrowDown, 
  CheckCircle2, 
  FileJson,
  Binary
} from 'lucide-react';
import { useInView, useReducedMotion } from '../../hooks/useMotion';

export const AIArchitectureSection: React.FC = () => {
  const [sectionRef, isInView] = useInView({ threshold: 0.15 });
  const prefersReduced = useReducedMotion();

  // 3-tier downward execution flow: 0 = AI Layer, 1 = Structured Output, 2 = Control Layer
  const [archStage, setArchStage] = useState<number>(0);

  useEffect(() => {
    if (!isInView || prefersReduced) {
      setArchStage(2);
      return;
    }

    const interval = setInterval(() => {
      setArchStage((prev) => (prev + 1) % 3);
    }, 2000);

    return () => clearInterval(interval);
  }, [isInView, prefersReduced]);

  return (
    <section id="ai-control" ref={sectionRef} className="py-20 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
      <div className="max-w-6xl mx-auto">
        {/* Section Header with entrance */}
        <div className={`text-center max-w-2xl mx-auto mb-14 transition-all duration-400 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-700/60 mb-4">
            <Binary className="w-3.5 h-3.5" />
            Architectural Separation
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
            AI understands. Control decides.
          </h2>
          <p className="mt-3 text-base text-[var(--text-secondary)]">
            We strictly isolate non-deterministic semantic parsing from deterministic workflow execution.
          </p>
        </div>

        {/* 3-Tier Architectural Stack Demonstration */}
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Top Tier: AI Layer (Subtle Violet Identity) */}
          <div className={`p-6 rounded-2xl transition-all duration-300 ${
            archStage === 0
              ? 'bg-violet-500/10 border-2 border-violet-500 shadow-xs ring-2 ring-violet-500/20'
              : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)]'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] mb-4">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  archStage === 0
                    ? 'bg-violet-500 text-white shadow-2xs'
                    : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                }`}>
                  <Cpu className="w-4 h-4 micro-icon" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">AI LAYER</h3>
                  <span className="text-[11px] font-mono text-violet-600 dark:text-violet-400 font-medium">
                    Read-Only Semantic Parsing
                  </span>
                </div>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold transition-colors ${
                archStage === 0
                  ? 'bg-violet-500 text-white'
                  : 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
              }`}>
                {archStage === 0 ? 'EXTRACTING NOW...' : 'ZERO SIDE-EFFECTS'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-surface)] border border-violet-500/20 hover:border-violet-500/40">
                <span className="text-violet-600 dark:text-violet-400 font-bold block mb-0.5">Classification</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Lead intent, category &amp; urgency</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-surface)] border border-violet-500/20 hover:border-violet-500/40">
                <span className="text-violet-600 dark:text-violet-400 font-bold block mb-0.5">Entity Extraction</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Seats, values, dates &amp; constraints</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-surface)] border border-violet-500/20 hover:border-violet-500/40">
                <span className="text-violet-600 dark:text-violet-400 font-bold block mb-0.5">Intent Detection</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Expansion, security, or support</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-surface)] border border-violet-500/20 hover:border-violet-500/40">
                <span className="text-violet-600 dark:text-violet-400 font-bold block mb-0.5">Confidence Scoring</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Calculated 0.00–1.00 certainty</span>
              </div>
            </div>
          </div>

          {/* Animated Downward Transition Connector */}
          <div className="flex items-center justify-center gap-3 py-1">
            <div className="h-px bg-[var(--border-subtle)] flex-1 max-w-[120px]" />
            <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[10px] font-mono font-semibold transition-all duration-300 ${
              archStage === 1
                ? 'bg-brand-500 text-white border-brand-500 shadow-xs scale-105'
                : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
            }`}>
              <FileJson className="w-3.5 h-3.5" />
              <span>STRUCTURED OUTPUT (VALIDATED JSON)</span>
              <ArrowDown className={`w-3 h-3 ${archStage === 1 ? 'animate-bounce' : ''}`} />
            </div>
            <div className="h-px bg-[var(--border-subtle)] flex-1 max-w-[120px]" />
          </div>

          {/* Bottom Tier: Deterministic Control Layer (Emerald & Neutral) */}
          <div className={`p-6 rounded-2xl transition-all duration-300 ${
            archStage === 2
              ? 'bg-[var(--bg-surface)] border-2 border-brand-500 shadow-xs ring-2 ring-brand-500/20'
              : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)]'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] mb-4">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  archStage === 2
                    ? 'bg-brand-500 text-white shadow-2xs'
                    : 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
                }`}>
                  <ShieldCheck className="w-4 h-4 micro-icon" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">CONTROL LAYER</h3>
                  <span className="text-[11px] font-mono text-brand-600 dark:text-brand-400 font-medium">
                    Deterministic Rule &amp; Action Governance
                  </span>
                </div>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold transition-colors ${
                archStage === 2
                  ? 'bg-brand-500 text-white'
                  : 'bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300'
              }`}>
                {archStage === 2 ? 'GOVERNING MUTATION...' : '100% GOVERNED'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono">
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-brand-500/30">
                <span className="text-brand-600 dark:text-brand-400 font-bold block mb-0.5">Business Rules</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Strict IF/THEN gates</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-brand-500/30">
                <span className="text-brand-600 dark:text-brand-400 font-bold block mb-0.5">Permissions</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Role-based access</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-brand-500/30">
                <span className="text-brand-600 dark:text-brand-400 font-bold block mb-0.5">Approvals</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Human authorization</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-brand-500/30">
                <span className="text-brand-600 dark:text-brand-400 font-bold block mb-0.5">Idempotency</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Zero duplicate runs</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-brand-500/30">
                <span className="text-brand-600 dark:text-brand-400 font-bold block mb-0.5">Execution</span>
                <span className="text-[11px] text-[var(--text-secondary)]">CRM, Slack &amp; APIs</span>
              </div>
              <div className="card-hover-micro p-2.5 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] hover:border-brand-500/30">
                <span className="text-brand-600 dark:text-brand-400 font-bold block mb-0.5">Audit</span>
                <span className="text-[11px] text-[var(--text-secondary)]">SHA-256 ledger</span>
              </div>
            </div>
          </div>
        </div>

        {/* Core Principles Footer Tag */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs font-mono text-[var(--text-muted)]">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
            <span>AI never triggers downstream mutations directly</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
            <span>Every branch evaluated against deterministic code</span>
          </div>
        </div>
      </div>
    </section>
  );
};
