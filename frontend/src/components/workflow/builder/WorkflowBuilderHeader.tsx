import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FlaskConical, ExternalLink, Loader2, Rocket, Save } from 'lucide-react';
import { WorkflowStatusIndicator, WorkflowLifecycle } from './WorkflowStatusIndicator';
import { btn, focusRing } from './styles';

interface WorkflowBuilderHeaderProps {
  name: string;
  onNameChange: (name: string) => void;
  lifecycle: WorkflowLifecycle;
  hasDraft: boolean;
  /** Primary action state */
  isCreating: boolean;
  isSaving: boolean;
  isActivating: boolean;
  canCreate: boolean;
  canSave: boolean;
  canActivate: boolean;
  canTest: boolean;
  testOpen: boolean;
  /** Short reason why the main action is unavailable; shown under the buttons. */
  hint?: string | null;
  onBack: () => void;
  onTest: () => void;
  onCreate: () => void;
  onSave: () => void;
  onOpenEditor: () => void;
  onActivate: () => void;
}

export const WorkflowBuilderHeader: React.FC<WorkflowBuilderHeaderProps> = ({
  name,
  onNameChange,
  lifecycle,
  hasDraft,
  isCreating,
  isSaving,
  isActivating,
  canCreate,
  canSave,
  canActivate,
  canTest,
  testOpen,
  hint,
  onBack,
  onTest,
  onCreate,
  onSave,
  onOpenEditor,
  onActivate,
}) => {
  const isActive = lifecycle === 'active';
  const guard = (e: React.MouseEvent) => {
    e.preventDefault();
    onBack();
  };

  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-sm text-warm-500 dark:text-charcoal-400">
              <li>
                <Link
                  to="/workflows"
                  onClick={guard}
                  className={`rounded hover:text-brand-700 dark:hover:text-brand-400 transition-colors ${focusRing}`}
                >
                  Workflows
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="w-3.5 h-3.5" />
              </li>
              <li aria-current="page" className="text-warm-700 dark:text-charcoal-200">
                New workflow
              </li>
            </ol>
          </nav>
          <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-warm-900 dark:text-charcoal-100">
            Create workflow
          </h1>
          <p className="text-[15px] text-warm-600 dark:text-charcoal-400 max-w-2xl">
            Describe your process. AI will build the workflow for you to review, configure, and test before activation.
          </p>
        </div>

        <div className="flex flex-col gap-2 xl:items-end xl:shrink-0">
          <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap xl:whitespace-nowrap">
            <button type="button" onClick={onBack} className={btn.secondary}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to workflows
            </button>
            <button
              type="button"
              onClick={onTest}
              disabled={!canTest}
              aria-expanded={testOpen}
              className={btn.secondary}
            >
              <FlaskConical className="w-4 h-4" aria-hidden="true" />
              Test workflow
            </button>

            {!hasDraft && (
              <button type="button" onClick={onCreate} disabled={!canCreate || isCreating} className={btn.primary}>
                {isCreating ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="w-4 h-4" aria-hidden="true" />
                )}
                {isCreating ? 'Creating draft…' : 'Create draft'}
              </button>
            )}

            {hasDraft && !isActive && (
              <>
                <button type="button" onClick={onOpenEditor} className={btn.secondary}>
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  Open in editor
                </button>
                <button type="button" onClick={onSave} disabled={!canSave || isSaving} className={btn.primary}>
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="w-4 h-4" aria-hidden="true" />
                  )}
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" onClick={onActivate} disabled={!canActivate || isActivating} className={btn.dark}>
                  {isActivating ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Rocket className="w-4 h-4" aria-hidden="true" />
                  )}
                  {isActivating ? 'Activating…' : 'Activate'}
                </button>
              </>
            )}

            {hasDraft && isActive && (
              <button type="button" onClick={onOpenEditor} className={btn.primary}>
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                Open workflow
              </button>
            )}
          </div>
          <p
            aria-live="polite"
            className={`text-sm min-h-[20px] xl:text-right ${
              hint ? 'text-warm-600 dark:text-charcoal-400' : 'text-transparent select-none'
            }`}
          >
            {hint || ' '}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-warm-200 pt-3 dark:border-charcoal-800">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="workflow-name" className="sr-only">
            Workflow name
          </label>
          <input
            id="workflow-name"
            type="text"
            value={name}
            maxLength={255}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Name your workflow"
            className={`w-full rounded-md border border-transparent bg-transparent px-2 py-1 -mx-2 text-lg font-semibold text-warm-900 placeholder:text-warm-400 hover:border-warm-300 dark:text-charcoal-100 dark:placeholder:text-charcoal-600 dark:hover:border-charcoal-700 focus:border-brand-500 ${focusRing}`}
          />
        </div>
        <WorkflowStatusIndicator state={lifecycle} />
        <p className="text-sm text-warm-600 dark:text-charcoal-400 w-full sm:w-auto">
          {isActive
            ? 'This workflow is live. Open it to change or pause it.'
            : 'Your workflow is a draft. Nothing runs until you activate it.'}
        </p>
      </div>
    </header>
  );
};
