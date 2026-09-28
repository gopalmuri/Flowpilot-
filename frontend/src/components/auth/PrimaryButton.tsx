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
      className={`w-full h-12 flex items-center justify-center gap-2 rounded-lg bg-[#18B89A] hover:bg-[#16A389] active:bg-[#14917A] text-sm font-semibold text-white transition-all disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#18B89A]/40 ${className}`}
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
