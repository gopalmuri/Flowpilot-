import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, Plug, SlidersHorizontal, ExternalLink } from 'lucide-react';
import { AISetupItem } from '../../../types/workflowAI';

interface SetupChecklistProps {
  items: AISetupItem[];
}

const KIND_ICON: Record<AISetupItem['kind'], React.ElementType> = {
  integration: Plug,
  config: SlidersHorizontal,
  info: Info,
};

/** "Setup needed" checklist. Blocking items are shown first and more prominently. */
export const SetupChecklist: React.FC<SetupChecklistProps> = ({ items }) => {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  const blockingCount = sorted.filter((i) => i.blocking).length;

  return (
    <section aria-labelledby="setup-needed-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="setup-needed-heading" className="text-xs font-bold uppercase tracking-wider text-warm-800 dark:text-charcoal-200">
          Setup needed
        </h3>
        {blockingCount > 0 && (
          <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
            {blockingCount} to finish before it can do real work
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {sorted.map((item) => {
          const Icon = item.blocking ? AlertTriangle : KIND_ICON[item.kind];
          return (
            <li
              key={item.id}
              className={`p-3 rounded-xl border text-xs ${
                item.blocking
                  ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800/60'
                  : 'bg-warm-50 dark:bg-charcoal-850 border-warm-200 dark:border-charcoal-750'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Icon
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    item.blocking ? 'text-amber-600 dark:text-amber-400' : 'text-warm-500 dark:text-charcoal-400'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-warm-900 dark:text-charcoal-100">
                    {item.title}
                    {item.blocking && (
                      <span className="ml-2 text-[10px] font-bold uppercase text-amber-800 dark:text-amber-300">
                        Required
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-warm-700 dark:text-charcoal-300 leading-relaxed">{item.detail}</p>
                  {(item.action === 'connect_gmail' || item.action === 'open_integrations') && (
                    <Link
                      to="/integrations"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-700 text-xs font-semibold text-brand-700 dark:text-brand-400 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
                    >
                      {item.action === 'connect_gmail' ? 'Connect Gmail' : 'Open integrations'}
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab so your draft stays here)</span>
                    </Link>
                  )}
                  {item.action === 'edit_step' && (
                    <p className="mt-1.5 text-[11px] italic text-warm-500 dark:text-charcoal-400">
                      You can fill this in on the step itself once the draft is created.
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
