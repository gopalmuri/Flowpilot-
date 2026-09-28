import React from 'react';
import { 
  TrendingUp, 
  Briefcase, 
  Target, 
  Code2, 
  CheckCircle2, 
  Users2
} from 'lucide-react';

interface AudienceCard {
  role: string;
  icon: React.ElementType;
  tagline: string;
  useCases: string[];
  outcome: string;
}

export const TargetAudienceSection: React.FC = () => {
  const personas: AudienceCard[] = [
    {
      role: 'Revenue Operations',
      icon: TrendingUp,
      tagline: 'Orchestrate high-velocity deal pipelines with governance',
      useCases: [
        'Tier-1 inbound lead qualification and custom routing',
        'Automatic contract threshold routing ($50k+ VP sign-offs)',
        'Bi-directional sync between forms, CRM records, and Slack alerts',
        'SLA countdown monitoring on high-priority enterprise prospects'
      ],
      outcome: 'Zero missed lead SLAs and guaranteed compliance before CRM deal creation.'
    },
    {
      role: 'Operations Teams',
      icon: Briefcase,
      tagline: 'Eliminate manual spreadsheet coordination and email chains',
      useCases: [
        'Customer onboarding and multi-step provisioning handoffs',
        'Vendor compliance review and legal sign-off gates',
        'Cross-departmental exception tracking and auto-escalation',
        'Centralized operational dashboards with real-time health'
      ],
      outcome: 'Standardized operational intake with complete lifecycle auditability.'
    },
    {
      role: 'Sales Operations',
      icon: Target,
      tagline: 'Accelerate response time while preserving deal hygiene',
      useCases: [
        'AI classification of unstructured demo and pricing requests',
        'Discount threshold approvals with automated reminder timers',
        'Territory assignment and instant rep Slack notifications',
        'Deduplication and schema validation on incoming contacts'
      ],
      outcome: 'Lead response times cut from hours to seconds with strict discount controls.'
    },
    {
      role: 'Technical Workflow Teams',
      icon: Code2,
      tagline: 'Deploy governed automation without building custom glue code',
      useCases: [
        'Webhook ingestion pipelines with HMAC signature validation',
        'Bounded LLM structured extraction without uncontrolled side-effects',
        'Idempotent task execution with configurable exponential backoff',
        'Immutable event logging with distributed correlation tracking'
      ],
      outcome: 'Production-grade orchestration primitives with zero infrastructure maintenance.'
    }
  ];

  return (
    <section id="solutions" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <Users2 className="w-3.5 h-3.5" />
            Designed For Operational Teams
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Who builds on FlowPilot? <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">Teams that value controlled execution.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            Whether you operate in Revenue, Operations, or Engineering, FlowPilot provides the
            control plane to bridge requests, decisions, and systems seamlessly.
          </p>
        </div>

        {/* 4 Persona Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {personas.map((p, idx) => {
            const Icon = p.icon;
            return (
              <div 
                key={idx}
                className="p-8 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-subtle)] hover:border-[var(--brand-emerald)]/50 transition-all duration-200 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-3.5 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[var(--text-primary)]">{p.role}</h3>
                      <p className="text-xs text-[var(--text-secondary)]">{p.tagline}</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] font-semibold block">
                      Typical Workflows Orchestrated:
                    </span>
                    {p.useCases.map((uc, uIdx) => (
                      <div key={uIdx} className="flex items-start gap-2.5 text-xs text-[var(--text-secondary)]">
                        <CheckCircle2 className="w-4 h-4 text-[var(--brand-emerald)] flex-shrink-0 mt-0.5" />
                        <span>{uc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 rounded-xl">
                  <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">Outcome:</span>
                  <p className="text-xs font-semibold text-[var(--text-primary)] mt-0.5">
                    {p.outcome}
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
