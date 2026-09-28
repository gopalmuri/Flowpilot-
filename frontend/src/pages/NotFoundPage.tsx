import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-warm-100 dark:bg-charcoal-950 p-4 text-center">
      <div className="max-w-md p-8 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 shadow-subtle space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-warm-900 dark:text-charcoal-100 tracking-tight">404 - Page Not Found</h1>
        <p className="text-xs text-warm-500 dark:text-charcoal-400 leading-relaxed">
          The requested control plane route or resource does not exist or your active role does not have authorization.
        </p>
        <div className="pt-2">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-xs font-semibold text-white shadow-subtle transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
