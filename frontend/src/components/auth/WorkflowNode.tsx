import React from 'react';
import { StatusBadge, StatusBadgeVariant } from './StatusBadge';

interface WorkflowNodeProps {
  icon: React.ReactNode;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  title: string;
  description?: string;
  badgeVariant: StatusBadgeVariant;
  badgeLabel?: string;
  className?: string;
}

export const WorkflowNode: React.FC<WorkflowNodeProps> = ({
  icon,
  iconBg,
  iconBorder,
  iconColor,
  title,
  description,
  badgeVariant,
  badgeLabel,
  className = '',
}) => {
  return (
    <div
      className={`flex items-center justify-between p-2 rounded-lg bg-[#12181A] border border-[#1F272A] ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`w-6 h-6 rounded-md ${iconBg} ${iconBorder} ${iconColor} border flex items-center justify-center flex-shrink-0`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-100 truncate">{title}</div>
          {description && (
            <div className="text-[10px] text-slate-400 truncate">{description}</div>
          )}
        </div>
      </div>
      <StatusBadge variant={badgeVariant} label={badgeLabel} className="flex-shrink-0" />
    </div>
  );
};
