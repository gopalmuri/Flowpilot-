import React from 'react';
import { 
  GitFork, 
  Workflow, 
  Sparkles, 
  UserCheck, 
  Activity, 
  Timer, 
  FileText, 
  Shield, 
  Blocks, 
  History,
  Grid
} from 'lucide-react';

interface FeatureItem {
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: string;
  isAi?: boolean;
}

export const ControlPlaneFeaturesSection: React.FC = () => {
  const features: FeatureItem[] = [
    {
      icon: GitFork,
      title: 'Workflow Orchestration',
      description: 'Deterministic directed acyclic graph (DAG) engine executing steps with idempotency keys, state checkpoints, and branch isolation.',
    },
    {
      icon: Workflow,
      title: 'Visual Workflow Builder',
      description: 'Interactive canvas to configure triggers, validation logic, branch conditions, human gates, and outbound integrations with live validation.',
    },
    {
      icon: Sparkles,
      title: 'AI Classification',
      description: 'Bounded LLM entity extraction and intent tagging that produces schema-validated JSON without granting autonomous side-effect authority.',
      isAi: true,
      badge: 'Bounded'
    },
    {
      icon: UserCheck,
      title: 'Human Approvals',
      description: 'Synchronous and asynchronous human-in-the-loop decision checkpoints with strict expiration SLAs and assigned role authorization.',
    },
    {
      icon: Activity,
      title: 'Execution Observability',
      description: 'Granular step-by-step latency tracking, payload inspection, retry backoff histories, and correlation IDs across every workflow run.',
    },
    {
      icon: Timer,
      title: 'SLA Monitoring',
      description: 'Real-time countdown timers, threshold breach warnings, priority tier categorizations, and automated escalation dispatching.',
    },
    {
      icon: FileText,
      title: 'Audit Logs',
      description: 'Immutable, SHA-256 hashed ledger tracking all operator decisions, system state changes, authentication events, and API mutations.',
    },
    {
      icon: Shield,
      title: 'Multi-Tenant RBAC',
      description: 'Strict logical data isolation across organizations with granular role-based permissions (Admin, Operator, Reviewer, Auditor).',
    },
    {
      icon: Blocks,
      title: 'Integrations',
      description: 'Plug-and-play outbound connectors for REST Webhooks, Slack channels, and CRM records with token masking and HMAC validation.',
    },
    {
      icon: History,
      title: 'Workflow Versioning',
      description: 'Immutable version control for workflow definitions. Safely draft, validate, and roll back published topologies without downtime.',
    }
  ];

  return (
    <section id="features" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]/30">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <Grid className="w-3.5 h-3.5" />
            Control Plane Architecture
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Built for enterprise stability. <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">Every feature is governed.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            FlowPilot provides the infrastructure primitives required to orchestrate critical business operations
            with deterministic control, high availability, and complete visibility.
          </p>
        </div>

        {/* Feature Grid: 10 Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((item, idx) => {
            const IconComponent = item.icon;
            return (
              <div
                key={idx}
                className={`p-6 rounded-2xl bg-[var(--surface-primary)] border transition-all duration-200 hover:-translate-y-1 hover:shadow-md flex flex-col justify-between group ${
                  item.isAi
                    ? 'border-[#8B5CF6]/30 hover:border-[#8B5CF6]'
                    : 'border-[var(--border-subtle)] hover:border-[var(--brand-emerald)]/60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                      item.isAi
                        ? 'bg-[#8B5CF6]/15 text-[#8B5CF6] dark:text-[#A78BFA] group-hover:bg-[#8B5CF6]/25'
                        : 'bg-[var(--surface-sunken)] text-[var(--brand-emerald)] group-hover:bg-[var(--brand-emerald)]/15'
                    }`}>
                      <IconComponent className="w-5 h-5" />
                    </div>

                    {item.badge && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#8B5CF6]/15 text-[#8B5CF6] dark:text-[#A78BFA] border border-[#8B5CF6]/30">
                        {item.badge}
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-[var(--text-primary)] mb-2 group-hover:text-[var(--brand-emerald)] transition-colors">
                    {item.title}
                  </h3>

                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-[var(--border-subtle)]/60 flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                  <span>Engine Primitive</span>
                  <span className="text-[var(--brand-emerald)] font-semibold">Active</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
