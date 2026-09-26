import React, { useState, useEffect } from 'react';
import { AlertCircle, Clock, Lock, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SLAConfig, SLAUpdateRequest } from '../../types/analytics';
import { WorkflowVersionDetail } from '../../types/workflow';
import { updateVersionSLA } from '../../services/analyticsService';

interface SLAConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string;
  version: WorkflowVersionDetail | null;
  onSaveSuccess: (updatedSla: SLAConfig) => void;
}

export const SLAConfigModal: React.FC<SLAConfigModalProps> = ({
  isOpen,
  onClose,
  workflowId,
  version,
  onSaveSuccess,
}) => {
  const { activeOrganization, activeRole } = useAuth();
  const orgId = activeOrganization?.id;

  const isPublished = version?.status === 'PUBLISHED';
  const hasEditRole = activeRole === 'OWNER' || activeRole === 'ADMIN' || activeRole === 'MANAGER';
  const isReadOnly = isPublished || !hasEditRole;

  const existingSla: SLAConfig | undefined = version?.definition?.sla;

  const [enabled, setEnabled] = useState<boolean>(existingSla?.enabled ?? true);
  const [targetSeconds, setTargetSeconds] = useState<number>(existingSla?.target_seconds ?? 30);
  const [warningSeconds, setWarningSeconds] = useState<number>(existingSla?.warning_threshold_seconds ?? 20);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (version?.definition?.sla) {
      setEnabled(version.definition.sla.enabled ?? true);
      setTargetSeconds(version.definition.sla.target_seconds ?? 30);
      setWarningSeconds(version.definition.sla.warning_threshold_seconds ?? 20);
    } else {
      setEnabled(true);
      setTargetSeconds(30);
      setWarningSeconds(20);
    }
    setError(null);
  }, [version]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !orgId || !version) return;

    // Client-side validations
    if (targetSeconds <= 0) {
      setError('Target duration must be strictly greater than 0 seconds.');
      return;
    }
    if (warningSeconds < 0) {
      setError('Warning threshold must be non-negative (>= 0).');
      return;
    }
    if (warningSeconds >= targetSeconds) {
      setError('Warning threshold must be strictly less than the target duration.');
      return;
    }
    if (targetSeconds > 604800) {
      setError('Target duration cannot exceed 604,800 seconds (7 days).');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload: SLAUpdateRequest = {
        target_seconds: Number(targetSeconds),
        warning_threshold_seconds: Number(warningSeconds),
        enabled,
      };

      const res = await updateVersionSLA(orgId, workflowId, version.id, payload);
      onSaveSuccess(res.sla);
      onClose();
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to update SLA configuration');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-left animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                SLA Configuration (v{version?.version_number || 1})
              </h3>
              <p className="text-[11px] text-slate-400">
                Version-scoped execution time thresholds
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Read-Only Notice for Published Versions */}
          {isPublished && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2.5">
              <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
              <div>
                <span className="font-semibold block">Version is Published (Immutable)</span>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  Create a new draft version to adjust SLA targets.
                </p>
              </div>
            </div>
          )}

          {!hasEditRole && !isPublished && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>You have read-only access (MANAGER role or higher required to edit SLA).</span>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* SLA Enabled Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div>
              <span className="text-xs font-semibold text-slate-200 block">Enable SLA Monitoring</span>
              <span className="text-[10px] text-slate-400">
                Track compliance rates and alert on breaches for this version
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={isReadOnly}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600 disabled:opacity-50" />
            </label>
          </div>

          {/* Target Duration Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              Target Duration (Seconds)
            </label>
            <input
              type="number"
              step="any"
              min="0.1"
              max="604800"
              value={targetSeconds}
              onChange={(e) => setTargetSeconds(parseFloat(e.target.value) || 0)}
              disabled={isReadOnly || !enabled}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono rounded-xl px-3 py-2 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              placeholder="e.g. 30"
              required
            />
            <p className="text-[10px] text-slate-500">
              Executions completing beyond this threshold are classified as <span className="text-rose-400 font-semibold">BREACHED</span>.
            </p>
          </div>

          {/* Warning Threshold Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              Warning Threshold (Seconds)
            </label>
            <input
              type="number"
              step="any"
              min="0"
              max="604800"
              value={warningSeconds}
              onChange={(e) => setWarningSeconds(parseFloat(e.target.value) || 0)}
              disabled={isReadOnly || !enabled}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono rounded-xl px-3 py-2 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              placeholder="e.g. 20"
              required
            />
            <p className="text-[10px] text-slate-500">
              Executions between warning and target duration are classified as <span className="text-amber-400 font-semibold">WARNING</span> (elevated risk).
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              {isReadOnly ? 'Close' : 'Cancel'}
            </button>
            {!isReadOnly && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition disabled:opacity-50 shadow-md shadow-cyan-600/20"
              >
                {isSubmitting ? 'Saving...' : 'Save SLA Targets'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
