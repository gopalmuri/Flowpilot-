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
} from 'lucide-react';
import { StepType } from '../../../types/workflow';

interface PaletteItem {
  type: StepType;
  label: string;
  category: string;
  icon: React.ElementType;
  description: string;
  badgeClass: string;
  iconClass: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: StepType.WEBHOOK_TRIGGER,
    label: 'Webhook Trigger',
    category: 'Triggers',
    icon: Webhook,
    badgeClass: 'bg-warm-100 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-300 border-warm-200 dark:border-charcoal-700',
    iconClass: 'text-brand-600 dark:text-brand-400',
    description: 'Listen for authenticated inbound JSON payloads',
  },
  {
    type: StepType.MANUAL_TRIGGER,
    label: 'Manual Trigger',
    category: 'Triggers',
    icon: Play,
    badgeClass: 'bg-warm-100 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-300 border-warm-200 dark:border-charcoal-700',
    iconClass: 'text-brand-600 dark:text-brand-400',
    description: 'Trigger workflow manually with test parameters',
  },
  {
    type: StepType.VALIDATE_DATA,
    label: 'Data Validation',
    category: 'Processing',
    icon: CheckCircle2,
    badgeClass: 'bg-brand-50 dark:bg-brand-900/40 text-brand-800 dark:text-brand-300 border-brand-200 dark:border-brand-800/60',
    iconClass: 'text-brand-600 dark:text-brand-400',
    description: 'Ensure fields adhere to required types and rules',
  },
  {
    type: StepType.AI_CLASSIFICATION,
    label: 'AI Classification',
    category: 'Intelligence',
    icon: Sparkles,
    badgeClass: 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800/60',
    iconClass: 'text-teal-600 dark:text-teal-400',
    description: 'Classify content using LLM model triage',
  },
  {
    type: StepType.CONDITION,
    label: 'Condition Rule',
    category: 'Logic',
    icon: GitFork,
    badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
    iconClass: 'text-amber-600 dark:text-amber-400',
    description: 'Branch execution based on boolean condition AST',
  },
  {
    type: StepType.HUMAN_APPROVAL,
    label: 'Human Approval',
    category: 'Governance',
    icon: UserCheck,
    badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
    iconClass: 'text-amber-600 dark:text-amber-400',
    description: 'Pause execution until authorized manager reviews',
  },
  {
    type: StepType.MOCK_CRM_CREATE,
    label: 'Mock CRM Entity',
    category: 'Integrations',
    icon: Database,
    badgeClass: 'bg-brand-50 dark:bg-brand-900/30 text-brand-800 dark:text-brand-400 border-brand-200 dark:border-brand-800/50',
    iconClass: 'text-brand-600 dark:text-brand-400',
    description: 'Upsert record in simulated external CRM',
  },
  {
    type: StepType.SLACK_NOTIFICATION,
    label: 'Slack Notification',
    category: 'Integrations',
    icon: MessageSquare,
    badgeClass: 'bg-brand-50 dark:bg-brand-900/30 text-brand-800 dark:text-brand-400 border-brand-200 dark:border-brand-800/50',
    iconClass: 'text-brand-600 dark:text-brand-400',
    description: 'Dispatch real-time notification to Slack channel',
  },
];

interface NodePaletteProps {
  onAddNode: (type: StepType) => void;
  disabled?: boolean;
  isMobileSheet?: boolean;
}

export const NodePalette: React.FC<NodePaletteProps> = ({ onAddNode, disabled = false, isMobileSheet = false }) => {
  return (
    <div className={`p-4 bg-white dark:bg-charcoal-900 ${isMobileSheet ? "w-full border-r-0" : "border-r border-warm-300 dark:border-charcoal-750 w-64"} flex flex-col h-full select-none`}>
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-warm-700 dark:text-charcoal-300">
          Node Palette
        </h3>
        <p className="text-[11px] text-warm-500 dark:text-charcoal-400 mt-0.5">
          Click to add orchestration steps to canvas
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {PALETTE_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              type="button"
              disabled={disabled}
              onClick={() => onAddNode(item.type)}
              className="w-full p-2.5 rounded-lg border border-warm-200 dark:border-charcoal-800 bg-warm-50 dark:bg-charcoal-850 hover:border-warm-300 dark:hover:border-charcoal-700 hover:bg-white dark:hover:bg-charcoal-800 transition-all text-left flex items-start justify-between group disabled:opacity-50 cursor-pointer"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-md bg-warm-200/80 dark:bg-charcoal-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className={`w-3.5 h-3.5 ${item.iconClass}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 truncate">
                    {item.label}
                  </div>
                  <div className="text-[10px] text-warm-500 dark:text-charcoal-400 line-clamp-1 mt-0.5">
                    {item.description}
                  </div>
                </div>
              </div>
              <Plus className="w-3.5 h-3.5 text-warm-400 dark:text-charcoal-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 flex-shrink-0 mt-1" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
