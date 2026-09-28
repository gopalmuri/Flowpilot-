import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Play, 
  Pause, 
  RotateCcw, 
} from 'lucide-react';

interface TimelineStep {
  id: number;
  label: string;
  category: 'ingest' | 'ai' | 'rule' | 'human' | 'action' | 'audit';
  duration: string;
  details: string;
  statusText: string;
}

export const BusinessExampleSection: React.FC = () => {
  const steps: TimelineStep[] = [
    {
      id: 1,
      label: 'Receives request',
      category: 'ingest',
      duration: '4ms',
      details: 'HTTPS POST /v1/webhooks/sales-intake from marketing website contact form.',
      statusText: '202 ACCEPTED'
    },
    {
      id: 2,
      label: 'Validates payload',
      category: 'ingest',
      duration: '8ms',
      details: 'Pydantic schema validation verifies company name, work email, and seat inquiry parameters.',
      statusText: 'SCHEMA VALID'
    },
    {
      id: 3,
      label: 'AI identifies enterprise intent',
      category: 'ai',
      duration: '310ms',
      details: 'Extracted: 500 seats, SSO SAML requirement, custom InfoSec addendum. Confidence: 0.99.',
      statusText: 'INTENT: ENTERPRISE'
    },
    {
      id: 4,
      label: 'Rules detect enterprise tier',
      category: 'rule',
      duration: '3ms',
      details: 'Deterministic logic matches rule: seats >= 250 requires Tier-1 Account Executive + VP Approval.',
      statusText: 'RULE MATCHED'
    },
    {
      id: 5,
      label: 'Manager approval requested',
      category: 'human',
      duration: '12ms',
      details: 'Workflow transitions to WAITING_FOR_APPROVAL. Dispatched notification to VP Sales queue.',
      statusText: 'GATE HALTED'
    },
    {
      id: 6,
      label: 'Manager approves',
      category: 'human',
      duration: 'Manual',
      details: 'VP of Sales reviews commercial scope in FlowPilot UI and submits signed approval token.',
      statusText: 'HUMAN APPROVED'
    },
    {
      id: 7,
      label: 'CRM lead created',
      category: 'action',
      duration: '180ms',
      details: 'Created Account "Acme Corp" & Deal "500-seat Enterprise" valued at $85,000 ARR in CRM.',
      statusText: 'CRM SYNCED'
    },
    {
      id: 8,
      label: 'Slack notification dispatched',
      category: 'action',
      duration: '95ms',
      details: 'Formatted deal brief posted to #enterprise-wins channel with AE assignment link.',
      statusText: 'SLACK SENT'
    },
    {
      id: 9,
      label: 'Execution completed',
      category: 'action',
      duration: '6ms',
      details: 'All downstream task handlers returned 200 OK. State marked COMPLETED.',
      statusText: 'STATUS: COMPLETED'
    },
    {
      id: 10,
      label: 'Audit trail recorded',
      category: 'audit',
      duration: '14ms',
      details: 'Full execution payload, actor tokens, and timestamps committed to immutable audit ledger.',
      statusText: 'AUDIT COMMITTED'
    }
  ];

  const [activeStepIndex, setActiveStepIndex] = useState<number>(steps.length - 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setActiveStepIndex((prev) => {
          if (prev >= steps.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1200);
    }
    return () => clearInterval(interval);
  }, [isPlaying, steps.length]);

  const handleRestart = () => {
    setActiveStepIndex(0);
    setIsPlaying(true);
  };

  return (
    <section id="solutions" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <Clock className="w-3.5 h-3.5" />
            Walkthrough
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            From inbound request to <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">completed business action.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            Here is a realistic look at how Acme Corporation's 500-user enterprise request moves through
            FlowPilot from initial form submission to recorded audit log.
          </p>
        </div>

        {/* Realistic Request Card Brief */}
        <div className="mb-12 p-6 rounded-2xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[var(--border-subtle)] gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] font-semibold">Incoming Business Request Payload</span>
            <span className="text-xs font-mono text-[var(--brand-emerald)]">Correlation ID: fp_lead_9281bf7</span>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div>
              <span className="text-[var(--text-muted)] block">Sender:</span>
              <span className="font-semibold text-[var(--text-primary)]">Acme Corporation (VP Tech)</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Raw Inquiry:</span>
              <span className="font-semibold text-[var(--text-primary)]">"500 employees, SSO SAML, custom InfoSec"</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">SLA Target:</span>
              <span className="font-semibold text-[var(--brand-emerald)]">&lt; 15 mins (Tier-1)</span>
            </div>
          </div>
        </div>

        {/* Interactive Controls Bar */}
        <div className="flex items-center justify-between max-w-4xl mx-auto mb-8 bg-[var(--surface-card)] p-3 rounded-xl border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--brand-emerald)] text-white hover:opacity-95 transition-all shadow-xs"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause Stepper' : 'Play Stepper'}</span>
            </button>
            <button
              type="button"
              onClick={handleRestart}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restart</span>
            </button>
          </div>

          <div className="text-xs font-mono text-[var(--text-muted)]">
            Step <span className="font-bold text-[var(--text-primary)]">{activeStepIndex + 1}</span> of {steps.length}
          </div>
        </div>

        {/* 10-Step Timeline List */}
        <div className="max-w-4xl mx-auto space-y-3">
          {steps.map((step, idx) => {
            const isCompleted = idx <= activeStepIndex;
            const isCurrent = idx === activeStepIndex;

            return (
              <div
                key={step.id}
                onClick={() => setActiveStepIndex(idx)}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isCurrent
                    ? 'bg-[var(--surface-card)] border-2 border-[var(--brand-emerald)] shadow-md'
                    : isCompleted
                    ? 'bg-[var(--surface-card)] border-[var(--border-subtle)] hover:border-[var(--brand-emerald)]/40'
                    : 'bg-[var(--surface-sunken)]/60 border-transparent opacity-50'
                }`}
              >
                <div className="flex items-start sm:items-center gap-3.5">
                  {/* Step Number or Check */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-mono font-bold transition-all ${
                    isCurrent
                      ? 'bg-[var(--brand-emerald)] text-white ring-4 ring-[var(--brand-emerald)]/20'
                      : isCompleted
                      ? 'bg-[var(--brand-emerald)]/15 text-[var(--brand-emerald)]'
                      : 'bg-[var(--surface-sunken)] text-[var(--text-muted)]'
                  }`}>
                    {isCompleted && !isCurrent ? <CheckCircle2 className="w-4 h-4" /> : step.id}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">{step.label}</h4>
                      {step.category === 'ai' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#8B5CF6]/15 text-[#8B5CF6] dark:text-[#A78BFA] border border-[#8B5CF6]/30">
                          AI Bounded
                        </span>
                      )}
                      {step.category === 'human' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          Human Gate
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 max-w-xl">
                      {step.details}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 font-mono text-xs flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[var(--border-subtle)]">
                  <span className="text-[var(--text-muted)]">{step.duration}</span>
                  <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                    isCurrent
                      ? 'bg-[var(--brand-emerald)]/20 text-[var(--brand-emerald)]'
                      : isCompleted
                      ? 'bg-[var(--surface-sunken)] text-[var(--text-secondary)]'
                      : 'text-[var(--text-muted)]'
                  }`}>
                    {step.statusText}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
