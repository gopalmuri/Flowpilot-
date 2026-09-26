import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Zap,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Preserve redirect path
  const redirectPath = searchParams.get('redirect')
    ? decodeURIComponent(searchParams.get('redirect')!)
    : '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login({ email, password });
      navigate(redirectPath, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden">
      {/* LEFT COLUMN: Hero & Enterprise Workflow Showcase (Desktop) */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-7/12 relative flex-col justify-between p-12 xl:p-16 border-r border-slate-800/80 bg-gradient-to-b from-slate-900/80 via-slate-950 to-slate-950 overflow-hidden">
        {/* Ambient background glows */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 -right-24 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 left-1/4 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Header */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-white">FlowPilot</span>
              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                Enterprise
              </span>
            </div>
          </div>
        </div>

        {/* Central Product Message & Interactive Execution Pipeline Graphic */}
        <div className="relative z-10 max-w-xl my-auto py-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/70 text-slate-300 text-xs font-medium mb-6 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>High-Throughput Autonomous Orchestration</span>
          </div>

          <h2 className="text-4xl xl:text-5xl font-extrabold text-white tracking-tight leading-[1.15]">
            Automate the work.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-300 to-cyan-300">
              Control the workflow.
            </span>
          </h2>

          <p className="mt-4 text-sm xl:text-base text-slate-400 leading-relaxed max-w-lg">
            FlowPilot orchestrates event-driven DAGs, human approvals, AI classification,
            and real-time SLA monitoring with sub-millisecond precision.
          </p>

          {/* Workflow Simulation Pipeline Card */}
          <div className="mt-8 rounded-2xl bg-slate-900/80 border border-slate-800/90 p-5 shadow-2xl backdrop-blur-xl relative">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <span className="text-xs font-mono font-medium text-slate-400 pl-2">pipeline.telemetry</span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                LIVE &bull; 99.98% SLA
              </span>
            </div>

            {/* Stepper Pipeline */}
            <div className="space-y-3">
              {/* Step 1 */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Inbound Event Ingestion</div>
                    <div className="text-[10px] text-slate-400 font-mono">webhook.payload_received</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">14ms</span>
              </div>

              {/* Step 2 */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">AI Sentiment &amp; Priority Classifier</div>
                    <div className="text-[10px] text-slate-400 font-mono">llm.classification.v2</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-indigo-300">88ms</span>
              </div>

              {/* Step 3 */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400">
                    <GitBranch className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Automated SLA Routing &amp; CRM Dispatch</div>
                    <div className="text-[10px] text-slate-400 font-mono">hubspot.contact_update</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-violet-300">42ms</span>
              </div>
            </div>

            {/* Micro stats banner */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" /> Total Duration: <strong className="text-slate-200 font-mono">144ms</strong>
              </span>
              <span className="text-slate-500 font-mono">Zero Breaches</span>
            </div>
          </div>
        </div>

        {/* Footer Trust Badges */}
        <div className="relative z-10 flex items-center gap-6 pt-4 text-xs text-slate-400 border-t border-slate-800/60">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>SOC2 Type II Certified</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-slate-700" />
          <span>Tenant Isolated</span>
          <div className="w-1 h-1 rounded-full bg-slate-700" />
          <span>Enterprise Encryption</span>
        </div>
      </div>

      {/* RIGHT COLUMN: Authentication Panel */}
      <div className="w-full lg:w-1/2 xl:w-5/12 flex items-center justify-center p-6 sm:p-10 relative overflow-y-auto">
        {/* Subtle glow for mobile/small view */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none lg:hidden" />

        <div className="w-full max-w-md z-10 py-6">
          {/* Mobile Brand Header */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 text-white shadow-lg shadow-indigo-600/25 mb-4">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Welcome to FlowPilot</h1>
            <p className="text-xs text-slate-400 mt-1">
              Automate the work. Control the workflow.
            </p>
          </div>

          {/* Form Card */}
          <div className="p-8 sm:p-9 rounded-2xl bg-slate-900/85 border border-slate-800/90 shadow-2xl shadow-black/80 backdrop-blur-xl">
            {/* Header info */}
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white tracking-tight">Sign in to FlowPilot</h2>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Enter your credentials to access your workflows, executions, and analytics.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Work Email Field */}
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Work Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="alex@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="text-xs font-semibold text-slate-300">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-0.5"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Primary Sign In Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Footer Registration Link */}
            <div className="mt-6 pt-6 border-t border-slate-800/80 text-center">
              <p className="text-xs text-slate-400">
                Don't have an organization account?{' '}
                <Link
                  to={searchParams.get('redirect') ? `/register?redirect=${searchParams.get('redirect')}` : '/register'}
                  className="text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-4 transition-colors"
                >
                  Register now
                </Link>
              </p>
            </div>
          </div>

          <div className="mt-6 text-center text-[11px] text-slate-400">
            Protected by enterprise-grade TLS 1.3 encryption &bull; FlowPilot Platform
          </div>
        </div>
      </div>
    </div>
  );
};
