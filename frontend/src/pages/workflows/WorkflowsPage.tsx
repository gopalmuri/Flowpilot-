import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GitBranch,
  Plus,
  Search,
  Layers,
  ArrowRight,
  Play,
  Pause,
  Archive,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Workflow, WorkflowStatus } from '../../types/workflow';
import {
  listWorkflows,
  createWorkflow,
  enableWorkflow,
  disableWorkflow,
  archiveWorkflow,
} from '../../services/workflowService';

export const WorkflowsPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeOrganization, activeRole } = useAuth();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Creation Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newWorkflowName, setNewWorkflowName] = useState<string>('');
  const [newWorkflowDesc, setNewWorkflowDesc] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Action Loading
  const [actionWorkflowId, setActionWorkflowId] = useState<string | null>(null);

  const canEdit = activeRole === 'MANAGER' || activeRole === 'ADMIN' || activeRole === 'OWNER';

  const fetchWorkflows = async () => {
    if (!activeOrganization?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await listWorkflows(activeOrganization.id, {
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
      });
      setWorkflows(data.items || []);
    } catch (err: any) {
      console.error('Failed to load workflows:', err);
      setError(err?.response?.data?.detail || err.message || 'Failed to load workflows');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, [activeOrganization?.id, statusFilter]);

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((wf) => {
      const matchesSearch =
        wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (wf.description && wf.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesSearch;
    });
  }, [workflows, searchQuery]);

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganization?.id || !newWorkflowName.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await createWorkflow(activeOrganization.id, {
        name: newWorkflowName.trim(),
        description: newWorkflowDesc.trim() || undefined,
      });
      setIsModalOpen(false);
      setNewWorkflowName('');
      setNewWorkflowDesc('');
      navigate(`/workflows/${created.id}`);
    } catch (err: any) {
      setCreateError(err?.response?.data?.detail || err.message || 'Failed to create workflow');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleStatus = async (wf: Workflow) => {
    if (!activeOrganization?.id || !canEdit) return;
    setActionWorkflowId(wf.id);
    try {
      if (wf.status === WorkflowStatus.ACTIVE) {
        await disableWorkflow(activeOrganization.id, wf.id);
      } else {
        await enableWorkflow(activeOrganization.id, wf.id);
      }
      await fetchWorkflows();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to update workflow status');
    } finally {
      setActionWorkflowId(null);
    }
  };

  const handleArchive = async (wf: Workflow) => {
    if (!activeOrganization?.id || !canEdit) return;
    if (!window.confirm(`Are you sure you want to archive '${wf.name}'?`)) return;

    setActionWorkflowId(wf.id);
    try {
      await archiveWorkflow(activeOrganization.id, wf.id);
      await fetchWorkflows();
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to archive workflow');
    } finally {
      setActionWorkflowId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case WorkflowStatus.ACTIVE:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            ACTIVE
          </span>
        );
      case WorkflowStatus.PAUSED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/25">
            PAUSED
          </span>
        );
      case WorkflowStatus.ARCHIVED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            ARCHIVED
          </span>
        );
      case WorkflowStatus.DRAFT:
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
            DRAFT
          </span>
        );
    }
  };

  const filterTabs = [
    { key: 'ALL', label: 'All Workflows' },
    { key: 'ACTIVE', label: 'ACTIVE' },
    { key: 'PAUSED', label: 'PAUSED' },
    { key: 'DRAFT', label: 'DRAFT' },
    { key: 'ARCHIVED', label: 'ARCHIVED' },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400">
              <GitBranch className="w-4 h-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Workflow Orchestration
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Build, test, and deploy automated event-driven DAG workflows across your enterprise stack.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Workflow</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-2 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm backdrop-blur-sm">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
          {filterTabs.map((tab) => {
            const isSelected = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search workflows by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-1.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Content Area */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-16 rounded-2xl bg-slate-900/40 border border-slate-800/80">
          <Loader2 className="w-7 h-7 text-indigo-400 animate-spin mb-3" />
          <p className="text-xs text-slate-400">Loading enterprise workflows...</p>
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchWorkflows}
            className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium transition"
          >
            Retry
          </button>
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="text-center p-16 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-400 mx-auto">
            <GitBranch className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-200">No workflows found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            {searchQuery
              ? 'No workflows match your search query. Try adjusting your search or status filter.'
              : 'Create your first workflow to orchestrate automated events and business processes.'}
          </p>
          {canEdit && !searchQuery && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Workflow</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkflows.map((wf) => (
            <div
              key={wf.id}
              className="group relative flex flex-col justify-between p-5 rounded-2xl bg-slate-900/75 border border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-900 transition-all duration-200 shadow-sm text-left"
            >
              <div>
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate group-hover:text-indigo-300 transition-colors">
                      {wf.name}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mt-1 min-h-[32px]">
                      {wf.description || 'No description provided'}
                    </p>
                  </div>
                  <div>{getStatusBadge(wf.status)}</div>
                </div>

                {/* Metadata Pills */}
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded-lg border border-slate-800 text-slate-300">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    {wf.version_count || 1} {wf.version_count === 1 ? 'version' : 'versions'}
                  </span>
                  {wf.active_version && (
                    <span className="flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded-lg border border-slate-800 text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Active: v{wf.active_version.version_number}
                    </span>
                  )}
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-800/60">
                <button
                  type="button"
                  onClick={() => navigate(`/workflows/${wf.id}`)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                >
                  <span>Open Visual Editor</span>
                  <ArrowRight className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition-transform" />
                </button>

                {canEdit && wf.status !== WorkflowStatus.ARCHIVED && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={actionWorkflowId === wf.id}
                      onClick={() => handleToggleStatus(wf)}
                      className={`p-1.5 rounded-lg border transition cursor-pointer ${
                        wf.status === WorkflowStatus.ACTIVE
                          ? 'border-amber-500/20 text-amber-400 hover:bg-amber-500/10'
                          : 'border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10'
                      }`}
                      title={wf.status === WorkflowStatus.ACTIVE ? 'Pause Workflow' : 'Activate Workflow'}
                    >
                      {wf.status === WorkflowStatus.ACTIVE ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={actionWorkflowId === wf.id}
                      onClick={() => handleArchive(wf)}
                      className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                      title="Archive Workflow"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Workflow Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Create New Workflow</h2>
              <p className="text-xs text-slate-400 mt-1">
                Initialize a new DAG workflow. You can design its nodes and triggers in the visual editor.
              </p>
            </div>

            {createError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateWorkflow} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Workflow Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inbound Lead Qualification"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Description <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe the workflow purpose, triggers, and expected outcomes..."
                  value={newWorkflowDesc}
                  onChange={(e) => setNewWorkflowDesc(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  disabled={isCreating}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newWorkflowName.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition disabled:opacity-50 cursor-pointer"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create & Open Editor</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
