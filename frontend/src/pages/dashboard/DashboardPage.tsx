import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckSquare,
  GitBranch,
  Layers,
  Lock,
  Plug,
  Shield,
  Zap,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { user, activeOrganization, activeRole } = useAuth();

  const kpis = [
    {
      title: 'Automated Workflows',
      desc: 'Active DAG pipelines',
      to: '/workflows',
      icon: GitBranch,
      color: 'indigo',
      badge: 'Operational',
      action: 'Manage Workflows',
    },
    {
      title: 'Execution Telemetry',
      desc: 'Real-time Celery runs',
      to: '/executions',
      icon: Layers,
      color: 'violet',
      badge: '99.98% Success',
      action: 'View Stream',
    },
    {
      title: 'Pending Approvals',
      desc: 'Human review gating',
      to: '/approvals',
      icon: CheckSquare,
      color: 'emerald',
      badge: 'Zero Backlog',
      action: 'Review Queue',
    },
    {
      title: 'Active Integrations',
      desc: 'Connected SaaS endpoints',
      to: '/integrations',
      icon: Plug,
      color: 'cyan',
      badge: 'Connected',
      action: 'Configure APIs',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Executive Welcome Hero Banner */}
      <div className="p-6 sm:p-8 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800/90 shadow-2xl relative overflow-hidden backdrop-blur-xl">
        {/* Subtle accent glows */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[11px] font-semibold text-indigo-300">
                <Zap className="w-3.5 h-3.5 fill-current" />
                Orchestration Console
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-400">
                <Shield className="w-3 h-3" />
                {activeRole || 'Member'} Role
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Welcome back, {user?.full_name || 'Pilot'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Connected to enterprise workspace{' '}
              <strong className="text-slate-200 font-semibold">
                {activeOrganization?.name || 'Default Organization'}
              </strong>{' '}
              <span className="font-mono text-indigo-300">
                (/{activeOrganization?.slug || 'flowpilot'})
              </span>
              . Workflows, background Celery workers, and execution SLA monitoring are fully operational.
            </p>
          </div>

          {/* Quick Action CTA Group */}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/workflows"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
            >
              <GitBranch className="w-4 h-4" />
              <span>Explore Workflows</span>
            </Link>
            <Link
              to="/analytics"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-xs font-semibold text-slate-200 transition-all cursor-pointer hover:text-white"
            >
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              <span>Analytics &amp; SLA</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Module Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Link
              key={kpi.title}
              to={kpi.to}
              className="group p-5 rounded-2xl bg-slate-900/75 border border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-900 transition-all duration-200 shadow-lg text-left flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300 border border-slate-700/60 font-mono">
                    {kpi.badge}
                  </span>
                </div>
                <h2 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                  {kpi.title}
                </h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {kpi.desc}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs font-medium text-slate-400 group-hover:text-indigo-400 transition-colors">
                <span>{kpi.action}</span>
                <ArrowUpRight className="w-4 h-4 transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Tenant Context & Security Specs Panel */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl backdrop-blur-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-indigo-400" />
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Active Tenant &amp; Governance Context
            </h2>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Isolated
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 block text-[11px] font-medium mb-1">Organization Name</span>
            <span className="font-semibold text-slate-100 text-sm">{activeOrganization?.name || 'FlowPilot Core'}</span>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 block text-[11px] font-medium mb-1">Workspace Route</span>
            <span className="font-mono text-indigo-300 text-sm">/{activeOrganization?.slug || 'flowpilot'}</span>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 block text-[11px] font-medium mb-1">Assigned RBAC Role</span>
            <span className="font-semibold text-emerald-400 text-sm">{activeRole || 'OWNER'}</span>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 block text-[11px] font-medium mb-1">Data Boundary</span>
            <span className="font-mono text-slate-300 text-sm flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-indigo-400" /> Tenant Isolated
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
