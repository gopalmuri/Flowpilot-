import React from 'react';
import { 
  ShieldCheck, 
  Lock, 
  Users, 
  FileCheck, 
  GitCommit, 
  EyeOff, 
  Search,
  CheckCircle2
} from 'lucide-react';

interface SecurityItem {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  description: string;
  technicalSpec: string;
}

export const SecurityGovernanceSection: React.FC = () => {
  const securityFeatures: SecurityItem[] = [
    {
      icon: Users,
      title: 'Tenant Isolation',
      subtitle: 'Logical Data Separation',
      description: 'Every database query, background worker task, and cached state is scoped by tenant UUID. Organizations cannot query or access peer resources.',
      technicalSpec: 'Foreign Key Partitioning & Tenant Guards'
    },
    {
      icon: Lock,
      title: 'Role-Based Access Control',
      subtitle: 'Granular RBAC Enforced',
      description: 'Strict authorization matrices for Admins, Operators, Approvers, and Read-Only Auditors. Privileged actions require explicit role entitlements.',
      technicalSpec: 'FastAPI Depends() & JWT Scopes'
    },
    {
      icon: FileCheck,
      title: 'Auditability',
      subtitle: 'Immutable Audit Ledger',
      description: 'Every approval, workflow execution, credential access, and schema update produces a tamper-evident audit record with timestamp and actor attribution.',
      technicalSpec: 'Append-only PostgreSQL Event Store'
    },
    {
      icon: ShieldCheck,
      title: 'Controlled Approvals',
      subtitle: 'Human-in-the-Loop Governance',
      description: 'Sensitive operations halt execution until authorized personnel review payload details and submit a verified decision token before external calls.',
      technicalSpec: 'Tokenized State Machine Checkpoints'
    },
    {
      icon: EyeOff,
      title: 'Secret Masking',
      subtitle: 'Encrypted Credential Vault',
      description: 'API keys, webhook secrets, and OAuth bearer tokens are encrypted at rest using AES-256 and redacted automatically from execution telemetry and logs.',
      technicalSpec: 'AES-256 GCM Encryption & UI Redaction'
    },
    {
      icon: GitCommit,
      title: 'Workflow Versioning',
      subtitle: 'Immutable Topology Definitions',
      description: 'Workflows maintain version history. Running executions are pinned to their trigger-time topology version, preventing breaking changes in production.',
      technicalSpec: 'SemVer Topological Snapshots'
    },
    {
      icon: Search,
      title: 'Execution Traceability',
      subtitle: 'Distributed Correlation IDs',
      description: 'Every inbound webhook generates a unique correlation ID that propagates through validation, AI extraction, Celery queues, and downstream API logs.',
      technicalSpec: 'End-to-end Request Context Tracing'
    }
  ];

  return (
    <section id="security" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 relative">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <ShieldCheck className="w-3.5 h-3.5" />
            Security &amp; Governance
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Built for controlled <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">business operations.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            Enterprise operations require zero ambiguity. FlowPilot enforces deterministic execution
            boundaries, strict cryptographic tracing, and comprehensive authorization controls.
          </p>
        </div>

        {/* Security Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {securityFeatures.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div 
                key={idx}
                className="p-6 rounded-2xl bg-[var(--surface-primary)] border border-[var(--border-subtle)] hover:border-[var(--brand-emerald)]/50 transition-all shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--brand-emerald)] mb-4">
                    <Icon className="w-5 h-5" />
                  </div>

                  <h3 className="text-base font-bold text-[var(--text-primary)]">{item.title}</h3>
                  <span className="text-[11px] font-mono text-[var(--brand-emerald)] block mt-0.5 mb-2 font-semibold">
                    {item.subtitle}
                  </span>

                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-muted)] flex items-center justify-between">
                  <span>Spec:</span>
                  <span className="text-[var(--text-primary)]">{item.technicalSpec}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fact-based Governance Commitment Banner */}
        <div className="p-6 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-subtle)] max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[var(--text-primary)]">Verifiable Architecture Principles</h4>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Engineered with defensible isolation boundaries and zero unmonitored execution pathways.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-[var(--brand-emerald)] font-bold self-start sm:self-center">
            <span>Deterministic Control Plane</span>
          </div>
        </div>
      </div>
    </section>
  );
};
