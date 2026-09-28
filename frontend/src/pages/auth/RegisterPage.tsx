import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { AuthCard } from '../../components/auth/AuthCard';
import { FormField } from '../../components/auth/FormField';
import { PasswordField } from '../../components/auth/PasswordField';
import { PasswordRequirements } from '../../components/auth/PasswordRequirements';
import { PrimaryButton } from '../../components/auth/PrimaryButton';
import { ArrowRight, Building2, Mail, User as UserIcon } from 'lucide-react';

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

  const footerLink = (
    <p className="text-xs text-[var(--text-secondary)]">
      Already have an account?{' '}
      <Link
        to="/login"
        className="text-brand-600 dark:text-brand-400 hover:underline font-semibold transition-colors ml-1"
      >
        Sign in
      </Link>
    </p>
  );

  return (
    <AuthLayout>
      <AuthCard
        title="Create organization account"
        subtitle="Set up your organization workspace and administrator account."
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
            icon={<UserIcon className="w-4 h-4 text-[var(--text-muted)]" />}
          />

          <FormField
            id="email"
            label="Work Email"
            type="email"
            required
            placeholder="alex@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<Mail className="w-4 h-4 text-[var(--text-muted)]" />}
          />

          <FormField
            id="orgName"
            label={
              <span>
                Organization Name <span className="text-[var(--text-muted)] font-normal">(Optional)</span>
              </span>
            }
            type="text"
            placeholder="e.g. Acme Corp"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            icon={<Building2 className="w-4 h-4 text-[var(--text-muted)]" />}
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

          <div className="pt-2">
            <PrimaryButton
              type="submit"
              disabled={!isPasswordValid || isSubmitting}
              isLoading={isSubmitting}
              loadingText="Creating Account..."
            >
              <span>Create Account</span>
              <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
        </form>
      </AuthCard>
    </AuthLayout>
  );
};
