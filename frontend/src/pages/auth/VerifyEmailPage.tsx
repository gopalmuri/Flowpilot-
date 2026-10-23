import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { verifyEmailUser, resendVerificationOtp } from '../../services/authService';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { AuthCard } from '../../components/auth/AuthCard';
import { PrimaryButton } from '../../components/auth/PrimaryButton';
import { ArrowRight, CheckCircle2, Mail, RefreshCw } from 'lucide-react';

export const VerifyEmailPage: React.FC = () => {
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const emailParam = searchParams.get('email') || '';
  const [email, setEmail] = useState(emailParam);
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Timer countdown for resending code
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleDigitChange = (index: number, val: string) => {
    // Only accept numbers
    const clean = val.replace(/\D/g, '');
    if (!clean && val !== '') return;

    const newDigits = [...digits];

    if (clean.length > 1) {
      // Pasted multiple digits
      const pastedChars = clean.slice(0, 6).split('');
      pastedChars.forEach((ch, i) => {
        if (index + i < 6) {
          newDigits[index + i] = ch;
        }
      });
      setDigits(newDigits);
      const nextFocus = Math.min(index + pastedChars.length, 5);
      inputRefs.current[nextFocus]?.focus();
      return;
    }

    newDigits[index] = clean;
    setDigits(newDigits);

    // Auto-advance
    if (clean && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const fullCode = digits.join('');
  const isCodeComplete = fullCode.length === 6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCodeComplete || !email.trim()) return;

    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      if (verifyEmail) {
        await verifyEmail(email.trim(), fullCode);
      } else {
        await verifyEmailUser(email.trim(), fullCode);
      }
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Invalid or expired verification code. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || !email.trim()) return;
    setError(null);
    setSuccessMsg(null);
    setIsResending(true);

    try {
      await resendVerificationOtp(email.trim());
      setSuccessMsg('A new 6-digit verification code has been sent to your email.');
      setCountdown(60);
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      setError(err.message || 'Failed to resend code. Please try again later.');
    } finally {
      setIsResending(false);
    }
  };

  const footerLink = (
    <div className="flex flex-col gap-2 text-xs text-[var(--text-secondary)]">
      <div>
        Didn't receive the code?{' '}
        <button
          type="button"
          onClick={handleResend}
          disabled={countdown > 0 || isResending}
          className="text-brand-600 dark:text-brand-400 hover:underline font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
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
        <Link
          to="/login"
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );

  return (
    <AuthLayout>
      <AuthCard
        title="Verify your email"
        subtitle={`Enter the 6-digit code sent to ${email || 'your email inbox'}.`}
        error={error}
        footer={footerLink}
      >

        {successMsg && (
          <div className="mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!emailParam && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="alex@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all"
                />
                <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-2.5" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2.5 text-center">
              6-Digit Verification Code
            </label>
            <div className="flex justify-center items-center gap-2 sm:gap-3">
              {digits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (inputRefs.current[idx] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={digit}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  className="w-10 h-12 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-bold rounded-xl border border-[var(--border-subtle)] dark:border-[#2A332E] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-all shadow-sm"
                />
              ))}
            </div>
          </div>

          <div className="pt-2">
            <PrimaryButton
              type="submit"
              disabled={isSubmitting || !isCodeComplete}
              isLoading={isSubmitting}
              loadingText="Verifying..."
            >
              <span>Verify & Continue</span>
              <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
        </form>
      </AuthCard>
    </AuthLayout>
  );
};
