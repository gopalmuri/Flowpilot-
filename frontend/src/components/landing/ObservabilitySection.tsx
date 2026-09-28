import React, { useState } from 'react';
import { 
  Activity, 
  CheckCircle2, 
  ShieldCheck, 
  ChevronRight, 
  Copy, 
  Check, 
} from 'lucide-react';

export const ObservabilitySection: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number>(2);

  const steps = [
    { name: 'Trigger (Webhook)', duration: '14ms', status: 'SUCCESS', details: 'POST /v1/webhooks/intake • Headers: HMAC SHA-256 Validated • Payload: 1.4KB' },
    { name: 'Payload Validation', duration: '8ms', status: 'SUCCESS', details: 'Pydantic Model Schema Match • Required fields [company, email, seats] present' },
    { name: 'AI Classification', duration: '410ms', status: 'SUCCESS', details: 'Model: Mistral-7B / Local Guard • Intent: Enterprise Expansion • Confidence: 0.99', isAi: true },
    { name: 'Deterministic Rule Gate', duration: '3ms', status: 'SUCCESS', details: 'Rule matched: seats >= 250 • Routed to VP Approval branch' },
    { name: 'Human Approval Gate', duration: '2m 14s', status: 'RESOLVED', details: 'Actor: vp_sales@acme.com • Token: apr_77a94f • Decision: APPROVED' },
    { name: 'CRM Record Sync', duration: '280ms', status: 'SUCCESS', details: 'Created Lead ID #crm_88921 • Deal Value: $85,000 • Status: Qualified' },
    { name: 'Slack Notification', duration: '95ms', status: 'SUCCESS', details: 'Dispatched to #enterprise-wins • Channel ID: C0829A10 • Thread ID: p179023' },
  ];

  const handleCopy = () => {
    navigator.clipboard.writeText('exec_9f82d1c0b3');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="observability" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <Activity className="w-3.5 h-3.5" />
            Full Observability
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Know exactly what happened. <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">At every millisecond.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            Eliminate black-box automation. FlowPilot captures deterministic execution traces,
            precise step latencies, human checkpoint states, and immutable audit logs.
          </p>
        </div>

        {/* Miniature Execution Monitoring Interface */}
        <div className="max-w-5xl mx-auto rounded-3xl border-2 border-[var(--border-strong)] bg-[var(--surface-card)] shadow-xl overflow-hidden">
          {/* Top Window Bar */}
          <div className="px-6 py-4 bg-[var(--surface-sunken)] border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-[var(--brand-emerald)]/80" />
              </div>
              <span className="text-xs font-mono font-bold text-[var(--text-primary)] border-l border-[var(--border-subtle)] pl-3 ml-1">
                Lead Intake Automation
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--brand-emerald)]/20 text-[var(--brand-emerald)]">
                COMPLETED
              </span>
            </div>

            {/* Illustrative Demo Indicator */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-1 rounded border border-[var(--border-subtle)]">
                Illustrative Execution Trace
              </span>
            </div>
          </div>

          {/* Telemetry Header Bar */}
          <div className="px-6 py-3 bg-[var(--surface-primary)] border-b border-[var(--border-subtle)] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <span className="text-[var(--text-muted)] block text-[10px]">CORRELATION ID</span>
              <button 
                type="button" 
                onClick={handleCopy}
                className="font-bold text-[var(--text-primary)] flex items-center gap-1 hover:text-[var(--brand-emerald)] transition-colors"
              >
                <span>exec_9f82d1c0b3</span>
                {copied ? <Check className="w-3 h-3 text-[var(--brand-emerald)]" /> : <Copy className="w-3 h-3 text-[var(--text-muted)]" />}
              </button>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block text-[10px]">TOTAL DURATION</span>
              <span className="font-bold text-[var(--brand-emerald)]">3.31s (active)</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block text-[10px]">HUMAN CHECKPOINT</span>
              <span className="font-bold text-[var(--text-primary)]">Approved (VP Sales)</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block text-[10px]">AUDIT COMMIT</span>
              <span className="font-bold text-[var(--text-primary)] font-mono">sha256:d82...f9a</span>
            </div>
          </div>

          {/* Main Execution Inspector Body */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-subtle)]">
            {/* Step Sequence Timeline List (7 cols) */}
            <div className="lg:col-span-7 p-6 space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] font-semibold block mb-3">
                Execution DAG Step Sequence
              </span>

              {steps.map((st, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setSelectedStep(i)}
                  className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 text-xs font-mono ${
                    selectedStep === i
                      ? 'bg-[var(--surface-sunken)] border-[var(--brand-emerald)] text-[var(--text-primary)] shadow-xs'
                      : 'bg-transparent border-transparent hover:bg-[var(--surface-sunken)]/50 text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-[var(--brand-emerald)]/15 text-[var(--brand-emerald)] flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-semibold text-[var(--text-primary)]">{st.name}</span>
                    {st.isAi && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 text-[#8B5CF6] dark:text-[#A78BFA] font-bold">
                        AI
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-muted)]">{st.duration}</span>
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${selectedStep === i ? 'rotate-90 text-[var(--brand-emerald)]' : 'text-[var(--text-muted)]'}`} />
                  </div>
                </button>
              ))}
            </div>

            {/* Step Payload Detail Inspector (5 cols) */}
            <div className="lg:col-span-5 p-6 bg-[var(--surface-sunken)]/40 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] font-semibold block mb-3">
                  Step Telemetry Inspector
                </span>

                <div className="p-4 rounded-xl bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-3 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">STEP NAME</span>
                    <span className="font-bold text-[var(--text-primary)] text-sm">{steps[selectedStep].name}</span>
                  </div>

                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">EXECUTION TIME</span>
                    <span className="font-semibold text-[var(--brand-emerald)]">{steps[selectedStep].duration}</span>
                  </div>

                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">DIAGNOSTIC LOG</span>
                    <p className="text-[11px] text-[var(--text-secondary)] bg-[var(--surface-sunken)] p-2.5 rounded border border-[var(--border-subtle)] mt-1 break-words">
                      {steps[selectedStep].details}
                    </p>
                  </div>

                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">RETRY POLICY</span>
                    <span className="text-[11px] text-[var(--text-secondary)]">Max Attempts: 3 • Backoff: Exponential (Base 2s)</span>
                  </div>
                </div>
              </div>

              {/* Security Trace Confirmation */}
              <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex items-center gap-2 text-[11px] text-[var(--text-muted)] font-mono">
                <ShieldCheck className="w-4 h-4 text-[var(--brand-emerald)]" />
                <span>Idempotency token checked &amp; released cleanly</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
