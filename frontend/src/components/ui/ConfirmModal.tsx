import React, { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { AlertTriangle, AlertCircle, Info, Loader2 } from 'lucide-react';

export const ConfirmModal: React.FC = () => {
  const { confirmDialog, closeConfirm } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  if (!confirmDialog) return null;

  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    onConfirm,
  } = confirmDialog;

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
      closeConfirm();
    } catch {
      // Keep modal open if an error is thrown so user can retry or cancel
    } finally {
      setIsProcessing(false);
    }
  };

  const isDanger = variant === 'danger';
  const isWarning = variant === 'warning';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-sm bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3.5">
          <div
            className={`p-2 rounded-xl shrink-0 ${
              isDanger
                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : isWarning
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
            }`}
          >
            {isDanger ? (
              <AlertCircle className="w-5 h-5" />
            ) : isWarning ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <Info className="w-5 h-5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3
              id="confirm-modal-title"
              className="text-sm font-bold text-warm-900 dark:text-charcoal-100 tracking-tight"
            >
              {title}
            </h3>
            <p className="text-xs text-warm-600 dark:text-charcoal-300 mt-1 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-warm-100 dark:border-charcoal-800">
          <button
            type="button"
            disabled={isProcessing}
            onClick={closeConfirm}
            className="px-3 py-1.5 rounded-lg border border-warm-300 dark:border-charcoal-700 hover:bg-warm-50 dark:hover:bg-charcoal-800 text-xs font-semibold text-warm-700 dark:text-charcoal-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={handleConfirm}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700'
                : isWarning
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {isProcessing && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
