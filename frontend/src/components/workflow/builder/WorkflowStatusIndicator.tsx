import React from 'react';
import { CheckCircle2, CircleDashed, PencilLine, Save } from 'lucide-react';

export type WorkflowLifecycle = 'unsaved' | 'saved' | 'dirty' | 'published' | 'active';

const CONFIG: Record<WorkflowLifecycle, { label: string; icon: React.ElementType; cls: string }> = {
  unsaved: { label: 'Draft, not saved yet', icon: CircleDashed, cls: 'text-warm-600 dark:text-charcoal-300' },
  saved: { label: 'Draft saved', icon: Save, cls: 'text-warm-700 dark:text-charcoal-200' },
  dirty: { label: 'Draft, unsaved changes', icon: PencilLine, cls: 'text-amber-700 dark:text-amber-400' },
  published: { label: 'Published, not active', icon: CheckCircle2, cls: 'text-warm-700 dark:text-charcoal-200' },
  // Green is reserved for the one state that is live.
  active: { label: 'Active', icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-400' },
};

/** Icon + text status, never colour alone. */
export const WorkflowStatusIndicator: React.FC<{ state: WorkflowLifecycle }> = ({ state }) => {
  const c = CONFIG[state];
  const Icon = c.icon;
  return (
    <span
      data-testid="workflow-status"
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${c.cls}`}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      {c.label}
    </span>
  );
};
