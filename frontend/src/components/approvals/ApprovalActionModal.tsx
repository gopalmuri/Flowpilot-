import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  X,
  XCircle,
} from 'lucide-react';
import { ApprovalRequest } from '../../types/approval';

interface ApprovalActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  approval: ApprovalRequest | null;
  onDecide: (decision: 'APPROVE' | 'REJECT', comment?: string) => Promise<void>;
  isSubmitting?: boolean;
  userRole?: string;
}

const ROLE_RANKS: Record<string, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export const ApprovalActionModal: React.FC<ApprovalActionModalProps> = ({
  isOpen,
  onClose,
  approval,
  onDecide,
  isSubmitting = false,
  userRole = 'MEMBER',
}) => {
  const [comment, setComment] = useState('');
  const [activeDecision, setActiveDecision] = useState<'APPROVE' | 'REJECT' | null>(null);

  if (!isOpen || !approval) {
    return null;
  }

  const userRank = ROLE_RANKS[userRole?.toUpperCase()] ?? 0;
  const requiredRank = ROLE_RANKS[approval.required_role?.toUpperCase()] ?? 1;
  const hasRolePermission = userRank >= requiredRank;
  const isPending = approval.status === 'PENDING';
  const isExpired = approval.expires_at ? new Date(approval.expires_at) < new Date() : false;
  const canDecide = hasRolePermission && isPending && !isExpired;

  const handleAction = async (decision: 'APPROVE' | 'REJECT') => {
    setActiveDecision(decision);
    try {
      await onDecide(decision, comment.trim() ? comment.trim() : undefined);
      onClose();
    } finally {
      setActiveDecision(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-warm-200 dark:border-charcoal-750 bg-warm-50 dark:bg-charcoal-850 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 flex items-center gap-2">
                <span>Review Approval Request</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-warm-200 dark:bg-charcoal-750 text-warm-800 dark:text-charcoal-200">
                  {approval.step_key}
                </span>
              </h3>
              <p className="text-[11px] font-mono text-warm-500 dark:text-charcoal-400 mt-0.5">
                ID: {approval.id} &bull; Run: {approval.workflow_run_id.slice(0, 12)}...
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-700 dark:text-charcoal-400 dark:hover:text-charcoal-200 hover:bg-warm-200 dark:hover:bg-charcoal-750 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Permission warning if insufficient rank */}
          {!hasRolePermission && isPending && (
            <div className="flex items-center space-x-3 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 dark:bg-rose-950/40 dark:border-rose-800/60 dark:text-rose-300 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <div>
                <span className="font-semibold">Insufficient Permissions:</span> Your role (<span className="uppercase font-mono">{userRole}</span>) is lower than the required threshold (<span className="uppercase font-mono">{approval.required_role}</span>).
              </div>
            </div>
          )}

          {!isPending && (
            <div className="flex items-center space-x-3 p-3.5 bg-slate-800/80 border border-warm-300 dark:border-charcoal-750 rounded-xl text-warm-700 dark:text-charcoal-300 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <div>
                This approval is currently <span className="font-semibold uppercase text-warm-900 dark:text-charcoal-100">{approval.status}</span>. Decisions cannot be modified.
              </div>
            </div>
          )}

          {isPending && isExpired && (
            <div className="flex items-center space-x-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300 text-xs">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <div>
                This request passed its expiration deadline (<span className="font-mono">{new Date(approval.expires_at!).toLocaleString()}</span>).
              </div>
            </div>
          )}

          {/* Operational Decision Consequence Banner */}
          {canDecide && (
            <div className="p-3.5 bg-brand-50/60 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800/60 rounded-xl text-xs space-y-1 text-left">
              <div className="font-semibold text-brand-900 dark:text-brand-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                <span>Approval Consequence &amp; Governance</span>
              </div>
              <p className="text-warm-700 dark:text-charcoal-300">
                Approving this request will allow the workflow to continue to the configured downstream actions.
              </p>
              <p className="text-warm-500 dark:text-charcoal-400 pt-1 text-[11px] border-t border-brand-200/60 dark:border-brand-900/60">
                Rejecting this request will halt the workflow or execute configured fallback actions.
              </p>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
            <div className="p-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-xl">
              <div className="text-[11px] font-medium text-warm-500 dark:text-charcoal-400">Status</div>
              <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 mt-1 capitalize">{approval.status.toLowerCase()}</div>
            </div>
            <div className="p-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-xl">
              <div className="text-[11px] font-medium text-warm-500 dark:text-charcoal-400">Required Role</div>
              <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-1 uppercase">{approval.required_role}</div>
            </div>
            <div className="p-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-xl">
              <div className="text-[11px] font-medium text-warm-500 dark:text-charcoal-400">Requested At</div>
              <div className="text-xs font-semibold text-warm-700 dark:text-charcoal-300 mt-1">
                {new Date(approval.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div className="p-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-xl">
              <div className="text-[11px] font-medium text-warm-500 dark:text-charcoal-400">Timeout / Expiry</div>
              <div className="text-xs font-semibold text-warm-700 dark:text-charcoal-300 mt-1">
                {approval.expires_at ? new Date(approval.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'None'}
              </div>
            </div>
          </div>

          {/* Context Snapshot JSON card */}
          <div className="text-left">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-warm-700 dark:text-charcoal-300">
                Context Snapshot (Payload for Review)
              </label>
              <span className="text-[11px] text-warm-400 dark:text-charcoal-500 font-mono">Immutable State</span>
            </div>
            <pre className="p-3.5 bg-warm-50 dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-xl text-xs font-mono text-emerald-600 dark:text-emerald-400 overflow-x-auto max-h-48 whitespace-pre-wrap select-all">
              {JSON.stringify(approval.context_snapshot || {}, null, 2)}
            </pre>
          </div>

          {/* Optional Comment Input */}
          {canDecide && (
            <div className="text-left">
              <label htmlFor="approval-comment" className="block text-xs font-medium text-warm-700 dark:text-charcoal-300 mb-1.5">
                Decision Notes / Audit Comment <span className="text-warm-400 dark:text-charcoal-500">(Optional)</span>
              </label>
              <textarea
                id="approval-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add audit rationale or context for this approval or rejection decision..."
                disabled={isSubmitting}
                className="w-full px-3.5 py-2.5 bg-white dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded-xl text-xs text-warm-900 dark:text-charcoal-100 placeholder-warm-400 dark:placeholder-charcoal-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 focus:border-brand-600 transition-colors"
              />
            </div>
          )}

          {/* Historical Decision Info if already resolved */}
          {!isPending && (
            <div className="p-4 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-xl space-y-2 text-xs text-left">
              <div className="font-semibold text-warm-700 dark:text-charcoal-300">Resolution Details</div>
              {approval.resolved_at && (
                <div className="text-warm-500 dark:text-charcoal-400">
                  Resolved At: <span className="text-warm-800 dark:text-charcoal-200">{new Date(approval.resolved_at).toLocaleString()}</span>
                </div>
              )}
              {approval.decision_comment && (
                <div className="text-warm-500 dark:text-charcoal-400">
                  Comment: <span className="text-warm-800 dark:text-charcoal-200 italic">"{approval.decision_comment}"</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 px-4 sm:px-6 py-3.5 sm:py-4 border-t border-warm-200 dark:border-charcoal-750 bg-warm-50 dark:bg-charcoal-850 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full sm:w-auto px-4 py-2.5 text-xs font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-750 rounded-xl transition-colors text-center"
          >
            Close
          </button>

          {canDecide && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => handleAction('REJECT')}
                disabled={isSubmitting}
                className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-4 py-2.5 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-300 dark:border-red-800/60 rounded-xl transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                <span>{isSubmitting && activeDecision === 'REJECT' ? 'Rejecting...' : 'Reject Step'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleAction('APPROVE')}
                disabled={isSubmitting}
                className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-4 py-2.5 text-xs font-semibold bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white rounded-xl shadow-subtle transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSubmitting && activeDecision === 'APPROVE' ? 'Approving...' : 'Approve & Resume'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
