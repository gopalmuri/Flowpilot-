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

  if (['ACTIVE', 'COMPLETED', 'APPROVED', 'HEALTHY'].includes(norm)) {
    // Green means success / healthy / live only
    classes = 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60';
    dotColor = 'bg-emerald-500';
  } else if (norm === 'RUNNING') {
    // In progress is neutral-primary (indigo), not success
    classes = 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800/60';
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
