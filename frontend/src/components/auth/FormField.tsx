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
      <label htmlFor={id} className="block text-[13px] font-medium text-slate-300 mb-1.5">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
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
          } ${children ? 'pr-10' : 'pr-3.5'} rounded-lg bg-[#0B0F10] border border-[#242D30] text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#18B89A] focus:ring-1 focus:ring-[#18B89A] transition-all`}
        />
        {children}
      </div>
    </div>
  );
};
