import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  GitBranch,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User as UserIcon,
  X,
  Zap,
} from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live password complexity checks
  const hasMinLength = password.length >= 10;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const isPasswordValid =
    hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await register({
        full_name: fullName,
        email,
        password,
        organization_name: orgName.trim() || undefined,
      });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please verify your details.');
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

        {/* Central Product Message */}
        <div className="relative z-10 max-w-xl my-auto py-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/70 text-slate-300 text-xs font-medium mb-6 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>Multi-Tenant Enterprise Automation</span>
          </div>

          <h2 className="text-4xl xl:text-5xl font-extrabold text-white tracking-tight leading-[1.15]">
            Scale your operations.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-300 to-cyan-300">
              With full confidence.
            </span>
          </h2>

          <p className="mt-4 text-sm xl:text-base text-slate-400 leading-relaxed max-w-lg">
            Provision dedicated tenant workspaces, configure role-based access control,
            and automate mission-critical workflows with immutable audit logging.
          </p>

          {/* Security & Reliability Feature Grid */}
          <div className="mt-8 grid grid-cols-2 gap-3.5 max-w-lg">
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 backdrop-blur-sm">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-2.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-slate-200">Strict RBAC &amp; Tenant Isolation</div>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                Cryptographically isolated data boundaries per organization.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 backdrop-blur-sm">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-2.5">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-slate-200">Version-Scoped SLAs</div>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                Execution-level latency tracking and threshold breach alerts.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 backdrop-blur-sm">
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400 mb-2.5">
                <Cpu className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-slate-200">AI Classification</div>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                Intelligent sentiment scoring and intent-based routing.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 backdrop-blur-sm">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-2.5">
                <GitBranch className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold text-slate-200">Native Connectors</div>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                Turnkey integration with Slack, HubSpot, and Webhooks.
              </p>
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

      {/* RIGHT COLUMN: Registration Form Panel */}
      <div className="w-full lg:w-1/2 xl:w-5/12 flex items-center justify-center p-6 sm:p-10 relative overflow-y-auto">
        {/* Subtle glow for mobile/small view */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none lg:hidden" />

        <div className="w-full max-w-md z-10 py-6">
          {/* Mobile Brand Header */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 text-white shadow-lg shadow-indigo-600/25 mb-4">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Create your Account</h1>
            <p className="text-xs text-slate-400 mt-1">
              Automate the work. Control the workflow.
            </p>
          </div>

          {/* Form Card */}
          <div className="p-8 sm:p-9 rounded-2xl bg-slate-900/85 border border-slate-800/90 shadow-2xl shadow-black/80 backdrop-blur-xl">
            {/* Header info */}
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white tracking-tight">Create your account</h2>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Get started with automated workflows for your organization.
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
              {/* Full Name */}
              <div>
                <label htmlFor="fullName" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="fullName"
                    type="text"
                    required
                    placeholder="e.g. Alex Morgan"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* Work Email */}
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
                    placeholder="alex@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* Organization Name (Optional) */}
              <div>
                <label htmlFor="orgName" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Organization Name <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="orgName"
                    type="text"
                    placeholder="e.g. Acme Corp"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Master Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Create a strong password"
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

                {/* Live Password Rules Checklist */}
                <div className="mt-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    {hasMinLength ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span className={hasMinLength ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                      At least 10 characters
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasUppercase ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span className={hasUppercase ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                      One uppercase letter (A-Z)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasLowercase ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span className={hasLowercase ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                      One lowercase letter (a-z)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasNumber ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span className={hasNumber ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                      One numeric digit (0-9)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasSpecial ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span className={hasSpecial ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                      One special character (!@#$%^&*)
                    </span>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || !isPasswordValid}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating Account...</span>
                  </>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Footer Link */}
            <div className="mt-6 pt-6 border-t border-slate-800/80 text-center">
              <p className="text-xs text-slate-400">
                Already have an account?{' '}
                <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-4 transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
