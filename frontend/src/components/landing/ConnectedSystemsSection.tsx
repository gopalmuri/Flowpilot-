import React from 'react';
import { 
  Webhook, 
  MessageSquare, 
  Database, 
  ArrowDown, 
  ExternalLink, 
  Globe, 
  Layers, 
  ShieldCheck, 
  RefreshCw,
  Cpu,
} from 'lucide-react';

export const ConnectedSystemsSection: React.FC = () => {
  return (
    <section id="platform" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 relative">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <Layers className="w-3.5 h-3.5" />
            System Orchestration
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Orchestrate the systems <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">your business already uses.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            FlowPilot sits between incoming business events and downstream business systems.
            We don’t replace your CRM, messaging, or databases — we make them execute in lockstep.
          </p>
        </div>

        {/* Visual Topology Diagram: Inbound -> FlowPilot Control Plane -> Outbound */}
        <div className="mb-16 p-8 rounded-3xl bg-[var(--surface-primary)] border border-[var(--border-subtle)] shadow-sm">
          {/* Layer 1: Inbound Triggers */}
          <div className="text-center max-w-sm mx-auto mb-6">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] font-semibold">Incoming Business Events</span>
            <div className="mt-2 p-3.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border-subtle)] flex items-center justify-center gap-3 shadow-xs">
              <Globe className="w-5 h-5 text-[var(--brand-emerald)]" />
              <div className="text-left">
                <span className="text-xs font-bold text-[var(--text-primary)] block">Website Forms &amp; REST Inbound APIs</span>
                <span className="text-[11px] font-mono text-[var(--text-secondary)]">HTTPS JSON Webhook Triggers</span>
              </div>
            </div>
          </div>

          {/* Connection Line Down */}
          <div className="flex justify-center mb-6">
            <div className="flex flex-col items-center">
              <div className="w-0.5 h-6 bg-[var(--border-strong)]" />
              <ArrowDown className="w-4 h-4 text-[var(--brand-emerald)] -mt-1" />
            </div>
          </div>

          {/* Layer 2: FlowPilot Control Plane Box */}
          <div className="max-w-2xl mx-auto p-6 rounded-2xl bg-[var(--brand-emerald)]/10 border-2 border-[var(--brand-emerald)]/40 text-center relative overflow-hidden mb-6 shadow-sm">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--brand-emerald)]/10 rounded-bl-full pointer-events-none" />
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-md bg-[var(--brand-emerald)] text-white flex items-center justify-center font-bold text-xs">
                FP
              </div>
              <h3 className="text-base font-bold text-[var(--text-primary)]">FlowPilot Orchestration Control Plane</h3>
            </div>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Payload Validation • AI Intent Extraction • Business Rules Engine • Human Approval Gates • Retry &amp; Observability
            </p>
          </div>

          {/* Connection Lines Splitting Out */}
          <div className="hidden md:flex justify-around max-w-3xl mx-auto mb-6 px-12">
            <div className="flex flex-col items-center">
              <div className="w-0.5 h-6 bg-[var(--border-strong)]" />
              <ArrowDown className="w-4 h-4 text-[var(--brand-emerald)] -mt-1" />
            </div>
            <div className="flex flex-col items-center">
              <div className="w-0.5 h-6 bg-[var(--border-strong)]" />
              <ArrowDown className="w-4 h-4 text-[var(--brand-emerald)] -mt-1" />
            </div>
            <div className="flex flex-col items-center">
              <div className="w-0.5 h-6 bg-[var(--border-strong)]" />
              <ArrowDown className="w-4 h-4 text-[var(--brand-emerald)] -mt-1" />
            </div>
          </div>

          {/* Layer 3: Supported Downstream Capabilities (3 Columns) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {/* 1. Webhooks */}
            <div className="p-5 rounded-xl bg-[var(--surface-card)] border border-[var(--border-subtle)] hover:border-[var(--brand-emerald)]/50 transition-all shadow-xs">
              <div className="w-10 h-10 rounded-lg bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--brand-emerald)] mb-4">
                <Webhook className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-bold text-[var(--text-primary)]">Inbound &amp; Outbound Webhooks</h4>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Connect any HTTP service. Deliver authenticated payloads with HMAC signatures, exponential backoff retries, and rate limiting.
              </p>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                <span>POST / PUT</span>
                <span className="text-[var(--brand-emerald)] font-semibold">Active</span>
              </div>
            </div>

            {/* 2. Slack Integration */}
            <div className="p-5 rounded-xl bg-[var(--surface-card)] border border-[var(--border-subtle)] hover:border-[var(--brand-emerald)]/50 transition-all shadow-xs">
              <div className="w-10 h-10 rounded-lg bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--brand-emerald)] mb-4">
                <MessageSquare className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-bold text-[var(--text-primary)]">Slack Real-time Messaging</h4>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Dispatch structured alerts, incident notifications, and human approval requests directly into dedicated team channels.
              </p>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                <span>Bot API</span>
                <span className="text-[var(--brand-emerald)] font-semibold">Active</span>
              </div>
            </div>

            {/* 3. CRM Integration */}
            <div className="p-5 rounded-xl bg-[var(--surface-card)] border border-[var(--border-subtle)] hover:border-[var(--brand-emerald)]/50 transition-all shadow-xs">
              <div className="w-10 h-10 rounded-lg bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--brand-emerald)] mb-4">
                <Database className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-bold text-[var(--text-primary)]">CRM Record Sync</h4>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Automatically create, update, or deduplicate lead records, accounts, and deal stages when business conditions are fulfilled.
              </p>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                <span>Leads &amp; Deals</span>
                <span className="text-[var(--brand-emerald)] font-semibold">Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* Integration Capabilities Fact Sheet */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          <div className="p-4 rounded-xl bg-[var(--surface-primary)] border border-[var(--border-subtle)] flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-[var(--brand-emerald)] flex-shrink-0" />
            <span className="text-[var(--text-secondary)]">Encrypted Credential Storage (AES-256)</span>
          </div>
          <div className="p-4 rounded-xl bg-[var(--surface-primary)] border border-[var(--border-subtle)] flex items-center gap-3">
            <RefreshCw className="w-4 h-4 text-[var(--brand-emerald)] flex-shrink-0" />
            <span className="text-[var(--text-secondary)]">Automated Retry &amp; Dead-letter Queues</span>
          </div>
          <div className="p-4 rounded-xl bg-[var(--surface-primary)] border border-[var(--border-subtle)] flex items-center gap-3">
            <Cpu className="w-4 h-4 text-[var(--brand-emerald)] flex-shrink-0" />
            <span className="text-[var(--text-secondary)]">Idempotent Execution Guarantee</span>
          </div>
          <div className="p-4 rounded-xl bg-[var(--surface-primary)] border border-[var(--border-subtle)] flex items-center gap-3">
            <ExternalLink className="w-4 h-4 text-[var(--brand-emerald)] flex-shrink-0" />
            <span className="text-[var(--text-secondary)]">Full Correlation Traces per Webhook</span>
          </div>
        </div>
      </div>
    </section>
  );
};
