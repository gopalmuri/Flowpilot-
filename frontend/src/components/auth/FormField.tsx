import React from 'react';

interface FormFieldProps {
  id: string;
  label: React.ReactNode;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  type = 'text',
  required = false,
  autoComplete,
  placeholder,
  value,
  onChange,
  icon,
  children,
  className = '',
}) => {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-semibold text-[var(--text-primary)] mb-1.5">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
            {icon}
          </div>
        )}
        <input
          id={id}
          type={type}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className={`w-full h-12 ${
            icon ? 'pl-10' : 'pl-3.5'
          } ${children ? 'pr-10' : 'pr-3.5'} rounded-xl bg-[var(--bg-surface-secondary)] dark:bg-[#121614] border border-[var(--border-subtle)] dark:border-[#2A332E] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-brand-600 dark:focus:border-brand-500 focus:ring-1 focus:ring-brand-600 dark:focus:ring-brand-500 transition-all`}
        />
        {children}
      </div>
    </div>
  );
};
