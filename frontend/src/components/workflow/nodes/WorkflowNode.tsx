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
  AlertCircle,
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
          color: 'indigo',
          bgColor: 'bg-indigo-500/10',
          borderColor: 'border-indigo-500/30',
          textColor: 'text-indigo-400',
          icon: Webhook,
          summary: `Methods: ${(config.allowed_methods || ['POST']).join(', ')}`,
          isTrigger: true,
        };
      case StepType.MANUAL_TRIGGER:
        return {
          label: 'Manual Trigger',
          category: 'Trigger',
          color: 'blue',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/30',
          textColor: 'text-blue-400',
          icon: Play,
          summary: 'Interactive manual execution',
          isTrigger: true,
        };
      case StepType.VALIDATE_DATA:
        return {
          label: 'Validate Data',
          category: 'Processing',
          color: 'emerald',
          bgColor: 'bg-emerald-500/10',
          borderColor: 'border-emerald-500/30',
          textColor: 'text-emerald-400',
          icon: CheckCircle2,
          summary: config.required_fields?.length
            ? `${config.required_fields.length} required fields`
            : 'Schema & rules',
          isTrigger: false,
        };
      case StepType.AI_CLASSIFICATION:
        return {
          label: 'AI Classification',
          category: 'Intelligence',
          color: 'purple',
          bgColor: 'bg-purple-500/10',
          borderColor: 'border-purple-500/30',
          textColor: 'text-purple-400',
          icon: Sparkles,
          summary: config.model ? `Model: ${config.model}` : 'LLM categorization',
          isTrigger: false,
        };
      case StepType.CONDITION:
        return {
          label: 'Condition',
          category: 'Logic & Flow',
          color: 'amber',
          bgColor: 'bg-amber-500/10',
          borderColor: 'border-amber-500/30',
          textColor: 'text-amber-400',
          icon: GitFork,
          summary: config.field ? `Check: ${config.field}` : 'Branching rules',
          isTrigger: false,
          isBranching: true,
        };
      case StepType.MOCK_CRM_CREATE:
        return {
          label: 'Mock CRM Entity',
          category: 'Integration',
          color: 'teal',
          bgColor: 'bg-teal-500/10',
          borderColor: 'border-teal-500/30',
          textColor: 'text-teal-400',
          icon: Database,
          summary: `Entity: ${config.entity_type || 'lead'}`,
          isTrigger: false,
        };
      case StepType.SLACK_NOTIFICATION:
        return {
          label: 'Slack Message',
          category: 'Integration',
          color: 'indigo',
          bgColor: 'bg-indigo-500/10',
          borderColor: 'border-indigo-500/30',
          textColor: 'text-indigo-400',
          icon: MessageSquare,
          summary: config.channel ? `Channel: ${config.channel}` : 'Slack notification',
          isTrigger: false,
        };
      case StepType.HUMAN_APPROVAL:
        return {
          label: 'Human Approval',
          category: 'Guard',
          color: 'rose',
          bgColor: 'bg-rose-500/10',
          borderColor: 'border-rose-500/30',
          textColor: 'text-rose-400',
          icon: UserCheck,
          summary: `Role: ${config.approver_role || 'MANAGER'}`,
          isTrigger: false,
          isApproval: true,
        };
      default:
        return {
          label: String(stepType),
          category: 'Step',
          color: 'slate',
          bgColor: 'bg-slate-800',
          borderColor: 'border-slate-700',
          textColor: 'text-slate-300',
          icon: AlertCircle,
          summary: 'Configured step',
          isTrigger: false,
        };
    }
  };

  const meta = getNodeMeta();
  const Icon = meta.icon;

  return (
    <div
      className={`rounded-xl bg-slate-900 border transition-all duration-200 min-w-[210px] max-w-[260px] shadow-lg ${
        selected
          ? 'border-indigo-500 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-500/10'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Target Handle (Top) - omitted for Trigger nodes */}
      {!meta.isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-slate-400 !border-2 !border-slate-900 hover:!bg-indigo-400 transition-colors"
        />
      )}

      {/* Card Header */}
      <div className="p-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 truncate">
          <div className={`p-1.5 rounded-lg ${meta.bgColor} ${meta.textColor} shrink-0`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="truncate">
            <h4 className="text-xs font-semibold text-slate-100 truncate">
              {nodeData.name || meta.label}
            </h4>
            <span className="text-[10px] font-mono text-slate-400 block truncate">
              key: {nodeData.step_key}
            </span>
          </div>
        </div>
        <span
          className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-medium shrink-0 border ${meta.bgColor} ${meta.borderColor} ${meta.textColor}`}
        >
          {meta.category}
        </span>
      </div>

      {/* Card Body */}
      <div className="p-2.5 bg-slate-950/40 rounded-b-xl">
        <p className="text-[11px] text-slate-400 truncate">{meta.summary}</p>
      </div>

      {/* Source Handles (Bottom) */}
      {meta.isBranching ? (
        <div className="relative w-full flex justify-between px-4 pb-0 -mb-1.5">
          <div className="flex flex-col items-center">
            <Handle
              type="source"
              position={Position.Bottom}
              id="true"
              style={{ left: '25%' }}
              className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-slate-900 hover:!bg-emerald-300"
            />
            <span className="text-[9px] text-emerald-400 font-mono -bottom-4 absolute" style={{ left: '18%' }}>
              true
            </span>
          </div>
          <div className="flex flex-col items-center">
            <Handle
              type="source"
              position={Position.Bottom}
              id="false"
              style={{ left: '75%' }}
              className="!w-3 !h-3 !bg-rose-400 !border-2 !border-slate-900 hover:!bg-rose-300"
            />
            <span className="text-[9px] text-rose-400 font-mono -bottom-4 absolute" style={{ left: '68%' }}>
              false
            </span>
          </div>
        </div>
      ) : meta.isApproval ? (
        <div className="relative w-full flex justify-between px-4 pb-0 -mb-1.5">
          <div className="flex flex-col items-center">
            <Handle
              type="source"
              position={Position.Bottom}
              id="approved"
              style={{ left: '25%' }}
              className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-slate-900 hover:!bg-emerald-300"
            />
            <span className="text-[9px] text-emerald-400 font-mono -bottom-4 absolute" style={{ left: '14%' }}>
              approved
            </span>
          </div>
          <div className="flex flex-col items-center">
            <Handle
              type="source"
              position={Position.Bottom}
              id="rejected"
              style={{ left: '75%' }}
              className="!w-3 !h-3 !bg-rose-400 !border-2 !border-slate-900 hover:!bg-rose-300"
            />
            <span className="text-[9px] text-rose-400 font-mono -bottom-4 absolute" style={{ left: '66%' }}>
              rejected
            </span>
          </div>
        </div>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-slate-400 !border-2 !border-slate-900 hover:!bg-indigo-400 transition-colors"
        />
      )}
    </div>
  );
});

WorkflowNode.displayName = 'WorkflowNode';
