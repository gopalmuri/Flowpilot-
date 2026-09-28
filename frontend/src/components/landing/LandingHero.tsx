import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowRight, 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle2, 
  Sparkles, 
  UserCheck, 
  ShieldCheck, 
  Clock, 
  Database, 
  MessageSquare,
  FileCheck2,
  Cpu
} from 'lucide-react';
import { useReducedMotion, useScrollParallax } from '../../hooks/useMotion';

type NodeState = 'idle' | 'active' | 'processing' | 'waiting' | 'completed';

interface StageConfig {
  id: number;
  name: string;
  shortLabel: string;
  category: 'ingest' | 'validate' | 'ai' | 'rule' | 'human' | 'action' | 'done' | 'audit' | 'sla';
  description: string;
  metric?: string;
}

export const LandingHero: React.FC = () => {
  const prefersReduced = useReducedMotion();
  const parallaxOffset = useScrollParallax(0.02, 10);

  // Controlled entrance sequencing
  const [loadStage, setLoadStage] = useState(0);

  useEffect(() => {
    if (prefersReduced) {
      setLoadStage(8);
      return;
    }

    const t1 = setTimeout(() => setLoadStage(1), 80);   // Eyebrow
    const t2 = setTimeout(() => setLoadStage(2), 160);  // Headline Line 1
    const t3 = setTimeout(() => setLoadStage(3), 260);  // Headline Line 2
    const t4 = setTimeout(() => setLoadStage(4), 360);  // Description
    const t5 = setTimeout(() => setLoadStage(5), 460);  // CTAs
    const t6 = setTimeout(() => setLoadStage(6), 560);  // Trust metadata
    const t7 = setTimeout(() => setLoadStage(7), 680);  // Workflow Panel
    const t8 = setTimeout(() => setLoadStage(8), 850);  // Continuous Engine Starts

    return () => {
      [t1, t2, t3, t4, t5, t6, t7, t8].forEach(clearTimeout);
    };
  }, [prefersReduced]);

  const stages: StageConfig[] = [
    {
      id: 1,
      name: 'Incoming Request',
      shortLabel: 'Request',
      category: 'ingest',
      description: 'Webhook payload accepted with valid HMAC signature from Acme Corp.',
      metric: 'POST /v1/intake'
    },
    {
      id: 2,
      name: 'Payload Validation',
      shortLabel: 'Validate',
      category: 'validate',
      description: 'Schema integrity verified. Required fields [company, email, seats] confirmed.',
      metric: 'Schema Valid'
    },
    {
      id: 3,
      name: 'AI Classification',
      shortLabel: 'AI Classify',
      category: 'ai',
      description: 'Intent: Enterprise Lead • Confidence: 94% • Seats: 500 • SAML Required.',
      metric: '0.94 Conf'
    },
    {
      id: 4,
      name: 'Business Rules',
      shortLabel: 'Rules',
      category: 'rule',
      description: 'deal_value > $25,000 AND seats >= 250 → Requires Manager Approval.',
      metric: 'Rule Matched'
    },
    {
      id: 5,
      name: 'Human Approval',
      shortLabel: 'Approval',
      category: 'human',
      description: 'Halted for sign-off. Approved by Operations Director (Token: apr_9941).',
      metric: 'Human Sign-off'
    },
    {
      id: 6,
      name: 'Automated Action',
      shortLabel: 'Action',
      category: 'action',
      description: 'CRM deal record created ($85,000 ARR) • Alert dispatched to #enterprise-wins.',
      metric: 'CRM + Slack'
    },
    {
      id: 7,
      name: 'Workflow Completed',
      shortLabel: 'Completed',
      category: 'done',
      description: 'All downstream execution tasks committed with zero errors.',
      metric: 'Status: 200 OK'
    },
    {
      id: 8,
      name: 'Audit Trail',
      shortLabel: 'Audit',
      category: 'audit',
      description: 'SHA-256 tamper-evident execution record appended to PostgreSQL ledger.',
      metric: 'sha256:d82...f9a'
    },
    {
      id: 9,
      name: 'SLA Monitoring',
      shortLabel: 'SLA Met',
      category: 'sla',
      description: 'Execution duration 84ms active runtime — comfortably within 15-minute SLA.',
      metric: '84ms (Within Target)'
    }
  ];

  // Active step in the 9-stage sequence
  const [activeStep, setActiveStep] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [approvalPaused, setApprovalPaused] = useState<boolean>(false);
  const [aiFieldStep, setAiFieldStep] = useState<number>(0);

  // Continuous state machine execution loop
  useEffect(() => {
    if (prefersReduced) {
      setActiveStep(stages.length - 1);
      setIsPlaying(false);
      return;
    }

    if (!isPlaying || loadStage < 8) return;

    let timer: NodeJS.Timeout;

    // Stage 4 (Human Approval): Intentional Pause (1.8s)
    if (activeStep === 4) {
      setApprovalPaused(true);
      timer = setTimeout(() => {
        setApprovalPaused(false);
        setActiveStep(5);
      }, 1800);
      return () => clearTimeout(timer);
    }

    // Stage 2 (AI Classification): Sequential micro-field reveal
    if (activeStep === 2) {
      setAiFieldStep(0);
      const sub1 = setTimeout(() => setAiFieldStep(1), 350);
      const sub2 = setTimeout(() => setAiFieldStep(2), 700);
      const main = setTimeout(() => {
        setActiveStep(3);
      }, 1500);

      return () => {
        clearTimeout(sub1);
        clearTimeout(sub2);
        clearTimeout(main);
      };
    }

    // Stage 8 (Final): Hold completed state for 1.8s before smooth reset loop
    if (activeStep === stages.length - 1) {
      timer = setTimeout(() => {
        setActiveStep(0);
      }, 1800);
      return () => clearTimeout(timer);
    }

    // Standard stage duration (1250ms)
    timer = setTimeout(() => {
      setActiveStep((prev) => (prev + 1) % stages.length);
    }, 1250);

    return () => clearTimeout(timer);
  }, [activeStep, isPlaying, loadStage, prefersReduced, stages.length]);

  const currentStage = stages[activeStep];

  // Calculate packet track position for smooth continuous signal indicator
  const packetPercent = (activeStep / (stages.length - 1)) * 100;
  const isCurrentAi = currentStage.category === 'ai';
  const isCurrentHuman = currentStage.category === 'human';

  return (
    <section className="pt-8 sm:pt-14 pb-16 sm:pb-24 px-4 sm:px-6 lg:px-8 border-b border-[var(--border-subtle)] bg-[var(--bg-app)] relative overflow-hidden">
      {/* 2 Soft Ambient Depth Drift Layers (16s & 20s subtle movement) */}
      <div 
        className="absolute top-1/4 left-1/3 w-[620px] h-[360px] bg-brand-500/5 dark:bg-brand-400/5 blur-3xl pointer-events-none rounded-full animate-ambient-drift-1" 
        aria-hidden="true" 
      />
      <div 
        className="absolute top-1/3 right-1/4 w-[480px] h-[300px] bg-brand-600/4 dark:bg-brand-500/4 blur-3xl pointer-events-none rounded-full animate-ambient-drift-2" 
        aria-hidden="true" 
      />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Controlled Hero Entrance Sequencing */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
          {/* Eyebrow (T=80ms) with 4s breathing animation */}
          <div
            className={`transition-all duration-300 transform ${
              loadStage >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
            }`}
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider bg-[var(--brand-soft)] text-[var(--brand-text)] border border-brand-200 dark:border-brand-700/60 mb-4 animate-eyebrow-breathe">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-600 dark:bg-brand-400 animate-pulse" />
              B2B Workflow Orchestration
            </div>
          </div>

          {/* Hero Heading: Centerpiece with micro-float and continuous emerald gradient sweep */}
          <div className="animate-micro-float">
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-[var(--text-primary)] tracking-tight leading-[1.12] mb-4 overflow-hidden">
              <span
                className={`block transition-all duration-400 transform ${
                  loadStage >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
                }`}
              >
                Turn business requests
              </span>
              <span
                className={`block transition-all duration-400 delay-100 transform ${
                  loadStage >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
                }`}
              >
                into <span className="text-emerald-continuous">controlled execution.</span>
              </span>
            </h1>
          </div>

          {/* Description (T=360ms): Static after entrance */}
          <p
            className={`text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed max-w-2xl mx-auto mb-7 transition-all duration-350 transform ${
              loadStage >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
            }`}
          >
            FlowPilot orchestrates validation, AI classification, business rules, human approvals, and downstream actions through one auditable control plane.
          </p>

          {/* CTAs (T=460ms) with polished micro-interactions */}
          <div
            className={`flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-5 transition-all duration-350 transform ${
              loadStage >= 5 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
            }`}
          >
            <Link
              to="/register"
              className="btn-micro-hover w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl text-sm font-semibold text-white bg-brand-600 dark:bg-brand-500 shadow-xs"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4 btn-arrow" />
            </Link>

            <a
              href="#how-it-works"
              className="btn-micro-hover w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-brand-500/40 shadow-2xs"
            >
              <span>See How It Works</span>
            </a>
          </div>

          {/* Trust Metadata (T=560ms) */}
          <div
            className={`flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs font-mono text-[var(--text-muted)] transition-opacity duration-350 ${
              loadStage >= 6 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span>No uncontrolled AI execution</span>
            <span>&bull;</span>
            <span>Human-in-the-loop</span>
            <span>&bull;</span>
            <span>Full audit trail</span>
          </div>
        </div>

        {/* Hero Interactive Workflow Panel (T=680ms entrance + subtle scroll parallax) */}
        <div
          id="hero-workflow"
          style={{ transform: `translateY(${parallaxOffset}px)` }}
          className={`rounded-3xl border border-[var(--border-subtle)] dark:border-[#2A332E] bg-[var(--bg-surface)] shadow-md overflow-hidden transition-all duration-500 ${
            loadStage >= 7 ? 'opacity-100 scale-100' : 'opacity-0 translate-y-8 scale-[0.98]'
          }`}
        >
          {/* Top Panel Window Bar */}
          <div className="px-4 sm:px-6 py-3.5 bg-[var(--bg-surface-secondary)] border-b border-[var(--border-subtle)] dark:border-[#2A332E] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-brand-500/80" />
              </div>
              <span className="text-xs font-mono font-bold text-[var(--text-primary)] border-l border-[var(--border-subtle)] pl-2.5 ml-1">
                FLOWPILOT CONTROL PLANE
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-600 dark:bg-brand-400 animate-pulse" />
                LIVE MISSION CONTROL
              </span>
            </div>

            {/* Stepper Controls */}
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-brand-500/40 transition-colors"
                aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
              >
                {isPlaying ? <Pause className="w-3 h-3 text-amber-500" /> : <Play className="w-3 h-3 text-brand-500" />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveStep(0);
                  setIsPlaying(true);
                }}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-brand-500/40 transition-colors"
                aria-label="Restart pipeline trace"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* DESKTOP 9-Stage Pipeline Track with Moving Data Packet */}
          <div className="hidden lg:block p-6 border-b border-[var(--border-subtle)] dark:border-[#2A332E] relative">
            {/* Subtle Animated Connector Track Line */}
            <div className="absolute top-12 left-10 right-10 h-[2px] bg-[var(--border-subtle)] pointer-events-none z-0 overflow-hidden">
              <svg className="w-full h-full" preserveAspectRatio="none">
                <line 
                  x1="0" 
                  y1="1" 
                  x2="100%" 
                  y2="1" 
                  className="stroke-brand-500/40 dark:stroke-brand-400/40 animate-line-flow" 
                  strokeWidth="2" 
                />
              </svg>
            </div>

            {/* Traveling Data Packet Signal on Track */}
            <div 
              className="absolute top-11 -translate-y-1/2 pointer-events-none z-10 transition-all duration-500 ease-out"
              style={{ left: `calc(40px + ${packetPercent} * (100% - 80px) / 100)` }}
            >
              <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center -translate-x-1/2 ${
                isCurrentAi 
                  ? 'bg-violet-500 ring-4 ring-violet-500/30 animate-violet-pulse'
                  : isCurrentHuman
                  ? 'bg-amber-500 ring-4 ring-amber-500/30 animate-amber-dwell'
                  : 'bg-brand-500 ring-4 ring-brand-500/30 animate-packet-pulse'
              }`}>
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
            </div>

            <div className="grid grid-cols-9 gap-2 relative z-10">
              {stages.map((st, idx) => {
                const isActive = idx === activeStep;
                const isPassed = idx < activeStep;
                const isAi = st.category === 'ai';
                const isHuman = st.category === 'human';

                let nodeStatus: NodeState = 'idle';
                if (isActive) {
                  nodeStatus = isHuman && approvalPaused ? 'waiting' : 'active';
                } else if (isPassed) {
                  nodeStatus = 'completed';
                }

                return (
                  <button
                    type="button"
                    key={st.id}
                    onClick={() => {
                      setActiveStep(idx);
                      setIsPlaying(false);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all duration-200 cursor-pointer relative overflow-hidden card-hover-micro ${
                      isActive
                        ? isAi
                          ? 'bg-violet-500/10 border-violet-500 shadow-xs ring-2 ring-violet-500/30'
                          : isHuman
                          ? 'bg-amber-500/10 border-amber-500 shadow-xs ring-2 ring-amber-500/30'
                          : 'bg-brand-500/10 border-brand-500 shadow-xs ring-2 ring-brand-500/30'
                        : isPassed
                        ? 'bg-[var(--bg-surface-secondary)] border-[var(--border-subtle)] opacity-95'
                        : 'bg-transparent border-transparent opacity-40 hover:opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono font-bold text-[var(--text-muted)]">
                        0{st.id}
                      </span>
                      {isPassed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                      ) : isActive ? (
                        <span className={`w-2 h-2 rounded-full ${
                          isAi ? 'bg-violet-500' : isHuman ? 'bg-amber-500 animate-pulse' : 'bg-brand-500 animate-pulse'
                        }`} />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--border-subtle)]" />
                      )}
                    </div>

                    <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {st.shortLabel}
                    </div>

                    <div className={`text-[10px] font-mono mt-0.5 truncate ${
                      isActive
                        ? isAi ? 'text-violet-600 dark:text-violet-400 font-bold' : isHuman ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-brand-600 dark:text-brand-400 font-bold'
                        : 'text-[var(--text-muted)]'
                    }`}>
                      {nodeStatus === 'waiting'
                        ? 'WAITING...'
                        : isPassed
                        ? 'DONE ✓'
                        : isActive
                        ? 'ACTIVE'
                        : 'IDLE'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* MOBILE Vertical Timeline View (Viewports < 1024px) */}
          <div className="lg:hidden p-4 border-b border-[var(--border-subtle)] dark:border-[#2A332E]">
            <div className="flex items-center justify-between mb-3 text-xs font-mono text-[var(--text-muted)]">
              <span>ACTIVE STAGE:</span>
              <span className={`font-bold ${
                isCurrentAi ? 'text-violet-600 dark:text-violet-400' : isCurrentHuman ? 'text-amber-600 dark:text-amber-400' : 'text-brand-600 dark:text-brand-400'
              }`}>
                0{currentStage.id} of 09 ({currentStage.shortLabel})
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {stages.map((st, idx) => {
                const isActive = idx === activeStep;
                const isPassed = idx < activeStep;
                return (
                  <button
                    type="button"
                    key={st.id}
                    onClick={() => {
                      setActiveStep(idx);
                      setIsPlaying(false);
                    }}
                    className={`p-2 rounded-lg text-center text-xs font-mono transition-all ${
                      isActive
                        ? st.category === 'ai'
                          ? 'bg-violet-600 text-white font-bold shadow-xs'
                          : st.category === 'human'
                          ? 'bg-amber-600 text-white font-bold shadow-xs'
                          : 'bg-brand-500 text-white font-bold shadow-xs'
                        : isPassed
                        ? 'bg-[var(--bg-surface-secondary)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                        : 'bg-transparent text-[var(--text-muted)] opacity-50'
                    }`}
                  >
                    0{st.id} {st.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Diagnostic Inspector Panel */}
          <div className="p-5 sm:p-7 bg-[var(--bg-surface-secondary)]/50">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-[var(--border-subtle)]/70">
              <div className="flex items-start gap-3.5">
                {/* Stage Category Icon */}
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors shadow-xs ${
                  currentStage.category === 'ai'
                    ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30'
                    : currentStage.category === 'human'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                    : 'bg-brand-500/15 text-brand-600 dark:text-brand-400 border border-brand-500/30'
                }`}>
                  {currentStage.category === 'ai' ? (
                    <Sparkles className="w-5 h-5 animate-pulse text-violet-500" />
                  ) : currentStage.category === 'human' ? (
                    <UserCheck className="w-5 h-5 animate-pulse text-amber-500" />
                  ) : currentStage.category === 'rule' ? (
                    <Cpu className="w-5 h-5 text-amber-500" />
                  ) : currentStage.category === 'action' ? (
                    <Database className="w-5 h-5" />
                  ) : currentStage.category === 'audit' ? (
                    <FileCheck2 className="w-5 h-5" />
                  ) : currentStage.category === 'sla' ? (
                    <Clock className="w-5 h-5" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-bold uppercase text-[var(--text-muted)]">
                      Stage 0{currentStage.id}
                    </span>
                    <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
                      {currentStage.name}
                    </h3>
                  </div>

                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1 max-w-xl">
                    {currentStage.description}
                  </p>

                  {/* AI Specialized Micro-View (Sequential extraction) */}
                  {currentStage.category === 'ai' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono">
                      <span className={`px-2 py-0.5 rounded transition-all duration-200 ${
                        aiFieldStep >= 0 ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 font-bold border border-violet-500/30' : 'opacity-30'
                      }`}>
                        Intent: Enterprise Lead ✓
                      </span>
                      <span className={`px-2 py-0.5 rounded transition-all duration-200 ${
                        aiFieldStep >= 1 ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 font-bold border border-violet-500/30' : 'opacity-30'
                      }`}>
                        Confidence: 0.94 ✓
                      </span>
                      <span className={`px-2 py-0.5 rounded transition-all duration-200 ${
                        aiFieldStep >= 2 ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 font-bold border border-violet-500/30' : 'opacity-30'
                      }`}>
                        Entities: 500 Seats, SAML ✓
                      </span>
                    </div>
                  )}

                  {/* Human Approval Specialized Micro-View (Intentional Pause) */}
                  {currentStage.category === 'human' && (
                    <div className="mt-3 flex items-center gap-2.5 text-xs font-mono">
                      {approvalPaused ? (
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 animate-amber-dwell">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                          <span>WAITING FOR APPROVAL: Operations Director</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-brand-500/15 border border-brand-500/40 text-brand-700 dark:text-brand-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                          <span>APPROVED ✓ (Workflow Resumed)</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Business Rules Micro-View */}
                  {currentStage.category === 'rule' && (
                    <div className="mt-3 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>EVALUATED: deal_value &gt; $25,000 → MATCHED ✓ (Approval Required)</span>
                    </div>
                  )}

                  {/* Action Node Specialized Micro-View (CRM + Slack dispatch) */}
                  {currentStage.category === 'action' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 font-semibold border border-brand-200 dark:border-brand-700/60">
                        <Database className="w-3 h-3" /> CRM Record #8819 Created
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-300 font-semibold border border-brand-200 dark:border-brand-700/60">
                        <MessageSquare className="w-3 h-3" /> #enterprise-wins Notified
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Metric Tag */}
              <div className="flex items-center gap-2 font-mono text-xs flex-shrink-0">
                <span className="text-[var(--text-muted)]">TELEMETRY:</span>
                <span className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-bold text-[var(--text-primary)] shadow-2xs">
                  {currentStage.metric}
                </span>
              </div>
            </div>

            {/* Bottom Status Ticker */}
            <div className="pt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[var(--text-muted)]">
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-primary)] font-bold">Execution Context:</span>
                <span>Acme Corp &bull; 500 Enterprise Seats &bull; SSO SAML</span>
              </div>
              <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>Deterministic Control Plane Active</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
