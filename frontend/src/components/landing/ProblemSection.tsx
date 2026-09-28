import React from 'react';
import { Shuffle, Clock, EyeOff, AlertTriangle } from 'lucide-react';
import { useInView } from '../../hooks/useMotion';

export const ProblemSection: React.FC = () => {
  const [sectionRef, isInView] = useInView({ threshold: 0.15 });

  const problems = [
    {
      icon: Shuffle,
      title: 'Manual Handoffs',
      subtitle: 'Fragmented Coordination',
      description: 'Teams copy-paste requests between shared inboxes, spreadsheets, and chat channels. Context and critical metadata get lost with every forward.'
    },
    {
      icon: Clock,
      title: 'Decision Bottlenecks',
      subtitle: 'Unmonitored Approvals',
      description: 'High-value requests stall in buried DMs and email threads. Managers lack context, and SLA countdowns breach without anyone noticing.'
    },
    {
      icon: EyeOff,
      title: 'No Execution Visibility',
      subtitle: 'Zero Auditability',
      description: 'When an integration fails or an order breaks, operators cannot easily see what happened, why the branch was taken, or which user authorized it.'
    }
  ];

  return (
    <section ref={sectionRef} className="py-20 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
      <div className="max-w-6xl mx-auto">
        {/* Header with entrance animation */}
        <div className={`text-center max-w-2xl mx-auto mb-12 transition-all duration-400 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 mb-4">
            <AlertTriangle className="w-3.5 h-3.5" />
            The Operational Bottleneck
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Business requests rarely stop at one system.
          </h2>
          <p className="mt-3 text-base text-[var(--text-secondary)]">
            When teams glue business processes together with email and manual follow-ups, speed drops and risk multiplies.
          </p>
        </div>

        {/* 3 Staggered Entrance Cards with Micro-Interactions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {problems.map((p, idx) => {
            const Icon = p.icon;
            const delays = ['delay-[100ms]', 'delay-[180ms]', 'delay-[260ms]'];

            return (
              <div
                key={idx}
                className={`card-hover-micro p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xs hover:border-rose-500/40 transform ${
                  delays[idx]
                } ${isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 micro-icon" />
                  </div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {p.title}
                  </h3>
                  <span className="text-[11px] font-mono text-rose-600 dark:text-rose-400 block font-semibold mt-0.5 mb-2">
                    {p.subtitle}
                  </span>
                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                    {p.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
