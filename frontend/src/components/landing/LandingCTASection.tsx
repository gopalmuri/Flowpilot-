import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LogIn, Workflow, CheckCircle2 } from 'lucide-react';
import { useInView } from '../../hooks/useMotion';

export const LandingCTASection: React.FC = () => {
  const [sectionRef, isInView] = useInView({ threshold: 0.15 });

  return (
    <section ref={sectionRef} className="py-20 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-app)] relative overflow-hidden">
      {/* Very Slow Ambient Depth Glow Layer */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[580px] h-[320px] bg-brand-500/5 dark:bg-brand-400/5 blur-3xl pointer-events-none rounded-full animate-ambient-drift-1" 
        aria-hidden="true" 
      />

      <div className="max-w-4xl mx-auto relative z-10 text-center">
        {/* Eyebrow */}
        <div className={`transition-all duration-300 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-700/60 mb-6">
            <Workflow className="w-3.5 h-3.5" />
            Enterprise Control Plane
          </div>
        </div>

        {/* Headline Line-by-Line Entrance with Continuous Emerald Gradient Treatment */}
        <h2 className="text-3xl sm:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight leading-tight mb-4 overflow-hidden">
          <span className={`block transition-all duration-400 delay-75 transform ${
            isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}>
            Bring your business requests
          </span>
          <span className={`block transition-all duration-400 delay-150 transform ${
            isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}>
            <span className="text-emerald-continuous">under control.</span>
          </span>
        </h2>

        {/* Description */}
        <p className={`text-base sm:text-lg text-[var(--text-secondary)] max-w-xl mx-auto mb-8 leading-relaxed transition-all duration-350 delay-200 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}>
          Build workflows that combine automation, AI-assisted decisions, human control, and complete execution visibility.
        </p>

        {/* Buttons with micro-interactions */}
        <div className={`flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-8 transition-all duration-350 delay-300 transform ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <Link
            to="/register"
            className="btn-micro-hover w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl text-sm font-semibold text-white bg-brand-600 dark:bg-brand-500 shadow-xs"
          >
            <span>Get Started</span>
            <ArrowRight className="w-4 h-4 btn-arrow" />
          </Link>

          <Link
            to="/login"
            className="btn-micro-hover w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-brand-500/40 shadow-2xs"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In</span>
          </Link>
        </div>

        {/* Trust Badges (Fade in last) */}
        <div className={`flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-xs font-mono text-[var(--text-muted)] transition-opacity duration-400 delay-400 ${
          isInView ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
            <span>Zero Uncontrolled AI Action</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
            <span>Deterministic Rule Engine</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
            <span>Immutable Audit Trail</span>
          </div>
        </div>
      </div>
    </section>
  );
};
