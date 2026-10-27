import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  action?: ToastAction;
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'brand';
  onConfirm: () => Promise<void> | void;
}

interface ToastContextType {
  toasts: ToastItem[];
  showToast: (options: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  showSuccess: (message: string, title?: string) => string;
  showError: (message: string, title?: string) => string;
  showWarning: (message: string, title?: string, action?: ToastAction) => string;
  showInfo: (message: string, title?: string) => string;
  confirmDialog: ConfirmDialogOptions | null;
  confirm: (options: ConfirmDialogOptions) => void;
  closeConfirm: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const counterRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (options: Omit<ToastItem, 'id'>): string => {
      counterRef.current += 1;
      const id = `toast-${Date.now()}-${counterRef.current}`;
      const newToast: ToastItem = { ...options, id };

      setToasts((prev) => {
        // Keep max 5 active toasts on screen
        const trimmed = prev.length >= 5 ? prev.slice(prev.length - 4) : prev;
        return [...trimmed, newToast];
      });

      const duration = options.duration ?? (options.type === 'error' ? 6000 : 4500);
      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }

      return id;
    },
    [dismissToast]
  );

  const showSuccess = useCallback(
    (message: string, title?: string) => {
      return showToast({ type: 'success', title: title || 'Success', message });
    },
    [showToast]
  );

  const showError = useCallback(
    (message: string, title?: string) => {
      return showToast({ type: 'error', title: title || 'Error', message });
    },
    [showToast]
  );

  const showWarning = useCallback(
    (message: string, title?: string, action?: ToastAction) => {
      return showToast({ type: 'warning', title: title || 'Attention', message, action });
    },
    [showToast]
  );

  const showInfo = useCallback(
    (message: string, title?: string) => {
      return showToast({ type: 'info', title: title || 'Information', message });
    },
    [showToast]
  );

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    setConfirmDialog(options);
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  return (
    <ToastContext.Provider
      value={{
        toasts,
        showToast,
        dismissToast,
        showSuccess,
        showError,
        showWarning,
        showInfo,
        confirmDialog,
        confirm,
        closeConfirm,
      }}
    >
      {children}
    </ToastContext.Provider>
  );
};

const defaultToastContext: ToastContextType = {
  toasts: [],
  showToast: () => '',
  dismissToast: () => {},
  showSuccess: () => '',
  showError: () => '',
  showWarning: () => '',
  showInfo: () => '',
  confirmDialog: null,
  confirm: (options) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(options.message)) {
        void options.onConfirm();
      }
    } else {
      void options.onConfirm();
    }
  },
  closeConfirm: () => {},
};

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  return context || defaultToastContext;
}

