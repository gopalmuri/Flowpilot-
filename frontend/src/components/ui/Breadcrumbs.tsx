import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  to?: string;
  current?: boolean;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className = '' }) => {
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center text-xs ${className}`}>
      <ol className="flex items-center gap-1.5 flex-wrap">
        <li>
          <Link
            to="/dashboard"
            className="text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:hover:text-charcoal-200 transition-colors flex items-center"
            title="Dashboard"
            aria-label="Dashboard"
          >
            <Home className="w-3.5 h-3.5" />
          </Link>
        </li>
        {items.map((item, index) => {
          const isLast = index === items.length - 1 || item.current;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5 min-w-0">
              <ChevronRight className="w-3.5 h-3.5 text-warm-400 dark:text-charcoal-600 flex-shrink-0" />
              {isLast || !item.to ? (
                <span
                  className="font-medium text-warm-900 dark:text-charcoal-100 truncate max-w-[160px] sm:max-w-xs"
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:hover:text-charcoal-200 transition-colors truncate max-w-[140px] sm:max-w-xs"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
