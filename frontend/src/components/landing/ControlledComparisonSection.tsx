import React from 'react';
import { 
  ArrowDown, 
  XCircle, 
  CheckCircle2, 
  GitCompare,
  TrendingDown,
  TrendingUp
} from 'lucide-react';

export const ControlledComparisonSection: React.FC = () => {
  return (
    <section id="comparison" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 relative">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <GitCompare className="w-3.5 h-3.5" />
            Operational Paradigm Shift
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Stop duct-taping operations. <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">Orchestrate them.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            Compare fragile manual coordination across siloed tools against FlowPilot’s unified,
            auditable, and deterministic control plane.
          </p>
        </div>

        {/* Side-by-Side Comparison Container */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          {/* Left Column: Fragmented Manual Coordination */}
          <div className="p-8 rounded-3xl bg-[var(--surface-primary)] border-2 border-rose-500/20 shadow-sm flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-bl-full pointer-events-none" />

            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)] mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
                    <XCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">Manual Coordination</h3>
                    <p className="text-xs text-[var(--text-muted)]">Fragile, Slow &amp; Ungoverned</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-500/10 text-rose-500">
                  High Risk
                </span>
              </div>

              {/* Vertical Linear Steps */}
              <div className="space-y-3 font-mono text-xs max-w-sm mx-auto my-6">
                {[
                  { label: 'Incoming Request', sub: 'Inbound email or webform landing in shared inbox' },
                  { label: 'Email Chain', sub: 'Forwarded to 3 internal stakeholders with context lost' },
                  { label: 'Manual Spreadsheet', sub: 'Row manually typed into Google Sheets or tracker' },
                  { label: 'Slack Ping', sub: 'Urgent DM sent to manager asking for status' },
                  { label: 'Manager Review', sub: 'Delayed 18 hours due to buried notifications' },
                  { label: 'Manual CRM Entry', sub: 'Fields copied over by hand with missing metadata' },
                  { label: 'Manual Follow-up', sub: 'Hope that someone remembered to respond to lead' }
                ].map((item, idx, arr) => (
                  <React.Fragment key={idx}>
                    <div className="p-3 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)] flex items-center justify-between">
                      <div>
                        <span className="font-bold text-[var(--text-primary)] block">{item.label}</span>
                        <span className="text-[11px] text-[var(--text-secondary)]">{item.sub}</span>
                      </div>
                      <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 ml-2" />
                    </div>
                    {idx < arr.length - 1 && (
                      <div className="flex justify-center my-0.5">
                        <ArrowDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Downside Takeaways */}
            <div className="mt-6 pt-5 border-t border-[var(--border-subtle)] space-y-2 text-xs">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-medium">
                <TrendingDown className="w-4 h-4 flex-shrink-0" />
                <span>Average resolution time: 24–72 hours</span>
              </div>
              <p className="text-[var(--text-secondary)] text-[11px]">
                Zero SLA visibility, non-existent audit logs, rampant data re-entry errors, and constant manual nagging.
              </p>
            </div>
          </div>

          {/* Right Column: FlowPilot Governed Control Plane */}
          <div className="p-8 rounded-3xl bg-[var(--surface-primary)] border-2 border-[var(--brand-emerald)] shadow-lg flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--brand-emerald)]/10 rounded-bl-full pointer-events-none" />

            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)] mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-[var(--brand-emerald)]/15 text-[var(--brand-emerald)] flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">FlowPilot Control Plane</h3>
                    <p className="text-xs text-[var(--brand-emerald)] font-semibold">Deterministic, Governed &amp; Real-time</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[var(--brand-emerald)]/15 text-[var(--brand-emerald)]">
                  Guaranteed SLA
                </span>
              </div>

              {/* Vertical Linear Steps */}
              <div className="space-y-3 font-mono text-xs max-w-sm mx-auto my-6">
                {[
                  { label: 'Request Ingestion', sub: 'Authenticated webhook trigger accepted with HMAC' },
                  { label: 'Payload Validation', sub: 'Strict schema check prevents corrupted data entry' },
                  { label: 'AI Classification', sub: 'Bounded semantic parsing into structured JSON', isAi: true },
                  { label: 'Deterministic Rules', sub: 'Explicit threshold logic decides branch execution' },
                  { label: 'Human Approval Gate', sub: 'Halts safely for authorized sign-off if required' },
                  { label: 'Automated Action', sub: 'Instant sync across CRM, Slack, and APIs' },
                  { label: 'Immutable Audit & SLA', sub: 'SHA-256 hashed ledger committed permanently' }
                ].map((item, idx, arr) => (
                  <React.Fragment key={idx}>
                    <div className={`p-3 rounded-xl border flex items-center justify-between ${
                      item.isAi
                        ? 'bg-[rgba(139,92,246,0.05)] border-[#8B5CF6]/30'
                        : 'bg-[var(--surface-sunken)] border-[var(--border-subtle)]'
                    }`}>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[var(--text-primary)]">{item.label}</span>
                          {item.isAi && (
                            <span className="text-[9px] px-1 rounded bg-[#8B5CF6]/15 text-[#8B5CF6] dark:text-[#A78BFA] font-bold">
                              AI
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-[var(--text-secondary)]">{item.sub}</span>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-[var(--brand-emerald)] flex-shrink-0 ml-2" />
                    </div>
                    {idx < arr.length - 1 && (
                      <div className="flex justify-center my-0.5">
                        <ArrowDown className="w-3.5 h-3.5 text-[var(--brand-emerald)]" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Upside Takeaways */}
            <div className="mt-6 pt-5 border-t border-[var(--border-subtle)] space-y-2 text-xs">
              <div className="flex items-center gap-2 text-[var(--brand-emerald)] font-medium">
                <TrendingUp className="w-4 h-4 flex-shrink-0" />
                <span>Execution latency: &lt; 3.5 seconds (plus human review)</span>
              </div>
              <p className="text-[var(--text-secondary)] text-[11px]">
                100% SLA traceability, immutable audit logs, deterministic routing, and zero human copy-paste errors.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
