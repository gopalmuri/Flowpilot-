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
    <div className="border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm select-none transition-all duration-200">
      {/* Summary Bar */}
      <div
        className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-900/60 transition"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <div className="flex items-center gap-2.5 text-xs">
          {isValidating ? (
            <span className="text-slate-400">Validating workflow DAG structure...</span>
          ) : isValid && warnings.length === 0 ? (
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>Workflow DAG is valid and ready for execution</span>
            </div>
          ) : isValid && warnings.length > 0 ? (
            <div className="flex items-center gap-1.5 text-amber-400 font-medium">
              <AlertTriangle className="w-4 h-4" />
              <span>Valid with {warnings.length} warning(s)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-rose-400 font-medium">
              <XCircle className="w-4 h-4" />
              <span>{errors.length} validation error(s) detected</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {(errors.length > 0 || warnings.length > 0) && (
            <span className="text-[11px] text-slate-400">
              {isExpanded ? 'Hide details' : 'View details'}
            </span>
          )}
          <button
            type="button"
            className="text-slate-400 hover:text-slate-200 p-0.5"
            aria-label={isExpanded ? 'Collapse validation drawer' : 'Expand validation drawer'}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Details Drawer */}
      {isExpanded && (errors.length > 0 || warnings.length > 0) && (
        <div className="px-5 py-3 border-t border-slate-800/80 max-h-48 overflow-y-auto space-y-2 text-xs">
          {errors.map((err, idx) => (
            <div key={`err-${idx}`} className="flex items-start gap-2 text-rose-400 font-mono text-[11px]">
              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}

          {warnings.map((warn, idx) => (
            <div key={`warn-${idx}`} className="flex items-start gap-2 text-amber-400 font-mono text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{warn}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
