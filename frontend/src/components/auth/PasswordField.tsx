import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

interface PasswordFieldProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
  id = 'password',
  label = 'Password',
  value,
  onChange,
  placeholder = 'Enter your password',
  autoComplete = 'current-password',
  required = true,
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-[13px] font-medium text-slate-300">
          {label}
        </label>
      </div>
      <div className="relative">
        <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className="w-full h-12 pl-10 pr-10 rounded-lg bg-[#0B0F10] border border-[#242D30] text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#18B89A] focus:ring-1 focus:ring-[#18B89A] transition-all"
        />
        <button
          type="button"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1"
        >
          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
