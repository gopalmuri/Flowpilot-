import React from 'react';
import {
  Webhook,
  Play,
  CheckCircle2,
  Sparkles,
  GitFork,
  Database,
  MessageSquare,
  UserCheck,
  Plus,
  GripVertical,
} from 'lucide-react';
import { StepType } from '../../../types/workflow';

interface PaletteItem {
  type: StepType;
  label: string;
  category: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  textColor: string;
  description: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  // Triggers
  {
    type: StepType.WEBHOOK_TRIGGER,
    label: 'Webhook Trigger',
    category: 'Triggers',
    icon: Webhook,
    color: 'indigo',
    bgColor: 'bg-indigo-500/10',
    textColor: 'text-indigo-400',
    description: 'Listen for authenticated inbound JSON payloads',
  },
  {
    type: StepType.MANUAL_TRIGGER,
    label: 'Manual Trigger',
    category: 'Triggers',
    icon: Play,
    color: 'blue',
    bgColor: 'bg-blue-500/10',
    textColor: 'text-blue-400',
    description: 'Trigger workflow manually with test parameters',
  },
  // Processing
  {
    type: StepType.VALIDATE_DATA,
    label: 'Validate Data',
    category: 'Processing',
    icon: CheckCircle2,
    color: 'emerald',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-400',
    description: 'Ensure fields adhere to required types and rules',
  },
  {
    type: StepType.AI_CLASSIFICATION,
    label: 'AI Classification',
    category: 'Processing',
    icon: Sparkles,
    color: 'purple',
    bgColor: 'bg-purple-500/10',
    textColor: 'text-purple-400',
    description: 'LLM classification and intent extraction',
  },
  // Flow Control
  {
    type: StepType.CONDITION,
    label: 'Condition Branch',
    category: 'Logic & Flow',
    icon: GitFork,
    color: 'amber',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-400',
    description: 'Route execution paths based on evaluated rules',
  },
  {
    type: StepType.HUMAN_APPROVAL,
    label: 'Human Approval',
    category: 'Logic & Flow',
    icon: UserCheck,
    color: 'rose',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-400',
    description: 'Paused workflow human review checkpoint',
  },
  // Integrations
  {
    type: StepType.MOCK_CRM_CREATE,
    label: 'Mock CRM Entity',
    category: 'Integrations',
    icon: Database,
    color: 'teal',
    bgColor: 'bg-teal-500/10',
    textColor: 'text-teal-400',
    description: 'Create Lead, Contact, or Deal in Mock CRM',
  },
  {
    type: StepType.SLACK_NOTIFICATION,
    label: 'Slack Message',
    category: 'Integrations',
    icon: MessageSquare,
    color: 'indigo',
    bgColor: 'bg-indigo-500/10',
    textColor: 'text-indigo-400',
    description: 'Send formatted alert to Slack channel',
  },
];

export interface NodePaletteProps {
  onAddNode?: (type: StepType) => void;
  disabled?: boolean;
  isReadOnly?: boolean;
}

export const NodePalette: React.FC<NodePaletteProps> = ({
  onAddNode,
  disabled = false,
  isReadOnly = false,
}) => {
  const isLocked = disabled || isReadOnly;

  const onDragStart = (event: React.DragEvent, nodeType: StepType) => {
    if (isLocked) return;
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/reactflow-step-type', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const categories = ['Triggers', 'Processing', 'Logic & Flow', 'Integrations'];

  return (
    <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col h-full select-none">
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
          Node Palette
        </h3>
        <p className="text-[11px] text-slate-400 mt-1">
          {isLocked
            ? 'Canvas is read-only'
            : 'Drag nodes onto canvas or click + to add'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {categories.map((category) => {
          const items = PALETTE_ITEMS.filter((i) => i.category === category);
          if (items.length === 0) return null;

          return (
            <div key={category} className="space-y-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">
                {category}
              </span>
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.type}
                      draggable={!isLocked}
                      onDragStart={(e) => onDragStart(e, item.type)}
                      className={`group relative flex items-center justify-between p-2 rounded-xl border border-slate-800/80 bg-slate-900/60 transition-all ${
                        isLocked
                          ? 'opacity-60 cursor-not-allowed'
                          : 'cursor-grab hover:cursor-grab active:cursor-grabbing hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0" />
                        <div
                          className={`p-1 rounded-lg ${item.bgColor} ${item.textColor} shrink-0`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-medium text-slate-200 truncate">
                            {item.label}
                          </h4>
                          <p className="text-[10px] text-slate-400 truncate">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      {onAddNode && !isLocked && (
                        <button
                          type="button"
                          onClick={() => onAddNode(item.type)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition"
                          title={`Add ${item.label}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
