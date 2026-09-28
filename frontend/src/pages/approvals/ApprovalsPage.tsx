import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  ExternalLink,
  History,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ApprovalRequest, ApprovalStatus } from '../../types/approval';
import {
  approveRequest,
  listApprovals,
  rejectRequest,
} from '../../services/approvalService';
import { ApprovalActionModal } from '../../components/approvals/ApprovalActionModal';

export const ApprovalsPage: React.FC = () => {
  const { activeOrganization, activeRole } = useAuth();
  const [activeTab, setActiveTab] = useState<'PENDING' | 'HISTORY'>('PENDING');
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [historyApprovals, setHistoryApprovals] = useState<ApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const orgId = activeOrganization?.id;

  const loadData = useCallback(async () => {
    if (!orgId) {
      setPendingApprovals([]);
      setHistoryApprovals([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      // Fetch pending approvals
      const pendingRes = await listApprovals(orgId, 'PENDING');
      setPendingApprovals(pendingRes.items || []);

      // Fetch all to populate history
      const allRes = await listApprovals(orgId, undefined, 1, 50);
      const history = (allRes.items || []).filter((item) => item.status !== 'PENDING');
      setHistoryApprovals(history);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to load approvals.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenReview = (approval: ApprovalRequest) => {
    setSelectedApproval(approval);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedApproval(null);
  };

  const handleDecide = async (decision: 'APPROVE' | 'REJECT', comment?: string) => {
    if (!orgId || !selectedApproval) return;
    setIsSubmitting(true);
    setFeedback(null);
    try {
      if (decision === 'APPROVE') {
        await approveRequest(orgId, selectedApproval.id, { comment });
        setFeedback({
          type: 'success',
          message: `Approval request for "${selectedApproval.step_key}" was successfully approved. The workflow run has been resumed.`,
        });
      } else {
        await rejectRequest(orgId, selectedApproval.id, { comment });
        setFeedback({
          type: 'success',
          message: `Approval request for "${selectedApproval.step_key}" was rejected. Downstream rejection branch has been taken.`,
        });
      }
      await loadData();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to submit decision.',
      });
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentList = activeTab === 'PENDING' ? pendingApprovals : historyApprovals;

  const getStatusBadge = (status: ApprovalStatus) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60">
            Pending Review
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-brand-600 dark:text-brand-400 border border-brand-600 dark:border-brand-500/20">
            Approved
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60">
            Rejected
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/10 text-warm-500 dark:text-charcoal-400 border border-slate-500/20">
            Expired
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/10 text-warm-500 dark:text-charcoal-400 border border-slate-500/20">
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-warm-900 dark:text-charcoal-100 tracking-tight">Human Approvals</h1>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-1">
            Human-in-the-loop governance for authorizing sensitive automated workflow operations.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={isLoading}
          className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-medium text-warm-700 dark:text-charcoal-300 bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 hover:bg-warm-100 dark:bg-charcoal-800 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-600 dark:text-brand-400' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`flex items-start justify-between p-4 rounded-xl border text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-brand-600 dark:border-brand-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-warm-500 dark:text-charcoal-400 hover:text-warm-900 dark:text-charcoal-100 transition-colors ml-4 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-warm-200 dark:border-charcoal-750 space-x-4">
        <button
          onClick={() => setActiveTab('PENDING')}
          className={`pb-3 px-1 text-xs font-medium flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'PENDING'
              ? 'border-brand-600 dark:border-brand-500 text-brand-600 dark:text-brand-400 font-semibold'
              : 'border-transparent text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:text-charcoal-200'
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>Pending Approvals</span>
          {pendingApprovals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {pendingApprovals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('HISTORY')}
          className={`pb-3 px-1 text-xs font-medium flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'HISTORY'
              ? 'border-brand-600 dark:border-brand-500 text-brand-600 dark:text-brand-400 font-semibold'
              : 'border-transparent text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:text-charcoal-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Resolution History</span>
          {historyApprovals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-warm-100 dark:bg-charcoal-800 text-warm-500 dark:text-charcoal-400">
              {historyApprovals.length}
            </span>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[320px] rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 p-8">
          <RefreshCw className="w-8 h-8 animate-spin text-brand-600 dark:text-brand-400 mb-3" />
          <p className="text-xs text-warm-500 dark:text-charcoal-400">Loading approval requests...</p>
        </div>
      ) : currentList.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[360px] p-8 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-brand-600 dark:border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400">
            <CheckSquare className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-warm-900 dark:text-charcoal-100">
            {activeTab === 'PENDING' ? 'Inbox Zero' : 'No History Found'}
          </h2>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 max-w-sm">
            {activeTab === 'PENDING'
              ? 'No approval requests are currently awaiting human review in this organization.'
              : 'No resolved approval history records found for this organization.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {currentList.map((item) => {
            const isExpired = item.expires_at ? new Date(item.expires_at) < new Date() : false;
            return (
              <div
                key={item.id}
                className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 hover:border-warm-300 dark:border-charcoal-700 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center space-x-2.5">
                    <span className="font-semibold text-sm text-warm-900 dark:text-charcoal-100 font-mono">{item.step_key}</span>
                    {getStatusBadge(item.status)}
                    <span className="text-[11px] px-2 py-0.5 rounded bg-warm-100 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300 border border-warm-300 dark:border-charcoal-700 font-mono uppercase">
                      Requires: {item.required_role}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-warm-500 dark:text-charcoal-400">
                    <div className="flex items-center space-x-1.5">
                      <Sliders className="w-3.5 h-3.5 text-warm-400 dark:text-charcoal-500" />
                      <span>Run: <span className="font-mono text-warm-700 dark:text-charcoal-300">{item.workflow_run_id.slice(0, 8)}...</span></span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <Calendar className="w-3.5 h-3.5 text-warm-400 dark:text-charcoal-500" />
                      <span>Requested: {new Date(item.requested_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                    {item.expires_at && (
                      <div className={`flex items-center space-x-1.5 ${isExpired ? 'text-rose-400' : 'text-amber-400'}`}>
                        <Clock className="w-3.5 h-3.5" />
                        <span>Expires: {new Date(item.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                    {item.decision_comment && (
                      <div className="w-full text-warm-700 dark:text-charcoal-300 italic text-[11px] mt-1 bg-warm-50 dark:bg-charcoal-950 px-3 py-1.5 rounded-lg border border-warm-200 dark:border-charcoal-750">
                        Comment: "{item.decision_comment}"
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 sm:self-center">
                  <button
                    onClick={() => handleOpenReview(item)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                      item.status === 'PENDING'
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-warm-900 dark:text-charcoal-100 shadow-lg shadow-emerald-600/10'
                        : 'bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-700 text-warm-700 dark:text-charcoal-300'
                    }`}
                  >
                    <span>{item.status === 'PENDING' ? 'Review & Authorize' : 'View Audit Details'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      <ApprovalActionModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        approval={selectedApproval}
        onDecide={handleDecide}
        isSubmitting={isSubmitting}
        userRole={activeRole || 'MEMBER'}
      />
    </div>
  );
};
