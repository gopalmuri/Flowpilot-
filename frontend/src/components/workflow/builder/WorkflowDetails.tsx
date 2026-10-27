import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Info, Plug, SlidersHorizontal } from 'lucide-react';
import { WorkflowStepSchema } from '../../../types/workflow';
import { AICatalogStep, AISetupItem } from '../../../types/workflowAI';
import { KIND_LABEL, KIND_STYLE, getStepMeta } from './stepMeta';
import { focusRing } from './styles';

interface WorkflowDetailsProps {
  summary: string | null;
  steps: WorkflowStepSchema[];
  catalog: Record<string, AICatalogStep>;
  selectedKey: string | null;
  onSelectStep: (key: string) => void;
  errors: string[];
  warnings: string[];
  setupItems: AISetupItem[];
  unsupported: string[];
}

const KIND_ICON: Record<AISetupItem['kind'], React.ElementType> = {
  integration: Plug,
  config: SlidersHorizontal,
  info: Info,
};

const H = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h3 id={id} className="text-base font-semibold text-warm-900 dark:text-charcoal-100">
    {children}
  </h3>
);

const NOTICE =
  'flex items-start gap-3 rounded-lg border border-warm-300 bg-warm-50 px-3.5 py-3 text-sm text-warm-700 dark:border-charcoal-750 dark:bg-charcoal-850 dark:text-charcoal-300';

/** Summary, ordered steps and setup requirements, all taken from the assistant's real response. */
export const WorkflowDetails: React.FC<WorkflowDetailsProps> = ({
  summary,
  steps,
  catalog,
  selectedKey,
  onSelectStep,
  errors,
  warnings,
  setupItems,
  unsupported,
}) => {
  const sortedSetup = [...setupItems].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  const requiredCount = sortedSetup.filter((i) => i.blocking).length;

  return (
    <div className="space-y-6 p-5" data-testid="workflow-details">
      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            Fix {errors.length === 1 ? 'this problem' : `these ${errors.length} problems`} before saving or activating
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-sm text-red-800 dark:text-red-300">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="mt-1.5 pl-6 text-sm text-red-800 dark:text-red-300">
            Ask the assistant to fix it, or edit the step.
          </p>
        </div>
      )}

      {summary && (
        <section aria-labelledby="details-summary">
          <H id="details-summary">Summary</H>
          <p className="mt-1 text-[15px] leading-relaxed text-warm-700 dark:text-charcoal-300">{summary}</p>
        </section>
      )}

      {steps.length > 0 && (
        <section aria-labelledby="details-steps">
          <H id="details-steps">Steps</H>
          <ol className="mt-2 divide-y divide-warm-200 rounded-lg border border-warm-300 dark:divide-charcoal-800 dark:border-charcoal-750">
            {steps.map((s, i) => {
              const meta = getStepMeta(s.step_type);
              const Icon = meta.icon;
              const styles = KIND_STYLE[meta.kind];
              const plain = catalog[s.step_type]?.label;
              const title = s.name || plain || meta.fallbackLabel;
              return (
                <li key={s.step_key}>
                  <button
                    type="button"
                    onClick={() => onSelectStep(s.step_key)}
                    aria-current={selectedKey === s.step_key ? 'true' : undefined}
                    aria-label={`Step ${i + 1}: ${title}. Open settings`}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-warm-50 dark:hover:bg-charcoal-850 cursor-pointer ${focusRing}`}
                  >
                    <span
                      className="w-5 text-right text-sm tabular-nums text-warm-500 dark:text-charcoal-400"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${styles.tile}`}>
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-warm-900 dark:text-charcoal-100">
                      {title}
                    </span>
                    <span className={`flex-shrink-0 text-xs font-medium ${styles.label}`}>
                      {plain && plain !== s.name ? plain : KIND_LABEL[meta.kind]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {(sortedSetup.length > 0 || unsupported.length > 0 || warnings.length > 0) && (
        <section aria-labelledby="details-setup">
          <H id="details-setup">Setup requirements</H>
          {requiredCount > 0 && (
            <p className="mt-0.5 text-sm font-medium text-amber-800 dark:text-amber-300">
              {requiredCount} required before it can do real work
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {sortedSetup.map((item) => {
              const Icon = item.blocking ? AlertTriangle : KIND_ICON[item.kind];
              const step = item.step_key ? steps.find((s) => s.step_key === item.step_key) : undefined;
              return (
                <li
                  key={item.id}
                  className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 ${
                    item.blocking
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
                      : 'border-warm-300 bg-warm-50 dark:border-charcoal-750 dark:bg-charcoal-850'
                  }`}
                >
                  <Icon
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                      item.blocking ? 'text-amber-700 dark:text-amber-400' : 'text-warm-500 dark:text-charcoal-400'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-warm-900 dark:text-charcoal-100">
                      {item.title}
                      {item.blocking && (
                        <span className="ml-2 text-xs font-semibold text-amber-800 dark:text-amber-300">Required</span>
                      )}
                    </p>
                    <p className="mt-0.5 leading-relaxed text-warm-700 dark:text-charcoal-300">{item.detail}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {(item.action === 'connect_gmail' || item.action === 'open_integrations') && (
                        <Link
                          to="/integrations"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1 rounded font-medium text-brand-700 hover:underline dark:text-brand-400 ${focusRing}`}
                        >
                          {item.action === 'connect_gmail' ? 'Connect Gmail' : 'Open integrations'}
                          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          <span className="sr-only">(opens in a new tab so your draft stays here)</span>
                        </Link>
                      )}
                      {item.action === 'edit_step' && step && (
                        <button
                          type="button"
                          onClick={() => onSelectStep(step.step_key)}
                          className={`rounded font-medium text-brand-700 hover:underline dark:text-brand-400 cursor-pointer ${focusRing}`}
                        >
                          Configure "{step.name}"
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}

            {warnings.map((w) => (
              <li key={w} className={NOTICE}>
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
                {w}
              </li>
            ))}

            {unsupported.length > 0 && (
              <li className={NOTICE}>
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
                <div>
                  <p className="font-medium text-warm-900 dark:text-charcoal-100">Not available yet</p>
                  <p>Left out of this version because it is not supported today:</p>
                  <ul className="mt-0.5 list-disc pl-5">
                    {unsupported.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
};
