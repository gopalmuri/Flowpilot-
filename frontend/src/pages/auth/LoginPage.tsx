import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { AuthCard } from '../../components/auth/AuthCard';
import { FormField } from '../../components/auth/FormField';
import { PasswordField } from '../../components/auth/PasswordField';
import { PrimaryButton } from '../../components/auth/PrimaryButton';
import { ArrowRight, Mail } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const footerLink = (
    <p className="text-xs text-[var(--text-secondary)]">
      Don't have an organization account?{' '}
      <Link
        to={searchParams.get('redirect') ? `/register?redirect=${searchParams.get('redirect')}` : '/register'}
        className="text-brand-600 dark:text-brand-400 hover:underline font-semibold transition-colors ml-1"
      >
        Register now
      </Link>
    </p>
  );

  return (
    <AuthLayout>
      <AuthCard
        title="Sign in to FlowPilot"
        subtitle="Access your organization workspace."
        error={error}
        footer={footerLink}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            id="email"
            label="Work Email"
            type="email"
            required
            autoComplete="email"
            placeholder="alex@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<Mail className="w-4 h-4 text-[var(--text-muted)]" />}
          />

          <PasswordField
            id="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className="pt-2">
            <PrimaryButton
              type="submit"
              disabled={isSubmitting}
              isLoading={isSubmitting}
              loadingText="Signing In..."
            >
              <span>Sign In</span>
              <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
        </form>
      </AuthCard>
    </AuthLayout>
  );
};
