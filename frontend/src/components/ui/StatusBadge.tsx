import React from 'react';

export type StatusVariant =
  | 'ACTIVE'
  | 'DRAFT'
  | 'PAUSED'
  | 'RUNNING'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'PENDING'
  | 'APPROVED'
  | 'HEALTHY'
  | 'DEGRADED';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  pulse?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm', pulse = false }) => {
  const norm = (status || '').toUpperCase() as StatusVariant;

  let classes = 'bg-warm-200 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300 border-warm-300 dark:border-charcoal-700';
  let dotColor = 'bg-warm-500 dark:bg-charcoal-400';

  if (['ACTIVE', 'RUNNING', 'COMPLETED', 'APPROVED', 'HEALTHY'].includes(norm)) {
    classes = 'bg-brand-50 dark:bg-brand-900/30 text-brand-800 dark:text-brand-400 border-brand-200 dark:border-brand-800/60';
    dotColor = 'bg-brand-600 dark:bg-brand-500';
  } else if (['WAITING', 'PAUSED', 'PENDING', 'DEGRADED'].includes(norm)) {
    classes = 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800/60';
    dotColor = 'bg-amber-500';
  } else if (['FAILED', 'REJECTED'].includes(norm)) {
    classes = 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800/60';
    dotColor = 'bg-red-500';
  }

  const isRunning = norm === 'RUNNING' || pulse;
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium border rounded-md font-sans ${padding} ${classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${isRunning ? 'animate-pulse' : ''}`} />
      <span className="capitalize">{status.toLowerCase()}</span>
    </span>
  );
};
