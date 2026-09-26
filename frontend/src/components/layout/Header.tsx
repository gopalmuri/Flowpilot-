import React, { useState, useRef, useEffect } from 'react';
import {
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  LogOut,
  Menu,
  Shield,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { HealthResponse, fetchHealthStatus } from '../../services/api';

interface HeaderProps {
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const { user, organizations, activeOrganization, activeRole, switchOrganization, logout } =
    useAuth();

  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState<HealthResponse['status']>('healthy');

  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Poll or check system health
  useEffect(() => {
    fetchHealthStatus().then((res) => {
      setSystemStatus(res.status);
    });
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(event.target as Node)) {
        setIsOrgDropdownOpen(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compute initials
  const initials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : user?.email.slice(0, 2).toUpperCase() || 'FP';

  return (
    <header className="h-16 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 select-none">
      {/* Left: Mobile hamburger & Organization Switcher */}
      <div className="flex items-center gap-3">
        {onOpenMobileMenu && (
          <button
            type="button"
            aria-label="Open mobile navigation"
            onClick={onOpenMobileMenu}
            className="md:hidden p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Organization Switcher Dropdown */}
        <div className="relative" ref={orgDropdownRef}>
          <button
            type="button"
            aria-label="Select active organization"
            aria-haspopup="true"
            aria-expanded={isOrgDropdownOpen}
            onClick={() => {
              setIsOrgDropdownOpen(!isOrgDropdownOpen);
              setIsUserDropdownOpen(false);
            }}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800/90 hover:border-slate-700 hover:bg-slate-800/50 transition-all cursor-pointer text-left shadow-sm"
          >
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 flex-shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-slate-100 leading-tight">
                {activeOrganization ? activeOrganization.name : 'Select Organization'}
              </span>
              <span className="text-[10px] text-slate-400 leading-tight">
                {activeRole ? `${activeRole} Role` : 'No Tenant'}
              </span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 ml-1 transition-transform duration-150 ${isOrgDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOrgDropdownOpen && (
            <div className="absolute left-0 mt-2 w-64 rounded-2xl bg-slate-900/95 border border-slate-800/90 shadow-2xl shadow-black/80 py-1.5 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3.5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800/60">
                Your Organizations
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {organizations.length === 0 ? (
                  <div className="px-3.5 py-2 text-xs text-slate-400 italic">
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
                        className={`w-full flex items-center justify-between px-3.5 py-2 text-xs text-left hover:bg-slate-800/60 transition-colors ${
                          isSelected ? 'text-indigo-300 font-semibold bg-indigo-500/10' : 'text-slate-300'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="truncate">{org.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {org.role} &bull; /{org.slug}
                          </span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Health pill, API docs, User Menu */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* System Health Status Badge */}
        <div
          aria-label={`System health status: ${systemStatus}`}
          className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900/70 border border-slate-800 text-xs font-medium"
        >
          <span className="relative flex h-2 w-2">
            {systemStatus === 'healthy' && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                systemStatus === 'healthy'
                  ? 'bg-emerald-500'
                  : systemStatus === 'degraded'
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
            ></span>
          </span>
          <span className="text-slate-300 capitalize hidden sm:inline">{systemStatus}</span>
        </div>

        {/* API Docs Link */}
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          aria-label="View API Documentation"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-900/80 border border-transparent hover:border-slate-800 transition-all"
        >
          <BookOpen className="w-4 h-4" />
          <span>Docs</span>
        </a>

        {/* User Profile & Menu */}
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
            className="flex items-center gap-2.5 pl-2.5 border-l border-slate-800/80 hover:opacity-95 transition-opacity cursor-pointer text-left"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-semibold text-xs ring-1 ring-white/10 shadow-sm">
              {initials}
            </div>
            <div className="hidden md:flex flex-col">
              <span className="text-xs font-medium text-slate-200 leading-tight">
                {user?.full_name || 'Authenticated User'}
              </span>
              <span className="text-[10px] text-indigo-400 font-semibold leading-tight">
                {activeRole || 'Member'}
              </span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 hidden md:block transition-transform duration-150 ${isUserDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isUserDropdownOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-slate-900/95 border border-slate-800/90 shadow-2xl shadow-black/80 py-1.5 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
              <div className="px-4 py-2.5 border-b border-slate-800/80">
                <p className="text-xs font-semibold text-slate-200 truncate">
                  {user?.full_name}
                </p>
                <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
                {activeRole && (
                  <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-medium text-indigo-300">
                    <Shield className="w-3 h-3" />
                    {activeRole}
                  </span>
                )}
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsUserDropdownOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors text-left font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
