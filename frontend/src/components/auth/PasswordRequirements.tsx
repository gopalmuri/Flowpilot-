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
    <div className="mt-2.5 p-2.5 rounded-lg bg-[#0B0F10] border border-[#1F272A] space-y-1 text-xs select-none">
      {requirements.map((req) => (
        <div key={req.label} className="flex items-center gap-2">
          {req.met ? (
            <Check className="w-3.5 h-3.5 text-[#18B89A] flex-shrink-0" />
          ) : (
            <Circle className="w-3 h-3 text-slate-600 flex-shrink-0" />
          )}
          <span className={req.met ? 'text-[#18B89A] font-medium' : 'text-slate-400'}>
            {req.label}
          </span>
        </div>
      ))}
    </div>
  );
};
