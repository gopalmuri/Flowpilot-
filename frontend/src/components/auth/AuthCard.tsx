import React from 'react';
import { AlertCircle } from 'lucide-react';

interface AuthCardProps {
  title: string;
  subtitle: string;
  error?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const AuthCard: React.FC<AuthCardProps> = ({
  title,
  subtitle,
  error,
  children,
  footer,
  className = '',
}) => {
  return (
    <div className={`p-8 sm:p-9 rounded-xl bg-[#12181A] border border-[#242D30] shadow-sm relative ${className}`}>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
        <p className="text-[13px] text-slate-400 mt-1 leading-relaxed">
          {subtitle}
        </p>
      </div>

      {/* Accessible Error Alert */}
      {error && (
        <div
          role="alert"
          className="mb-5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* Form Content */}
      {children}

      {/* Optional Card Footer */}
      {footer && (
        <div className="mt-5 pt-4 border-t border-[#1F272A] text-center">
          {footer}
        </div>
      )}
    </div>
  );
};
