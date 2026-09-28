import React from 'react';
import { Check, Circle } from 'lucide-react';

interface PasswordRequirementsProps {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export const PasswordRequirements: React.FC<PasswordRequirementsProps> = ({
  hasMinLength,
  hasUppercase,
  hasLowercase,
  hasNumber,
  hasSpecial,
}) => {
  const requirements = [
    { label: 'At least 10 characters', met: hasMinLength },
    { label: 'One uppercase letter (A-Z)', met: hasUppercase },
    { label: 'One lowercase letter (a-z)', met: hasLowercase },
    { label: 'One numeric digit (0-9)', met: hasNumber },
    { label: 'One special character (!@#$%^&*)', met: hasSpecial },
  ];

  return (
    <div className="mt-3 p-3 rounded-xl bg-[var(--bg-surface-secondary)] dark:bg-[#121614] border border-[var(--border-subtle)] dark:border-[#242E29] space-y-1.5 text-xs select-none">
      <span className="block text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">
        Password Requirements:
      </span>
      {requirements.map((req) => (
        <div key={req.label} className="flex items-center gap-2">
          {req.met ? (
            <Check className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 flex-shrink-0" />
          ) : (
            <Circle className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
          )}
          <span className={req.met ? 'text-brand-700 dark:text-brand-300 font-medium' : 'text-[var(--text-secondary)]'}>
            {req.label}
          </span>
        </div>
      ))}
    </div>
  );
};
