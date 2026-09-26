import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Activity,
  AlertCircle,
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import {
  AnalyticsOverviewResponse,
  SLAMonitoringResponse,
  StepLatencyItem,
  TimeSeriesBucket,
  WorkflowPerformanceItem,
} from '../../types/analytics';
import {
  getAnalyticsOverview,
  getSLAMonitoring,
  getStepLatency,
  getTimeSeries,
  getWorkflowPerformance,
  toUtcIsoString,
} from '../../services/analyticsService';
import { listWorkflows } from '../../services/workflowService';
import { Workflow } from '../../types/workflow';
import { AnalyticsOverviewCards } from '../../components/analytics/AnalyticsOverviewCards';
import { ExecutionVolumeChart } from '../../components/analytics/ExecutionVolumeChart';
import { DurationTrendChart } from '../../components/analytics/DurationTrendChart';
import { WorkflowPerformanceTable } from '../../components/analytics/WorkflowPerformanceTable';
import { StepLatencyBreakdown } from '../../components/analytics/StepLatencyBreakdown';
import { SLAMonitoringPanel } from '../../components/analytics/SLAMonitoringPanel';

export const AnalyticsPage: React.FC = () => {
  const { activeOrganization } = useAuth();
  const orgId = activeOrganization?.id;

  // Filters state
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [timeRange, setTimeRange] = useState<string>('24h');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);

  // Workflow catalog dropdown options
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  // Sub-component table/sort state
  const [wfSortBy, setWfSortBy] = useState<string>('executions');
  const [wfSortOrder, setWfSortOrder] = useState<string>('desc');
  const [wfPage, setWfPage] = useState<number>(1);
  const [stepSortBy, setStepSortBy] = useState<string>('avg_latency');

  // Data state
  const [overview, setOverview] = useState<AnalyticsOverviewResponse | null>(null);
  const [timeSeriesBuckets, setTimeSeriesBuckets] = useState<TimeSeriesBucket[]>([]);
  const [wfPerformance, setWfPerformance] = useState<{
    items: WorkflowPerformanceItem[];
    total: number;
    totalPages: number;
  }>({ items: [], total: 0, totalPages: 1 });
  const [stepLatencyItems, setStepLatencyItems] = useState<StepLatencyItem[]>([]);
  const [slaData, setSlaData] = useState<SLAMonitoringResponse | null>(null);

  // Loading & error state
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load workflow catalog for filter
  useEffect(() => {
    if (!orgId) return;
    listWorkflows(orgId, { pageSize: 100 })
      .then((res) => setWorkflows(res.items || []))
      .catch(() => {});
  }, [orgId]);

  // Main data fetch function
  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setErrorMessage(null);

    let startIso: string | undefined;
    let endIso: string | undefined;

    if (timeRange === 'custom') {
      if (!customStart || !customEnd) {
        setIsLoading(false);
        return;
      }
      try {
        startIso = toUtcIsoString(customStart);
        endIso = toUtcIsoString(customEnd);
      } catch {
        setErrorMessage('Invalid date/time format for custom range');
        setIsLoading(false);
        return;
      }
    }

    const commonFilter = {
      workflowId: selectedWorkflowId || undefined,
      range: timeRange !== 'custom' ? timeRange : undefined,
      startTime: startIso,
      endTime: endIso,
    };

    try {
      const [ovRes, tsRes, wfRes, stepRes, slaRes] = await Promise.all([
        getAnalyticsOverview(orgId, commonFilter),
        getTimeSeries(orgId, commonFilter),
        getWorkflowPerformance(orgId, {
          ...commonFilter,
          sortBy: wfSortBy as any,
          sortOrder: wfSortOrder as any,
          page: wfPage,
          pageSize: 10,
        }),
        getStepLatency(orgId, {
          ...commonFilter,
          sortBy: stepSortBy as any,
          limit: 20,
        }),
        getSLAMonitoring(orgId, commonFilter),
      ]);

      setOverview(ovRes);
      setTimeSeriesBuckets(tsRes.buckets || []);
      setWfPerformance({
        items: wfRes.items || [],
        total: wfRes.total || 0,
        totalPages: wfRes.total_pages || 1,
      });
      setStepLatencyItems(stepRes.items || []);
      setSlaData(slaRes);
    } catch (err: any) {
      setErrorMessage(err?.detail || err?.message || 'Failed to load execution analytics');
    } finally {
      setIsLoading(false);
    }
  }, [
    orgId,
    selectedWorkflowId,
    timeRange,
    customStart,
    customEnd,
    wfSortBy,
    wfSortOrder,
    wfPage,
    stepSortBy,
  ]);

  // Fetch on filter changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh interval (30s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const handleWfSortChange = (newSort: string) => {
    if (wfSortBy === newSort) {
      setWfSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setWfSortBy(newSort);
      setWfSortOrder('desc');
    }
    setWfPage(1);
  };

  return (
    <div className="space-y-6 text-left pb-12">
      {/* Header & Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
              Phase 15
            </span>
            <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-medium text-indigo-300">
              Live Metrics & SLA
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-500" />
            Execution Analytics & SLA Monitoring
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Production telemetry for execution volumes, percentile latencies, and query-derived SLA targets.
          </p>
        </div>

        {/* Global Control Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Workflow Selector */}
          <div className="relative">
            <select
              aria-label="Filter by workflow"
              value={selectedWorkflowId}
              onChange={(e) => {
                setSelectedWorkflowId(e.target.value);
                setWfPage(1);
              }}
              className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="">All Workflows</option>
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                </option>
              ))}
            </select>
          </div>

          {/* Time Range Selector */}
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            {['24h', '7d', '30d', '90d', 'custom'].map((rng) => (
              <button
                key={rng}
                onClick={() => setTimeRange(rng)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all select-none ${
                  timeRange === rng
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {rng.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              autoRefresh
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Auto-refresh every 30 seconds"
          >
            <Activity className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            <span>30s</span>
          </button>

          {/* Manual Refresh Button */}
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh now"
            aria-label="Refresh analytics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Custom Date Range Picker (shown when custom is selected) */}
      {timeRange === 'custom' && (
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Start (Local):</span>
            <input
              type="datetime-local"
              aria-label="Custom start date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">End (Local):</span>
            <input
              type="datetime-local"
              aria-label="Custom end date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <span className="text-[11px] text-slate-500 italic">
            * Converted to UTC boundaries [start, end) on request. Max range: 90 days.
          </span>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={fetchData}
            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* 1. Executive Overview KPI Cards */}
      <AnalyticsOverviewCards
        volume={overview?.volume}
        duration={overview?.duration}
        sla={overview?.sla}
        isLoading={isLoading && !overview}
      />

      {/* 2. Charts Section (Volume & Duration Trends) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ExecutionVolumeChart buckets={timeSeriesBuckets} isLoading={isLoading && timeSeriesBuckets.length === 0} />
        <DurationTrendChart buckets={timeSeriesBuckets} isLoading={isLoading && timeSeriesBuckets.length === 0} />
      </div>

      {/* 3. SLA Health Panel */}
      <SLAMonitoringPanel data={slaData || undefined} isLoading={isLoading && !slaData} />

      {/* 4. Step Latency & Bottleneck Analysis */}
      <StepLatencyBreakdown
        items={stepLatencyItems}
        sortBy={stepSortBy}
        onSortChange={setStepSortBy}
        isLoading={isLoading && stepLatencyItems.length === 0}
      />

      {/* 5. Per-Workflow Performance Table */}
      <WorkflowPerformanceTable
        items={wfPerformance.items}
        total={wfPerformance.total}
        page={wfPage}
        pageSize={10}
        totalPages={wfPerformance.totalPages}
        sortBy={wfSortBy}
        sortOrder={wfSortOrder}
        onSortChange={handleWfSortChange}
        onPageChange={setWfPage}
        isLoading={isLoading && wfPerformance.items.length === 0}
      />
    </div>
  );
};
