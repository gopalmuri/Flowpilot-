import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Database,
  Cpu,
  RefreshCw,
  Terminal,
  Zap,
  Server,
  Layers,
  Copy,
  Check,
} from 'lucide-react';
import { fetchHealthStatus, HealthResponse } from '../services/api';

export const StatusPage: React.FC = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const loadStatus = async () => {
    setLoading(true);
    const data = await fetchHealthStatus();
    setHealth(data);
    setLoading(false);
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const copyCurl = () => {
    navigator.clipboard.writeText('curl -i http://localhost:8000/api/v1/health');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isHealthy = health?.status === 'healthy';
  const isDegraded = health?.status === 'degraded';

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl glass-panel relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="space-y-1 z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">System Status & Topology</h1>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                isHealthy
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : isDegraded
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              {isHealthy ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              {health?.status || 'Checking...'}
            </span>
          </div>
          <p className="text-sm text-slate-400">
            Real-time infrastructure health, microservices connectivity, and API latency metrics.
          </p>
        </div>

        <div className="flex items-center gap-3 z-10">
          {health?.latencyMs !== undefined && (
            <div className="px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs font-mono text-slate-300">
              <span className="text-slate-400">Ping:</span>{' '}
              <span className="text-indigo-400 font-semibold">{health.latencyMs}ms</span>
            </div>
          )}

          <button
            onClick={loadStatus}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Grid of Core Services */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Service 1: FastAPI */}
        <div className="p-5 rounded-2xl glass-panel glass-panel-hover flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Server className="w-5 h-5" />
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
                Active
              </span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">FastAPI Core</h3>
              <p className="text-xs text-slate-400 mt-0.5">Asynchronous HTTP & OpenAPI Engine</p>
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Port 8000</span>
            <span className="text-slate-300">v{health?.version || '1.0.0'}</span>
          </div>
        </div>

        {/* Service 2: PostgreSQL */}
        <div className="p-5 rounded-2xl glass-panel glass-panel-hover flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Database className="w-5 h-5" />
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                  health?.services.database === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                {health?.services.database || 'Configured'}
              </span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">PostgreSQL 16</h3>
              <p className="text-xs text-slate-400 mt-0.5">Multi-Tenant Relational Store</p>
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Port 5432</span>
            <span className="text-slate-300">asyncpg pool</span>
          </div>
        </div>

        {/* Service 3: Redis */}
        <div className="p-5 rounded-2xl glass-panel glass-panel-hover flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <Zap className="w-5 h-5" />
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                  health?.services.redis === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                {health?.services.redis || 'Configured'}
              </span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Redis 7</h3>
              <p className="text-xs text-slate-400 mt-0.5">Task Broker & Idempotency Store</p>
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Port 6379</span>
            <span className="text-slate-300">In-Memory</span>
          </div>
        </div>

        {/* Service 4: Celery Workers */}
        <div className="p-5 rounded-2xl glass-panel glass-panel-hover flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                <Cpu className="w-5 h-5" />
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-medium border border-indigo-500/20">
                Ready
              </span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Celery Workers</h3>
              <p className="text-xs text-slate-400 mt-0.5">Async Workflow Execution Pool</p>
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Concurrency 4</span>
            <span className="text-slate-300">app.workers</span>
          </div>
        </div>
      </div>

      {/* Two Column Section: Live Health Payload + Dev Quickstart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Live Health Payload */}
        <div className="p-6 rounded-2xl glass-panel space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Live Endpoint Response</h3>
            </div>
            <span className="text-xs font-mono text-slate-400">GET /api/v1/health</span>
          </div>

          <pre className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto leading-relaxed">
            {JSON.stringify(health, null, 2)}
          </pre>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Last polled: {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : 'N/A'}</span>
            <button
              onClick={copyCurl}
              className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied curl!' : 'Copy curl'}</span>
            </button>
          </div>
        </div>

        {/* Right: Technical Phase Tracker */}
        <div className="p-6 rounded-2xl glass-panel space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Engineering Milestone Status</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-900/70 border border-emerald-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-slate-200">Phase 1: Architecture & Specs</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                Completed
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/70 border border-indigo-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Activity className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span className="font-semibold text-slate-200">Phase 2: Foundation & Health Checks</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
                Active Now
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between text-slate-400">
              <div className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[10px]">
                  3
                </span>
                <span>Phase 3: PostgreSQL Models & Alembic Migrations</span>
              </div>
              <span className="text-[11px] text-slate-400">Up Next</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between text-slate-400">
              <div className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[10px]">
                  4
                </span>
                <span>Phase 4: Multi-Tenant Authentication & RBAC</span>
              </div>
              <span className="text-[11px] text-slate-400">Queued</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
