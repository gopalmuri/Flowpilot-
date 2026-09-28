import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Layers,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PauseCircle,
  Ban,
  Eye,
  Filter,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStatus,
} from '../../types/execution';
import {
  listExecutions,
  getExecutionDetail,
  cancelExecution,
  ExecutionFilterOptions,
} from '../../services/executionService';
import { ExecutionTimelineDrawer } from '../../components/executions/ExecutionTimelineDrawer';

const STATUS_FILTERS: { label: string; value: WorkflowRunStatus | 'ALL' }[] = [
  { label: 'All Statuses', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Running', value: 'RUNNING' },
  { label: 'Paused', value: 'PAUSED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const TRIGGER_OPTIONS = [
  { label: 'All Triggers', value: '' },
  { label: 'Manual', value: 'MANUAL' },
  { label: 'Webhook', value: 'WEBHOOK' },
  { label: 'Schedule', value: 'SCHEDULE' },
];

const DATE_RANGE_OPTIONS = [
  { label: 'All Time', value: 'ALL' },
  { label: 'Today', value: 'TODAY' },
  { label: 'Last 7 Days', value: '7D' },
  { label: 'Last 30 Days', value: '30D' },
];

export const ExecutionsPage: React.FC = () => {
  const { activeOrganization } = useAuth();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Read URL query parameters safely without requiring Router context
  const queryParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialStatusParam = queryParams.get('status') as WorkflowRunStatus | null;
  const initialSearchParam = queryParams.get('search') || queryParams.get('correlationId') || '';
  const initialWfIdParam = queryParams.get('workflowId') || '';
  const initialRunIdParam = queryParams.get('runId') || queryParams.get('executionId') || '';

  // Filters
  const [selectedStatus, setSelectedStatus] = useState<WorkflowRunStatus | 'ALL'>(
    initialStatusParam && ['PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(initialStatusParam)
      ? initialStatusParam
      : 'ALL'
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(initialWfIdParam);
  const [triggerType, setTriggerType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchParam);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearchParam.trim());
  const [dateRange, setDateRange] = useState<string>('ALL');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunDetail | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const pollingTimerRef = useRef<number | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Compute from_date based on selected date range
  const getDateRangeParams = useCallback(() => {
    if (dateRange === 'ALL') return {};
    const now = new Date();
    if (dateRange === 'TODAY') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { fromDate: today.toISOString() };
    }
    if (dateRange === '7D') {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { fromDate: past.toISOString() };
    }
    if (dateRange === '30D') {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { fromDate: past.toISOString() };
    }
    return {};
  }, [dateRange]);

  const fetchRuns = useCallback(
    async (showLoadingSpinner: boolean = false) => {
      if (!activeOrganization) return;
      if (showLoadingSpinner) setIsRefreshing(true);
      setError(null);

      try {
        const dateParams = getDateRangeParams();
        const options: ExecutionFilterOptions = {
          status: selectedStatus === 'ALL' ? undefined : selectedStatus,
          workflowId: selectedWorkflowId || undefined,
          triggerType: triggerType || undefined,
          search: debouncedSearch || undefined,
          fromDate: dateParams.fromDate,
          page,
          pageSize,
        };

        const res = await listExecutions(activeOrganization.id, options);
        setRuns(res.items || []);
        setTotal(res.total || 0);
        setTotalPages(res.total_pages || 1);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch workflow executions');
      } finally {
        setIsLoading(false);
        if (showLoadingSpinner) setIsRefreshing(false);
      }
    },
    [activeOrganization, selectedStatus, selectedWorkflowId, triggerType, debouncedSearch, getDateRangeParams, page, pageSize]
  );

  // Initial fetch and on filter/page change
  useEffect(() => {
    setIsLoading(true);
    fetchRuns(false);
  }, [fetchRuns]);

  // Open run detail drawer
  const handleOpenDetail = useCallback(async (runId: string) => {
    if (!activeOrganization) return;
    try {
      const detail = await getExecutionDetail(activeOrganization.id, runId);
      setSelectedRun(detail);
      setIsDrawerOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load execution details');
    }
  }, [activeOrganization]);

  // Deep-link auto-open execution drawer if initialRunIdParam exists
  useEffect(() => {
    if (initialRunIdParam && activeOrganization) {
      handleOpenDetail(initialRunIdParam);
    }
  }, [initialRunIdParam, activeOrganization, handleOpenDetail]);

  // Polling effect: Poll every 3 seconds if autoRefresh is enabled
  useEffect(() => {
    if (!autoRefresh || !activeOrganization) {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      return;
    }

    pollingTimerRef.current = window.setInterval(() => {
      fetchRuns(false);
    }, 3000);

    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, [autoRefresh, activeOrganization, fetchRuns]);

  // Cancel execution handler
  const handleCancelRun = async (runId: string) => {
    if (!activeOrganization) return;
    setIsCancelling(true);
    try {
      await cancelExecution(activeOrganization.id, runId);
      await fetchRuns(false);
      if (selectedRun && selectedRun.id === runId) {
        const detail = await getExecutionDetail(activeOrganization.id, runId);
        setSelectedRun(detail);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel execution');
    } finally {
      setIsCancelling(false);
    }
  };

  const copyToClipboard = (text: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const formatDuration = (run: WorkflowRun): string => {
    if (run.duration_ms !== undefined && run.duration_ms !== null) {
      if (run.duration_ms < 1000) return `${run.duration_ms}ms`;
      return `${(run.duration_ms / 1000).toFixed(2)}s`;
    }
    if (!run.started_at) return '-';
    const start = new Date(run.started_at).getTime();
    const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
    const diff = Math.max(0, end - start);
    if (diff < 1000) return `${diff}ms`;
    return `${(diff / 1000).toFixed(1)}s`;
  };

  const getStatusBadge = (status: WorkflowRunStatus) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:border-brand-800/60">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border-brand-300 dark:bg-brand-950/40 dark:text-brand-300 dark:border-brand-800/60 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Running
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60">
            <Clock className="w-3.5 h-3.5" />
            Pending
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
            <PauseCircle className="w-3.5 h-3.5" />
            Paused
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-warm-500 dark:text-charcoal-400 border border-slate-500/20">
            <Ban className="w-3.5 h-3.5" />
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-warm-200 dark:border-charcoal-750">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/50 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-700 dark:text-brand-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-warm-900 dark:text-charcoal-100 flex items-center gap-2">
              Execution Telemetry & History
            </h1>
            <p className="text-xs text-warm-500 dark:text-charcoal-400">
              Real-time execution monitoring, DAG step timelines, and historical audit trail
            </p>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-warm-500 dark:text-charcoal-400 cursor-pointer select-none bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 px-3 py-1.5 rounded-lg hover:border-warm-300 dark:hover:border-charcoal-700 transition">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-white dark:bg-charcoal-800 border-warm-300 dark:border-charcoal-750 text-brand-600 focus:ring-0 focus:ring-offset-0"
            />
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-brand-500 animate-pulse' : 'bg-warm-400 dark:bg-charcoal-600'}`} />
              Auto-refresh (3s)
            </span>
          </label>

          <button
            onClick={() => fetchRuns(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-warm-100 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-200 border border-warm-300 dark:border-charcoal-700 hover:bg-slate-700 transition disabled:opacity-50"
            title="Refresh runs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Tabs & Bar */}
      <div className="space-y-3">
        {/* Active Workflow Filter Badge if present */}
        {selectedWorkflowId && (
          <div className="flex items-center justify-between p-2.5 px-3.5 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 text-xs text-brand-900 dark:text-brand-300">
            <div className="flex items-center gap-2">
              <span className="font-medium">Filtered by Workflow:</span>
              <span className="font-mono bg-white dark:bg-charcoal-900 px-2 py-0.5 rounded border border-brand-300 dark:border-brand-800/80">
                {selectedWorkflowId}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedWorkflowId('');
                setPage(1);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear Filter</span>
            </button>
          </div>
        )}

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-warm-200 dark:border-charcoal-750">
          <Filter className="w-4 h-4 text-warm-400 dark:text-charcoal-500 shrink-0 ml-1 mr-1" />
          {STATUS_FILTERS.map((f) => {
            const isActive = selectedStatus === f.value;
            return (
              <button
                key={f.value}
                onClick={() => {
                  setSelectedStatus(f.value);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  isActive
                    ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60'
                    : 'text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:text-charcoal-200 hover:bg-warm-100 dark:bg-charcoal-800 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Search & Secondary Filters Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-white dark:bg-charcoal-900 p-3 rounded-xl border border-warm-200 dark:border-charcoal-750 shadow-subtle">
          {/* Search Input */}
          <div className="relative col-span-1 sm:col-span-2">
            <Search className="w-4 h-4 text-warm-500 dark:text-charcoal-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by correlation ID or workflow name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-lg text-xs text-warm-800 dark:text-charcoal-200 placeholder-warm-400 dark:placeholder-charcoal-500 focus:outline-none focus:border-brand-600 dark:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-warm-500 dark:text-charcoal-500 hover:text-warm-700 dark:text-charcoal-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Trigger Type Filter */}
          <div>
            <select
              value={triggerType}
              onChange={(e) => {
                setTriggerType(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-lg text-xs text-warm-700 dark:text-charcoal-300 focus:outline-none focus:border-brand-600 dark:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition"
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-white dark:bg-charcoal-900 text-warm-800 dark:text-charcoal-200">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-warm-500 dark:text-charcoal-400 shrink-0" />
            <select
              value={dateRange}
              onChange={(e) => {
                setDateRange(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 rounded-lg text-xs text-warm-700 dark:text-charcoal-300 focus:outline-none focus:border-brand-600 dark:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition"
            >
              {DATE_RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-white dark:bg-charcoal-900 text-warm-800 dark:text-charcoal-200">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800/40 dark:text-red-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchRuns(true)}
            className="underline font-semibold hover:text-red-900 dark:hover:text-red-200"
          >
            Retry
          </button>
        </div>
      )}

      {/* Table Container */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-charcoal-900 rounded-2xl border border-warm-200 dark:border-charcoal-750 shadow-subtle min-h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 dark:text-brand-400 mb-3" />
          <p className="text-xs text-warm-500 dark:text-charcoal-400 font-medium">Loading execution telemetry...</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-charcoal-900 rounded-2xl border border-warm-200 dark:border-charcoal-750 shadow-subtle min-h-[300px] text-center">
          <div className="w-12 h-12 rounded-2xl bg-warm-100 dark:bg-charcoal-800 flex items-center justify-center text-warm-400 dark:text-charcoal-500 mb-3 border border-warm-200 dark:border-charcoal-750">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">No Executions Found</h3>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 max-w-sm mt-1">
            {selectedStatus !== 'ALL' || debouncedSearch || triggerType || dateRange !== 'ALL' || selectedWorkflowId
              ? 'No execution records match the current filter criteria.'
              : 'Trigger a workflow manually or send an inbound webhook event to generate executions.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 rounded-2xl shadow-subtle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-warm-50 dark:bg-charcoal-850/80 border-b border-warm-200 dark:border-charcoal-750 text-warm-500 dark:text-charcoal-400 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Workflow & Correlation ID</th>
                  <th className="py-3 px-4">Trigger</th>
                  <th className="py-3 px-4">Started At</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-warm-700 dark:text-charcoal-300">
                {runs.map((r) => {
                  const canCancel = r.status === 'RUNNING' || r.status === 'PENDING' || r.status === 'PAUSED';
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-warm-50 dark:hover:bg-charcoal-850/50 transition cursor-pointer"
                      onClick={() => handleOpenDetail(r.id)}
                    >
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getStatusBadge(r.status)}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-warm-900 dark:text-charcoal-100">
                          {r.workflow_name || `Workflow ${r.workflow_id.slice(0, 8)}`}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-warm-500 dark:text-charcoal-400 font-mono mt-0.5">
                          <span title={r.correlation_id} className="truncate max-w-[180px]">
                            {r.correlation_id || r.id.slice(0, 8)}
                          </span>
                          {r.correlation_id && (
                            <button
                              onClick={(e) => copyToClipboard(r.correlation_id, r.id, e)}
                              className="text-warm-500 dark:text-charcoal-500 hover:text-warm-700 dark:text-charcoal-300 transition"
                              title="Copy Correlation ID"
                            >
                              {copiedId === r.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 uppercase text-[11px] font-medium text-warm-700 dark:text-charcoal-300">
                        <span className="px-2 py-0.5 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700/60 text-warm-700 dark:text-charcoal-300 text-[10px]">
                          {r.trigger_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-warm-500 dark:text-charcoal-400">
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap font-medium text-warm-700 dark:text-charcoal-300 font-mono">
                        {formatDuration(r)}
                      </td>
                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenDetail(r.id)}
                            className="p-1.5 rounded-lg text-warm-500 dark:text-charcoal-400 hover:text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:bg-brand-950/40 transition"
                            title="View Timeline"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canCancel && (
                            <button
                              onClick={() => handleCancelRun(r.id)}
                              disabled={isCancelling}
                              className="p-1.5 rounded-lg text-warm-500 dark:text-charcoal-400 hover:text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-50"
                              title="Cancel Execution"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {total > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-900/60 text-xs text-warm-500 dark:text-charcoal-400">
              <div>
                Showing <span className="text-warm-800 dark:text-charcoal-200 font-medium">{(page - 1) * pageSize + 1}</span> to{' '}
                <span className="text-warm-800 dark:text-charcoal-200 font-medium">{Math.min(page * pageSize, total)}</span> of{' '}
                <span className="text-warm-800 dark:text-charcoal-200 font-medium">{total}</span> executions
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span>Page size:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="bg-warm-50 dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded px-2 py-1 text-warm-800 dark:text-charcoal-200 focus:outline-none focus:border-brand-600 dark:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-1 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-warm-700 dark:text-charcoal-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono text-warm-800 dark:text-charcoal-200">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-warm-700 dark:text-charcoal-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="Next Page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Execution Timeline Drawer */}
      <ExecutionTimelineDrawer
        run={selectedRun}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onCancel={handleCancelRun}
        isCancelling={isCancelling}
      />
    </div>
  );
};
