import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  CheckCircle2, 
  FileText, 
  Clock, 
  Lock, 
  Users, 
  UserCheck, 
  Database,
  Building2,
  HardDrive
} from 'lucide-react';
import { useInView, useCountUp, useReducedMotion } from '../../hooks/useMotion';

export const ObservabilityTrustSection: React.FC = () => {
  const [sectionRef, isInView] = useInView({ threshold: 0.15 });
  const prefersReduced = useReducedMotion();

  // Animated telemetry demo numbers
  const animatedLatency = useCountUp(84, 1200, isInView);
  const animatedSlaPercentage = useCountUp(99, 1400, isInView);

  // 8-Stage Live Execution Timeline State Machine
  const [timelineStep, setTimelineStep] = useState<number>(0);

  useEffect(() => {
    if (!isInView || prefersReduced) {
      setTimelineStep(7);
      return;
    }

    const interval = setInterval(() => {
      setTimelineStep((prev) => (prev + 1) % 8);
    }, 1300);

    return () => clearInterval(interval);
  }, [isInView, prefersReduced]);

  const observabilityItems = [
    {
      title: 'Execution Traceability',
      description: 'Every run is assigned an immutable trace ID linking input parameters, intermediate evaluations, and final payloads.',
      icon: Activity
    },
    {
      title: 'State Transition History',
      description: 'Review the exact inputs and outputs of each step as the pipeline transitions between pending, processing, and completed.',
      icon: Clock
    },
    {
      title: 'SLA Tracking & Breach Alerts',
      description: 'Real-time countdown clocks against operational targets with automated escalation paths when queues back up.',
      icon: FileText
    },
    {
      title: 'Cryptographic Ledger',
      description: 'PostgreSQL-backed tamper-evident audit log with hash verification on every mutating database transaction.',
      icon: Database
    }
  ];

  const trustItems = [
    {
      title: 'Tenant Isolation',
      desc: 'Strict multi-tenant boundaries at the database and memory layer ensure zero data contamination across enterprise workspaces.',
      icon: Building2
    },
    {
      title: 'Granular RBAC',
      desc: 'Role-based access controls for Admin, Operator, and Auditor roles with least-privilege token enforcement.',
      icon: Users
    },
    {
      title: 'Deterministic Approvals',
      desc: 'High-risk operations require explicit human cryptographic authorization before downstream API execution triggers.',
      icon: UserCheck
    },
    {
      title: 'Immutable Storage',
      desc: 'All execution traces and audit events are write-once, read-many records permanently sealed against manual modification.',
      icon: HardDrive
    }
  ];

  // 8 Stages as specified in prompt: Trigger, Validation, AI, Condition, Approval, CRM, Slack, Audit
  const timelineStages = [
    { name: 'Trigger', time: '1ms', label: 'POST /v1/intake' },
    { name: 'Validation', time: '12ms', label: 'Schema valid' },
    { name: 'AI', time: '48ms', label: '0.94 Conf' },
    { name: 'Condition', time: '4ms', label: 'Rule matched' },
    { name: 'Approval', time: 'Resolved', label: 'Authorized' },
    { name: 'CRM', time: '21ms', label: 'Record created' },
    { name: 'Slack', time: '14ms', label: 'Notified' },
    { name: 'Audit', time: '3ms', label: 'sha256 signed' }
  ];

  return (
    <section id="security" ref={sectionRef} className="py-20 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="max-w-6xl mx-auto">
        {/* Section Header with entrance */}
        <div className={`text-center max-w-2xl mx-auto mb-14 transition-all duration-400 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-700/60 mb-4">
            <Lock className="w-3.5 h-3.5" />
            Observability &amp; Enterprise Trust
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Nothing disappears after execution.
          </h2>
          <p className="mt-3 text-base text-[var(--text-secondary)]">
            Built for controlled business operations with verifiable trace history and strict governance boundaries.
          </p>
        </div>

        {/* Live Miniature Observability Dashboard Demonstration */}
        <div className={`mb-12 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-5 sm:p-7 shadow-xs transition-all duration-500 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[var(--border-subtle)] gap-2 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
              <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                LIVE PRODUCT DEMONSTRATION
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                &bull; exec_9f82d1c0b3
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-[var(--text-muted)]">
                DEMO LATENCY: <strong className="text-brand-600 dark:text-brand-400 font-bold">{animatedLatency}ms</strong>
              </span>
              <span className="text-[var(--text-muted)]">
                SLA TARGET: <strong className="text-brand-600 dark:text-brand-400 font-bold">{animatedSlaPercentage}.8%</strong>
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300">
                ACTIVE
              </span>
            </div>
          </div>

          {/* Stepper Timeline Progression (8 Stages: Trigger -> Validation -> AI -> Condition -> Approval -> CRM -> Slack -> Audit) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs font-mono">
            {timelineStages.map((s, idx) => {
              const isActive = idx === timelineStep;
              const isPassed = idx < timelineStep;

              return (
                <div
                  key={idx}
                  className={`p-2.5 rounded-lg border transition-all duration-200 flex flex-col justify-between ${
                    isActive
                      ? 'bg-brand-500/10 border-brand-500 shadow-xs ring-1 ring-brand-500/30'
                      : isPassed
                      ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)]'
                      : 'bg-[var(--bg-surface)]/60 border-transparent opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-[var(--text-primary)] truncate">{s.name}</span>
                    {isPassed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 flex-shrink-0" />
                    ) : isActive ? (
                      <span className="w-2 h-2 rounded-full bg-brand-500 animate-ping flex-shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--border-subtle)] flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-[10px]">
                    <span className={`block font-semibold ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-[var(--text-secondary)]'}`}>
                      {isActive ? 'RUNNING...' : isPassed ? 'COMPLETED' : 'PENDING'}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] truncate block mt-0.5">
                      {isPassed ? s.time : s.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2-Column Primitives Grid: Observability on Left, Enterprise Governance on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Observability Primitives */}
          <div className="p-6 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand-600 dark:text-brand-400" />
              Observability Primitives
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {observabilityItems.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={idx}
                    className="card-hover-micro p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-brand-500/40 flex flex-col justify-between"
                  >
                    <div>
                      <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center mb-2.5">
                        <Icon className="w-4 h-4 micro-icon" />
                      </div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">{item.title}</h4>
                      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Enterprise Governance Primitives */}
          <div className="p-6 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Lock className="w-4 h-4 text-brand-600 dark:text-brand-400" />
              Governance &amp; Trust Boundaries
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {trustItems.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={idx}
                    className="card-hover-micro p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-brand-500/40 flex flex-col justify-between"
                  >
                    <div>
                      <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center mb-2.5">
                        <Icon className="w-4 h-4 micro-icon" />
                      </div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">{item.title}</h4>
                      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
