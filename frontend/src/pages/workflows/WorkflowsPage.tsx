import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Pause,
  Play,
  Archive,
  ArrowUp,
  ChevronDown,
  Loader2,
  CheckCircle2,
  MoreVertical,
  Sliders,
  History,
  Clock,
  Terminal,
  X,
  Edit2,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  listWorkflows,
  createWorkflow,
  archiveWorkflow,
  enableWorkflow,
  disableWorkflow,
  updateWorkflow,
  getAITemplates,
} from '../../services/workflowService';
import { triggerExecution } from '../../services/executionService';
import { Workflow, WorkflowStatus, WorkflowCreateRequest } from '../../types/workflow';
import { AIWorkflowTemplate } from '../../types/workflowAI';
import { EXAMPLE_IDEAS } from '../../components/workflow/ai/examplePrompts';

const LAST_RUN_STYLE: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
  COMPLETED: { label: 'Completed', cls: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', cls: 'text-red-700 dark:text-red-400', Icon: AlertTriangle },
  RUNNING: { label: 'Running', cls: 'text-brand-700 dark:text-brand-400', Icon: Loader2 },
  PAUSED: { label: 'Waiting for approval', cls: 'text-amber-700 dark:text-amber-400', Icon: Clock },
  PENDING: { label: 'Waiting to start', cls: 'text-amber-700 dark:text-amber-400', Icon: Clock },
};

/** Last-run indicator: icon + text carry the meaning, color is only reinforcement. */
export const LastRunPill: React.FC<{
  status?: string | null;
  at?: string | null;
  formatTime: (iso?: string) => string;
}> = ({ status, at, formatTime }) => {
  const base = 'inline-flex items-center gap-1';
  if (!status) {
    return (
      <span className={`${base} text-warm-600 dark:text-charcoal-400`}>
        <Clock className="w-3 h-3" aria-hidden="true" />
        Never run
      </span>
    );
  }
  const style = LAST_RUN_STYLE[status.toUpperCase()] ?? {
    label: status.charAt(0) + status.slice(1).toLowerCase(),
    cls: 'text-warm-700 dark:text-charcoal-300',
    Icon: Clock,
  };
  const Icon = style.Icon;
  return (
    <span className={`${base} ${style.cls}`}>
      <Icon className={`w-3 h-3 ${status.toUpperCase() === 'RUNNING' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {`Last run: ${style.label}${at ? ` ${formatTime(at)}` : ''}`}
    </span>
  );
};

export const WorkflowsPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeOrganization, activeRole } = useAuth();
  const { showSuccess, showError, showWarning, showInfo, confirm } = useToast();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Prompt-first hero
  const [heroPrompt, setHeroPrompt] = useState<string>('');
  const [templates, setTemplates] = useState<AIWorkflowTemplate[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(false);
  const heroInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newWorkflowName, setNewWorkflowName] = useState<string>('');
  const [newWorkflowDesc, setNewWorkflowDesc] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit Modal
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editDesc, setEditDesc] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  // Run Modal
  const [runningWorkflow, setRunningWorkflow] = useState<Workflow | null>(null);
  const [runPayload, setRunPayload] = useState<string>('{}');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runSuccessMsg, setRunSuccessMsg] = useState<string | null>(null);
  const [runErrorMsg, setRunErrorMsg] = useState<string | null>(null);

  // Overflow Menu State
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [actionWorkflowId, setActionWorkflowId] = useState<string | null>(null);

  const canEdit = useMemo(() => {
    return activeRole === 'OWNER' || activeRole === 'ADMIN' || activeRole === 'MANAGER';
  }, [activeRole]);

  const fetchWorkflows = useCallback(async () => {
    if (!activeOrganization) return;
    setIsLoading(true);
    setError(null);
    try {
      const filterOpts: any = {};
      if (statusFilter !== 'ALL') {
        filterOpts.status = statusFilter;
      }
      const data = await listWorkflows(activeOrganization.id, filterOpts);
      setWorkflows(data.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to load workflows.');
    } finally {
      setIsLoading(false);
    }
  }, [activeOrganization, statusFilter]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Templates are a nice-to-have: if they cannot load, the row simply does not appear.
  useEffect(() => {
    if (!activeOrganization) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => getAITemplates(activeOrganization.id))
      .then((items) => {
        if (!cancelled) setTemplates(Array.isArray(items) ? items.slice(0, 6) : []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganization]);

  const startAIBuild = (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    navigate('/workflows/new/ai', { state: { prompt: text } });
  };

  // Close overflow menu on outside click
  useEffect(() => {
    const handleDocClick = () => setOpenMenuId(null);
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganization || !newWorkflowName.trim()) return;

    setIsCreating(true);
    setCreateError(null);

    try {
      const payload: WorkflowCreateRequest = {
        name: newWorkflowName.trim(),
        description: newWorkflowDesc.trim() || undefined,
      };
      const created = await createWorkflow(activeOrganization.id, payload);
      setIsModalOpen(false);
      setNewWorkflowName('');
      setNewWorkflowDesc('');
      navigate(`/workflows/${created.id}`);
    } catch (err: any) {
      setCreateError(err?.response?.data?.detail || err.message || 'Failed to create workflow.');
      setIsCreating(false);
    }
  };

  const handleUpdateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganization || !editingWorkflow || !editName.trim()) return;
    setIsUpdating(true);
    try {
      const updated = await updateWorkflow(activeOrganization.id, editingWorkflow.id, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
      });
      setWorkflows((prev) => prev.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)));
      setEditingWorkflow(null);
      showSuccess(`Workflow "${updated.name}" updated successfully.`);
    } catch (err: any) {
      showError(err.message || 'Failed to update workflow metadata.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleTriggerRun = async () => {
    if (!activeOrganization || !runningWorkflow) return;
    setIsRunning(true);
    setRunErrorMsg(null);
    setRunSuccessMsg(null);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(runPayload);
      } catch {
        throw new Error('Invalid JSON format in trigger payload');
      }

      const res = await triggerExecution(activeOrganization.id, runningWorkflow.id, parsedPayload);
      setRunSuccessMsg(`Execution triggered successfully! Correlation ID: ${res.correlation_id}`);
      showSuccess(`Execution dispatched for "${runningWorkflow.name}". Correlation ID: ${res.correlation_id}`);
      setTimeout(() => {
        setRunningWorkflow(null);
        setRunSuccessMsg(null);
        navigate(`/executions?search=${encodeURIComponent(res.correlation_id)}`);
      }, 1200);
    } catch (err: any) {
      setRunErrorMsg(err.message || 'Failed to trigger workflow run.');
      showError(err.message || 'Failed to trigger workflow run.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleToggleStatus = async (wf: Workflow) => {
    if (!activeOrganization || !canEdit) return;

    // Check if activating a workflow that has no active published version
    if (wf.status !== WorkflowStatus.ACTIVE && !wf.active_version_id) {
      showWarning(
        `"${wf.name}" is currently in draft and cannot be activated without a published version. Open the Visual Editor and click "Publish Version" first.`,
        'Published Version Required',
        {
          label: 'Open Visual Editor',
          onClick: () => navigate(`/workflows/${wf.id}`),
        }
      );
      return;
    }

    setActionWorkflowId(wf.id);
    try {
      if (wf.status === WorkflowStatus.ACTIVE) {
        await disableWorkflow(activeOrganization.id, wf.id);
        showInfo(`"${wf.name}" is now paused. No new executions will be scheduled.`, 'Workflow Paused');
      } else {
        await enableWorkflow(activeOrganization.id, wf.id);
        showSuccess(`"${wf.name}" has been activated successfully.`, 'Workflow Activated');
      }
      await fetchWorkflows();
    } catch (err: any) {
      showError(err.message || 'Status toggle failed.', 'Action Failed');
    } finally {
      setActionWorkflowId(null);
    }
  };

  const handleArchive = (wf: Workflow) => {
    if (!activeOrganization || !canEdit) return;

    confirm({
      title: 'Archive Workflow',
      message: `Are you sure you want to archive "${wf.name}"? Active triggers will be paused, while version history and execution records will be preserved.`,
      confirmLabel: 'Archive Workflow',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: async () => {
        setActionWorkflowId(wf.id);
        try {
          await archiveWorkflow(activeOrganization.id, wf.id);
          showSuccess(`Workflow "${wf.name}" has been archived.`, 'Archived');
          await fetchWorkflows();
        } catch (err: any) {
          showError(err.message || 'Failed to archive workflow.', 'Archive Failed');
        } finally {
          setActionWorkflowId(null);
        }
      },
    });
  };

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((wf) => {
      const matchesSearch =
        wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (wf.description && wf.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesSearch;
    });
  }, [workflows, searchQuery]);

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return 'Never';
    try {
      const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      return `${Math.floor(diffHrs / 24)}d ago`;
    } catch {
      return isoString;
    }
  };

  const STATUS_LABEL: Record<string, { label: string; dot: string }> = {
    [WorkflowStatus.ACTIVE]: { label: 'Live', dot: 'bg-emerald-500' },
    [WorkflowStatus.DRAFT]: { label: 'Draft', dot: 'bg-amber-500' },
    [WorkflowStatus.PAUSED]: { label: 'Paused', dot: 'bg-warm-400 dark:bg-charcoal-500' },
    [WorkflowStatus.ARCHIVED]: { label: 'Archived', dot: 'bg-warm-400 dark:bg-charcoal-500' },
  };

  const FILTER_TABS: { id: string; label: string }[] = [
    { id: 'ALL', label: 'All' },
    { id: 'ACTIVE', label: 'Active' },
    { id: 'DRAFT', label: 'Draft' },
    { id: 'ARCHIVED', label: 'Archived' },
  ];

  const menuItem =
    'w-full flex items-center gap-2 px-3 py-1.5 text-left text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition';

  const showTemplates = templatesOpen;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Title */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 dark:text-charcoal-100 tracking-tight">Workflows</h1>
          <p className="text-sm text-warm-600 dark:text-charcoal-400 mt-1">
            Describe a process in plain English, review the steps, and turn it on when you are ready.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-850 transition cursor-pointer flex-shrink-0"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New Workflow</span>
          </button>
        )}
      </header>

      {/* Prompt */}
      {canEdit && (
        <section aria-labelledby="ai-hero-heading" className="mt-8">
          <h2 id="ai-hero-heading" className="text-base font-medium text-warm-900 dark:text-charcoal-100">
            What do you want to automate?
          </h2>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              startAIBuild(heroPrompt);
            }}
            className="mt-3"
          >
            <div className="relative rounded-2xl border border-warm-300 dark:border-charcoal-700 bg-white dark:bg-charcoal-900 focus-within:border-brand-600 dark:focus-within:border-brand-500 transition-colors">
              <label htmlFor="hero-prompt" className="sr-only">
                What do you want to automate?
              </label>
              <textarea
                id="hero-prompt"
                ref={heroInputRef}
                rows={2}
                value={heroPrompt}
                onChange={(e) => setHeroPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    startAIBuild(heroPrompt);
                  }
                }}
                placeholder="e.g. When a customer emails us, draft a reply for my approval"
                className="w-full resize-none bg-transparent pl-4 pr-14 py-3.5 text-sm text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Build with AI"
                title="Build with AI"
                disabled={!heroPrompt.trim()}
                className="absolute right-2.5 bottom-2.5 w-9 h-9 rounded-xl bg-brand-600 hover:bg-brand-700 dark:hover:bg-brand-500 dark:hover:bg-brand-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                <ArrowUp className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-xs text-warm-500 dark:text-charcoal-400">
              Nothing runs until you turn it on. Enter to build, Shift+Enter for a new line.
            </p>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Example ideas">
            <span className="text-xs text-warm-500 dark:text-charcoal-400">Try:</span>
            {EXAMPLE_IDEAS.map((idea) => (
              <button
                key={idea.label}
                type="button"
                title={idea.prompt}
                onClick={() => {
                  setHeroPrompt(idea.prompt);
                  heroInputRef.current?.focus();
                }}
                className="text-xs px-3 py-1.5 rounded-full border border-warm-300 dark:border-charcoal-700 text-warm-700 dark:text-charcoal-300 hover:border-brand-500 hover:text-brand-700 dark:hover:text-brand-400 transition cursor-pointer"
              >
                {idea.label}
              </button>
            ))}
            {templates.length > 0 && (
              <button
                type="button"
                onClick={() => setTemplatesOpen((v) => !v)}
                aria-expanded={templatesOpen}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline cursor-pointer"
              >
                <span>{templatesOpen ? 'Hide templates' : 'More templates'}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${templatesOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
            )}
          </div>

          {templates.length > 0 && showTemplates && (
            <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
              {templates.map((t) => (
                <li key={t.id} className="border-t border-warm-200 dark:border-charcoal-800">
                  <button
                    type="button"
                    onClick={() => startAIBuild(t.prompt)}
                    className="w-full text-left py-3 group cursor-pointer"
                  >
                    <span className="block text-sm font-medium text-warm-900 dark:text-charcoal-100 group-hover:text-brand-700 dark:group-hover:text-brand-400 transition">
                      {t.title}
                    </span>
                    <span className="block text-xs text-warm-600 dark:text-charcoal-400 mt-0.5 truncate">
                      {t.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Your workflows */}
      <section className="mt-12" aria-label="Your workflows">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-warm-200 dark:border-charcoal-800">
          <div className="flex items-center gap-5 overflow-x-auto -mb-px">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                aria-pressed={statusFilter === tab.id}
                className={`pb-3 text-sm font-medium border-b-2 transition whitespace-nowrap cursor-pointer ${
                  statusFilter === tab.id
                    ? 'border-brand-600 text-warm-900 dark:border-brand-500 dark:text-charcoal-100'
                    : 'border-transparent text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative sm:w-80 pb-3">
            <Search className="w-4 h-4 absolute left-0 top-[11px] text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search workflows by name or description..."
              aria-label="Search workflows"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-6 pr-2 py-1.5 bg-transparent text-sm text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none"
            />
          </div>
        </div>

        {isLoading ? (
          <ul className="divide-y divide-warm-200 dark:divide-charcoal-800" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <li key={i} className="py-5 animate-pulse">
                <div className="h-4 bg-warm-200 dark:bg-charcoal-800 rounded w-1/4 mb-2" />
                <div className="h-3 bg-warm-100 dark:bg-charcoal-850 rounded w-1/2" />
              </li>
            ))}
          </ul>
        ) : error ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
            <button
              type="button"
              onClick={fetchWorkflows}
              className="px-4 py-2 text-sm font-medium rounded-lg text-warm-800 dark:text-charcoal-200 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
            >
              Retry Loading
            </button>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="py-14 text-center space-y-2">
            <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">No workflows found</h3>
            <p className="text-sm text-warm-600 dark:text-charcoal-400 max-w-sm mx-auto">
              {searchQuery
                ? `No workflows matched "${searchQuery}". Try adjusting your search query.`
                : canEdit
                ? 'Describe your first automation above, or pick a template.'
                : 'No workflows have been created yet.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-warm-200 dark:divide-charcoal-800">
            {filteredWorkflows.map((wf) => {
              const status = STATUS_LABEL[wf.status] ?? { label: wf.status, dot: 'bg-warm-400' };
              return (
                <li
                  key={wf.id}
                  className="py-4 flex flex-col md:flex-row md:items-center gap-x-6 gap-y-2"
                >
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/workflows/${wf.id}`)}
                      className="max-w-full text-left text-sm font-semibold text-warm-900 dark:text-charcoal-100 hover:text-brand-700 dark:hover:text-brand-400 transition truncate cursor-pointer"
                    >
                      {wf.name}
                    </button>
                    <p className="text-sm text-warm-600 dark:text-charcoal-400 truncate">
                      {wf.description || 'No description'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-warm-600 dark:text-charcoal-400">
                    <span className="inline-flex items-center gap-1.5 font-medium text-warm-800 dark:text-charcoal-200">
                      <span className={`w-2 h-2 rounded-full ${status.dot}`} aria-hidden="true" />
                      {status.label}
                      {wf.active_version && (
                        <span className="font-mono font-normal text-warm-500 dark:text-charcoal-400">
                          v{wf.active_version.version_number}
                        </span>
                      )}
                    </span>
                    <LastRunPill status={wf.last_run_status} at={wf.last_run_at} formatTime={formatRelativeTime} />
                    <span>Updated {formatRelativeTime(wf.updated_at)}</span>
                  </div>

                  <div className="flex items-center gap-1 md:justify-end md:w-40">
                    {canEdit && wf.status === WorkflowStatus.ACTIVE && (
                      <button
                        type="button"
                        onClick={() => {
                          setRunningWorkflow(wf);
                          setRunPayload('{\n  "source": "manual_trigger",\n  "timestamp": "' + new Date().toISOString() + '"\n}');
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition cursor-pointer"
                        title="Trigger execution"
                      >
                        <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                        <span>Run</span>
                      </button>
                    )}

                    {canEdit && wf.status !== WorkflowStatus.ARCHIVED && (
                      <button
                        type="button"
                        disabled={actionWorkflowId === wf.id}
                        onClick={() => handleToggleStatus(wf)}
                        className="p-2 rounded-lg text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-850 transition cursor-pointer"
                        title={
                          wf.status === WorkflowStatus.ACTIVE
                            ? 'Pause Workflow'
                            : wf.active_version_id
                            ? 'Activate Workflow'
                            : 'Draft Workflow (Open visual editor to publish version 1.0)'
                        }
                        aria-label={wf.status === WorkflowStatus.ACTIVE ? 'Pause Workflow' : 'Activate Workflow'}
                      >
                        {actionWorkflowId === wf.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : wf.status === WorkflowStatus.ACTIVE ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                    )}

                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Workflow options"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === wf.id ? null : wf.id);
                        }}
                        className="p-2 rounded-lg text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-850 transition cursor-pointer"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {openMenuId === wf.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 mt-1 w-48 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-elevated py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              navigate(`/workflows/${wf.id}`);
                            }}
                            className={menuItem}
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>Open Visual Editor</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              navigate(`/executions?search=${encodeURIComponent(wf.name)}`);
                            }}
                            className={menuItem}
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>View Executions</span>
                          </button>

                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                setEditingWorkflow(wf);
                                setEditName(wf.name);
                                setEditDesc(wf.description || '');
                              }}
                              className={menuItem}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Edit Details</span>
                            </button>
                          )}

                          {canEdit && wf.status !== WorkflowStatus.ARCHIVED && (
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                handleToggleStatus(wf);
                              }}
                              className={menuItem}
                            >
                              {wf.status === WorkflowStatus.ACTIVE ? (
                                <>
                                  <Pause className="w-3.5 h-3.5 text-amber-500" />
                                  <span>Pause Workflow</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-3.5 h-3.5 text-brand-500" />
                                  <span>Activate Workflow</span>
                                </>
                              )}
                            </button>
                          )}

                          {canEdit && wf.status !== WorkflowStatus.ARCHIVED && (
                            <>
                              <div className="border-t border-warm-200 dark:border-charcoal-800 my-1" />
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handleArchive(wf);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition"
                              >
                                <Archive className="w-3.5 h-3.5" />
                                <span>Archive Workflow</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* New Workflow Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl p-4 sm:p-6 shadow-modal space-y-4 sm:space-y-5 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-base font-bold text-warm-900 dark:text-charcoal-100 tracking-tight">
                Create New Workflow
              </h2>
              <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-1">
                Initialize a new DAG workflow. You can design its nodes and triggers in the visual editor.
              </p>
            </div>

            {createError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-xl text-xs text-red-700 dark:text-red-300">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateWorkflow} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-warm-800 dark:text-charcoal-200 mb-1.5">
                  Workflow Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inbound Lead Qualification"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none focus:border-brand-600 dark:focus:border-brand-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-warm-800 dark:text-charcoal-200 mb-1.5">
                  Description <span className="text-warm-500 dark:text-charcoal-500 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe the workflow purpose, triggers, and expected outcomes..."
                  value={newWorkflowDesc}
                  onChange={(e) => setNewWorkflowDesc(e.target.value)}
                  className="w-full px-3.5 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none focus:border-brand-600 dark:focus:border-brand-500 transition-all resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-warm-200 dark:border-charcoal-800">
                <button
                  type="button"
                  disabled={isCreating}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newWorkflowName.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 dark:hover:bg-brand-500 dark:hover:bg-brand-600 text-white text-xs font-semibold shadow-subtle transition disabled:opacity-50 cursor-pointer"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create &amp; Open Editor</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Details Modal */}
      {editingWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl p-5 shadow-modal space-y-4">
            <div className="flex items-center justify-between border-b border-warm-200 dark:border-charcoal-800 pb-3">
              <h2 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">
                Edit Workflow Metadata
              </h2>
              <button
                type="button"
                onClick={() => setEditingWorkflow(null)}
                className="text-warm-400 hover:text-warm-700 dark:hover:text-charcoal-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateWorkflow} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-warm-800 dark:text-charcoal-200 mb-1">
                  Workflow Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 rounded-lg text-xs text-warm-900 dark:text-charcoal-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-warm-800 dark:text-charcoal-200 mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-warm-200 dark:border-charcoal-800">
                <button
                  type="button"
                  onClick={() => setEditingWorkflow(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-warm-600 dark:text-charcoal-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold"
                >
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Trigger Run Modal */}
      {runningWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl p-5 shadow-modal space-y-4">
            <div className="flex items-center justify-between border-b border-warm-200 dark:border-charcoal-800 pb-3">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-brand-600 dark:text-brand-400 fill-current" />
                <h2 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">
                  Trigger Execution: {runningWorkflow.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRunningWorkflow(null)}
                className="text-warm-400 hover:text-warm-700 dark:hover:text-charcoal-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {runErrorMsg && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-xl text-xs text-red-700 dark:text-red-300">
                {runErrorMsg}
              </div>
            )}
            {runSuccessMsg && (
              <div className="p-3 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800/40 rounded-xl text-xs text-brand-700 dark:text-brand-300">
                {runSuccessMsg}
              </div>
            )}

            <div>
              <label className="flex items-center justify-between text-xs font-semibold text-warm-800 dark:text-charcoal-200 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400" />
                  <span>Trigger Payload (JSON)</span>
                </span>
                <span className="text-[10px] font-mono text-warm-500 dark:text-charcoal-400">
                  Passed to trigger step
                </span>
              </label>
              <textarea
                rows={6}
                value={runPayload}
                onChange={(e) => setRunPayload(e.target.value)}
                className="w-full p-3 bg-warm-50 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-xl text-xs font-mono text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600 dark:focus:border-brand-500 transition-all resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-warm-200 dark:border-charcoal-800">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setRunningWorkflow(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRunning}
                onClick={handleTriggerRun}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-subtle transition disabled:opacity-50"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Triggering...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Execute Workflow</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
