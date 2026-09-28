import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  GitBranch,
  Layers,
  LayoutDashboard,
  Plug,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { FlowPilotLogo } from '../ui/FlowPilotLogo';
import { ThemeSwitcher } from '../ui/ThemeSwitcher';

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const SIDEBAR_COLLAPSED_KEY = 'flowpilot_sidebar_collapsed';

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen = false, onCloseMobile }) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed ? 'true' : 'false');
    } catch {
      // Ignore
    }
  }, [isCollapsed]);

  const sections = [
    {
      title: 'WORKSPACE',
      items: [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/workflows', label: 'Workflows', icon: GitBranch },
        { to: '/executions', label: 'Executions', icon: Layers },
        { to: '/approvals', label: 'Approvals', icon: CheckSquare },
      ],
    },
    {
      title: 'OPERATIONS',
      items: [
        { to: '/integrations', label: 'Integrations', icon: Plug },
        { to: '/analytics', label: 'Analytics', icon: BarChart3 },
        { to: '/analytics#sla', label: 'SLA Monitoring', icon: Clock },
      ],
    },
    {
      title: 'GOVERNANCE',
      items: [
        { to: '/audit', label: 'Audit Logs', icon: Shield },
        { to: '/status', label: 'System Status', icon: Activity },
      ],
    },
    {
      title: 'SETTINGS',
      items: [
        { to: '/settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  const renderSidebarContent = (isDrawer: boolean = false) => {
    const collapsed = isDrawer ? false : isCollapsed;

    return (
      <div
        className={`flex flex-col h-full bg-white dark:bg-charcoal-900 border-r border-warm-300 dark:border-charcoal-750 select-none transition-all duration-200 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-warm-300 dark:border-charcoal-750 flex-shrink-0">
          <FlowPilotLogo
            size={30}
            showText={!collapsed}
            subtitle="Business Workflow Control"
          />

          {isDrawer ? (
            <button
              type="button"
              aria-label="Close mobile navigation"
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden md:flex p-1.5 rounded-lg text-warm-500 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition-colors"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav aria-label="Main Navigation" className="flex-1 py-4 px-2.5 space-y-4 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <div className="px-2.5 pb-1 text-[10px] font-bold text-warm-600 dark:text-charcoal-400 uppercase tracking-wider">
                  {section.title}
                </div>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    onClick={onCloseMobile}
                    className={({ isActive }) =>
                      `group w-full flex items-center ${
                        collapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2'
                      } rounded-lg text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-900 dark:text-brand-200 border border-brand-200 dark:border-brand-800/60 font-semibold'
                          : 'text-warm-800 dark:text-charcoal-200 hover:text-warm-950 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 border border-transparent'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 flex-shrink-0 transition-colors ${
                            isActive
                              ? 'text-brand-600 dark:text-brand-400'
                              : 'text-warm-600 dark:text-charcoal-400 group-hover:text-warm-950 dark:group-hover:text-charcoal-200'
                          }`}
                        />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </div>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Appearance Control Footer */}
        <div className="p-3 border-t border-warm-300 dark:border-charcoal-750 flex-shrink-0">
          {!collapsed ? (
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-warm-600 dark:text-charcoal-400">
                Appearance
              </span>
              <ThemeSwitcher compact={true} />
            </div>
          ) : (
            <div className="flex justify-center">
              <ThemeSwitcher compact={true} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex h-screen flex-shrink-0">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full shadow-modal">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
