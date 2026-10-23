import React from 'react';
import { useToast, ToastType } from '../../context/ToastContext';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />,
  error: <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
  info: <Info className="w-4 h-4 text-brand-500 shrink-0" />,
};

const badgeStyles: Record<ToastType, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  error: 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  info: 'border-brand-500/30 bg-brand-500/10 text-brand-800 dark:text-brand-200',
};

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none select-none px-2 sm:px-0"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md bg-white/95 dark:bg-charcoal-900/95 transition-all animate-in slide-in-from-bottom-3 fade-in duration-200 ${
            badgeStyles[toast.type]
          }`}
          role="alert"
        >
          <div className="mt-0.5">{icons[toast.type]}</div>

          <div className="flex-1 min-w-0 pr-1">
            {toast.title && (
              <div className="text-xs font-bold text-warm-900 dark:text-charcoal-100 tracking-tight">
                {toast.title}
              </div>
            )}
            <p className="text-xs text-warm-700 dark:text-charcoal-300 mt-0.5 leading-relaxed break-words">
              {toast.message}
            </p>

            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismissToast(toast.id);
                }}
                className="mt-2 text-xs font-semibold px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1"
              >
                {toast.action.label}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="text-warm-400 hover:text-warm-700 dark:text-charcoal-400 dark:hover:text-charcoal-100 p-1 rounded-lg transition-colors cursor-pointer -mr-1 -mt-1"
            aria-label="Close notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
