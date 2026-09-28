import React, { useState } from 'react';
import { 
  UserCheck, 
  Check, 
  X, 
  Clock, 
  ShieldAlert, 
  CheckCircle2, 
  RotateCcw,
  Building,
  
} from 'lucide-react';

export const HumanInTheLoopSection: React.FC = () => {
  const [decisionState, setDecisionState] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const handleApprove = () => {
    setDecisionState('approved');
  };

  const handleReject = () => {
    setDecisionState('rejected');
  };

  const handleReset = () => {
    setDecisionState('pending');
  };

  return (
    <section id="human-in-the-loop" className="py-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] border border-[var(--brand-emerald)]/20 mb-4">
            <UserCheck className="w-3.5 h-3.5" />
            Human-in-the-Loop Governance
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
            Automation does not mean <br className="hidden sm:inline" />
            <span className="text-[var(--brand-emerald)]">giving up control.</span>
          </h2>
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            Sensitive business decisions can pause automatically and request approval from an authorized person.
            Execution halts safely until explicit human sign-off is committed.
          </p>
        </div>

        {/* 2-Column Layout: Interactive Approval Card on Left, Dynamic Execution Flow on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Interactive Approval Card (5 cols) */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface-card)] p-6 sm:p-7 shadow-lg relative overflow-hidden transition-all duration-300">
              {/* Header Badge */}
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)] mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-[var(--brand-emerald)]/15 flex items-center justify-center text-[var(--brand-emerald)]">
                    <Building className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">Acme Corporation</h3>
                    <p className="text-xs text-[var(--text-muted)] font-mono">REQ-2026-8891</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <Clock className="w-3 h-3" />
                  <span>SLA: 03:42:15</span>
                </div>
              </div>

              {/* Lead Details */}
              <div className="space-y-3.5 mb-6 text-xs sm:text-sm">
                <div className="flex justify-between items-center py-1.5 border-b border-[var(--border-subtle)]/60">
                  <span className="text-[var(--text-secondary)]">Request Type:</span>
                  <span className="font-semibold text-[var(--text-primary)]">Enterprise Expansion</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[var(--border-subtle)]/60">
                  <span className="text-[var(--text-secondary)]">Deal Value:</span>
                  <span className="font-mono font-bold text-base text-[var(--brand-emerald)]">$85,000 / yr</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[var(--border-subtle)]/60">
                  <span className="text-[var(--text-secondary)]">AI Classification:</span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#8B5CF6]/15 text-[#8B5CF6] dark:text-[#A78BFA] border border-[#8B5CF6]/20">
                    Enterprise (Tier-1)
                  </span>
                </div>
                <div className="flex justify-between items-start py-1.5 border-b border-[var(--border-subtle)]/60">
                  <span className="text-[var(--text-secondary)]">Requirements:</span>
                  <span className="font-medium text-[var(--text-primary)] text-right max-w-[200px]">
                    Custom Security Addendum & 500 SSO Seats
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-[var(--text-secondary)]">Governance Gate:</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-rose-500 text-xs">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Deal value &gt; $50k requires VP sign-off
                  </span>
                </div>
              </div>

              {/* Action Buttons depending on state */}
              {decisionState === 'pending' && (
                <div className="space-y-3">
                  <div className="text-xs text-[var(--text-muted)] text-center font-mono">
                    Awaiting human authorization to proceed...
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={handleReject}
                      className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all cursor-pointer active:scale-95"
                    >
                      <X className="w-4 h-4" />
                      Reject Lead
                    </button>
                    <button
                      type="button"
                      onClick={handleApprove}
                      className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-[var(--brand-emerald)] hover:opacity-95 shadow-md shadow-[var(--brand-emerald)]/20 transition-all cursor-pointer active:scale-95"
                    >
                      <Check className="w-4 h-4" />
                      Approve & Resume
                    </button>
                  </div>
                </div>
              )}

              {decisionState === 'approved' && (
                <div className="p-4 rounded-xl bg-[var(--brand-emerald)]/10 border border-[var(--brand-emerald)]/30 text-center animate-fadeIn">
                  <div className="w-10 h-10 rounded-full bg-[var(--brand-emerald)] text-white flex items-center justify-center mx-auto mb-2">
                    <Check className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-[var(--brand-emerald)]">Approval Granted by VP Sales</h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
                    Token: <span className="text-[var(--text-primary)]">apr_77a94f</span> • Resuming workflow execution
                  </p>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset demo
                  </button>
                </div>
              )}

              {decisionState === 'rejected' && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-center animate-fadeIn">
                  <div className="w-10 h-10 rounded-full bg-rose-500 text-white flex items-center justify-center mx-auto mb-2">
                    <X className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-rose-500">Lead Rejected with Reason</h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
                    Routing to nurture pipeline & informing AE
                  </p>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset demo
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Visual Execution Progression (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-6 rounded-2xl bg-[var(--surface-sunken)] border border-[var(--border-subtle)]">
              <h3 className="text-base font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--brand-emerald)] animate-pulse" />
                Live Control Plane Trace
              </h3>

              {/* Step Sequence Flow */}
              <div className="space-y-3 font-mono text-xs">
                {/* 1. Gate Triggered */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)]">
                  <div className="w-6 h-6 rounded-md bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--text-muted)] flex-shrink-0 font-bold">
                    1
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">Gate Condition Triggered</span>
                      <span className="text-[10px] text-[var(--brand-emerald)]">Evaluated: PASS</span>
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] mt-0.5">
                      Rule: Deal value &gt; $50k requires human authorization before mutating production systems.
                    </p>
                  </div>
                </div>

                {/* 2. Execution Paused */}
                <div className={`flex items-start gap-3 p-3 rounded-lg transition-all border ${
                  decisionState === 'pending'
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-[var(--surface-card)] border-[var(--border-subtle)]'
                }`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 font-bold ${
                    decisionState === 'pending'
                      ? 'bg-amber-500 text-white animate-pulse'
                      : 'bg-[var(--surface-sunken)] text-[var(--text-muted)]'
                  }`}>
                    2
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">Execution Paused</span>
                      <span className={`text-[10px] ${decisionState === 'pending' ? 'text-amber-500 font-bold' : 'text-[var(--text-muted)]'}`}>
                        {decisionState === 'pending' ? 'WAITING_FOR_APPROVAL' : 'RESOLVED'}
                      </span>
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] mt-0.5">
                      Workflow execution state checkpointed in PostgreSQL. Webhook response dispatched with pending correlation token.
                    </p>
                  </div>
                </div>

                {/* 3. Action Execution on Approval */}
                <div className={`flex items-start gap-3 p-3 rounded-lg transition-all border ${
                  decisionState === 'approved'
                    ? 'bg-[var(--brand-emerald)]/10 border-[var(--brand-emerald)]/30'
                    : decisionState === 'rejected'
                    ? 'bg-rose-500/10 border-rose-500/30'
                    : 'bg-[var(--surface-card)]/50 border-[var(--border-subtle)] opacity-60'
                }`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 font-bold ${
                    decisionState === 'approved'
                      ? 'bg-[var(--brand-emerald)] text-white'
                      : decisionState === 'rejected'
                      ? 'bg-rose-500 text-white'
                      : 'bg-[var(--surface-sunken)] text-[var(--text-muted)]'
                  }`}>
                    3
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {decisionState === 'approved' ? 'Downstream Execution Dispatched' : decisionState === 'rejected' ? 'Rejection Branch Executed' : 'Downstream Actions (Locked)'}
                      </span>
                      <span className="text-[10px]">
                        {decisionState === 'approved' ? 'STATUS: SUCCESS' : decisionState === 'rejected' ? 'STATUS: REJECTED' : 'PENDING'}
                      </span>
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] mt-0.5">
                      {decisionState === 'approved' 
                        ? 'CRM deal created with $85,000 ARR • Slack message posted to #enterprise-wins • AE notified.' 
                        : decisionState === 'rejected'
                        ? 'Opportunity marked Disqualified in CRM • Lead owner notified with reason code.'
                        : 'External API mutations are strictly locked until human resolution.'}
                    </p>
                  </div>
                </div>

                {/* 4. Immutable Audit Trail */}
                <div className={`flex items-start gap-3 p-3 rounded-lg transition-all border ${
                  decisionState !== 'pending'
                    ? 'bg-[var(--surface-card)] border-[var(--brand-emerald)]/40 shadow-sm'
                    : 'bg-[var(--surface-card)]/50 border-[var(--border-subtle)] opacity-60'
                }`}>
                  <div className="w-6 h-6 rounded-md bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--text-muted)] flex-shrink-0 font-bold">
                    4
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">Immutable Audit Trail Recorded</span>
                      <span className="text-[10px] text-[var(--text-muted)]">SHA-256 Hashed</span>
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] mt-0.5">
                      {decisionState !== 'pending'
                        ? `Actor: vp_sales@acme.com • Action: ${decisionState.toUpperCase()} • Timestamp: ${new Date().toISOString().substring(11, 19)}Z • Tenant: tenant_prod_01`
                        : 'Awaiting actor signature and timestamp to append immutable audit ledger entry.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Key Assurance Note */}
            <div className="p-4 rounded-xl bg-[var(--surface-card)] border border-[var(--border-subtle)] flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--brand-emerald)]/10 text-[var(--brand-emerald)] flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                <strong className="text-[var(--text-primary)]">Guaranteed Governance:</strong> No webhook or downstream API mutation executes without cryptographic confirmation of human approval when configured.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
