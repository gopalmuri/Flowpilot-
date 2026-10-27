import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { branchHandlesFor } from '../../../utils/workflowGraphMapper';
import { WorkflowNodeData } from '../../../utils/workflowGraphValidator';
import { KIND_LABEL, KIND_STYLE, describeStep, getStepMeta } from '../builder/stepMeta';

const HANDLE_BASE = '!w-3 !h-3 !border-2 !border-white dark:!border-charcoal-900';

const BRANCH_HANDLE_COLORS: Record<string, string> = {
  true: '!bg-brand-600 dark:!bg-brand-500',
  approved: '!bg-brand-600 dark:!bg-brand-500',
  false: '!bg-red-500',
  rejected: '!bg-red-500',
};

/**
 * One step on the canvas. Shared by the full editor and the AI builder.
 * Optional data flags (set by the AI builder): `catalogLabel`, `testMode`, `hasError`, `hideKey`.
 */
export const WorkflowNode: React.FC<NodeProps<any>> = memo(({ data, selected }) => {
  const nodeData = data as WorkflowNodeData;
  const stepType = String(nodeData.step_type);
  const meta = getStepMeta(stepType);
  const Icon = meta.icon;
  const styles = KIND_STYLE[meta.kind];
  const isTrigger = meta.kind === 'trigger';
  const branchHandles = branchHandlesFor(stepType);
  const title = nodeData.name || nodeData.catalogLabel || meta.fallbackLabel;
  const description = describeStep(stepType, nodeData.config);
  const isPreview = Boolean(nodeData.isPreview);

  return (
    <div
      data-testid={`workflow-node-${nodeData.step_key}`}
      className={`relative w-[272px] rounded-xl bg-white dark:bg-charcoal-900 border shadow-subtle transition-shadow duration-150 ${
        isPreview
          ? 'border-dashed border-brand-500 ring-2 ring-brand-500/20'
          : selected
          ? 'border-brand-500 ring-2 ring-brand-500/40'
          : nodeData.hasError
          ? 'border-red-300 dark:border-red-500/50'
          : 'border-warm-300 dark:border-charcoal-750 hover:shadow-card'
      }`}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          title="Input"
          className={`${HANDLE_BASE} !bg-warm-400 dark:!bg-charcoal-600 !-top-1.5`}
        />
      )}

      <div className="flex items-start gap-3 p-3.5">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${styles.tile}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className={styles.label}>{KIND_LABEL[meta.kind]}</span>
            {nodeData.testMode && (
              <span className="inline-flex items-center gap-1 text-warm-500 dark:text-charcoal-400">
                <FlaskConical className="w-3 h-3" aria-hidden="true" />
                Test mode
              </span>
            )}
            {nodeData.hasError && (
              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                Needs attention
              </span>
            )}
          </div>
          <div className="mt-0.5 text-sm font-semibold leading-snug text-warm-900 dark:text-charcoal-100 truncate" title={title}>
            {title}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-warm-600 dark:text-charcoal-400 line-clamp-2">{description}</p>
          {!nodeData.hideKey && (
            <div className="mt-1.5 font-mono text-xs text-warm-500 dark:text-charcoal-500 truncate">
              key: {nodeData.step_key}
            </div>
          )}
        </div>
      </div>

      {branchHandles.length > 0 ? (
        <>
          <div className="relative h-6 border-t border-warm-200 dark:border-charcoal-800" aria-hidden="true">
            {branchHandles.map((handleId, i) => (
              <span
                key={handleId}
                className="absolute top-1 -translate-x-1/2 text-xs font-medium capitalize text-warm-600 dark:text-charcoal-400"
                style={{ left: `${((i + 1) * 100) / (branchHandles.length + 1)}%` }}
              >
                {handleId}
              </span>
            ))}
          </div>
          {branchHandles.map((handleId, i) => (
            <Handle
              key={handleId}
              type="source"
              position={Position.Bottom}
              id={handleId}
              title={`Output: ${handleId}`}
              style={{ left: `${((i + 1) * 100) / (branchHandles.length + 1)}%` }}
              className={`${HANDLE_BASE} !-bottom-1.5 ${BRANCH_HANDLE_COLORS[handleId] || '!bg-warm-400'}`}
            />
          ))}
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          title="Output"
          className={`${HANDLE_BASE} !bg-warm-400 dark:!bg-charcoal-600 !-bottom-1.5`}
        />
      )}
    </div>
  );
});
