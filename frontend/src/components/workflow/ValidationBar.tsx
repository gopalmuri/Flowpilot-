import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { WorkflowValidationResult } from '../../types/workflow';

interface ValidationBarProps {
  validationResult: WorkflowValidationResult | null;
  isValidating?: boolean;
}

export const ValidationBar: React.FC<ValidationBarProps> = ({
  validationResult,
  isValidating = false,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  if (!validationResult && !isValidating) return null;

  const isValid = validationResult?.valid ?? false;
  const errors = validationResult?.errors || [];
  const warnings = validationResult?.warnings || [];

  return (
    <div className="border-t border-warm-300 dark:border-charcoal-750 bg-white/95 dark:bg-charcoal-900/95 backdrop-blur-sm select-none transition-all duration-200">
      <div
        className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-warm-100 dark:hover:bg-charcoal-850 transition"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <div className="flex items-center gap-2.5 text-xs">
          {isValidating ? (
            <span className="text-warm-500 dark:text-charcoal-400">Validating workflow DAG structure...</span>
          ) : isValid && warnings.length === 0 ? (
            <div className="flex items-center gap-1.5 text-brand-700 dark:text-brand-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>Workflow DAG is valid and ready for execution</span>
            </div>
          ) : isValid && warnings.length > 0 ? (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
              <AlertTriangle className="w-4 h-4" />
              <span>Valid with {warnings.length} warning(s)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
              <XCircle className="w-4 h-4" />
              <span>{errors.length} validation error(s) detected</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {(errors.length > 0 || warnings.length > 0) && (
            <span className="text-[11px] text-warm-500 dark:text-charcoal-400">
              {isExpanded ? 'Hide details' : 'View details'}
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-warm-500 dark:text-charcoal-400" />
          ) : (
            <ChevronUp className="w-4 h-4 text-warm-500 dark:text-charcoal-400" />
          )}
        </div>
      </div>

      {isExpanded && (errors.length > 0 || warnings.length > 0) && (
        <div className="p-4 border-t border-warm-200 dark:border-charcoal-800 max-h-48 overflow-y-auto space-y-2 text-xs">
          {errors.map((err, i) => (
            <div
              key={`err-${i}`}
              className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-red-800 dark:text-red-300 flex items-start gap-2"
            >
              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          ))}

          {warnings.map((warn, i) => (
            <div
              key={`warn-${i}`}
              className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{warn}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
