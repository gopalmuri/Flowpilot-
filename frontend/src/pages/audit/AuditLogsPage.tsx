import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  RefreshCw,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Eye,
  Copy,
  Check,
  X,
  AlertTriangle,
  Lock,
  User,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AuditLog } from '../../types/audit';
import { listAuditLogs, getAuditLogDetail, AuditLogFilterOptions } from '../../services/auditService';

const ACTION_FILTERS = [
  { label: 'All Actions', value: '' },
  { label: 'Execution Started', value: 'execution.started' },
  { label: 'Execution Completed', value: 'execution.completed' },
  { label: 'Execution Failed', value: 'execution.failed' },
  { label: 'Execution Cancelled', value: 'execution.cancelled' },
  { label: 'Workflow Created', value: 'workflow.created' },
  { label: 'Workflow Updated', value: 'workflow.updated' },
  { label: 'Workflow Archived', value: 'workflow.archived' },
  { label: 'Approval Requested', value: 'approval.requested' },
  { label: 'Approval Approved', value: 'approval.approved' },
  { label: 'Approval Rejected', value: 'approval.rejected' },
  { label: 'Approval Cancelled', value: 'approval.cancelled' },
  { label: 'Approval Expired', value: 'approval.expired' },
  { label: 'Integration Created', value: 'integration.created' },
  { label: 'Integration Updated', value: 'integration.updated' },
  { label: 'Integration Deleted', value: 'integration.deleted' },
  { label: 'Webhook Key Rotated', value: 'WORKFLOW_WEBHOOK_KEY_ROTATED' },
];

const RESOURCE_FILTERS = [
  { label: 'All Resources', value: '' },
  { label: 'Workflow Run', value: 'workflow_run' },
  { label: 'Workflow', value: 'workflow' },
  { label: 'Approval Request', value: 'approval_request' },
  { label: 'Integration', value: 'integration' },
];

const DATE_RANGE_OPTIONS = [
  { label: 'All Time', value: 'ALL' },
  { label: 'Today', value: 'TODAY' },
  { label: 'Last 7 Days', value: '7D' },
  { label: 'Last 30 Days', value: '30D' },
];


const maskSecrets = (data: any): any => {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(maskSecrets);
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const k = key.toLowerCase();
    if (k.includes('token') || k.includes('secret') || k.includes('password') || k.includes('api_key') || k.includes('apikey')) {
      result[key] = '••••••••';
    } else if (typeof value === 'object') {
      result[key] = maskSecrets(value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

export const AuditLogsPage: React.FC = () => {
  const { activeOrganization, activeRole } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Filters
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [selectedResource, setSelectedResource] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [dateRange, setDateRange] = useState<string>('ALL');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedPayload, setCopiedPayload] = useState<boolean>(false);

  const isRestrictedRole = activeRole === 'VIEWER' || activeRole === 'OPERATOR';

  // Debounce search query
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

  const fetchLogs = useCallback(
    async (showLoadingSpinner: boolean = false) => {
      if (!activeOrganization) return;
      if (isRestrictedRole) {
        setIsLoading(false);
        return;
      }

      if (showLoadingSpinner) setIsRefreshing(true);
      setError(null);

      try {
        const dateParams = getDateRangeParams();
        const options: AuditLogFilterOptions = {
          action: selectedAction || undefined,
          resourceType: selectedResource || undefined,
          search: debouncedSearch || undefined,
          fromDate: dateParams.fromDate,
          page,
          pageSize,
        };

        const res = await listAuditLogs(activeOrganization.id, options);
        setLogs(res.items || []);
        setTotal(res.total || 0);
        setTotalPages(res.total_pages || 1);
      } catch (err: any) {
        if (err.status === 403 || (err.message && err.message.includes('403'))) {
          setError('Access Restricted: Audit trail inspection requires Manager, Admin, or Owner role.');
        } else {
          setError(err.message || 'Failed to fetch audit records');
        }
      } finally {
        setIsLoading(false);
        if (showLoadingSpinner) setIsRefreshing(false);
      }
    },
    [activeOrganization, isRestrictedRole, selectedAction, selectedResource, debouncedSearch, getDateRangeParams, page, pageSize]
  );

  useEffect(() => {
    setIsLoading(true);
    fetchLogs(false);
  }, [fetchLogs]);

  const handleOpenDetail = async (auditId: string) => {
    if (!activeOrganization) return;
    try {
      const detail = await getAuditLogDetail(activeOrganization.id, auditId);
      setSelectedLog(detail);
      setIsModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit detail');
    }
  };

  const copyToClipboard = (text: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const copyPayload = () => {
    if (!selectedLog) return;
    navigator.clipboard.writeText(JSON.stringify(selectedLog.details, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 1500);
  };

  const getActionBadge = (action: string) => {
    if (action.includes('completed') || action.includes('approved')) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-brand-600 dark:text-brand-400 border border-emerald-500/20 font-mono">
          {action}
        </span>
      );
    }
    if (action.includes('failed') || action.includes('rejected')) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60 font-mono">
          {action}
        </span>
      );
    }
    if (action.includes('started') || action.includes('created')) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800/60 font-mono">
          {action}
        </span>
      );
    }
    if (action.includes('cancelled') || action.includes('expired')) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60 font-mono">
          {action}
        </span>
      );
    }
    if (action.includes('updated') || action.includes('integration')) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60 font-mono">
          {action}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warm-100 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300 border border-warm-300 dark:border-charcoal-700/60 font-mono">
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-warm-200 dark:border-charcoal-750">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-600 dark:text-brand-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-warm-900 dark:text-charcoal-100 flex items-center gap-2">
              System Audit Logs
            </h1>
            <p className="text-xs text-warm-500 dark:text-charcoal-400">
              Immutable chronological trail of security, execution, workflow, and integration events
            </p>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchLogs(true)}
            disabled={isRefreshing || isRestrictedRole}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-warm-100 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-200 border border-warm-300 dark:border-charcoal-700 hover:bg-warm-200 dark:hover:bg-charcoal-700 transition disabled:opacity-50"
            title="Refresh audit logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Role Restriction Banner if Viewer/Operator */}
      {isRestrictedRole && (
        <div className="p-6 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-warm-800 dark:text-charcoal-200">Audit Trail Access Restricted</h3>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 max-w-md mx-auto">
            Viewing immutable audit trail logs is restricted to <span className="text-amber-400 font-medium">Manager</span>, <span className="text-amber-400 font-medium">Admin</span>, and <span className="text-amber-400 font-medium">Owner</span> roles. Your current role is <span className="font-mono text-warm-700 dark:text-charcoal-300 uppercase">{activeRole}</span>.
          </p>
        </div>
      )}

      {!isRestrictedRole && (
        <>
          {/* Filters Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-white dark:bg-charcoal-900 shadow-subtle p-3 rounded-xl border border-warm-200 dark:border-charcoal-750">
            {/* Search Input */}
            <div className="relative col-span-1">
              <Search className="w-4 h-4 text-warm-500 dark:text-charcoal-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search action or resource ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 text-warm-900 dark:text-charcoal-100 placeholder-warm-400 dark:placeholder-charcoal-500 border border-warm-200 dark:border-charcoal-750 rounded-lg text-xs text-warm-800 dark:text-charcoal-200 placeholder-warm-400 dark:placeholder-charcoal-500 focus:outline-none focus:border-brand-500/30 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-warm-400 dark:text-charcoal-500 hover:text-warm-700 dark:text-charcoal-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Action Filter */}
            <div>
              <select
                value={selectedAction}
                onChange={(e) => {
                  setSelectedAction(e.target.value);
                  setPage(1);
                }}
                className="w-full py-2 px-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 text-warm-900 dark:text-charcoal-100 placeholder-warm-400 dark:placeholder-charcoal-500 border border-warm-200 dark:border-charcoal-750 rounded-lg text-xs text-warm-700 dark:text-charcoal-300 focus:outline-none focus:border-brand-500/30 transition"
              >
                {ACTION_FILTERS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-white dark:bg-charcoal-900 text-warm-800 dark:text-charcoal-200">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Resource Type Filter */}
            <div>
              <select
                value={selectedResource}
                onChange={(e) => {
                  setSelectedResource(e.target.value);
                  setPage(1);
                }}
                className="w-full py-2 px-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 text-warm-900 dark:text-charcoal-100 placeholder-warm-400 dark:placeholder-charcoal-500 border border-warm-200 dark:border-charcoal-750 rounded-lg text-xs text-warm-700 dark:text-charcoal-300 focus:outline-none focus:border-brand-500/30 transition"
              >
                {RESOURCE_FILTERS.map((opt) => (
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
                className="w-full py-2 px-3 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 text-warm-900 dark:text-charcoal-100 placeholder-warm-400 dark:placeholder-charcoal-500 border border-warm-200 dark:border-charcoal-750 rounded-lg text-xs text-warm-700 dark:text-charcoal-300 focus:outline-none focus:border-brand-500/30 transition"
              >
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-white dark:bg-charcoal-900 text-warm-800 dark:text-charcoal-200">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => fetchLogs(true)}
                className="underline hover:text-rose-300 transition"
              >
                Retry
              </button>
            </div>
          )}

          {/* Table Content Area */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center min-h-[300px] p-8 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750">
              <RefreshCw className="w-8 h-8 text-brand-600 dark:text-brand-400 animate-spin mb-3" />
              <p className="text-xs text-warm-500 dark:text-charcoal-400">Loading audit trail records...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[320px] p-8 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 text-center">
              <div className="w-12 h-12 rounded-2xl bg-warm-100 dark:bg-charcoal-800/60 border border-warm-300 dark:border-charcoal-700/60 flex items-center justify-center text-warm-500 dark:text-charcoal-400 mb-3">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-warm-800 dark:text-charcoal-200">No Audit Logs Found</h3>
              <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-1 max-w-sm">
                No audit events matched your filter criteria. Trigger workflow actions, updates, or executions to generate audit history.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-900 shadow-subtle overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-warm-100 dark:bg-charcoal-850 text-warm-500 dark:text-charcoal-400 uppercase text-[10px] tracking-wider border-b border-warm-200 dark:border-charcoal-750 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Resource</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">IP Address</th>
                      <th className="py-3 px-4 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-warm-700 dark:text-charcoal-300">
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="hover:bg-warm-100 dark:bg-charcoal-800/20 transition cursor-pointer"
                        onClick={() => handleOpenDetail(log.id)}
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap text-warm-500 dark:text-charcoal-400 font-mono text-[11px]">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {getActionBadge(log.action)}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 font-mono text-[11px]">
                            <span className="px-1.5 py-0.5 rounded bg-warm-100 dark:bg-charcoal-800 text-warm-500 dark:text-charcoal-400 border border-warm-300 dark:border-charcoal-700/50 text-[10px]">
                              {log.resource_type}
                            </span>
                            <span title={log.resource_id} className="text-warm-700 dark:text-charcoal-300 truncate max-w-[140px]">
                              {log.resource_id.slice(0, 8)}...
                            </span>
                            <button
                              onClick={(e) => copyToClipboard(log.resource_id, log.id, e)}
                              className="text-warm-400 dark:text-charcoal-500 hover:text-warm-700 dark:text-charcoal-300 transition"
                              title="Copy Resource ID"
                            >
                              {copiedId === log.id ? (
                                <Check className="w-3 h-3 text-brand-600 dark:text-brand-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {log.actor_name || log.actor_email ? (
                            <div className="flex items-center gap-1.5 text-warm-700 dark:text-charcoal-300">
                              <User className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400" />
                              <span>{log.actor_name || log.actor_email}</span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-warm-100 dark:bg-charcoal-850 text-warm-500 dark:text-charcoal-400 text-[10px] border border-warm-300 dark:border-charcoal-700/40">
                              System Worker
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap font-mono text-warm-500 dark:text-charcoal-400 text-[11px]">
                          {log.ip_address || 'Internal'}
                        </td>
                        <td
                          className="py-3.5 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleOpenDetail(log.id)}
                            className="p-1.5 rounded-lg text-warm-500 dark:text-charcoal-400 hover:text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition"
                            title="Inspect Audit Metadata"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {total > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-900 shadow-subtle text-xs text-warm-500 dark:text-charcoal-400">
                  <div>
                    Showing <span className="text-warm-800 dark:text-charcoal-200 font-medium">{(page - 1) * pageSize + 1}</span> to{' '}
                    <span className="text-warm-800 dark:text-charcoal-200 font-medium">{Math.min(page * pageSize, total)}</span> of{' '}
                    <span className="text-warm-800 dark:text-charcoal-200 font-medium">{total}</span> audit records
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
                        className="bg-warm-50 dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 rounded px-2 py-1 text-warm-800 dark:text-charcoal-200 focus:outline-none focus:border-brand-500"
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
                        className="p-1 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-warm-700 dark:text-charcoal-300 hover:bg-warm-200 dark:hover:bg-charcoal-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
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
                        className="p-1 rounded bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-warm-700 dark:text-charcoal-300 hover:bg-warm-200 dark:hover:bg-charcoal-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
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
        </>
      )}

      {/* Audit Detail Modal */}
      {isModalOpen && selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-50 dark:bg-charcoal-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-900 shadow-subtle">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 text-brand-600 dark:text-brand-400">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100 flex items-center gap-2">
                    Audit Event Details
                  </h3>
                  <p className="text-[11px] font-mono text-warm-500 dark:text-charcoal-400">
                    ID: {selectedLog.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:text-charcoal-200 hover:bg-warm-100 dark:bg-charcoal-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Immutability Ledger Banner */}
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-warm-100 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 text-xs text-warm-700 dark:text-charcoal-300">
                <Lock className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                <div>
                  <span className="font-semibold text-warm-900 dark:text-charcoal-100">Cryptographically Sealed &bull; Immutable Ledger Record</span>
                  <span className="text-[11px] text-warm-500 dark:text-charcoal-400 block">
                    Append-only audit trail. This event cannot be altered, overwritten, or purged.
                  </span>
                </div>
              </div>

              {/* Event Attributes Grid */}
              <div className="grid grid-cols-2 gap-3 bg-warm-50 dark:bg-charcoal-950/50 p-3.5 rounded-xl border border-warm-200 dark:border-charcoal-750">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-warm-400 dark:text-charcoal-500 tracking-wider">Action</span>
                  <div className="mt-1">{getActionBadge(selectedLog.action)}</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-warm-400 dark:text-charcoal-500 tracking-wider">Timestamp</span>
                  <div className="text-warm-800 dark:text-charcoal-200 font-mono mt-1">
                    {new Date(selectedLog.created_at).toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-warm-400 dark:text-charcoal-500 tracking-wider">Resource</span>
                  <div className="text-warm-800 dark:text-charcoal-200 font-mono mt-1 break-all">
                    {selectedLog.resource_type}: {selectedLog.resource_id}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-warm-400 dark:text-charcoal-500 tracking-wider">Actor / Identity</span>
                  <div className="text-warm-800 dark:text-charcoal-200 mt-1">
                    {selectedLog.actor_name || selectedLog.actor_email ? (
                      <div>
                        {selectedLog.actor_name && <span className="font-medium">{selectedLog.actor_name} </span>}
                        {selectedLog.actor_email && <span className="text-warm-500 dark:text-charcoal-400">({selectedLog.actor_email})</span>}
                      </div>
                    ) : (
                      <span className="text-warm-500 dark:text-charcoal-400">System (Worker Process)</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-warm-400 dark:text-charcoal-500 tracking-wider">Tenant Organization</span>
                  <div className="text-warm-800 dark:text-charcoal-200 font-mono mt-1">
                    {activeOrganization?.slug ? `/${activeOrganization.slug}` : (selectedLog.organization_id || 'System')}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-warm-400 dark:text-charcoal-500 tracking-wider">Origin IP</span>
                  <div className="text-warm-800 dark:text-charcoal-200 font-mono mt-1">
                    {selectedLog.ip_address || 'Internal (Worker)'}
                  </div>
                </div>
              </div>

              {/* Details JSON Viewer */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase font-semibold text-warm-500 dark:text-charcoal-400 tracking-wider">
                    Sanitized Event Details Payload
                  </span>
                  <button
                    onClick={copyPayload}
                    className="inline-flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:text-brand-300 transition"
                  >
                    {copiedPayload ? (
                      <>
                        <Check className="w-3 h-3 text-brand-600 dark:text-brand-400" />
                        <span>Copied JSON</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="bg-warm-50 dark:bg-charcoal-950 p-4 rounded-xl border border-warm-200 dark:border-charcoal-750 font-mono text-[11px] text-warm-700 dark:text-charcoal-300 max-h-60 overflow-y-auto">
                  <pre>{JSON.stringify(maskSecrets(selectedLog.details), null, 2)}</pre>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 border-t border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-900 shadow-subtle flex justify-end">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-warm-100 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-200 hover:bg-warm-200 dark:hover:bg-charcoal-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
