import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Building2,
  User as UserIcon,
  Palette,
  Shield,
  Users,
  Sliders,
  Check,
  Sun,
  Moon,
  Laptop,
  Sidebar as SidebarIcon,
  Globe,
} from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { user, activeOrganization, activeRole } = useAuth();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<'appearance' | 'organization' | 'general' | 'members' | 'security'>('appearance');
  const [sidebarPreference, setSidebarPreference] = useState<'expanded' | 'compact'>('expanded');

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-warm-900 dark:text-charcoal-100 tracking-tight">
          Settings & Workspace Preferences
        </h1>
        <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-1">
          Manage control plane appearance, organization governance, and administrative policies.
        </p>
      </div>

      <div className="flex border-b border-warm-200 dark:border-charcoal-750 gap-2 overflow-x-auto">
        {[
          { id: 'appearance', label: 'Appearance', icon: Palette },
          { id: 'organization', label: 'Organization', icon: Building2 },
          { id: 'general', label: 'General', icon: Sliders },
          { id: 'members', label: 'Members & Roles', icon: Users },
          { id: 'security', label: 'Security & Access', icon: Shield },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 px-3 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-brand-600 text-brand-700 dark:text-brand-400 font-semibold'
                  : 'border-transparent text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'appearance' && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 space-y-4 shadow-subtle">
            <div>
              <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100 flex items-center gap-2">
                <Palette className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                Color Theme
              </h2>
              <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-0.5">
                Select your preferred visual interface. Changes apply globally across all views and persist across sessions.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  theme === 'light'
                    ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 ring-2 ring-brand-500/20'
                    : 'border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-850 hover:border-warm-300 dark:hover:border-charcoal-700'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-8 h-8 rounded-lg bg-warm-100 flex items-center justify-center text-warm-800">
                    <Sun className="w-4 h-4 text-amber-600" />
                  </div>
                  {theme === 'light' && (
                    <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">Light Mode</div>
                  <div className="text-[11px] text-warm-500 dark:text-charcoal-400 mt-0.5">
                    Warm neutral off-white surface with forest accents
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  theme === 'dark'
                    ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 ring-2 ring-brand-500/20'
                    : 'border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-850 hover:border-warm-300 dark:hover:border-charcoal-700'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-8 h-8 rounded-lg bg-charcoal-900 flex items-center justify-center text-charcoal-200">
                    <Moon className="w-4 h-4 text-brand-400" />
                  </div>
                  {theme === 'dark' && (
                    <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">Dark Mode</div>
                  <div className="text-[11px] text-warm-500 dark:text-charcoal-400 mt-0.5">
                    Deep charcoal control plane with emerald accents
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTheme('system')}
                className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  theme === 'system'
                    ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/20 ring-2 ring-brand-500/20'
                    : 'border-warm-200 dark:border-charcoal-750 bg-white dark:bg-charcoal-850 hover:border-warm-300 dark:hover:border-charcoal-700'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-8 h-8 rounded-lg bg-warm-200 dark:bg-charcoal-800 flex items-center justify-center text-warm-700 dark:text-charcoal-300">
                    <Laptop className="w-4 h-4" />
                  </div>
                  {theme === 'system' && (
                    <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">System Preference</div>
                  <div className="text-[11px] text-warm-500 dark:text-charcoal-400 mt-0.5">
                    Automatically synchronize with OS dark/light setting
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 space-y-4 shadow-subtle">
            <div>
              <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100 flex items-center gap-2">
                <SidebarIcon className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                Sidebar Navigation Layout
              </h2>
              <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-0.5">
                Choose the default density of the primary navigation panel.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSidebarPreference('expanded')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border transition ${
                  sidebarPreference === 'expanded'
                    ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-800/60'
                    : 'bg-warm-50 dark:bg-charcoal-850 text-warm-600 dark:text-charcoal-400 border-warm-200 dark:border-charcoal-750 hover:bg-warm-100 dark:hover:bg-charcoal-800'
                }`}
              >
                Expanded (Icon + Label)
              </button>
              <button
                type="button"
                onClick={() => setSidebarPreference('compact')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border transition ${
                  sidebarPreference === 'compact'
                    ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-800/60'
                    : 'bg-warm-50 dark:bg-charcoal-850 text-warm-600 dark:text-charcoal-400 border-warm-200 dark:border-charcoal-750 hover:bg-warm-100 dark:hover:bg-charcoal-800'
                }`}
              >
                Compact (Icon Only)
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'organization' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 space-y-4 shadow-subtle">
            <div className="flex items-center gap-2.5 text-brand-600 dark:text-brand-400">
              <Building2 className="w-5 h-5" />
              <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Active Organization</h2>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Organization Name</span>
                <span className="font-semibold text-warm-900 dark:text-charcoal-100">{activeOrganization?.name || 'Default Workspace'}</span>
              </div>
              <div>
                <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Tenant Slug</span>
                <span className="font-mono text-brand-700 dark:text-brand-400">/{activeOrganization?.slug || 'flowpilot'}</span>
              </div>
              <div>
                <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Assigned Role</span>
                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60">
                  {activeRole || 'ADMIN'}
                </span>
              </div>
              <div>
                <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Plan Level</span>
                <span className="font-medium text-warm-800 dark:text-charcoal-200">Enterprise Control Plane</span>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 space-y-4 shadow-subtle">
            <div className="flex items-center gap-2.5 text-brand-600 dark:text-brand-400">
              <UserIcon className="w-5 h-5" />
              <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">User Profile</h2>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Full Name</span>
                <span className="font-semibold text-warm-900 dark:text-charcoal-100">{user?.full_name || 'Workflow Administrator'}</span>
              </div>
              <div>
                <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Email Address</span>
                <span className="text-warm-800 dark:text-charcoal-200">{user?.email || 'admin@flowpilot.internal'}</span>
              </div>
              <div>
                <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Status</span>
                <span className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Active User
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'general' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 space-y-4 shadow-subtle">
          <div className="flex items-center gap-2.5 text-brand-600 dark:text-brand-400">
            <Globe className="w-5 h-5" />
            <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Regional & System Preferences</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2">
            <div>
              <label className="block text-warm-700 dark:text-charcoal-300 font-medium mb-1">Timezone Display</label>
              <select className="w-full px-3 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600">
                <option value="utc">UTC (Coordinated Universal Time)</option>
                <option value="local">Local Browser Time</option>
              </select>
            </div>
            <div>
              <label className="block text-warm-700 dark:text-charcoal-300 font-medium mb-1">Workflow Execution Logs Retention</label>
              <select className="w-full px-3 py-2 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600">
                <option value="90">90 Days (Enterprise Standard)</option>
                <option value="180">180 Days</option>
                <option value="365">365 Days</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 space-y-4 shadow-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-brand-600 dark:text-brand-400">
              <Users className="w-5 h-5" />
              <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Organization Members</h2>
            </div>
            <span className="text-xs text-warm-500 dark:text-charcoal-400 font-medium">1 Active Operator</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-warm-100 dark:bg-charcoal-850 text-warm-600 dark:text-charcoal-400 uppercase text-[10px] tracking-wider border-b border-warm-200 dark:border-charcoal-750">
                <tr>
                  <th className="py-2.5 px-3">Member</th>
                  <th className="py-2.5 px-3">Email</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-200 dark:divide-charcoal-800">
                <tr>
                  <td className="py-3 px-3 font-semibold text-warm-900 dark:text-charcoal-100">{user?.full_name || 'Admin User'}</td>
                  <td className="py-3 px-3 text-warm-600 dark:text-charcoal-400 font-mono">{user?.email || 'admin@flowpilot.internal'}</td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60">
                      {activeRole || 'ADMIN'}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                      Active
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 space-y-4 shadow-subtle">
          <div className="flex items-center gap-2.5 text-brand-600 dark:text-brand-400">
            <Shield className="w-5 h-5" />
            <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Security & Authentication</h2>
          </div>
          <div className="space-y-3 text-xs pt-2">
            <div className="p-4 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 flex items-center justify-between">
              <div>
                <div className="font-semibold text-warm-900 dark:text-charcoal-100">Role-Based Access Control (RBAC)</div>
                <div className="text-warm-500 dark:text-charcoal-400 text-[11px] mt-0.5">Enforced on all workflow authoring and execution actions.</div>
              </div>
              <span className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60">
                ACTIVE
              </span>
            </div>

            <div className="p-4 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 flex items-center justify-between">
              <div>
                <div className="font-semibold text-warm-900 dark:text-charcoal-100">Session JWT Token Validity</div>
                <div className="text-warm-500 dark:text-charcoal-400 text-[11px] mt-0.5">Automatic bearer token refresh and revocation on sign out.</div>
              </div>
              <span className="font-mono text-warm-700 dark:text-charcoal-300 text-[11px]">60 min TTL</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
