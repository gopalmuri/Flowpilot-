import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  GitBranch,
  Layers,
  CheckSquare,
  Plug,
  BarChart3,
  Clock,
  Shield,
  Activity,
  Settings,
  Plus,
  Sun,
  Moon,
  X,
  CornerDownLeft,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { listWorkflows } from '../../services/workflowService';
import { listExecutions } from '../../services/executionService';
import { listApprovals } from '../../services/approvalService';
import { Workflow } from '../../types/workflow';
import { WorkflowRun } from '../../types/execution';
import { ApprovalRequest } from '../../types/approval';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkflow?: () => void;
}

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigation' | 'Actions' | 'Workflows' | 'Executions' | 'Approvals';
  icon: React.ElementType;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'danger';
  perform: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onCreateWorkflow,
}) => {
  const navigate = useNavigate();
  const { activeOrganization } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<WorkflowRun[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Fetch live entities when palette is opened or org changes
  useEffect(() => {
    if (!isOpen || !activeOrganization) return;
    let isMounted = true;

    async function fetchEntities() {
      try {
        setIsSearching(true);
        const [wfRes, execRes, apprRes] = await Promise.allSettled([
          listWorkflows(activeOrganization!.id, { pageSize: 15 }),
          listExecutions(activeOrganization!.id, { pageSize: 15 }),
          listApprovals(activeOrganization!.id, 'PENDING', 1, 10),
        ]);

        if (isMounted) {
          if (wfRes.status === 'fulfilled') setWorkflows(wfRes.value.items || []);
          if (execRes.status === 'fulfilled') setExecutions(execRes.value.items || []);
          if (apprRes.status === 'fulfilled') setApprovals(apprRes.value.items || []);
        }
      } finally {
        if (isMounted) setIsSearching(false);
      }
    }

    fetchEntities();

    return () => {
      isMounted = false;
    };
  }, [isOpen, activeOrganization]);

  // Base navigation commands
  const navigationCommands: CommandItem[] = useMemo(
    () => [
      {
        id: 'nav-dashboard',
        title: 'Dashboard',
        subtitle: 'Operational control plane & summary metrics',
        category: 'Navigation',
        icon: LayoutDashboard,
        perform: () => {
          navigate('/dashboard');
          onClose();
        },
      },
      {
        id: 'nav-workflows',
        title: 'Workflows',
        subtitle: 'Orchestration catalog & DAG builder',
        category: 'Navigation',
        icon: GitBranch,
        perform: () => {
          navigate('/workflows');
          onClose();
        },
      },
      {
        id: 'nav-executions',
        title: 'Executions',
        subtitle: 'Execution telemetry & step timelines',
        category: 'Navigation',
        icon: Layers,
        perform: () => {
          navigate('/executions');
          onClose();
        },
      },
      {
        id: 'nav-approvals',
        title: 'Approvals',
        subtitle: 'Human-in-the-loop review queue',
        category: 'Navigation',
        icon: CheckSquare,
        perform: () => {
          navigate('/approvals');
          onClose();
        },
      },
      {
        id: 'nav-integrations',
        title: 'Integrations',
        subtitle: 'Connectors, credentials & service hooks',
        category: 'Navigation',
        icon: Plug,
        perform: () => {
          navigate('/integrations');
          onClose();
        },
      },
      {
        id: 'nav-analytics',
        title: 'Analytics',
        subtitle: 'Execution volume, latency & trends',
        category: 'Navigation',
        icon: BarChart3,
        perform: () => {
          navigate('/analytics');
          onClose();
        },
      },
      {
        id: 'nav-sla',
        title: 'SLA Monitoring',
        subtitle: 'Threshold compliance & breach alerts',
        category: 'Navigation',
        icon: Clock,
        perform: () => {
          navigate('/analytics#sla');
          onClose();
        },
      },
      {
        id: 'nav-audit',
        title: 'Audit Logs',
        subtitle: 'Immutable governance & security trail',
        category: 'Navigation',
        icon: Shield,
        perform: () => {
          navigate('/audit');
          onClose();
        },
      },
      {
        id: 'nav-status',
        title: 'System Status',
        subtitle: 'FastAPI, Postgres, Redis & Celery health',
        category: 'Navigation',
        icon: Activity,
        perform: () => {
          navigate('/status');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        title: 'Settings',
        subtitle: 'Tenant configuration & organization preferences',
        category: 'Navigation',
        icon: Settings,
        perform: () => {
          navigate('/settings');
          onClose();
        },
      },
    ],
    [navigate, onClose]
  );

  // Quick actions
  const actionCommands: CommandItem[] = useMemo(
    () => [
      {
        id: 'act-new-workflow',
        title: 'Create New Workflow',
        subtitle: 'Initialize a new orchestration graph',
        category: 'Actions',
        icon: Plus,
        perform: () => {
          onClose();
          if (onCreateWorkflow) {
            onCreateWorkflow();
          } else {
            navigate('/workflows');
          }
        },
      },
      {
        id: 'act-toggle-theme',
        title: `Switch Theme to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`,
        subtitle: `Currently using ${theme} mode`,
        category: 'Actions',
        icon: resolvedTheme === 'dark' ? Sun : Moon,
        perform: () => {
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
    ],
    [onCreateWorkflow, onClose, navigate, resolvedTheme, theme, setTheme]
  );

  // Filtered entity commands
  const entityCommands: CommandItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: CommandItem[] = [];

    // Workflows
    const matchedWorkflows = workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.description && w.description.toLowerCase().includes(q))
    );
    for (const w of matchedWorkflows.slice(0, 5)) {
      items.push({
        id: `wf-${w.id}`,
        title: w.name,
        subtitle: w.description || `Status: ${w.status}`,
        category: 'Workflows',
        icon: GitBranch,
        badge: w.status,
        badgeVariant:
          w.status === 'ACTIVE'
            ? 'success'
            : w.status === 'ARCHIVED'
            ? 'danger'
            : 'default',
        perform: () => {
          navigate(`/workflows/${w.id}`);
          onClose();
        },
      });
    }

    // Executions
    const matchedExecutions = executions.filter(
      (e) =>
        e.correlation_id.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.workflow_name && e.workflow_name.toLowerCase().includes(q))
    );
    for (const e of matchedExecutions.slice(0, 5)) {
      items.push({
        id: `exec-${e.id}`,
        title: e.workflow_name || 'Workflow Run',
        subtitle: `Corr: ${e.correlation_id} • ${e.trigger_type}`,
        category: 'Executions',
        icon: Layers,
        badge: e.status,
        badgeVariant:
          e.status === 'COMPLETED'
            ? 'success'
            : e.status === 'FAILED'
            ? 'danger'
            : e.status === 'RUNNING'
            ? 'warning'
            : 'default',
        perform: () => {
          navigate(`/executions?search=${encodeURIComponent(e.correlation_id)}`);
          onClose();
        },
      });
    }

    // Approvals
    const matchedApprovals = approvals.filter(
      (a) =>
        a.step_key.toLowerCase().includes(q) ||
        a.required_role.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
    );
    for (const a of matchedApprovals.slice(0, 4)) {
      items.push({
        id: `appr-${a.id}`,
        title: `Pending Approval: Step ${a.step_key}`,
        subtitle: `Required Role: ${a.required_role} • ${new Date(a.requested_at).toLocaleTimeString()}`,
        category: 'Approvals',
        icon: CheckSquare,
        badge: 'PENDING',
        badgeVariant: 'warning',
        perform: () => {
          navigate('/approvals');
          onClose();
        },
      });
    }

    return items;
  }, [query, workflows, executions, approvals, navigate, onClose]);

  // Combined visible items
  const allFilteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...actionCommands, ...navigationCommands];
    }

    const filteredNav = navigationCommands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.subtitle && c.subtitle.toLowerCase().includes(q))
    );

    const filteredActions = actionCommands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.subtitle && c.subtitle.toLowerCase().includes(q))
    );

    return [...entityCommands, ...filteredActions, ...filteredNav];
  }, [query, navigationCommands, actionCommands, entityCommands]);

  // Keep selected index in bound
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev + 1 >= allFilteredItems.length ? 0 : prev + 1
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev - 1 < 0 ? allFilteredItems.length - 1 : prev - 1
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (allFilteredItems[selectedIndex]) {
          allFilteredItems[selectedIndex].perform();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [allFilteredItems, selectedIndex, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl shadow-elevated overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-warm-200 dark:border-charcoal-800 gap-3 bg-warm-50/50 dark:bg-charcoal-850/50 flex-shrink-0">
          <Search className="w-5 h-5 text-warm-500 dark:text-charcoal-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, search workflows, executions, approvals..."
            className="flex-1 bg-transparent border-none text-sm text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none focus:ring-0"
          />
          {isSearching && (
            <Loader2 className="w-4 h-4 text-brand-600 dark:text-brand-400 animate-spin flex-shrink-0" />
          )}
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded text-warm-400 hover:text-warm-600 dark:hover:text-charcoal-200 transition-colors"
              title="Clear input"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-warm-200 dark:bg-charcoal-800 text-warm-600 dark:text-charcoal-400 border border-warm-300 dark:border-charcoal-700">
              ESC
            </span>
          )}
        </div>

        {/* Command List */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 divide-y divide-warm-100 dark:divide-charcoal-800/60"
        >
          {allFilteredItems.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <p className="text-xs font-semibold text-warm-800 dark:text-charcoal-200">
                No commands or resources found
              </p>
              <p className="text-[11px] text-warm-500 dark:text-charcoal-500 mt-1">
                No matching workflow, execution, or navigation action for &ldquo;{query}&rdquo;
              </p>
            </div>
          ) : (
            allFilteredItems.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;

              return (
                <div
                  key={item.id}
                  onClick={() => item.perform()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-900 dark:text-brand-100'
                      : 'hover:bg-warm-100/70 dark:hover:bg-charcoal-800/60 text-warm-800 dark:text-charcoal-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? 'bg-brand-600 dark:bg-brand-500 text-white border-brand-600 dark:border-brand-500'
                          : 'bg-warm-100 dark:bg-charcoal-800 border-warm-200 dark:border-charcoal-700 text-warm-600 dark:text-charcoal-400'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold truncate block">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                              item.badgeVariant === 'success'
                                ? 'bg-brand-100 dark:bg-brand-950/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60'
                                : item.badgeVariant === 'danger'
                                ? 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60'
                                : item.badgeVariant === 'warning'
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60'
                                : 'bg-warm-200 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <p className="text-[11px] text-warm-500 dark:text-charcoal-400 truncate mt-0.5">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pl-3 flex-shrink-0">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-warm-400 dark:text-charcoal-500 hidden sm:inline">
                      {item.category}
                    </span>
                    {isSelected && (
                      <CornerDownLeft className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="px-4 py-2.5 bg-warm-100/70 dark:bg-charcoal-850/70 border-t border-warm-200 dark:border-charcoal-800 flex items-center justify-between text-[11px] text-warm-500 dark:text-charcoal-400 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-[10px] font-mono shadow-2xs">
                &uarr;
              </kbd>
              <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-[10px] font-mono shadow-2xs">
                &darr;
              </kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-[10px] font-mono shadow-2xs">
                &crarr;
              </kbd>
              <span>select</span>
            </span>
          </div>
          <span className="text-[10px] font-mono text-warm-600 dark:text-charcoal-400">
            FlowPilot Control Plane
          </span>
        </div>
      </div>
    </div>
  );
};
