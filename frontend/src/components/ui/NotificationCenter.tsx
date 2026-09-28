import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Layers,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { listApprovals } from '../../services/approvalService';
import { listExecutions } from '../../services/executionService';

export interface NotificationItem {
  id: string;
  category: 'APPROVAL' | 'FAILURE' | 'SUCCESS' | 'SYSTEM' | 'SLA';
  title: string;
  message: string;
  timestamp: string;
  severity: 'warning' | 'error' | 'success' | 'info';
  link: string;
  isRead: boolean;
}

const STORAGE_KEY = 'flowpilot_read_notifications';

export const NotificationCenter: React.FC = () => {
  const { activeOrganization } = useAuth();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Read notification IDs from localStorage
  const getReadIds = useCallback((): string[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, []);

  const saveReadIds = useCallback((ids: string[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // Ignore
    }
  }, []);

  // Fetch real notifications from existing backend APIs
  const loadNotifications = useCallback(async () => {
    if (!activeOrganization) return;
    setIsLoading(true);

    try {
      const readIds = getReadIds();
      const items: NotificationItem[] = [];

      // 1. Pending Approvals
      const approvalsRes = await listApprovals(activeOrganization.id, 'PENDING', 1, 10).catch(() => null);
      if (approvalsRes && approvalsRes.items) {
        for (const appr of approvalsRes.items) {
          const id = `appr-${appr.id}`;
          items.push({
            id,
            category: 'APPROVAL',
            title: 'Approval Required',
            message: `Review required for step "${appr.step_key}" (${appr.required_role} role).`,
            timestamp: appr.requested_at,
            severity: 'warning',
            link: '/approvals',
            isRead: readIds.includes(id),
          });
        }
      }

      // 2. Failed and Recent Runs
      const execRes = await listExecutions(activeOrganization.id, { pageSize: 15 }).catch(() => null);
      if (execRes && execRes.items) {
        for (const run of execRes.items) {
          if (run.status === 'FAILED') {
            const id = `exec-fail-${run.id}`;
            items.push({
              id,
              category: 'FAILURE',
              title: 'Workflow Execution Failed',
              message: `${run.workflow_name || 'Workflow'} failed (Corr: ${run.correlation_id.slice(0, 10)}...).`,
              timestamp: run.completed_at || run.updated_at,
              severity: 'error',
              link: `/executions?search=${encodeURIComponent(run.correlation_id)}`,
              isRead: readIds.includes(id),
            });
          } else if (run.status === 'COMPLETED') {
            const id = `exec-succ-${run.id}`;
            items.push({
              id,
              category: 'SUCCESS',
              title: 'Execution Completed',
              message: `${run.workflow_name || 'Workflow'} finished successfully in ${run.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : 'N/A'}.`,
              timestamp: run.completed_at || run.updated_at,
              severity: 'success',
              link: `/executions?search=${encodeURIComponent(run.correlation_id)}`,
              isRead: readIds.includes(id),
            });
          }
        }
      }

      // 3. System Status
      const healthRes = await fetch('/health').catch(() => null);
      if (healthRes && healthRes.ok) {
        const health = await healthRes.json().catch(() => null);
        if (health && health.status && health.status !== 'healthy') {
          const id = `sys-health-${health.timestamp || 'current'}`;
          items.push({
            id,
            category: 'SYSTEM',
            title: `System ${String(health.status).toUpperCase()}`,
            message: 'One or more backend infrastructure components reported degraded telemetry.',
            timestamp: health.timestamp || new Date().toISOString(),
            severity: 'error',
            link: '/status',
            isRead: readIds.includes(id),
          });
        }
      }

      // Sort newest first
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setNotifications(items.slice(0, 25));
    } catch {
      // Graceful fallback
    } finally {
      setIsLoading(false);
    }
  }, [activeOrganization, getReadIds]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Handle outside click to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.isRead).length;
  }, [notifications]);

  const markAsRead = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const readIds = getReadIds();
    if (!readIds.includes(id)) {
      const updated = [...readIds, id];
      saveReadIds(updated);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    }
  };

  const markAllAsRead = () => {
    const allIds = notifications.map((n) => n.id);
    const readIds = Array.from(new Set([...getReadIds(), ...allIds]));
    saveReadIds(readIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const formatRelativeTime = (isoString: string): string => {
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDays = Math.floor(diffHr / 24);
      return `${diffDays}d ago`;
    } catch {
      return 'Recently';
    }
  };

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'unread') {
      return notifications.filter((n) => !n.isRead);
    }
    return notifications;
  }, [notifications, activeTab]);

  return (
    <div className="relative" ref={containerRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        aria-label="Open notifications center"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) loadNotifications();
        }}
        className="relative p-2 rounded-xl text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-850 border border-transparent hover:border-warm-300 dark:hover:border-charcoal-750 transition-all cursor-pointer"
        title="Operational Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow-xs animate-in zoom-in-75">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-elevated z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="p-3.5 border-b border-warm-200 dark:border-charcoal-800 flex items-center justify-between bg-warm-50/50 dark:bg-charcoal-850/50">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-brand-100 dark:bg-brand-950/70 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60">
                  {unreadCount} unread
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 flex items-center gap-1 transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex border-b border-warm-200 dark:border-charcoal-800 px-3 bg-warm-50/20 dark:bg-charcoal-850/20 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`py-2 px-3 border-b-2 font-medium transition-colors ${
                activeTab === 'all'
                  ? 'border-brand-600 dark:border-brand-400 text-brand-700 dark:text-brand-300 font-semibold'
                  : 'border-transparent text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unread')}
              className={`py-2 px-3 border-b-2 font-medium transition-colors ${
                activeTab === 'unread'
                  ? 'border-brand-600 dark:border-brand-400 text-brand-700 dark:text-brand-300 font-semibold'
                  : 'border-transparent text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-warm-100 dark:divide-charcoal-800/60">
            {isLoading && notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-warm-500 dark:text-charcoal-400">
                Checking for alerts...
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <div className="w-9 h-9 rounded-xl bg-warm-100 dark:bg-charcoal-800 border border-warm-200 dark:border-charcoal-700 flex items-center justify-center text-brand-600 dark:text-brand-400 mx-auto">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">
                  {activeTab === 'unread' ? 'All Caught Up' : 'No Notifications'}
                </p>
                <p className="text-[11px] text-warm-500 dark:text-charcoal-400 max-w-xs mx-auto">
                  All automated workflows and services are operating normally.
                </p>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      markAsRead(item.id);
                      setIsOpen(false);
                      navigate(item.link);
                    }}
                    className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors ${
                      !item.isRead
                        ? 'bg-brand-50/40 dark:bg-brand-950/20 hover:bg-brand-50/70 dark:hover:bg-brand-950/40'
                        : 'hover:bg-warm-100/60 dark:hover:bg-charcoal-800/50'
                    }`}
                  >
                    {/* Severity Icon */}
                    <div
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        item.severity === 'warning'
                          ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400'
                          : item.severity === 'error'
                          ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400'
                          : item.severity === 'success'
                          ? 'bg-brand-50 dark:bg-brand-950/40 border-brand-200 dark:border-brand-800/60 text-brand-600 dark:text-brand-400'
                          : 'bg-warm-100 dark:bg-charcoal-800 border-warm-200 dark:border-charcoal-700 text-warm-600 dark:text-charcoal-400'
                      }`}
                    >
                      {item.severity === 'warning' && <AlertTriangle className="w-3.5 h-3.5" />}
                      {item.severity === 'error' && <XCircle className="w-3.5 h-3.5" />}
                      {item.severity === 'success' && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {item.severity === 'info' && <Layers className="w-3.5 h-3.5" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 truncate">
                          {item.title}
                        </span>
                        <span className="text-[10px] text-warm-500 dark:text-charcoal-400 flex-shrink-0 font-mono">
                          {formatRelativeTime(item.timestamp)}
                        </span>
                      </div>
                      <p className="text-[11px] text-warm-600 dark:text-charcoal-400 line-clamp-2 mt-0.5 leading-snug">
                        {item.message}
                      </p>

                      <div className="flex items-center justify-between mt-2 pt-1">
                        <span className="text-[10px] font-semibold text-brand-700 dark:text-brand-400 flex items-center gap-1">
                          <span>Inspect</span>
                          <ArrowRight className="w-3 h-3" />
                        </span>

                        {!item.isRead && (
                          <button
                            type="button"
                            onClick={(e) => markAsRead(item.id, e)}
                            className="text-[10px] text-warm-500 hover:text-warm-800 dark:text-charcoal-400 dark:hover:text-charcoal-200 flex items-center gap-0.5"
                            title="Mark as read"
                          >
                            <Check className="w-3 h-3" />
                            <span>Dismiss</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-2.5 bg-warm-50/50 dark:bg-charcoal-850/50 border-t border-warm-200 dark:border-charcoal-800 text-center">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                navigate('/status');
              }}
              className="text-[11px] font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 flex items-center justify-center gap-1.5 mx-auto"
            >
              <span>View System Health &amp; Telemetry</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
