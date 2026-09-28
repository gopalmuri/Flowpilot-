import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { AuthCard } from '../../components/auth/AuthCard';
import { CapabilityRow } from '../../components/auth/CapabilityRow';
import { FormField } from '../../components/auth/FormField';
import { PasswordField } from '../../components/auth/PasswordField';
import { PasswordRequirements } from '../../components/auth/PasswordRequirements';
import { PrimaryButton } from '../../components/auth/PrimaryButton';
import {
  ArrowRight,
  Building2,
  Cpu,
  GitBranch,
  Mail,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [password, setPassword] = useState('');
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

  const capabilitiesShowcase = (
    <div className="space-y-3 select-none">
      <CapabilityRow
        icon={<GitBranch className="w-3.5 h-3.5" />}
        iconBg="bg-[#132824]"
        iconBorder="border-[#18B89A]/30"
        iconColor="text-[#18B89A]"
        title="WORKFLOW CONTROL"
        description="Rules, branching, and approvals."
      />
      <CapabilityRow
        icon={<Cpu className="w-3.5 h-3.5" />}
        iconBg="bg-[#201830]"
        iconBorder="border-violet-800/40"
        iconColor="text-violet-300"
        title="AI-ASSISTED CLASSIFICATION"
        description="Structured AI output without uncontrolled execution."
      />
      <CapabilityRow
        icon={<ShieldCheck className="w-3.5 h-3.5" />}
        iconBg="bg-[#132B20]"
        iconBorder="border-emerald-800/40"
        iconColor="text-emerald-400"
        title="AUDITABLE EXECUTION"
        description="Traceable workflow state and business actions."
      />
    </div>
  );

  const footerLink = (
    <p className="text-xs text-slate-400">
      Already have an account?{' '}
      <Link
        to="/login"
        className="text-[#18B89A] hover:text-[#20C997] font-semibold underline underline-offset-4 transition-colors"
      >
        Sign in
      </Link>
    </p>
  );

  return (
    <AuthLayout
      categoryTag="ORGANIZATION WORKSPACE"
      headline={
        <>
          Scale business operations.
          <br />
          <span className="text-slate-300 font-normal">With deterministic control.</span>
        </>
      }
      supportingText="Create an organization workspace for controlled workflows, approvals, and auditable execution."
      showcase={capabilitiesShowcase}
    >
      <AuthCard
        title="Create Organization Account"
        subtitle="Set up your organization tenant and administrator account."
        error={error}
        footer={footerLink}
      >
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <FormField
            id="fullName"
            label="Full Name"
            type="text"
            required
            placeholder="e.g. Alex Morgan"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            icon={<UserIcon className="w-4 h-4 text-slate-500" />}
          />

          <FormField
            id="email"
            label="Work Email"
            type="email"
            required
            placeholder="alex@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<Mail className="w-4 h-4 text-slate-500" />}
          />

          <FormField
            id="orgName"
            label={
              <span>
                Organization Name <span className="text-slate-500 font-normal">(Optional)</span>
              </span>
            }
            type="text"
            placeholder="e.g. Acme Corp"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            icon={<Building2 className="w-4 h-4 text-slate-500" />}
          />

          <div>
            <PasswordField
              id="password"
              label="Master Password"
              placeholder="Create a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <PasswordRequirements
              hasMinLength={hasMinLength}
              hasUppercase={hasUppercase}
              hasLowercase={hasLowercase}
              hasNumber={hasNumber}
              hasSpecial={hasSpecial}
            />
          </div>

          <PrimaryButton
            type="submit"
            disabled={!isPasswordValid || isSubmitting}
            isLoading={isSubmitting}
            loadingText="Creating Account..."
          >
            <span>Create Account</span>
            <ArrowRight className="w-4 h-4" />
          </PrimaryButton>
        </form>
      </AuthCard>
    </AuthLayout>
  );
};
