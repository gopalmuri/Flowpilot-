import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
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

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  /** Signed-in user summary shown at the bottom of the sidebar (the account menu lives in the Header). */
  profile?: { name: string; role?: string | null };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'FP';

const SIDEBAR_COLLAPSED_KEY = 'flowpilot_sidebar_collapsed';

const SECTIONS = [
  {
    title: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/workflows', label: 'Workflows', icon: GitBranch },
      { to: '/executions', label: 'Executions', icon: Layers },
      { to: '/approvals', label: 'Approvals', icon: CheckSquare },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/integrations', label: 'Integrations', icon: Plug },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/analytics#sla', label: 'SLA Monitoring', icon: Clock },
    ],
  },
  {
    title: 'Governance',
    items: [
      { to: '/audit', label: 'Audit Logs', icon: Shield },
      { to: '/status', label: 'System Status', icon: Activity },
    ],
  },
  {
    title: 'Settings',
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen = false, onCloseMobile, profile }) => {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onCloseMobile);
  closeRef.current = onCloseMobile;
  const lastRouteRef = useRef(location.pathname + location.hash);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed ? 'true' : 'false');
    } catch {
      // Ignore
    }
  }, [isCollapsed]);

  // Close the drawer when the route changes
  useEffect(() => {
    const current = location.pathname + location.hash;
    if (current !== lastRouteRef.current) {
      lastRouteRef.current = current;
      if (isMobileOpen) closeRef.current?.();
    }
  }, [location.pathname, location.hash, isMobileOpen]);

  // Drawer: Esc to close, focus trap, restore focus, lock body scroll
  useEffect(() => {
    if (!isMobileOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusables = () => (drawer ? Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
    (focusables()[0] ?? drawer)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !drawer?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !drawer?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isMobileOpen]);

  const isItemActive = (to: string) => {
    const [path, hash] = to.split('#');
    const onPath = location.pathname === path || location.pathname.startsWith(path + '/');
    if (!onPath) return false;
    if (hash) return location.hash === `#${hash}`;
    // Plain /analytics is not active while its SLA anchor is selected
    if (path === '/analytics') return location.hash !== '#sla';
    return true;
  };

  const renderSidebarContent = (isDrawer: boolean = false) => {
    const collapsed = isDrawer ? false : isCollapsed;

    return (
      <div
        className={`flex flex-col h-full bg-white dark:bg-charcoal-900 border-r border-warm-300 dark:border-charcoal-750 select-none transition-[width] duration-200 ${
          isDrawer ? 'w-full' : collapsed ? 'w-[68px]' : 'w-56 lg:w-60'
        }`}
      >
        {/* Brand header */}
        <div
          className={`h-14 flex items-center flex-shrink-0 ${
            collapsed ? 'justify-center px-2' : 'justify-between pl-4 pr-2'
          }`}
        >
          <FlowPilotLogo size={28} showText={!collapsed} showBadge={false} subtitle="" />

          {isDrawer ? (
            <button
              type="button"
              aria-label="Close mobile navigation"
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg text-warm-500 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            !collapsed && (
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="hidden md:flex p-1.5 rounded-lg text-warm-400 dark:text-charcoal-500 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* Navigation */}
        <nav aria-label="Main Navigation" className="flex-1 pt-2 pb-3 px-2 space-y-5 overflow-y-auto">
          {SECTIONS.map((section) => (
            <div key={section.title} className="space-y-0.5">
              {!collapsed && (
                <div className="px-2.5 pb-1 text-[11px] font-medium text-warm-500 dark:text-charcoal-400 tracking-wide">
                  {section.title}
                </div>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = isItemActive(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={isDrawer ? onCloseMobile : undefined}
                    className={`group flex items-center h-9 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
                    } ${
                      isActive
                        ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 font-semibold'
                        : 'text-warm-600 dark:text-charcoal-300 font-medium hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800'
                    }`}
                  >
                    <Icon
                      className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                        isActive
                          ? 'text-brand-600 dark:text-brand-400'
                          : 'text-warm-400 dark:text-charcoal-400 group-hover:text-warm-700 dark:group-hover:text-charcoal-200'
                      }`}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer: expand control (collapsed) + profile */}
        <div className="px-2 py-2 border-t border-warm-200 dark:border-charcoal-800 flex-shrink-0 space-y-1">
          {collapsed && !isDrawer && (
            <button
              type="button"
              onClick={() => setIsCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="w-full h-9 flex items-center justify-center rounded-lg text-warm-400 dark:text-charcoal-500 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {profile && (
            <div
              data-testid="sidebar-profile"
              className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? profile.name : undefined}
            >
              <div className="w-8 h-8 rounded-full bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {getInitials(profile.name)}
              </div>
              {!collapsed && (
                <div className="min-w-0 leading-tight">
                  <p className="text-[13px] font-medium text-warm-900 dark:text-charcoal-100 truncate">{profile.name}</p>
                  {profile.role && (
                    <p className="text-xs text-warm-500 dark:text-charcoal-400 truncate capitalize">
                      {profile.role.toLowerCase()}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop / tablet persistent sidebar */}
      <aside className="hidden md:flex h-screen flex-shrink-0">{renderSidebarContent(false)}</aside>

      {/* Mobile drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            data-testid="mobile-nav-overlay"
            className="fixed inset-0 bg-slate-900/40 transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="relative flex flex-col w-72 max-w-[85vw] h-full shadow-modal outline-none"
          >
            {renderSidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
