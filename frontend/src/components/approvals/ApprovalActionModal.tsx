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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                Review Approval Request
              </h2>
              <p className="text-xs text-slate-400">
                Step: <span className="font-mono text-slate-300 font-semibold">{approval.step_key}</span> &bull; Run ID: <span className="font-mono text-slate-300">{approval.workflow_run_id.slice(0, 8)}...</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Status & Permissions Notice */}
          {!hasRolePermission && (
            <div className="flex items-start space-x-3 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Insufficient Permissions:</span> Your role is <span className="font-semibold uppercase">{userRole}</span>. This approval requires <span className="font-semibold uppercase">{approval.required_role}</span> or higher to authorize or reject.
              </div>
            </div>
          )}

          {!isPending && (
            <div className="flex items-center space-x-3 p-3.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-slate-300 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <div>
                This approval is currently <span className="font-semibold uppercase text-white">{approval.status}</span>. Decisions cannot be modified.
              </div>
            </div>
          )}

          {isPending && isExpired && (
            <div className="flex items-center space-x-3 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <div>
                This request passed its expiration deadline (<span className="font-mono">{new Date(approval.expires_at!).toLocaleString()}</span>).
              </div>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl">
              <div className="text-[11px] font-medium text-slate-400">Status</div>
              <div className="text-xs font-semibold text-white mt-1 capitalize">{approval.status.toLowerCase()}</div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl">
              <div className="text-[11px] font-medium text-slate-400">Required Role</div>
              <div className="text-xs font-semibold text-amber-400 mt-1 uppercase">{approval.required_role}</div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl">
              <div className="text-[11px] font-medium text-slate-400">Requested At</div>
              <div className="text-xs font-semibold text-slate-300 mt-1">
                {new Date(approval.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl">
              <div className="text-[11px] font-medium text-slate-400">Timeout / Expiry</div>
              <div className="text-xs font-semibold text-slate-300 mt-1">
                {approval.expires_at ? new Date(approval.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'None'}
              </div>
            </div>
          </div>

          {/* Context Snapshot JSON card */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">
                Context Snapshot (Payload for Review)
              </label>
              <span className="text-[11px] text-slate-500 font-mono">Immutable State</span>
            </div>
            <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-48 whitespace-pre-wrap select-all">
              {JSON.stringify(approval.context_snapshot || {}, null, 2)}
            </pre>
          </div>

          {/* Optional Comment Input */}
          {canDecide && (
            <div>
              <label htmlFor="approval-comment" className="block text-xs font-medium text-slate-300 mb-1.5">
                Decision Notes / Audit Comment <span className="text-slate-500">(Optional)</span>
              </label>
              <textarea
                id="approval-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add audit rationale or context for this approval or rejection decision..."
                disabled={isSubmitting}
                className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
              />
            </div>
          )}

          {/* Historical Decision Info if already resolved */}
          {!isPending && (
            <div className="p-4 bg-slate-950/40 border border-slate-800/80 rounded-xl space-y-2 text-xs">
              <div className="font-semibold text-slate-300">Resolution Details</div>
              {approval.resolved_at && (
                <div className="text-slate-400">
                  Resolved At: <span className="text-slate-200">{new Date(approval.resolved_at).toLocaleString()}</span>
                </div>
              )}
              {approval.decision_comment && (
                <div className="text-slate-400">
                  Comment: <span className="text-slate-200 italic">"{approval.decision_comment}"</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
          >
            Close
          </button>

          {canDecide && (
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => handleAction('REJECT')}
                disabled={isSubmitting}
                className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-xl transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                <span>{isSubmitting && activeDecision === 'REJECT' ? 'Rejecting...' : 'Reject Step'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleAction('APPROVE')}
                disabled={isSubmitting}
                className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-lg shadow-emerald-600/20 transition-colors disabled:opacity-50"
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
