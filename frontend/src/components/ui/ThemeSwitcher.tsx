import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Laptop, ChevronDown, Check } from 'lucide-react';
import { useTheme, ThemeMode } from '../../context/ThemeContext';

interface ThemeSwitcherProps {
  compact?: boolean;
  className?: string;
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ compact = false, className = '' }) => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const options: { mode: ThemeMode; label: string; icon: React.FC<{ className?: string }> }[] = [
    { mode: 'light', label: 'Light', icon: Sun },
    { mode: 'dark', label: 'Dark', icon: Moon },
    { mode: 'system', label: 'System', icon: Laptop },
  ];

  if (compact) {
    return (
      <div className={`flex items-center p-0.5 sm:p-1 rounded-lg bg-warm-200 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 ${className}`}>
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = theme === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => setTheme(opt.mode)}
              title={`${opt.label} mode`}
              aria-label={`Switch to ${opt.label} mode`}
              className={`p-1 sm:p-1.5 rounded-md text-xs font-medium transition-all ${
                isSelected
                  ? 'bg-white dark:bg-charcoal-900 text-brand-600 dark:text-brand-500 shadow-subtle'
                  : 'text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
    );
  }

  const ActiveIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Theme selector"
        aria-expanded={isOpen}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-warm-700 dark:text-charcoal-300 hover:text-warm-900 dark:hover:text-charcoal-100 bg-warm-200/80 dark:bg-charcoal-850/80 hover:bg-warm-200 dark:hover:bg-charcoal-800 border border-warm-300 dark:border-charcoal-750 transition-all cursor-pointer"
      >
        <ActiveIcon className="w-3.5 h-3.5 text-brand-600 dark:text-brand-500" />
        <span className="capitalize hidden sm:inline">{theme}</span>
        <ChevronDown className={`w-3 h-3 text-warm-500 dark:text-charcoal-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-36 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-elevated py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-1 text-[10px] font-bold text-warm-500 dark:text-charcoal-400 uppercase tracking-wider border-b border-warm-200 dark:border-charcoal-800 mb-1">
            Appearance
          </div>
          {options.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => {
                  setTheme(opt.mode);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors ${
                  isSelected
                    ? 'text-brand-700 dark:text-brand-400 font-semibold bg-brand-50 dark:bg-brand-900/40'
                    : 'text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5" />
                  <span>{opt.label}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-brand-600 dark:text-brand-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
