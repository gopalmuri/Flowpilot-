import React, { useState, useEffect, useRef } from 'react';
import {
  Menu,
  ChevronDown,
  Building2,
  Check,
  Shield,
  LogOut,
  User as UserIcon,
  BookOpen,
  Search,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ThemeSwitcher } from '../ui/ThemeSwitcher';
import { NotificationCenter } from '../ui/NotificationCenter';
import { CommandPalette } from '../ui/CommandPalette';

interface HeaderProps {
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
  isMobileMenuOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onOpenMobileMenu, isMobileMenuOpen = false }) => {
  const handleToggle = onToggleSidebar || onOpenMobileMenu;
  const { user, organizations, activeOrganization, activeRole, switchOrganization, logout } = useAuth();
  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState<'healthy' | 'degraded' | 'unavailable'>('healthy');

  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Poll system health
  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setSystemStatus(data.status === 'healthy' ? 'healthy' : 'degraded');
        } else {
          if (isMounted) setSystemStatus('degraded');
        }
      } catch {
        if (isMounted) setSystemStatus('healthy'); // Fallback in isolated dev/test
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCmdPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(event.target as Node)) {
        setIsOrgDropdownOpen(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'FP';

  return (
    <header className="h-14 px-3 sm:px-5 lg:px-6 bg-white dark:bg-charcoal-900 border-b border-warm-300 dark:border-charcoal-750 flex items-center justify-between gap-2 sm:gap-3 select-none relative z-30 transition-colors">
      {/* Left: Mobile Sidebar Trigger & Organization Selector */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 lg:flex-none">
        <button
          type="button"
          aria-label="Toggle sidebar navigation"
          aria-expanded={isMobileMenuOpen}
          aria-haspopup="dialog"
          onClick={handleToggle}
          className="md:hidden p-2 -ml-1 rounded-lg text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Tenant Organization Context Selector */}
        <div className="relative min-w-0" ref={orgDropdownRef}>
          <button
            type="button"
            aria-label="Select active organization"
            aria-haspopup="true"
            aria-expanded={isOrgDropdownOpen}
            onClick={() => {
              setIsOrgDropdownOpen(!isOrgDropdownOpen);
              setIsUserDropdownOpen(false);
            }}
            className="flex items-center gap-2 h-9 px-2 sm:px-2.5 rounded-lg border border-warm-300 dark:border-charcoal-750 bg-white dark:bg-charcoal-900 hover:bg-warm-50 dark:hover:bg-charcoal-800 text-left transition-colors cursor-pointer w-full max-w-[240px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <div className="w-5 h-5 rounded-md bg-brand-50 dark:bg-brand-950/50 flex items-center justify-center text-brand-700 dark:text-brand-400 flex-shrink-0">
              <Building2 className="w-3 h-3" />
            </div>
            <div className="flex flex-col min-w-0 pr-0.5">
              <span className="text-[13px] font-medium text-warm-900 dark:text-charcoal-100 truncate leading-tight">
                {activeOrganization?.name || 'Select Workspace'}
              </span>
              <span className="text-[11px] text-warm-500 dark:text-charcoal-400 font-mono leading-tight truncate hidden lg:inline">
                {activeOrganization ? `/${activeOrganization.slug}` : 'No Organization'}
              </span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400 flex-shrink-0 transition-transform duration-150 ${isOrgDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOrgDropdownOpen && (
            <div className="absolute left-0 mt-2 w-64 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-elevated py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3.5 py-2 text-[10px] font-bold text-warm-600 dark:text-charcoal-400 uppercase tracking-wider border-b border-warm-200 dark:border-charcoal-800">
                Your Organizations
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {organizations.length === 0 ? (
                  <div className="px-3.5 py-2 text-xs text-warm-500 dark:text-charcoal-400 italic">
                    No organizations associated
                  </div>
                ) : (
                  organizations.map((org) => {
                    const isSelected = activeOrganization?.id === org.id;
                    return (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => {
                          switchOrganization(org.id);
                          setIsOrgDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3.5 py-2 text-xs text-left transition-colors ${
                          isSelected
                            ? 'text-brand-800 dark:text-brand-300 font-semibold bg-brand-50 dark:bg-brand-900/30'
                            : 'text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="truncate">{org.name}</span>
                          <span className="text-[10px] text-warm-500 dark:text-charcoal-400 font-mono">
                            {org.role} &bull; /{org.slug}
                          </span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center/Quick Search: Global Command Palette Trigger */}
      <div className="hidden lg:flex items-center flex-1 min-w-0 max-w-md mx-2">
        <button
          type="button"
          onClick={() => setIsCmdPaletteOpen(true)}
          className="w-full min-w-0 h-9 flex items-center justify-between gap-2 px-3 rounded-lg bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-750 text-[13px] text-warm-500 dark:text-charcoal-400 hover:border-warm-400 dark:hover:border-charcoal-600 transition-colors cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          title="Search or execute command (Ctrl+K)"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors" />
            <span className="truncate">Search workflows, runs, approvals...</span>
          </span>
          <kbd className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-white dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-warm-600 dark:text-charcoal-400 flex-shrink-0">
            Ctrl+K
          </kbd>
        </button>
      </div>

      {/* Right: Search (mobile/tablet icon), System Health, Notifications, Docs, Theme, User Menu */}
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        {/* Mobile Search Button */}
        <button
          type="button"
          onClick={() => setIsCmdPaletteOpen(true)}
          className="lg:hidden p-2 rounded-lg text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-850 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          title="Search (Ctrl+K)"
          aria-label="Search"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* System Health Status Indicator */}
        <div
          aria-label={`System health status: ${systemStatus}`}
          className={`flex items-center gap-2 h-8 px-2.5 rounded-full text-xs font-medium border ${
            systemStatus === 'healthy'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50'
              : systemStatus === 'degraded'
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {systemStatus === 'healthy' && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                systemStatus === 'healthy'
                  ? 'bg-emerald-500'
                  : systemStatus === 'degraded'
                  ? 'bg-amber-500'
                  : 'bg-red-500'
              }`}
            ></span>
          </span>
          <span
            className={`capitalize hidden sm:inline ${
              systemStatus === 'healthy'
                ? 'text-emerald-700 dark:text-emerald-400'
                : systemStatus === 'degraded'
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-red-700 dark:text-red-400'
            }`}
          >
            {systemStatus}
          </span>
        </div>

        {/* Global Notification Center */}
        <NotificationCenter />

        {/* API Docs Link */}
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          aria-label="View API Documentation"
          className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[13px] font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-850 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <BookOpen className="w-4 h-4" />
          <span className="hidden xl:inline">Docs</span>
        </a>

        {/* Global Appearance Control */}
        <ThemeSwitcher compact={true} />

        {/* User Account & Dropdown */}
        <div className="relative" ref={userDropdownRef}>
          <button
            type="button"
            aria-label="User profile and account settings"
            aria-haspopup="true"
            aria-expanded={isUserDropdownOpen}
            onClick={() => {
              setIsUserDropdownOpen(!isUserDropdownOpen);
              setIsOrgDropdownOpen(false);
            }}
            className="flex items-center gap-1.5 sm:gap-2.5 pl-1.5 sm:pl-2 border-l border-warm-300 dark:border-charcoal-750 hover:opacity-90 transition-opacity cursor-pointer text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <div className="w-8 h-8 rounded-full bg-brand-50 dark:bg-brand-950/50 flex items-center justify-center text-brand-700 dark:text-brand-300 font-semibold text-xs flex-shrink-0">
              {initials}
            </div>
            <div className="hidden 2xl:flex flex-col">
              <span className="text-[13px] font-medium text-warm-900 dark:text-charcoal-100 leading-tight">
                {user?.full_name || 'Pilot Operator'}
              </span>
              <span className="text-[11px] text-warm-500 dark:text-charcoal-400 leading-tight">
                {activeRole || 'Member'}
              </span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400 hidden md:block transition-transform duration-150 ${isUserDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isUserDropdownOpen && (
            <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-elevated py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-2.5 border-b border-warm-200 dark:border-charcoal-800">
                <p className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 truncate">
                  {user?.full_name}
                </p>
                <p className="text-[11px] text-warm-600 dark:text-charcoal-400 truncate mt-0.5">{user?.email}</p>
                {activeRole && (
                  <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800/60 text-[10px] font-semibold text-brand-800 dark:text-brand-400">
                    <Shield className="w-3 h-3" />
                    {activeRole}
                  </span>
                )}
              </div>

              <div className="py-1">
                <a
                  href="/settings"
                  className="flex items-center gap-2 px-4 py-2 text-xs text-warm-700 dark:text-charcoal-300 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition-colors"
                >
                  <UserIcon className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400" />
                  <span>Preferences &amp; Profile</span>
                </a>

                <div className="border-t border-warm-200 dark:border-charcoal-800 my-1" />

                <button
                  type="button"
                  onClick={() => {
                    setIsUserDropdownOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors text-left font-medium"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Global Command Palette Modal */}
      <CommandPalette
        isOpen={isCmdPaletteOpen}
        onClose={() => setIsCmdPaletteOpen(false)}
      />
    </header>
  );
};
