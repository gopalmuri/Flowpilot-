import React from 'react';
import { AlertTriangle, FlaskConical, Info, Trash2, X } from 'lucide-react';
import { Node } from '@xyflow/react';
import { WorkflowStepSchema } from '../../../types/workflow';
import { AICatalogStep, AISetupItem } from '../../../types/workflowAI';
import { WorkflowNodeData } from '../../../utils/workflowGraphValidator';
import { NodeConfigPanel } from '../config/NodeConfigPanel';
import { KIND_LABEL, KIND_STYLE, getStepMeta } from './stepMeta';
import { iconBtn } from './styles';

interface WorkflowInspectorProps {
  step: WorkflowStepSchema;
  catalogEntry?: AICatalogStep;
  /** Validation problems for this step only. */
  errors: string[];
  /** Setup items from the assistant that point at this step. */
  setupItems: AISetupItem[];
  readOnly?: boolean;
  onChange: (stepKey: string, patch: { name?: string; config?: Record<string, any> }) => void;
  onDelete: (stepKey: string) => void;
  onClose: () => void;
}

/** Shows the configuration of ONE selected step, its problems, and what it needs from integrations. */
export const WorkflowInspector: React.FC<WorkflowInspectorProps> = ({
  step,
  catalogEntry,
  errors,
  setupItems,
  readOnly = false,
  onChange,
  onDelete,
  onClose,
}) => {
  const meta = getStepMeta(step.step_type);
  const styles = KIND_STYLE[meta.kind];
  const Icon = meta.icon;

  const node: Node<WorkflowNodeData> = {
    id: `node-${step.step_key}`,
    position: { x: 0, y: 0 },
    data: { step_key: step.step_key, step_type: step.step_type, name: step.name, config: step.config || {} },
  };

  // Only claim test mode where the API says so: via the step's own setup item or the catalog's `is_mock` flag.
  const showCatalogTestMode = Boolean(catalogEntry?.is_mock) && setupItems.length === 0;

  return (
    <section
      aria-label={`Settings for ${step.name || meta.fallbackLabel}`}
      className="space-y-4 p-5"
      data-testid="workflow-inspector"
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${styles.tile}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-medium ${styles.label}`}>{KIND_LABEL[meta.kind]} step</p>
          <h3 className="truncate text-base font-semibold text-warm-900 dark:text-charcoal-100">
            {step.name || catalogEntry?.label || meta.fallbackLabel}
          </h3>
          {catalogEntry && catalogEntry.label !== step.name && (
            <p className="text-sm text-warm-600 dark:text-charcoal-400">{catalogEntry.label}</p>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            className={iconBtn}
            aria-label="Delete this step"
            title="Delete this step"
            onClick={() => onDelete(step.step_key)}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
        <button type="button" className={iconBtn} aria-label="Close step settings" title="Close" onClick={onClose}>
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/10"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            This step needs attention
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6 text-sm text-red-800 dark:text-red-300">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {(setupItems.length > 0 || showCatalogTestMode) && (
        <div className="rounded-lg border border-warm-300 bg-warm-50 px-3 py-2.5 dark:border-charcoal-750 dark:bg-charcoal-850">
          <p className="text-xs font-semibold uppercase tracking-wide text-warm-500 dark:text-charcoal-400">
            Integration
          </p>
          <ul className="mt-1.5 space-y-2">
            {setupItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                {item.blocking ? (
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
                )}
                <span className="text-warm-700 dark:text-charcoal-300">
                  <span className="font-medium text-warm-900 dark:text-charcoal-100">{item.title}. </span>
                  {item.detail}
                  {item.blocking && <span className="font-medium text-amber-800 dark:text-amber-300"> Required.</span>}
                </span>
              </li>
            ))}
            {showCatalogTestMode && (
              <li className="flex items-start gap-2 text-sm text-warm-700 dark:text-charcoal-300">
                <FlaskConical
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-warm-500 dark:text-charcoal-400"
                  aria-hidden="true"
                />
                This step runs in test mode. Results are recorded in FlowPilot only.
              </li>
            )}
          </ul>
        </div>
      )}

      <NodeConfigPanel
        variant="embedded"
        selectedNode={node}
        isReadOnly={readOnly}
        onClose={onClose}
        onDeleteNode={() => onDelete(step.step_key)}
        onUpdateNode={(_id, patch) => onChange(step.step_key, { name: patch.name, config: patch.config })}
      />
    </section>
  );
};
