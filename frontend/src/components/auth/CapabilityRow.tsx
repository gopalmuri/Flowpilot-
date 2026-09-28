import React from 'react';

interface CapabilityRowProps {
  icon: React.ReactNode;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  title: string;
  description: string;
}

export const CapabilityRow: React.FC<CapabilityRowProps> = ({
  icon,
  iconBg,
  iconBorder,
  iconColor,
  title,
  description,
}) => {
  return (
    <div className="p-3.5 rounded-lg bg-[#0E1315] border border-[#20292C] flex items-start gap-3">
      <div
        className={`w-7 h-7 rounded-md ${iconBg} ${iconBorder} ${iconColor} border flex items-center justify-center flex-shrink-0 mt-0.5`}
      >
        {icon}
      </div>
      <div>
        <div className="text-xs font-semibold text-white tracking-wide">
          {title}
        </div>
        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
};
