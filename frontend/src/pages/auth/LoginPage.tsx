import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { AuthCard } from '../../components/auth/AuthCard';
import { FormField } from '../../components/auth/FormField';
import { PasswordField } from '../../components/auth/PasswordField';
import { PrimaryButton } from '../../components/auth/PrimaryButton';
import { ArrowLeft, ArrowRight, CheckCircle2, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { verifyLoginOtpUser, resendLoginOtpService } from '../../services/authService';

export const LoginPage: React.FC = () => {
  const { login, verifyLoginOtp, resendLoginOtp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Preserve redirect path
  const redirectPath = searchParams.get('redirect')
    ? decodeURIComponent(searchParams.get('redirect')!)
    : '/dashboard';

  // Timer countdown for resending login OTP
  useEffect(() => {
    if (step === 'otp' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [step, countdown]);

  // Focus first OTP input when switching to OTP step
  useEffect(() => {
    if (step === 'otp') {
      otpInputRefs.current[0]?.focus();
    }
  }, [step]);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      const res = await login({ email: email.trim(), password });
      if (res && res.requires_otp) {
        setStep('otp');
        setDigits(['', '', '', '', '', '']);
        setCountdown(60);
      } else {
        // Fallback in case tokens were directly issued
        navigate(redirectPath, { replace: true });
      }
    } catch (err: any) {
      if (err.message === 'email_not_verified' || err.message?.includes('email_not_verified')) {
        navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDigitChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean && val !== '') return;

    const newDigits = [...digits];

    if (clean.length > 1) {
      // Pasted full 6-digit OTP
      const pastedChars = clean.slice(0, 6).split('');
      pastedChars.forEach((ch, i) => {
        if (index + i < 6) {
          newDigits[index + i] = ch;
        }
      });
      setDigits(newDigits);
      const nextFocus = Math.min(index + pastedChars.length, 5);
      otpInputRefs.current[nextFocus]?.focus();
      return;
    }

    newDigits[index] = clean;
    setDigits(newDigits);

    // Auto-advance
    if (clean && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const fullCode = digits.join('');
  const isOtpComplete = fullCode.length === 6;

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOtpComplete || !email.trim()) return;

    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      if (verifyLoginOtp) {
        await verifyLoginOtp({ email: email.trim(), code: fullCode });
      } else {
        await verifyLoginOtpUser({ email: email.trim(), code: fullCode });
      }
      navigate(redirectPath, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Invalid or expired verification code. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0 || !email.trim()) return;
    setError(null);
    setSuccessMsg(null);
    setIsResending(true);

    try {
      if (resendLoginOtp) {
        await resendLoginOtp(email.trim());
      } else {
        await resendLoginOtpService(email.trim());
      }
      setSuccessMsg('A fresh verification code has been sent to your email.');
      setCountdown(60);
      setDigits(['', '', '', '', '', '']);
      otpInputRefs.current[0]?.focus();
    } catch (err: any) {
      setError(err.message || 'Failed to resend code. Please try again later.');
    } finally {
      setIsResending(false);
    }
  };

  const credentialsFooter = (
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

  const otpFooter = (
    <div className="flex flex-col gap-2.5 text-xs text-[var(--text-secondary)]">
      <div>
        Didn't receive the code?{' '}
        <button
          type="button"
          onClick={handleResendOtp}
          disabled={countdown > 0 || isResending}
          className="text-brand-600 dark:text-brand-400 hover:underline font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 cursor-pointer"
        >
          {isResending ? (
            <span>Sending...</span>
          ) : countdown > 0 ? (
            <span>Resend code ({countdown}s)</span>
          ) : (
            <>
              <RefreshCw className="w-3 h-3" />
              <span>Resend code</span>
            </>
          )}
        </button>
      </div>
      <div>
        <button
          type="button"
          onClick={() => {
            setStep('credentials');
            setError(null);
            setSuccessMsg(null);
            setDigits(['', '', '', '', '', '']);
          }}
          className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors underline cursor-pointer"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>Back to sign in with password</span>
        </button>
      </div>
    </div>
  );

  return (
    <AuthLayout>
      <AuthCard
        title={step === 'credentials' ? 'Sign in to FlowPilot' : 'Two-Factor Authentication'}
        subtitle={
          step === 'credentials'
            ? 'Access your organization workspace.'
            : `Enter the 6-digit code sent to ${email}.`
        }
        error={error}
        footer={step === 'credentials' ? credentialsFooter : otpFooter}
      >
        {successMsg && (
          <div className="mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        {step === 'credentials' ? (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
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
                loadingText="Verifying Credentials..."
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            </div>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-5 animate-in fade-in duration-200">
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-3 text-xs font-semibold text-[var(--text-secondary)]">
                <ShieldCheck className="w-4 h-4 text-brand-500" />
                <span>6-Digit Verification Code</span>
              </div>
              <div className="flex justify-center items-center gap-2 sm:gap-3">
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      otpInputRefs.current[index] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleDigitChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 ${
                      digit
                        ? 'border-brand-500/80 bg-brand-500/5 text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)]'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="pt-2">
              <PrimaryButton
                type="submit"
                disabled={!isOtpComplete || isSubmitting}
                isLoading={isSubmitting}
                loadingText="Signing In..."
              >
                <span>Verify & Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            </div>
          </form>
        )}
      </AuthCard>
    </AuthLayout>
  );
};
