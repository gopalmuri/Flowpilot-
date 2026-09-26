import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Building2, User as UserIcon } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { user, activeOrganization, activeRole } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Organization & Account Settings</h1>
        <p className="text-xs text-slate-400 mt-1">Manage tenant configurations, members, and personal credentials.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2.5 text-indigo-400">
            <Building2 className="w-5 h-5" />
            <h2 className="text-sm font-semibold text-white">Active Organization</h2>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-slate-500 block text-[11px]">Name</span>
              <span className="font-semibold text-slate-200">{activeOrganization?.name}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Tenant Slug</span>
              <span className="font-mono text-indigo-300">/{activeOrganization?.slug}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Assigned Role</span>
              <span className="font-semibold text-emerald-400">{activeRole}</span>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2.5 text-indigo-400">
            <UserIcon className="w-5 h-5" />
            <h2 className="text-sm font-semibold text-white">User Profile</h2>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-slate-500 block text-[11px]">Full Name</span>
              <span className="font-semibold text-slate-200">{user?.full_name}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Email Address</span>
              <span className="text-slate-200">{user?.email}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};