import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
  Webhook,
  Play,
  CheckCircle2,
  Sparkles,
  GitFork,
  Database,
  MessageSquare,
  UserCheck,
} from 'lucide-react';
import { StepType } from '../../../types/workflow';
import { WorkflowNodeData } from '../../../utils/workflowGraphValidator';

export const WorkflowNode: React.FC<NodeProps<any>> = memo(({ data, selected }) => {
  const nodeData = data as WorkflowNodeData;
  const stepType = nodeData.step_type;
  const config = nodeData.config || {};

  const getNodeMeta = () => {
    switch (stepType) {
      case StepType.WEBHOOK_TRIGGER:
        return {
          label: 'Webhook Trigger',
          category: 'Trigger',
          icon: Webhook,
          badgeClass: 'bg-warm-200 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-300 border-warm-300 dark:border-charcoal-700',
          iconClass: 'text-brand-600 dark:text-brand-400',
          summary: `Methods: ${(config.allowed_methods || ['POST']).join(', ')}`,
          isTrigger: true,
        };
      case StepType.MANUAL_TRIGGER:
        return {
          label: 'Manual Trigger',
          category: 'Trigger',
          icon: Play,
          badgeClass: 'bg-warm-200 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-300 border-warm-300 dark:border-charcoal-700',
          iconClass: 'text-brand-600 dark:text-brand-400',
          summary: 'Interactive manual execution',
          isTrigger: true,
        };
      case StepType.VALIDATE_DATA:
        return {
          label: 'Validate Data',
          category: 'Processing',
          icon: CheckCircle2,
          badgeClass: 'bg-brand-50 dark:bg-brand-900/40 text-brand-800 dark:text-brand-300 border-brand-200 dark:border-brand-800/60',
          iconClass: 'text-brand-600 dark:text-brand-400',
          summary: config.required_fields?.length
            ? `${config.required_fields.length} required fields`
            : 'Schema & rules',
          isTrigger: false,
        };
      case StepType.AI_CLASSIFICATION:
        return {
          label: 'AI Classification',
          category: 'Intelligence',
          icon: Sparkles,
          badgeClass: 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800/60',
          iconClass: 'text-teal-600 dark:text-teal-400',
          summary: config.model ? `Model: ${config.model}` : 'LLM categorization',
          isTrigger: false,
        };
      case StepType.CONDITION:
        return {
          label: 'Condition',
          category: 'Logic & Flow',
          icon: GitFork,
          badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
          iconClass: 'text-amber-600 dark:text-amber-400',
          summary: config.field ? `Check: ${config.field}` : 'Branching rules',
          isTrigger: false,
          isBranching: true,
        };
      case StepType.MOCK_CRM_CREATE:
        return {
          label: 'Mock CRM Entity',
          category: 'Integration',
          icon: Database,
          badgeClass: 'bg-brand-50 dark:bg-brand-900/30 text-brand-800 dark:text-brand-400 border-brand-200 dark:border-brand-800/50',
          iconClass: 'text-brand-600 dark:text-brand-400',
          summary: `Entity: ${config.entity_type || 'lead'}`,
          isTrigger: false,
        };
      case StepType.SLACK_NOTIFICATION:
        return {
          label: 'Slack Notification',
          category: 'Integration',
          icon: MessageSquare,
          badgeClass: 'bg-brand-50 dark:bg-brand-900/30 text-brand-800 dark:text-brand-400 border-brand-200 dark:border-brand-800/50',
          iconClass: 'text-brand-600 dark:text-brand-400',
          summary: config.channel ? `Channel: ${config.channel}` : 'Alerts dispatch',
          isTrigger: false,
        };
      case StepType.HUMAN_APPROVAL:
        return {
          label: 'Human Approval Gate',
          category: 'Governance',
          icon: UserCheck,
          badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
          iconClass: 'text-amber-600 dark:text-amber-400',
          summary: `Role: ${config.required_role || 'ADMIN'}`,
          isTrigger: false,
        };
      default:
        return {
          label: nodeData.name || 'Step',
          category: 'Step',
          icon: CheckCircle2,
          badgeClass: 'bg-warm-100 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300 border-warm-200 dark:border-charcoal-700',
          iconClass: 'text-warm-600 dark:text-charcoal-400',
          summary: 'Workflow operation',
          isTrigger: false,
        };
    }
  };

  const meta = getNodeMeta();
  const Icon = meta.icon;

  return (
    <div
      className={`min-w-[220px] max-w-[280px] rounded-xl bg-white dark:bg-charcoal-900 border transition-all duration-150 shadow-subtle ${
        selected
          ? 'border-brand-600 dark:border-brand-500 ring-2 ring-brand-500/20'
          : 'border-warm-300 dark:border-charcoal-750 hover:border-warm-400 dark:hover:border-charcoal-700'
      }`}
    >
      {!meta.isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-warm-400 dark:!bg-charcoal-600 !border-2 !border-white dark:!border-charcoal-900 !-top-1.5 transition-colors"
        />
      )}

      <div className="p-3 border-b border-warm-200 dark:border-charcoal-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-warm-100 dark:bg-charcoal-850 flex items-center justify-center flex-shrink-0">
            <Icon className={`w-3.5 h-3.5 ${meta.iconClass}`} />
          </div>
          <span className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 truncate">
            {nodeData.name || meta.label}
          </span>
        </div>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.badgeClass}`}>
          {meta.category}
        </span>
      </div>

      <div className="p-3 text-[11px] text-warm-600 dark:text-charcoal-400 space-y-1">
        <div className="font-mono text-[10px] text-warm-500 dark:text-charcoal-500 truncate">
          key: {nodeData.step_key}
        </div>
        <div className="text-warm-700 dark:text-charcoal-300 truncate">
          {meta.summary}
        </div>
      </div>

      {meta.isBranching ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="!w-3 !h-3 !bg-brand-600 dark:!bg-brand-500 !border-2 !border-white dark:!border-charcoal-900 !-bottom-1.5 !left-[30%]"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-white dark:!border-charcoal-900 !-bottom-1.5 !left-[70%]"
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-warm-400 dark:!bg-charcoal-600 !border-2 !border-white dark:!border-charcoal-900 !-bottom-1.5 transition-colors"
        />
      )}
    </div>
  );
});
