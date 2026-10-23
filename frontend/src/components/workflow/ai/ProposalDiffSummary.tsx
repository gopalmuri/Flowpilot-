import React from 'react';
import { Plus, Minus, Pencil, GitCommitHorizontal } from 'lucide-react';
import { AIWorkflowProposal } from '../../../types/workflowAI';

/** Turns an internal key such as "send_email_2" into "Send email" for display. */
export function humanizeKey(key: string): string {
  const cleaned = key.replace(/[_-]+/g, ' ').replace(/\s+\d+$/, '').trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

interface ProposalDiffSummaryProps {
  proposal: AIWorkflowProposal;
  /** Names of the steps in the current (before) workflow, used to label removed steps. */
  beforeNames?: Record<string, string>;
}

/** Plain-language before/after list: what will be added, removed, and changed. */
export const ProposalDiffSummary: React.FC<ProposalDiffSummaryProps> = ({ proposal, beforeNames = {} }) => {
  const names: Record<string, string> = { ...beforeNames };
  proposal.steps.forEach((s) => {
    names[s.step_key] = s.name || humanizeKey(s.step_key);
  });
  const label = (k: string) => names[k] || humanizeKey(k);
  const d = proposal.diff_summary;

  const groups: Array<{ id: string; title: string; items: string[]; icon: React.ElementType; tone: string }> = [
    { id: 'add', title: 'Will be added', items: d.added_steps.map(label), icon: Plus, tone: 'text-brand-700 dark:text-brand-400' },
    { id: 'remove', title: 'Will be removed', items: d.removed_steps.map(label), icon: Minus, tone: 'text-red-700 dark:text-red-400' },
    { id: 'change', title: 'Will be changed', items: d.modified_steps.map(label), icon: Pencil, tone: 'text-amber-700 dark:text-amber-400' },
  ].filter((g) => g.items.length > 0);

  const reconnected = d.reconnected_edges.length;

  if (groups.length === 0 && reconnected === 0) {
    return <p className="text-xs text-warm-600 dark:text-charcoal-400">No visible changes to the steps.</p>;
  }

  return (
    <ul className="space-y-2" aria-label="What changes">
      {groups.map((g) => {
        const Icon = g.icon;
        return (
          <li key={g.id} className="text-xs">
            <div className={`flex items-center gap-1.5 font-semibold ${g.tone}`}>
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {g.title}
            </div>
            <div className="mt-0.5 pl-5 text-warm-700 dark:text-charcoal-300">{g.items.join(', ')}</div>
          </li>
        );
      })}
      {reconnected > 0 && (
        <li className="text-xs flex items-center gap-1.5 text-warm-700 dark:text-charcoal-300">
          <GitCommitHorizontal className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
          {reconnected} {reconnected === 1 ? 'connection' : 'connections'} rearranged
        </li>
      )}
    </ul>
  );
};
