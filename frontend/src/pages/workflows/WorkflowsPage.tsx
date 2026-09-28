import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Layers,
  Pause,
  Play,
  Archive,
  ArrowRight,
  Loader2,
  CheckCircle2,
  MoreVertical,
  Sliders,
  History,
  Clock,
  Terminal,
  X,
  Edit2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  listWorkflows,
  createWorkflow,
  archiveWorkflow,
  enableWorkflow,
  disableWorkflow,
  updateWorkflow,
} from '../../services/workflowService';
import { triggerExecution } from '../../services/executionService';
import { Workflow, WorkflowStatus, WorkflowCreateRequest } from '../../types/workflow';
import { StatusBadge } from '../../components/ui/StatusBadge';

export const WorkflowsPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeOrganization, activeRole } = useAuth();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to update workflow metadata.');
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
      setTimeout(() => {
        setRunningWorkflow(null);
        setRunSuccessMsg(null);
        navigate(`/executions?search=${encodeURIComponent(res.correlation_id)}`);
      }, 1200);
    } catch (err: any) {
      setRunErrorMsg(err?.response?.data?.detail || err.message || 'Failed to trigger workflow run.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleToggleStatus = async (wf: Workflow) => {
    if (!activeOrganization || !canEdit) return;
    setActionWorkflowId(wf.id);
    try {
      if (wf.status === WorkflowStatus.ACTIVE) {
        await disableWorkflow(activeOrganization.id, wf.id);
      } else {
        await enableWorkflow(activeOrganization.id, wf.id);
      }
      await fetchWorkflows();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Status toggle failed.');
    } finally {
      setActionWorkflowId(null);
    }
  };

  const handleArchive = async (wf: Workflow) => {
    if (!activeOrganization || !canEdit) return;
    if (!window.confirm(`Are you sure you want to archive "${wf.name}"?`)) return;

    setActionWorkflowId(wf.id);
    try {
      await archiveWorkflow(activeOrganization.id, wf.id);
      await fetchWorkflows();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to archive workflow.');
    } finally {
      setActionWorkflowId(null);
    }
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

  return (
    <div className="space-y-6">
      {/* Top Header & Overview */}
      <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-brand-700 dark:text-brand-400 uppercase tracking-wider">
              Control Plane
            </span>
            <span className="text-warm-400 dark:text-charcoal-600">&bull;</span>
            <span className="text-xs text-warm-600 dark:text-charcoal-400">
              {activeOrganization?.name || 'Workspace'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-warm-900 dark:text-charcoal-100 tracking-tight mt-1">
            Workflow Orchestration
          </h1>
          <p className="text-xs sm:text-sm text-warm-600 dark:text-charcoal-400 mt-1 max-w-xl">
            Design deterministic automation pipelines with validation, AI classification, and human approvals.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white text-xs font-semibold shadow-subtle transition-all cursor-pointer flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Workflow</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-warm-500 dark:text-charcoal-400" />
          <input
            type="text"
            placeholder="Search workflows by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-xl text-xs text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none focus:border-brand-600 dark:focus:border-brand-500 transition-all shadow-2xs"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center p-1 bg-warm-200/80 dark:bg-charcoal-850 rounded-xl border border-warm-300 dark:border-charcoal-750 self-start sm:self-auto overflow-x-auto">
          {['ALL', 'ACTIVE', 'DRAFT', 'ARCHIVED'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === tab
                  ? 'bg-white dark:bg-charcoal-750 text-warm-900 dark:text-charcoal-100 shadow-2xs'
                  : 'text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Workflows List / Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-56 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 p-5 animate-pulse"
            >
              <div className="h-4 bg-warm-200 dark:bg-charcoal-800 rounded w-1/3 mb-3"></div>
              <div className="h-6 bg-warm-200 dark:bg-charcoal-800 rounded w-2/3 mb-4"></div>
              <div className="h-12 bg-warm-100 dark:bg-charcoal-850 rounded w-full mb-4"></div>
              <div className="h-4 bg-warm-200 dark:bg-charcoal-800 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center rounded-2xl bg-white dark:bg-charcoal-900 border border-red-200 dark:border-red-900/50 shadow-subtle space-y-3">
          <p className="text-xs text-red-600 dark:text-red-400 font-semibold">{error}</p>
          <button
            type="button"
            onClick={fetchWorkflows}
            className="px-4 py-2 bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-700 text-xs font-medium rounded-xl text-warm-800 dark:text-charcoal-200 transition"
          >
            Retry Loading
          </button>
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-warm-100 dark:bg-charcoal-800 border border-warm-200 dark:border-charcoal-700 flex items-center justify-center text-warm-500 dark:text-charcoal-400 mx-auto">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">
            No workflows found
          </h3>
          <p className="text-xs text-warm-600 dark:text-charcoal-400 max-w-sm mx-auto">
            {searchQuery
              ? `No workflows matched "${searchQuery}". Try adjusting your search query.`
              : 'Create your first workflow to orchestrate business actions and approval gates.'}
          </p>
          {canEdit && !searchQuery && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white text-xs font-semibold shadow-subtle transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Workflow</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkflows.map((wf) => (
            <div
              key={wf.id}
              className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle hover:border-warm-400 dark:hover:border-charcoal-600 transition-all flex flex-col justify-between group relative"
            >
              <div>
                {/* Header & Status */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={wf.status} size="sm" />
                    {wf.active_version ? (
                      <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md bg-warm-100 dark:bg-charcoal-850 text-brand-700 dark:text-brand-400 border border-warm-200 dark:border-charcoal-750">
                        <CheckCircle2 className="w-3 h-3 text-brand-600 dark:text-brand-500" />
                        Active: v{wf.active_version.version_number}
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-warm-100 dark:bg-charcoal-850 text-warm-600 dark:text-charcoal-400 border border-warm-200 dark:border-charcoal-750">
                        Draft v1
                      </span>
                    )}
                  </div>

                  {/* Overflow Action Menu */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Workflow options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === wf.id ? null : wf.id);
                      }}
                      className="p-1 rounded-lg text-warm-500 hover:text-warm-800 dark:text-charcoal-400 dark:hover:text-charcoal-200 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {openMenuId === wf.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 mt-1 w-44 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-elevated py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            navigate(`/workflows/${wf.id}`);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
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
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
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
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
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
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
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
                          <div className="border-t border-warm-200 dark:border-charcoal-800 my-1" />
                        )}

                        {canEdit && wf.status !== WorkflowStatus.ARCHIVED && (
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
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Workflow Title & Desc */}
                <h3
                  onClick={() => navigate(`/workflows/${wf.id}`)}
                  className="text-sm font-bold text-warm-900 dark:text-charcoal-100 tracking-tight cursor-pointer hover:text-brand-600 dark:hover:text-brand-400 transition"
                >
                  {wf.name}
                </h3>
                <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-1 line-clamp-2 leading-relaxed min-h-[2rem]">
                  {wf.description || 'No description configured for this workflow.'}
                </p>

                {/* Metadata Pills */}
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-warm-200 dark:border-charcoal-800 text-[11px] text-warm-600 dark:text-charcoal-400">
                  <span className="flex items-center gap-1.5 bg-warm-100 dark:bg-charcoal-850 px-2 py-0.5 rounded-md border border-warm-200 dark:border-charcoal-750 text-warm-700 dark:text-charcoal-300">
                    <Layers className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400" />
                    {wf.version_count || 1} {wf.version_count === 1 ? 'version' : 'versions'}
                  </span>

                  <span className="flex items-center gap-1 bg-warm-100 dark:bg-charcoal-850 px-2 py-0.5 rounded-md border border-warm-200 dark:border-charcoal-750 text-warm-600 dark:text-charcoal-400">
                    <Clock className="w-3 h-3" />
                    Updated {formatRelativeTime(wf.updated_at)}
                  </span>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="flex items-center justify-between mt-5 pt-3 border-t border-warm-200 dark:border-charcoal-800">
                <button
                  type="button"
                  onClick={() => navigate(`/workflows/${wf.id}`)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 transition cursor-pointer"
                >
                  <span>Open Visual Editor</span>
                  <ArrowRight className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition-transform" />
                </button>

                <div className="flex items-center gap-1.5">
                  {canEdit && wf.status === WorkflowStatus.ACTIVE && (
                    <button
                      type="button"
                      onClick={() => {
                        setRunningWorkflow(wf);
                        setRunPayload('{\n  "source": "manual_trigger",\n  "timestamp": "' + new Date().toISOString() + '"\n}');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/40 dark:hover:bg-brand-900/50 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                      title="Trigger execution"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Run</span>
                    </button>
                  )}

                  {canEdit && wf.status !== WorkflowStatus.ARCHIVED && (
                    <button
                      type="button"
                      disabled={actionWorkflowId === wf.id}
                      onClick={() => handleToggleStatus(wf)}
                      className={`p-1.5 rounded-lg border transition cursor-pointer ${
                        wf.status === WorkflowStatus.ACTIVE
                          ? 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                          : 'border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30'
                      }`}
                      title={wf.status === WorkflowStatus.ACTIVE ? 'Pause Workflow' : 'Activate Workflow'}
                    >
                      {wf.status === WorkflowStatus.ACTIVE ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white text-xs font-semibold shadow-subtle transition disabled:opacity-50 cursor-pointer"
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
