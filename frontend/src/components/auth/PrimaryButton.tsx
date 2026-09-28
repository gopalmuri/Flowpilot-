import React from 'react';
import { Loader2 } from 'lucide-react';

interface PrimaryButtonProps {
  type?: 'submit' | 'button';
  disabled?: boolean;
  isLoading?: boolean;
  loadingText?: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  type = 'submit',
  disabled = false,
  isLoading = false,
  loadingText = 'Processing...',
  children,
  className = '',
  onClick,
}) => {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      onClick={onClick}
      className={`w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 active:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-400 dark:active:bg-brand-600 text-sm font-semibold text-white shadow-sm hover:shadow active:scale-[0.99] transition-all duration-150 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${className}`}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{loadingText}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};
