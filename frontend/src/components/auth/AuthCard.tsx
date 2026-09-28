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
    <div className={`p-6 sm:p-9 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] dark:border-[#2A332E] shadow-sm relative transition-all duration-150 ${className}`}>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight">
          {title}
        </h2>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">
          {subtitle}
        </p>
      </div>

      {/* Accessible Error Alert */}
      {error && (
        <div
          role="alert"
          className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5 animate-in fade-in duration-150"
        >
          <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
          <span className="leading-relaxed font-medium">{error}</span>
        </div>
      )}

      {/* Form Content */}
      {children}

      {/* Optional Card Footer / Route Switch */}
      {footer && (
        <div className="mt-6 pt-5 border-t border-[var(--border-subtle)] dark:border-[#242E29] text-center">
          {footer}
        </div>
      )}
    </div>
  );
};
