import React, { useState, useEffect } from 'react';
import { 
  Inbox, 
  Sparkles, 
  GitBranch, 
  UserCheck, 
  Zap, 
  Workflow
} from 'lucide-react';
import { useInView, useReducedMotion } from '../../hooks/useMotion';

export const HowItWorksSection: React.FC = () => {
  const [sectionRef, isInView] = useInView({ threshold: 0.15 });
  const prefersReduced = useReducedMotion();

  // Active progression stage (0 to 4)
  const [activeStage, setActiveStage] = useState<number>(0);

  useEffect(() => {
    if (!isInView || prefersReduced) {
      setActiveStage(4);
      return;
    }

    // Continuous flow signal moving across stages: 0 -> 1 -> 2 -> 3 -> 4
    const interval = setInterval(() => {
      setActiveStage((prev) => (prev + 1) % 5);
    }, 1400);

    return () => clearInterval(interval);
  }, [isInView, prefersReduced]);

  const steps = [
    {
      num: '01',
      title: 'REQUEST',
      subtitle: 'Ingest Event',
      desc: 'Receive incoming business events through authenticated webhooks, forms, or APIs.',
      icon: Inbox,
      pill: 'HTTPS Ingest'
    },
    {
      num: '02',
      title: 'UNDERSTAND',
      subtitle: 'Extract & Validate',
      desc: 'Verify schema structure and use bounded AI to parse unstructured text into typed JSON.',
      icon: Sparkles,
      pill: 'Bounded AI',
      isAi: true
    },
    {
      num: '03',
      title: 'DECIDE',
      subtitle: 'Evaluate Rules',
      desc: 'Apply explicit, deterministic business rules to calculate the exact routing branch.',
      icon: GitBranch,
      pill: 'Zero Bias'
    },
    {
      num: '04',
      title: 'CONTROL',
      subtitle: 'Human Approval',
      desc: 'Safely halt execution when governance thresholds require authorized human sign-off.',
      icon: UserCheck,
      pill: 'Human Gate'
    },
    {
      num: '05',
      title: 'EXECUTE',
      subtitle: 'Dispatch & Audit',
      desc: 'Trigger downstream actions (CRM, Slack, APIs) and record an immutable audit ledger entry.',
      icon: Zap,
      pill: 'Audited'
    }
  ];

  return (
    <section id="how-it-works" ref={sectionRef} className="py-20 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="max-w-6xl mx-auto">
        {/* Header with entrance animation */}
        <div className={`text-center max-w-2xl mx-auto mb-14 transition-all duration-400 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-700/60 mb-4">
            <Workflow className="w-3.5 h-3.5" />
            End-to-End Orchestration
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
            One control plane for the entire workflow.
          </h2>
          <p className="mt-3 text-base text-[var(--text-secondary)]">
            A single, continuous path from request ingestion to auditable execution.
          </p>
        </div>

        {/* 5-Step Progression with animated flow between cards */}
        <div className="relative">
          {/* Subtle Desktop Connecting Flow Track */}
          <div className="hidden md:block absolute top-10 left-12 right-12 h-[2px] bg-[var(--border-subtle)] pointer-events-none z-0">
            <svg className="w-full h-full" preserveAspectRatio="none">
              <line 
                x1="0" 
                y1="1" 
                x2="100%" 
                y2="1" 
                className="stroke-brand-500/40 dark:stroke-brand-400/40 animate-line-flow" 
                strokeWidth="2" 
              />
            </svg>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative z-10">
            {steps.map((st, idx) => {
              const Icon = st.icon;
              const isActive = idx === activeStage;
              const isPassed = idx < activeStage;

              return (
                <div
                  key={st.num}
                  className={`card-hover-micro p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between relative ${
                    isActive
                      ? st.isAi
                        ? 'bg-violet-500/10 border-violet-500 shadow-xs ring-2 ring-violet-500/20'
                        : 'bg-brand-500/10 border-brand-500 shadow-xs ring-2 ring-brand-500/20'
                      : isPassed
                      ? 'bg-[var(--bg-app)] border-[var(--border-subtle)]'
                      : 'bg-[var(--bg-app)] border-[var(--border-subtle)] opacity-75'
                  }`}
                >
                  {/* Active Flow Indicator Beacon */}
                  {isActive && (
                    <div className="absolute top-2 right-2 w-2 h-2">
                      <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
                        st.isAi ? 'bg-violet-400' : 'bg-brand-400'
                      }`} />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-mono font-extrabold text-[var(--text-muted)]">
                        {st.num}
                      </span>
                      <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded transition-colors ${
                        isActive
                          ? st.isAi
                            ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
                            : 'bg-brand-500 text-white'
                          : st.isAi
                          ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                      }`}>
                        {st.pill}
                      </span>
                    </div>

                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-colors ${
                      isActive
                        ? st.isAi
                          ? 'bg-violet-500 text-white shadow-2xs'
                          : 'bg-brand-600 dark:bg-brand-500 text-white shadow-2xs'
                        : st.isAi
                        ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                        : 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
                    }`}>
                      <Icon className="w-5 h-5 micro-icon" />
                    </div>

                    <h3 className="text-sm font-bold text-[var(--text-primary)]">
                      {st.title}
                    </h3>
                    <span className="text-[11px] font-mono text-[var(--text-muted)] block mt-0.5 mb-2 font-medium">
                      {st.subtitle}
                    </span>

                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {st.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
