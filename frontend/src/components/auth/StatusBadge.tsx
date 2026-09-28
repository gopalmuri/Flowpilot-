import React from 'react';

export type StatusBadgeVariant =
  | 'trigger'
  | 'validate'
  | 'ai'
  | 'condition'
  | 'approval'
  | 'action'
  | 'success';

interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  label?: string;
  className?: string;
}

const variantStyles: Record<StatusBadgeVariant, { bg: string; text: string; border: string; defaultLabel: string }> = {
  trigger: {
    bg: 'bg-[#132824]',
    text: 'text-[#18B89A]',
    border: 'border-[#18B89A]/30',
    defaultLabel: 'TRIGGER',
  },
  validate: {
    bg: 'bg-[#182023]',
    text: 'text-slate-300',
    border: 'border-[#2A3438]',
    defaultLabel: 'VALIDATE',
  },
  ai: {
    bg: 'bg-[#201830]',
    text: 'text-violet-300',
    border: 'border-violet-800/40',
    defaultLabel: 'AI',
  },
  condition: {
    bg: 'bg-[#2A2012]',
    text: 'text-amber-300',
    border: 'border-amber-800/40',
    defaultLabel: 'CONDITION',
  },
  approval: {
    bg: 'bg-[#2A2012]',
    text: 'text-amber-300',
    border: 'border-amber-800/40',
    defaultLabel: 'APPROVAL',
  },
  action: {
    bg: 'bg-[#132824]',
    text: 'text-[#18B89A]',
    border: 'border-[#18B89A]/30',
    defaultLabel: 'ACTION',
  },
  success: {
    bg: 'bg-[#132B20]',
    text: 'text-emerald-300',
    border: 'border-emerald-800/40',
    defaultLabel: 'SUCCESS',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  variant,
  label,
  className = '',
}) => {
  const config = variantStyles[variant];
  return (
    <span
      className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border select-none tracking-wider ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      {label || config.defaultLabel}
    </span>
  );
};
