import {
  Webhook,
  Play,
  CheckCircle2,
  Sparkles,
  ScanSearch,
  Mail,
  Send,
  GitFork,
  Database,
  MessageSquare,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { StepType } from '../../../types/workflow';

export type StepKind = 'trigger' | 'ai' | 'condition' | 'approval' | 'action';

export interface StepMeta {
  icon: LucideIcon;
  kind: StepKind;
  /** Plain-language name used when the step has no name of its own. */
  fallbackLabel: string;
}

const META: Record<string, StepMeta> = {
  [StepType.WEBHOOK_TRIGGER]: { icon: Webhook, kind: 'trigger', fallbackLabel: 'Webhook trigger' },
  [StepType.MANUAL_TRIGGER]: { icon: Play, kind: 'trigger', fallbackLabel: 'Manual trigger' },
  [StepType.VALIDATE_DATA]: { icon: CheckCircle2, kind: 'action', fallbackLabel: 'Validate data' },
  [StepType.AI_CLASSIFICATION]: { icon: Sparkles, kind: 'ai', fallbackLabel: 'AI classification' },
  [StepType.AI_EXTRACT_DATA]: { icon: ScanSearch, kind: 'ai', fallbackLabel: 'AI extracts details' },
  [StepType.AI_ANALYZE_MESSAGE]: { icon: Mail, kind: 'ai', fallbackLabel: 'AI reads a message' },
  [StepType.SEND_REPLY]: { icon: Send, kind: 'action', fallbackLabel: 'Send reply' },
  [StepType.CONDITION]: { icon: GitFork, kind: 'condition', fallbackLabel: 'Condition' },
  [StepType.MOCK_CRM_CREATE]: { icon: Database, kind: 'action', fallbackLabel: 'Create CRM record' },
  [StepType.SLACK_NOTIFICATION]: { icon: MessageSquare, kind: 'action', fallbackLabel: 'Slack notification' },
  [StepType.HUMAN_APPROVAL]: { icon: UserCheck, kind: 'approval', fallbackLabel: 'Human approval' },
};

const DEFAULT_META: StepMeta = { icon: CheckCircle2, kind: 'action', fallbackLabel: 'Step' };

export function getStepMeta(stepType: string): StepMeta {
  return META[stepType] ?? DEFAULT_META;
}

export const KIND_LABEL: Record<StepKind, string> = {
  trigger: 'Trigger',
  ai: 'AI',
  condition: 'Condition',
  approval: 'Approval',
  action: 'Action',
};

/** Colour lives on the icon tile and the small type label only, never on the whole node. */
export const KIND_STYLE: Record<StepKind, { tile: string; label: string }> = {
  ai: {
    tile: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
    label: 'text-brand-700 dark:text-brand-400',
  },
  approval: {
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    label: 'text-amber-700 dark:text-amber-400',
  },
  trigger: {
    tile: 'bg-warm-100 text-warm-600 dark:bg-charcoal-800 dark:text-charcoal-300',
    label: 'text-warm-500 dark:text-charcoal-400',
  },
  condition: {
    tile: 'bg-warm-100 text-warm-600 dark:bg-charcoal-800 dark:text-charcoal-300',
    label: 'text-warm-500 dark:text-charcoal-400',
  },
  action: {
    tile: 'bg-warm-100 text-warm-600 dark:bg-charcoal-800 dark:text-charcoal-300',
    label: 'text-warm-500 dark:text-charcoal-400',
  },
};

const OPERATOR_TEXT: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
};

const clip = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

/** One-line, plain-language description built only from the step's real configuration. */
export function describeStep(stepType: string, config: Record<string, any> | undefined): string {
  const cfg = config || {};
  switch (stepType) {
    case StepType.WEBHOOK_TRIGGER: {
      const methods = asList(cfg.allowed_methods);
      return `Starts on incoming ${(methods.length ? methods : ['POST']).join(', ')} requests`;
    }
    case StepType.MANUAL_TRIGGER:
      return 'Starts when someone runs it';
    case StepType.VALIDATE_DATA: {
      const fields = asList(cfg.required_fields);
      return fields.length ? clip(`Requires ${fields.join(', ')}`) : 'Checks the incoming data against rules';
    }
    case StepType.AI_CLASSIFICATION: {
      const categories = asList(cfg.categories);
      if (categories.length) return clip(`Sorts into ${categories.join(', ')}`);
      if (typeof cfg.prompt === 'string' && cfg.prompt.trim()) return clip(cfg.prompt.trim());
      return 'Decides which category the data belongs to';
    }
    case StepType.AI_EXTRACT_DATA: {
      const fields = asList(cfg.fields);
      return fields.length ? clip(`Pulls out ${fields.join(', ')}`) : 'Pulls key details out of text';
    }
    case StepType.AI_ANALYZE_MESSAGE:
      return 'Reads the message and drafts a reply';
    case StepType.SEND_REPLY:
      return 'Sends the reply once it is approved';
    case StepType.CONDITION: {
      if (typeof cfg.field === 'string' && cfg.field.trim()) {
        const op = OPERATOR_TEXT[String(cfg.operator || 'eq')] ?? 'matches';
        const value = cfg.value !== undefined && cfg.value !== '' ? ` ${String(cfg.value)}` : '';
        return clip(`If ${cfg.field} ${op}${value}`);
      }
      if (typeof cfg.expression === 'string' && cfg.expression.trim()) return clip(`If ${cfg.expression.trim()}`);
      return 'Branches the flow on a rule';
    }
    case StepType.MOCK_CRM_CREATE:
      return `Creates a ${cfg.entity_type || 'lead'} record`;
    case StepType.SLACK_NOTIFICATION:
      if (cfg.channel) return clip(`Posts to ${cfg.channel}`);
      if (typeof cfg.message === 'string' && cfg.message.trim()) return clip(cfg.message.trim());
      return 'Sends a Slack message';
    case StepType.HUMAN_APPROVAL: {
      const role = String(cfg.approver_role || cfg.required_role || 'MANAGER').toLowerCase();
      return `Needs ${role} approval`;
    }
    default:
      return 'Runs a workflow step';
  }
}
