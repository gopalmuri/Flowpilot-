import React, { useState } from 'react';
import { 
  Sparkles, 
  UserCheck, 
  CheckCircle2, 
  Layers,
  ShieldCheck
} from 'lucide-react';
import { useInView } from '../../hooks/useMotion';

interface Scenario {
  id: string;
  name: string;
  badge: string;
  inbound: {
    channel: string;
    sender: string;
    requestText: string;
  };
  aiExtraction: {
    intent: string;
    confidence: string;
    entities: Record<string, string>;
  };
  ruleGate: {
    rule: string;
    condition: string;
    outcome: string;
  };
  approval: {
    required: boolean;
    role: string;
    status: string;
    sla: string;
  };
  action: {
    summary: string;
    systems: string[];
  };
  auditRecord: string;
}

export const InteractiveDemoSection: React.FC = () => {
  const [sectionRef, isInView] = useInView({ threshold: 0.15 });

  const scenarios: Scenario[] = [
    {
      id: 'lead',
      name: 'Enterprise Lead Intake',
      badge: 'Sales Ops',
      inbound: {
        channel: 'POST /v1/webhooks/typeform',
        sender: 'Sarah Lin, VP Engineering @ NorthStar Systems',
        requestText: '"Looking for enterprise deployment for 750 seats, SOC2 compliance, dedicated VPC and SSO integration."'
      },
      aiExtraction: {
        intent: 'Enterprise Upgrade / High-Value Expansion',
        confidence: '0.96 (High)',
        entities: {
          Company: 'NorthStar Systems',
          EstimatedSeats: '750',
          ComplianceScope: 'SOC2 Type II',
          DealTier: 'Tier 1 (> $50k ARR)'
        }
      },
      ruleGate: {
        rule: 'IF DealTier == "Tier 1" AND Seats >= 500',
        condition: 'Trigger VP Sales & Security Director sign-off gate',
        outcome: 'Gated Execution (Hold)'
      },
      approval: {
        required: true,
        role: 'VP Sales (Commercial) + InfoSec Lead',
        status: 'Awaiting Dual-Key Authorization',
        sla: '15 min response window'
      },
      action: {
        summary: 'Create Salesforce Opportunity ($92k ARR) + invite customer to dedicated Slack channel + alert #revops',
        systems: ['Salesforce', 'Slack', 'HubSpot']
      },
      auditRecord: 'sha256:4a8e99b0c2...f8812c7 [Timestamp: 2026-09-28T10:14:02Z]'
    },
    {
      id: 'refund',
      name: 'High-Risk Refund Exception',
      badge: 'Finance Ops',
      inbound: {
        channel: 'Intercom API / Ticket #49102',
        sender: 'Billing Team for Retail Partner #812',
        requestText: '"Customer requested $8,400 transaction refund due to duplicate gateway batch charging."'
      },
      aiExtraction: {
        intent: 'Billing Dispute / High-Value Refund',
        confidence: '0.98 (High)',
        entities: {
          Amount: '$8,400.00 USD',
          MerchantId: 'MERCHANT_812',
          DisputeCategory: 'Duplicate Batch Charge',
          RiskScore: '0.12 (Low Fraud Risk)'
        }
      },
      ruleGate: {
        rule: 'IF RefundAmount > $5,000 AND RiskScore < 0.20',
        condition: 'Route to Finance Controller with audit freeze check',
        outcome: 'Deterministic Human Gate'
      },
      approval: {
        required: true,
        role: 'Finance Controller',
        status: 'Authorized with Token: auth_fin_8829',
        sla: '30 min response window'
      },
      action: {
        summary: 'Issue Stripe refund #re_99182 + create NetSuite credit memo + dispatch confirmation email',
        systems: ['Stripe', 'NetSuite', 'SendGrid']
      },
      auditRecord: 'sha256:1f92e48aa3...01948ba [Timestamp: 2026-09-28T10:18:44Z]'
    },
    {
      id: 'access',
      name: 'Production Access Escalation',
      badge: 'SecOps',
      inbound: {
        channel: 'Slack Slash Command /request-access',
        sender: 'David K., Staff Reliability Engineer',
        requestText: '"Need 60-minute break-glass SSH access to prod-us-east-1 RDS cluster to investigate connection pool exhaustion."'
      },
      aiExtraction: {
        intent: 'Privileged Infrastructure Access Escalation',
        confidence: '0.99 (High)',
        entities: {
          Cluster: 'prod-us-east-1-rds',
          Duration: '60 minutes (Time-Bounded)',
          Reason: 'P1 Incident #7719 Investigation',
          Scope: 'Read-Only Query Replica'
        }
      },
      ruleGate: {
        rule: 'IF Environment == "Production" AND IncidentStatus == "Active"',
        condition: 'Enforce Dual-Custodian Sign-Off with auto-revocation at T+60m',
        outcome: 'Security Gate Enforced'
      },
      approval: {
        required: true,
        role: 'On-Call Incident Commander + Security Officer',
        status: 'Signed by IC: Sarah L. (Waiting for SecOps)',
        sla: '5 min critical window'
      },
      action: {
        summary: 'Provision Teleport temporary certificate (TTL: 3600s) + emit AWS CloudTrail audit event + start session recording',
        systems: ['Teleport', 'AWS IAM', 'PagerDuty']
      },
      auditRecord: 'sha256:77bc0019dd...bb018aa [Timestamp: 2026-09-28T10:22:10Z]'
    }
  ];

  const [activeId, setActiveId] = useState<string>('lead');
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const handleSelectScenario = (id: string) => {
    if (id === activeId || isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveId(id);
      setIsTransitioning(false);
    }, 160);
  };

  const active = scenarios.find((s) => s.id === activeId) || scenarios[0];

  return (
    <section ref={sectionRef} className="py-20 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="max-w-6xl mx-auto">
        {/* Section Header with Entrance Animation */}
        <div className={`text-center max-w-2xl mx-auto mb-12 transition-all duration-400 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-700/60 mb-4">
            <Layers className="w-3.5 h-3.5" />
            Interactive Scenario Demonstration
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
            See FlowPilot in action across high-stakes requests.
          </h2>
          <p className="mt-3 text-base text-[var(--text-secondary)]">
            Explore how real enterprise workloads transition from raw input to bounded classification, deterministic rule gating, and auditable action.
          </p>
        </div>

        {/* Scenario Switcher Tabs with smooth active indicators */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          {scenarios.map((sc) => (
            <button
              key={sc.id}
              type="button"
              onClick={() => handleSelectScenario(sc.id)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer active:scale-95 ${
                activeId === sc.id
                  ? 'bg-brand-600 dark:bg-brand-500 text-white shadow-xs ring-2 ring-brand-500/20'
                  : 'bg-[var(--bg-surface-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-brand-500/30'
              }`}
            >
              <span>{sc.name}</span>
              <span className={`ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                activeId === sc.id ? 'bg-white/20 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
              }`}>
                {sc.badge}
              </span>
            </button>
          ))}
        </div>

        {/* Live Scenario Inspector Grid with animated crossfade (fade + translateY(5px) -> -5px -> 0) */}
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 transition-all duration-200 transform ${
          isTransitioning ? 'opacity-0 scale-[0.99] translate-y-2' : 'opacity-100 scale-100 translate-y-0'
        }`}>
          {/* Card 1: Inbound Request */}
          <div className="card-hover-micro p-5 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex flex-col justify-between hover:border-brand-500/30">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-bold">
                  01. Inbound Request
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                  {active.inbound.channel}
                </span>
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-2">
                {active.inbound.sender}
              </p>
              <p className="text-xs text-[var(--text-secondary)] italic bg-[var(--bg-surface)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                {active.inbound.requestText}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[11px] font-mono text-brand-600 dark:text-brand-400 flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 micro-icon" />
              <span>Validated Payload</span>
            </div>
          </div>

          {/* Card 2: AI Classification (Subtle Violet Identity) */}
          <div className="card-hover-micro p-5 rounded-2xl bg-violet-500/5 border border-violet-500/30 flex flex-col justify-between relative hover:border-violet-500/50">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-violet-600 dark:text-violet-400 font-bold">
                  02. AI Classification
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-300 font-bold">
                  {active.aiExtraction.confidence}
                </span>
              </div>
              <p className="text-xs font-bold text-[var(--text-primary)] mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-500 micro-icon" />
                {active.aiExtraction.intent}
              </p>
              <div className="text-[11px] font-mono space-y-1 bg-[var(--bg-surface)] p-2.5 rounded-lg border border-violet-500/20 text-[var(--text-secondary)]">
                {Object.entries(active.aiExtraction.entities).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-[var(--text-muted)]">{k}:</span>
                    <span className="font-semibold text-violet-700 dark:text-violet-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-violet-500/20 text-[11px] font-mono text-violet-600 dark:text-violet-400 flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 micro-icon" />
              <span>Bounded Extraction</span>
            </div>
          </div>

          {/* Card 3: Deterministic Rule & Human Gate (Amber) */}
          <div className="card-hover-micro p-5 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex flex-col justify-between hover:border-amber-500/30">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-bold">
                  03. Rules &amp; Approval
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">
                  SLA: {active.approval.sla}
                </span>
              </div>
              <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[11px] font-mono mb-2">
                <span className="text-[10px] text-[var(--text-muted)] block">RULE:</span>
                <span className="font-semibold text-[var(--text-primary)] block break-words">
                  {active.ruleGate.rule}
                </span>
              </div>
              <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] font-mono text-amber-800 dark:text-amber-300">
                <span className="text-[10px] uppercase font-bold block text-amber-600 dark:text-amber-400">Gate Status:</span>
                <span>{active.approval.status}</span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[11px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-medium">
              <UserCheck className="w-3.5 h-3.5 micro-icon" />
              <span>{active.approval.role}</span>
            </div>
          </div>

          {/* Card 4: Action & Audit Trail */}
          <div className="card-hover-micro p-5 rounded-2xl bg-[var(--bg-app)] border border-brand-500/30 flex flex-col justify-between hover:border-brand-500/50">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-brand-600 dark:text-brand-400 font-bold">
                  04. Action &amp; Audit
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 font-bold">
                  Executed
                </span>
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
                Downstream Mutation:
              </p>
              <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-surface)] p-2.5 rounded-lg border border-[var(--border-subtle)] mb-2">
                {active.action.summary}
              </p>
              <p className="text-[10px] font-mono text-[var(--text-muted)] break-all bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)]">
                {active.auditRecord}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[11px] font-mono text-brand-600 dark:text-brand-400 flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 micro-icon" />
              <span>Immutable Audit Trail</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
