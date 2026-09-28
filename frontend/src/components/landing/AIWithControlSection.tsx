import React, { useState } from 'react';
import { 
  Sparkles, 
  ShieldCheck, 
  GitBranch, 
  Cpu, 
  CheckCircle2, 
  Lock 
} from 'lucide-react';

export const AIWithControlSection: React.FC = () => {
  const [selectedExample, setSelectedExample] = useState<'enterprise' | 'security' | 'churn'>('enterprise');

  const examples = {
    enterprise: {
      title: 'Inbound Sales Lead',
      rawInput: 'Acme Corp: "Looking to deploy 500 enterprise seats with SSO and custom SOC2 compliance across North America."',
      aiExtracted: {
        intent: 'Enterprise Upgrade',
        confidence: 0.98,
        seats: 500,
        securityTier: 'Custom SOC2',
        urgency: 'High',
      },
      ruleEvaluation: 'seats >= 250 AND securityTier != null => Route to VP of Sales Approval',
      ruleResult: 'Match: Trigger Approval Required',
      outcome: 'Approval assigned to enterprise-queue with 2-hour SLA'
    },
    security: {
      title: 'Vendor Security Review',
      rawInput: 'Vendor Partner: "Sharing new sub-processor data processing agreement requiring DPO sign-off within 48h."',
      aiExtracted: {
        intent: 'Legal DPA Review',
        confidence: 0.95,
        riskScore: 'Moderate',
        slaHours: 48,
        category: 'Compliance'
      },
      ruleEvaluation: 'intent == Legal DPA AND slaHours <= 72 => Enforce Legal Ops Review + Lock Integration Token',
      ruleResult: 'Match: Enforce Compliance Gate',
      outcome: 'Sub-workflow locked pending Legal Admin manual release'
    },
    churn: {
      title: 'Priority Support Escalation',
      rawInput: 'Tier-1 Customer: "Production sync failed after update, affecting 12,000 active checkout sessions."',
      aiExtracted: {
        intent: 'Sev-1 Incident Escalation',
        confidence: 0.99,
        impactedUsers: 12000,
        sentiment: 'Critical Distress',
        system: 'Checkout Sync'
      },
      ruleEvaluation: 'intent == Sev-1 OR impactedUsers > 5000 => Trigger PagerDuty + Update Incident Channel',
      ruleResult: 'Deterministic Dispatch Authorized',
      outcome: 'Auto-dispatched via configured Webhook with immutable execution trace'
    }
  };

  const activeData = examples[selectedExample];

  return (
    <section id="ai-control" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 relative">
      <div className="max-w-7xl mx-auto">
        {/* Eyebrow and Headline */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[rgba(139,92,246,0.1)] text-[#8B5CF6] dark:text-[#A78BFA] border border-[#8B5CF6]/30 mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            Bounded Intelligence
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            AI where it helps. <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">Rules where control matters.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            FlowPilot does <strong>not</strong> give an AI model unrestricted control over your business systems.
            AI parses messy context into structured data; deterministic code and human gates govern execution.
          </p>
        </div>

        {/* 2-Column Comparison Architecture */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-16">
          {/* Left: AI Scope (Violet Accents) */}
          <div className="p-8 rounded-2xl bg-[var(--surface-primary)] border border-[#8B5CF6]/25 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-36 h-36 bg-[#8B5CF6]/5 rounded-bl-full pointer-events-none" />
            
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#8B5CF6]/15 flex items-center justify-center text-[#8B5CF6] dark:text-[#A78BFA]">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">What AI Does</h3>
                <p className="text-xs font-mono text-[#8B5CF6] dark:text-[#A78BFA]">Semantic Interpretation & Extraction</p>
              </div>
            </div>

            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
              Natural language business requests are inconsistent, messy, and multi-channel. AI handles the semantic extraction, transforming unstructured payloads into typed, schema-validated JSON.
            </p>

            <ul className="space-y-3">
              {[
                { title: 'Intent Classification', desc: 'Identifies request category, urgency, and domain context.' },
                { title: 'Structured Entity Extraction', desc: 'Parses seats, deal values, technical constraints, and dates into strongly-typed objects.' },
                { title: 'Semantic Scoring', desc: 'Calculates confidence intervals and anomaly indicators without guessing side-effects.' },
                { title: 'Zero Side-Effects', desc: 'AI has strictly read-only execution permissions. It never executes actions directly.' }
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-[rgba(139,92,246,0.04)] border border-[#8B5CF6]/15">
                  <div className="w-5 h-5 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-[#8B5CF6]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-[var(--text-primary)] block">{item.title}</span>
                    <span className="text-xs text-[var(--text-secondary)]">{item.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: Deterministic Rules & Human Gates (Emerald Accents) */}
          <div className="p-8 rounded-2xl bg-[var(--surface-primary)] border border-[var(--border-subtle)] shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-36 h-36 bg-[var(--brand-emerald)]/5 rounded-bl-full pointer-events-none" />

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[var(--brand-emerald)]/15 flex items-center justify-center text-[var(--brand-emerald)]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">What Deterministic Rules Control</h3>
                <p className="text-xs font-mono text-[var(--brand-emerald)]">Governance, Approvals & Action Dispatch</p>
              </div>
            </div>

            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
              Critical business operations cannot tolerate stochastic hallucination or unpredictable execution. Deterministic logic dictates branches, permissions, and external mutations.
            </p>

            <ul className="space-y-3">
              {[
                { title: 'Branching & Routing', desc: 'Strict logic gates (IF/ELSE, thresholds, switch cases) evaluate structured inputs.' },
                { title: 'Mandatory Human Gates', desc: 'High-value or high-risk paths halt execution until authorized personnel sign off.' },
                { title: 'Permission & Tenant Boundary', desc: 'Role-based access control (RBAC) ensures operators only act within their authorized scope.' },
                { title: 'Idempotency & Retries', desc: 'Exponential backoff, token masking, and unalterable audit trails for full compliance.' }
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border-subtle)]">
                  <div className="w-5 h-5 rounded-full bg-[var(--brand-emerald)]/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-[var(--brand-emerald)]">
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-[var(--text-primary)] block">{item.title}</span>
                    <span className="text-xs text-[var(--text-secondary)]">{item.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Interactive Bounded Execution Pipeline Showcase */}
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-[var(--border-subtle)] gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] font-mono">Live Governance Pipeline Demo</span>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mt-1">See how structured data passes through the control plane</h3>
            </div>

            {/* Example Selector */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)] font-medium">Scenario:</span>
              <button
                type="button"
                onClick={() => setSelectedExample('enterprise')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  selectedExample === 'enterprise'
                    ? 'bg-[var(--brand-emerald)] text-white shadow-sm'
                    : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Enterprise Lead
              </button>
              <button
                type="button"
                onClick={() => setSelectedExample('security')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  selectedExample === 'security'
                    ? 'bg-[var(--brand-emerald)] text-white shadow-sm'
                    : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Legal DPA Review
              </button>
              <button
                type="button"
                onClick={() => setSelectedExample('churn')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  selectedExample === 'churn'
                    ? 'bg-[var(--brand-emerald)] text-white shadow-sm'
                    : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Sev-1 Incident
              </button>
            </div>
          </div>

          {/* Stepper Pipeline */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
            {/* Step 1: Raw Inbound Payload */}
            <div className="p-4 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono font-bold text-[var(--text-muted)] uppercase">01. Unstructured Input</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-card)] text-[var(--text-secondary)] font-mono">Raw Text</span>
                </div>
                <p className="text-xs font-mono text-[var(--text-secondary)] leading-relaxed italic bg-[var(--surface-card)] p-2.5 rounded border border-[var(--border-subtle)]">
                  {activeData.rawInput}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                <span>Webhook Ingestion</span>
              </div>
            </div>

            {/* Step 2: AI Classification & Extraction (Subtle Violet) */}
            <div className="p-4 rounded-xl bg-[rgba(139,92,246,0.03)] border border-[#8B5CF6]/30 flex flex-col justify-between relative shadow-sm">
              <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#8B5CF6] dark:text-[#A78BFA] text-[10px] font-mono font-semibold">
                <Sparkles className="w-3 h-3" />
                AI Bounded
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono font-bold text-[#8B5CF6] dark:text-[#A78BFA] uppercase">02. Semantic Extraction</span>
                </div>
                <div className="text-[11px] font-mono bg-[var(--surface-primary)] p-2.5 rounded border border-[#8B5CF6]/20 text-[var(--text-primary)] space-y-1">
                  {Object.entries(activeData.aiExtracted).map(([key, val]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{key}:</span>
                      <span className="font-semibold text-[#8B5CF6] dark:text-[#A78BFA]">{String(val)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-[#8B5CF6]/20 text-[11px] text-[#8B5CF6] dark:text-[#A78BFA] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Typed JSON Validated</span>
              </div>
            </div>

            {/* Step 3: Deterministic Rule Gate */}
            <div className="p-4 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono font-bold text-[var(--text-muted)] uppercase">03. Deterministic Gate</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-card)] text-[var(--brand-emerald)] font-mono font-semibold">Zero AI Bias</span>
                </div>
                <div className="p-2.5 rounded bg-[var(--surface-card)] border border-[var(--border-subtle)] font-mono text-[11px] space-y-2">
                  <div className="text-[var(--text-muted)] text-[10px]">RULE:</div>
                  <div className="text-[var(--text-primary)] font-semibold break-words">{activeData.ruleEvaluation}</div>
                  <div className="text-xs font-bold text-[var(--brand-emerald)] pt-1 border-t border-[var(--border-subtle)]">
                    {activeData.ruleResult}
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5" />
                <span>Explicit Code Decision</span>
              </div>
            </div>

            {/* Step 4: Downstream Action / Governance */}
            <div className="p-4 rounded-xl bg-[var(--surface-sunken)] border border-[var(--brand-emerald)]/30 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono font-bold text-[var(--brand-emerald)] uppercase">04. Execution & Audit</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] font-mono font-semibold">Audited</span>
                </div>
                <div className="p-2.5 rounded bg-[var(--surface-card)] border border-[var(--brand-emerald)]/20 text-xs text-[var(--text-primary)] leading-relaxed">
                  <span className="font-semibold text-[var(--text-primary)] block mb-1">Downstream Event:</span>
                  <p className="text-[var(--text-secondary)]">{activeData.outcome}</p>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[11px] text-[var(--brand-emerald)] flex items-center gap-1.5 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>SLA Timer Active</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
