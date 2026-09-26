import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  CheckSquare,
  GitBranch,
  Layers,
  LayoutDashboard,
  Plug,
  Settings,
  Shield,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen = false, onCloseMobile }) => {
  const sections = [
    {
      title: 'Platform',
      items: [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      ],
    },
    {
      title: 'Workflows',
      items: [
        { to: '/workflows', label: 'Workflows', icon: GitBranch },
        { to: '/executions', label: 'Executions', icon: Layers },
        { to: '/approvals', label: 'Approvals', icon: CheckSquare },
      ],
    },
    {
      title: 'Infrastructure',
      items: [
        { to: '/integrations', label: 'Integrations', icon: Plug },
        { to: '/audit', label: 'Audit Logs', icon: Shield },
        { to: '/status', label: 'System Status', icon: Activity, badge: 'Live' },
        { to: '/settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  const renderSidebarContent = (isDrawer: boolean = false) => (
    <div className="flex flex-col h-full bg-slate-950/95 border-r border-slate-800/80 w-64 select-none backdrop-blur-xl">
      {/* Brand Logo & Close Button */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-600/25 text-white font-bold ring-1 ring-white/10">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-base text-white tracking-tight">FlowPilot</span>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                PRO
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium tracking-tight">
              Enterprise Orchestration
            </span>
          </div>
        </div>

        {isDrawer && onCloseMobile && (
          <button
            type="button"
            aria-label="Close mobile navigation"
            onClick={onCloseMobile}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav aria-label="Main Navigation" className="flex-1 py-4 px-3 space-y-5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {section.title}
            </div>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    `group w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/70 border border-transparent'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={`w-4 h-4 transition-colors ${
                            isActive
                              ? 'text-indigo-400'
                              : 'text-slate-500 group-hover:text-slate-300'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-medium">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer Info Card */}
      <div className="p-3.5 border-t border-slate-800/80">
        <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Phase 15 Active</span>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Execution Analytics &amp; SLA Monitoring operational.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden md:flex h-screen flex-shrink-0">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full shadow-2xl">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
