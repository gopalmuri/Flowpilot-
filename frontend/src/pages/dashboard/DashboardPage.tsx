import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CheckSquare,
  Clock,
  GitBranch,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  XCircle,
  AlertTriangle,
  Play,
} from 'lucide-react';
import { listWorkflows } from '../../services/workflowService';
import { listExecutions } from '../../services/executionService';
import { listApprovals } from '../../services/approvalService';
import { getSLAMonitoring } from '../../services/analyticsService';
import { Workflow } from '../../types/workflow';
import { WorkflowRun } from '../../types/execution';
import { ApprovalRequest } from '../../types/approval';
import { MetricCard } from '../../components/ui/MetricCard';
import { StatusBadge } from '../../components/ui/StatusBadge';

export const DashboardPage: React.FC = () => {
  const { user, activeOrganization, activeRole } = useAuth();
  const orgId = activeOrganization?.id;

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [recentRuns, setRecentRuns] = useState<WorkflowRun[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [slaBreachedCount, setSlaBreachedCount] = useState<number>(0);
  const [counts, setCounts] = useState({
    activeWorkflows: 0,
    running: 0,
    waiting: 0,
    failed: 0,
    completed: 0,
  });

  const loadDashboardData = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    try {
      const [wfs, runsRes, apprRes, slaRes] = await Promise.allSettled([
        listWorkflows(orgId),
        listExecutions(orgId, { pageSize: 10 }),
        listApprovals(orgId, 'PENDING', 1, 10),
        getSLAMonitoring(orgId),
      ]);

      const loadedWfs: Workflow[] =
        wfs.status === 'fulfilled' && wfs.value && 'items' in wfs.value
          ? (wfs.value.items as Workflow[])
          : [];
      const loadedRuns = runsRes.status === 'fulfilled' ? runsRes.value.items : [];
      const loadedApprovals = apprRes.status === 'fulfilled' ? apprRes.value.items : [];
      const loadedSla = slaRes.status === 'fulfilled' ? slaRes.value : null;

      setRecentRuns(loadedRuns);
      setPendingApprovals(loadedApprovals);

      const activeCount = loadedWfs.filter((w: Workflow) => w.status === 'ACTIVE').length;
      const runningCount = loadedRuns.filter((r) => r.status === 'RUNNING').length;
      const waitingCount = loadedApprovals.length;
      const failedCount = loadedRuns.filter((r) => r.status === 'FAILED').length;
      const completedCount = loadedRuns.filter((r) => r.status === 'COMPLETED').length;

      let breaches = 0;
      if (loadedSla && loadedSla.workflows) {
        breaches = loadedSla.workflows.filter((w: any) => w.sla_status === 'BREACHED' || w.sla_status === 'WARNING').length;
      }
      setSlaBreachedCount(breaches);

      setCounts({
        activeWorkflows: activeCount,
        running: runningCount,
        waiting: waitingCount,
        failed: failedCount,
        completed: completedCount,
      });
    } catch {
      // Graceful fallback
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const firstName = user?.full_name ? user.full_name.split(' ')[0] : 'Operator';

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return 'Just now';
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

  const hasIssues = counts.waiting > 0 || counts.failed > 0 || slaBreachedCount > 0;

  return (
    <div className="space-y-6">
      {/* Clean Operational Control Header */}
      <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-brand-700 dark:text-brand-400 uppercase tracking-wider">
              Control Plane
            </span>
            <span className="text-warm-400 dark:text-charcoal-600">&bull;</span>
            <span className="text-xs text-warm-600 dark:text-charcoal-400">
              {activeOrganization?.name || 'Enterprise Workspace'}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-warm-900 dark:text-charcoal-100 tracking-tight">
            Welcome back, {firstName}
          </h1>

          <p className="text-xs sm:text-sm text-warm-600 dark:text-charcoal-400 leading-relaxed">
            Monitor workflows, approvals, and business automation from one control plane.
          </p>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadDashboardData}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-warm-100 dark:bg-charcoal-850 hover:bg-warm-200 dark:hover:bg-charcoal-800 text-xs font-semibold text-warm-700 dark:text-charcoal-300 border border-warm-300 dark:border-charcoal-750 transition-all cursor-pointer disabled:opacity-50"
            title="Refresh Telemetry"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <Link
            to="/workflows"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white text-xs font-semibold shadow-subtle transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Workflow</span>
          </Link>
        </div>
      </div>

      {/* Operational Summary - Clickable 5 KPI Cards */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-xs font-bold text-warm-600 dark:text-charcoal-400 uppercase tracking-wider">
            Operational Summary
          </h2>
          <span className="text-[11px] text-warm-500 dark:text-charcoal-500">
            Click metric to inspect
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4">
          <MetricCard
            label="Active Workflows"
            value={counts.activeWorkflows}
            subtext="Enabled automation graphs"
            icon={GitBranch}
            variant="default"
            to="/workflows"
          />
          <MetricCard
            label="Running"
            value={counts.running}
            subtext="In-flight step executions"
            icon={Play}
            variant="default"
            to="/executions?status=RUNNING"
          />
          <MetricCard
            label="Pending Approvals"
            value={counts.waiting}
            subtext="Human review checkpoints"
            icon={CheckSquare}
            variant={counts.waiting > 0 ? 'warning' : 'default'}
            to="/approvals"
          />
          <MetricCard
            label="Failed Runs"
            value={counts.failed}
            subtext="Errors in last batch"
            icon={XCircle}
            variant={counts.failed > 0 ? 'danger' : 'default'}
            to="/executions?status=FAILED"
          />
          <MetricCard
            label="SLA Compliance"
            value={slaBreachedCount > 0 ? `${slaBreachedCount} Warning` : '100%'}
            subtext={slaBreachedCount > 0 ? 'Breached / warning runs' : 'Within nominal duration'}
            icon={Clock}
            variant={slaBreachedCount > 0 ? 'warning' : 'success'}
            to="/analytics#sla"
          />
        </div>
      </div>

      {/* Attention Required Banner (Operational Triage) */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle space-y-3 transition-colors">
        <div className="flex items-center justify-between border-b border-warm-200 dark:border-charcoal-800 pb-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                hasIssues ? 'bg-amber-500 animate-pulse' : 'bg-brand-600 dark:bg-brand-500'
              }`}
            />
            <h2 className="text-xs font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
              Attention Required
            </h2>
          </div>
          <span className="text-[11px] text-warm-500 dark:text-charcoal-400">
            {hasIssues ? 'Actionable items' : 'System nominal'}
          </span>
        </div>

        {!hasIssues ? (
          <div className="py-4 flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-600 dark:text-brand-400 flex-shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">
                All systems operational &bull; No action required
              </h3>
              <p className="text-[11px] text-warm-600 dark:text-charcoal-400 mt-0.5">
                All automated workflows are executing within nominal latency boundaries and no approval gates are stalled.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {counts.waiting > 0 && (
              <Link
                to="/approvals"
                className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 hover:border-amber-400 transition-all flex items-start gap-3 group"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5">
                  <CheckSquare className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-amber-900 dark:text-amber-200 block truncate">
                    {counts.waiting} {counts.waiting === 1 ? 'approval' : 'approvals'} waiting
                  </span>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5 line-clamp-1">
                    Workflows are paused waiting for authorized review.
                  </p>
                  <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 group-hover:underline flex items-center gap-1 mt-2">
                    Review Queue &rarr;
                  </span>
                </div>
              </Link>
            )}

            {counts.failed > 0 && (
              <Link
                to="/executions?status=FAILED"
                className="p-3.5 rounded-xl bg-red-50/70 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 hover:border-red-400 transition-all flex items-start gap-3 group"
              >
                <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 flex items-center justify-center text-red-700 dark:text-red-400 flex-shrink-0 mt-0.5">
                  <XCircle className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-red-900 dark:text-red-200 block truncate">
                    {counts.failed} {counts.failed === 1 ? 'failure' : 'failures'} detected
                  </span>
                  <p className="text-[11px] text-red-800/80 dark:text-red-300/80 mt-0.5 line-clamp-1">
                    Step execution errors require operator inspection.
                  </p>
                  <span className="text-[10px] font-semibold text-red-700 dark:text-red-400 group-hover:underline flex items-center gap-1 mt-2">
                    Inspect Runs &rarr;
                  </span>
                </div>
              </Link>
            )}

            {slaBreachedCount > 0 && (
              <Link
                to="/analytics#sla"
                className="p-3.5 rounded-xl bg-warm-100 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 hover:border-warm-400 transition-all flex items-start gap-3 group"
              >
                <div className="w-7 h-7 rounded-lg bg-warm-200 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 flex items-center justify-center text-warm-700 dark:text-charcoal-300 flex-shrink-0 mt-0.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 block truncate">
                    {slaBreachedCount} SLA {slaBreachedCount === 1 ? 'warning' : 'warnings'}
                  </span>
                  <p className="text-[11px] text-warm-600 dark:text-charcoal-400 mt-0.5 line-clamp-1">
                    Workflows approaching configured duration limits.
                  </p>
                  <span className="text-[10px] font-semibold text-brand-700 dark:text-brand-400 group-hover:underline flex items-center gap-1 mt-2">
                    Inspect SLA &rarr;
                  </span>
                </div>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Two Column Layout: Recent Telemetry (2/3) + Approval Queue (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3): Recent Execution Telemetry */}
        <div className="lg:col-span-2 space-y-3">
          <div className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle">
            <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-warm-200 dark:border-charcoal-800">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-brand-600 dark:text-brand-500" />
                <h2 className="text-xs font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                  Recent Execution Telemetry
                </h2>
              </div>
              <Link
                to="/executions"
                className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
              >
                <span>View All Runs</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {recentRuns.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="w-10 h-10 rounded-xl bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 flex items-center justify-center text-warm-500 dark:text-charcoal-400 mx-auto">
                  <Layers className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">
                  No Execution History Recorded
                </h3>
                <p className="text-[11px] text-warm-600 dark:text-charcoal-400 max-w-sm mx-auto">
                  Trigger an automation via API webhook, manual run, or schedule to see live execution telemetry.
                </p>
                <div className="pt-2">
                  <Link
                    to="/workflows"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium"
                  >
                    <span>Go to Workflows</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-warm-100 dark:divide-charcoal-800/80">
                {recentRuns.map((run) => (
                  <Link
                    key={run.id}
                    to={`/executions?search=${encodeURIComponent(run.correlation_id)}`}
                    className="py-3 flex items-center justify-between gap-3 hover:bg-warm-50 dark:hover:bg-charcoal-850 px-2 rounded-xl transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-warm-100 dark:bg-charcoal-800 border border-warm-200 dark:border-charcoal-750 flex items-center justify-center text-warm-600 dark:text-charcoal-400 flex-shrink-0 group-hover:border-brand-500/40 transition-colors">
                        <GitBranch className="w-4 h-4 text-warm-600 dark:text-charcoal-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                            {run.workflow_name || 'Workflow Run'}
                          </span>
                          <span className="text-[10px] font-mono text-warm-500 dark:text-charcoal-400 bg-warm-100 dark:bg-charcoal-800 px-1.5 py-0.2 rounded border border-warm-200 dark:border-charcoal-750">
                            {run.correlation_id.slice(0, 10)}...
                          </span>
                        </div>
                        <span className="text-[11px] text-warm-500 dark:text-charcoal-400 block truncate mt-0.5">
                          Trigger: {run.trigger_type} &bull; Duration:{' '}
                          {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : 'In progress'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      <span className="text-[11px] font-mono text-warm-500 dark:text-charcoal-400 hidden sm:inline">
                        {formatRelativeTime(run.started_at)}
                      </span>
                      <StatusBadge status={run.status} size="sm" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1/3): Operational Approval Queue */}
        <div className="space-y-3">
          <div className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle">
            <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-warm-200 dark:border-charcoal-800">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-amber-600 dark:text-amber-500" />
                <h2 className="text-xs font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                  Approval Queue
                </h2>
              </div>
              <Link
                to="/approvals"
                className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
              >
                <span>Review</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {pendingApprovals.length === 0 ? (
              <div className="py-8 px-3 text-center space-y-2">
                <div className="w-10 h-10 rounded-xl bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 flex items-center justify-center text-brand-600 dark:text-brand-500 mx-auto">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">
                  Zero Pending Approvals
                </h3>
                <p className="text-[11px] text-warm-600 dark:text-charcoal-400 leading-relaxed max-w-xs mx-auto">
                  All automated workflows are executing without human gating bottlenecks.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pendingApprovals.map((appr) => (
                  <div
                    key={appr.id}
                    className="p-3 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-mono text-warm-500 dark:text-charcoal-400 block">
                          Step: {appr.step_key}
                        </span>
                        <h4 className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 leading-tight">
                          Review Required
                        </h4>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
                        {appr.required_role}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-warm-600 dark:text-charcoal-400 pt-1 border-t border-warm-200 dark:border-charcoal-800">
                      <span>Waiting {formatRelativeTime(appr.requested_at)}</span>
                      <Link
                        to="/approvals"
                        className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        Action &rarr;
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Shortcuts */}
          <div className="p-4 rounded-xl bg-warm-100 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-warm-500 dark:text-charcoal-400 block">
              Operations Tools
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link
                to="/analytics"
                className="p-2.5 rounded-lg bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 hover:border-warm-400 dark:hover:border-charcoal-700 text-warm-800 dark:text-charcoal-200 font-medium text-center transition-colors"
              >
                Analytics &amp; SLA
              </Link>
              <Link
                to="/status"
                className="p-2.5 rounded-lg bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 hover:border-warm-400 dark:hover:border-charcoal-700 text-warm-800 dark:text-charcoal-200 font-medium text-center transition-colors"
              >
                System Status
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Tenant Context & Governance Boundary Panel */}
      <div className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle space-y-3 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-brand-600 dark:text-brand-500" />
            <h2 className="text-xs font-bold text-warm-700 dark:text-charcoal-300 uppercase tracking-wider">
              Tenant Isolation &amp; Governance
            </h2>
          </div>
          <span className="text-[11px] font-medium text-brand-700 dark:text-brand-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-brand-600 dark:bg-brand-500" /> Boundary Verified
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-warm-100 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750">
            <span className="text-warm-500 dark:text-charcoal-400 block text-[11px] font-medium mb-0.5">Organization</span>
            <span className="font-semibold text-warm-900 dark:text-charcoal-100 text-xs truncate block">{activeOrganization?.name || 'FlowPilot Core'}</span>
          </div>
          <div className="p-3 rounded-lg bg-warm-100 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750">
            <span className="text-warm-500 dark:text-charcoal-400 block text-[11px] font-medium mb-0.5">Route Namespace</span>
            <span className="font-mono text-brand-700 dark:text-brand-400 text-xs block">/{activeOrganization?.slug || 'flowpilot'}</span>
          </div>
          <div className="p-3 rounded-lg bg-warm-100 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750">
            <span className="text-warm-500 dark:text-charcoal-400 block text-[11px] font-medium mb-0.5">RBAC Role</span>
            <span className="font-semibold text-warm-900 dark:text-charcoal-100 text-xs flex items-center gap-1">
              <Shield className="w-3 h-3 text-brand-600 dark:text-brand-500" />
              {activeRole || 'OWNER'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-warm-100 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750">
            <span className="text-warm-500 dark:text-charcoal-400 block text-[11px] font-medium mb-0.5">Data Boundary</span>
            <span className="font-mono text-warm-800 dark:text-charcoal-200 text-xs flex items-center gap-1">
              <Lock className="w-3 h-3 text-warm-500 dark:text-charcoal-400" /> Strict Multi-Tenant
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
