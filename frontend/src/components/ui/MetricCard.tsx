import React from 'react';
import { Link } from 'react-router-dom';
import { LucideIcon, ArrowUpRight } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: LucideIcon;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  to?: string;
  onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subtext,
  icon: Icon,
  variant = 'default',
  to,
  onClick,
}) => {
  let accentClass = 'text-brand-600 dark:text-brand-500 bg-brand-50 dark:bg-brand-900/30 border-brand-200 dark:border-brand-800/50';
  if (variant === 'warning') {
    accentClass = 'text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50';
  } else if (variant === 'danger') {
    accentClass = 'text-red-600 dark:text-red-500 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50';
  } else if (variant === 'default') {
    accentClass = 'text-warm-700 dark:text-charcoal-300 bg-warm-100 dark:bg-charcoal-800 border-warm-200 dark:border-charcoal-700';
  }

  const isClickable = Boolean(to || onClick);

  const content = (
    <div
      className={`p-4 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle transition-all h-full flex flex-col justify-between ${
        isClickable
          ? 'hover:border-warm-400 dark:hover:border-charcoal-600 hover:shadow-md cursor-pointer group'
          : ''
      }`}
    >
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-warm-600 dark:text-charcoal-400 group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors">
            {label}
          </span>
          <div className="flex items-center gap-1.5">
            {isClickable && (
              <ArrowUpRight className="w-3.5 h-3.5 text-warm-400 dark:text-charcoal-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-all opacity-0 group-hover:opacity-100 transform translate-y-0.5 -translate-x-0.5 group-hover:translate-y-0 group-hover:translate-x-0" />
            )}
            {Icon && (
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${accentClass}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        </div>
        <div className="text-2xl font-bold tracking-tight text-warm-900 dark:text-charcoal-100">
          {value}
        </div>
      </div>
      {subtext && (
        <p className="text-[11px] text-warm-600 dark:text-charcoal-400 mt-1">
          {subtext}
        </p>
      )}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block h-full no-underline focus:outline-none focus:ring-2 focus:ring-brand-500/50 rounded-xl">
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left p-0 bg-transparent border-none block h-full focus:outline-none focus:ring-2 focus:ring-brand-500/50 rounded-xl"
      >
        {content}
      </button>
    );
  }

  return content;
};
