import React from 'react';

interface FlowPilotLogoProps {
  className?: string;
  size?: number | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  showBadge?: boolean;
  subtitle?: string;
}

const SIZE_MAP: Record<string, number> = {
  sm: 20,
  md: 28,
  lg: 36,
  xl: 48,
};

export const FlowPilotLogo: React.FC<FlowPilotLogoProps> = ({
  className = '',
  size = 32,
  showText = true,
  showBadge = true,
  subtitle = 'Business Workflow Control',
}) => {
  const pixelSize = typeof size === 'string' ? (SIZE_MAP[size] || 32) : size;
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Precision Geometric Orchestration Icon */}
      <div
        style={{ width: pixelSize, height: pixelSize }}
        className="rounded-lg bg-brand-600 dark:bg-brand-500 flex items-center justify-center text-white shadow-subtle flex-shrink-0"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 text-white"
        >
          {/* Orchestration Diamond Node & Pipeline vectors */}
          <polygon points="12 2 19 8 12 14 5 8 12 2" />
          <polyline points="5 15 12 21 19 15" />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 leading-none">
            <span className="font-extrabold text-base tracking-tight text-warm-900 dark:text-charcoal-100">
              FlowPilot
            </span>
            {showBadge && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-700/60">
                Control
              </span>
            )}
          </div>
          {subtitle && (
            <span className="text-[11px] text-warm-600 dark:text-charcoal-400 font-medium tracking-tight mt-0.5 truncate">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
