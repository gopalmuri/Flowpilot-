import React from 'react';
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  Clock,
  Database,
  FileSpreadsheet,
  Mail,
  MessageSquare,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';

export const BusinessProblemSection: React.FC = () => {
  const frictionPoints = [
    {
      title: 'Manual Coordination',
      description: 'Operations engineers and reps acting as human API bridges, copy-pasting customer requirements across multiple unlinked browser tabs.',
      icon: Users,
    },
    {
      title: 'Inconsistent Decisions',
      description: 'High-value customer qualification dependent on individual human mood, tribal knowledge, or outdated qualification spreadsheets.',
      icon: AlertTriangle,
    },
    {
      title: 'Delayed Response Velocity',
      description: 'Urgent enterprise requests languishing for hours in inboxes waiting for manual handoffs, degrading SLA benchmarks.',
      icon: Clock,
    },
    {
      title: 'Fragmented Siloed Systems',
      description: 'Disparate databases, webhooks, CRMs, and Slack channels operating without a single authoritative state machine or source of truth.',
      icon: Database,
    },
    {
      title: 'Zero Governance & Auditing',
      description: 'No immutable audit record of who approved an exception, what exact data was modified, or why a decision was reached.',
      icon: ShieldAlert,
    },
    {
      title: 'Uncontrolled AI Liability',
      description: 'Generic AI bots executing raw commands against production databases without deterministic rule validation or human safety gates.',
      icon: XCircle,
    },
  ];

  const fragmentedSteps = [
    { name: 'Inbound Request', icon: Mail, tool: 'Email / Web Form' },
    { name: 'Manual Triage', icon: FileSpreadsheet, tool: 'Google Sheets' },
    { name: 'Team Ping', icon: MessageSquare, tool: 'Slack DMs' },
    { name: 'Manual Data Entry', icon: Database, tool: 'CRM Lead' },
    { name: 'Approval Chase', icon: Users, tool: 'Manager Email' },
    { name: 'Follow-Up Check', icon: Clock, tool: 'Manual Reminder' },
  ];

  return (
    <section id="problem" className="py-16 sm:py-24 border-t border-warm-200 dark:border-charcoal-750 bg-warm-50/50 dark:bg-charcoal-900/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-12">
        {/* Section Heading */}
        <div className="max-w-3xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            <span>The Operational Problem</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-warm-900 dark:text-charcoal-100">
            Business requests should not get lost between systems.
          </h2>
          <p className="text-sm sm:text-base text-warm-600 dark:text-charcoal-400 leading-relaxed">
            Every business request arrives with good intentions. But without an orchestrator, it devolves
            into chaotic manual coordination across email threads, spreadsheets, and disconnected messaging apps.
          </p>
        </div>

        {/* Visual Comparison: The Fragmented Reality */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle text-left space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-warm-200 dark:border-charcoal-750">
            <span className="text-xs font-mono uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>The Fragile Coordination Loop (Before FlowPilot)</span>
            </span>
            <span className="text-xs text-warm-500 dark:text-charcoal-400 font-mono">
              Avg. Resolution: 4 to 28 hours &bull; High error rate
            </span>
          </div>

          {/* Stepped Fragmented Diagram */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {fragmentedSteps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.name}
                  className="p-3.5 rounded-2xl bg-warm-50 dark:bg-charcoal-950 border border-warm-200 dark:border-charcoal-750 space-y-2 relative"
                >
                  <div className="flex items-center justify-between text-warm-400 dark:text-charcoal-500">
                    <span className="text-[10px] font-mono font-bold">0{idx + 1}</span>
                    <Icon className="w-4 h-4 text-warm-500 dark:text-charcoal-400" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">
                      {step.name}
                    </div>
                    <div className="text-[11px] font-mono text-warm-500 dark:text-charcoal-400 mt-0.5">
                      {step.tool}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Friction Point Cards */}
          <div className="pt-4 border-t border-warm-200 dark:border-charcoal-750">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-warm-500 dark:text-charcoal-400 mb-4">
              Operational Cost &amp; Liability
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {frictionPoints.map((point) => {
                const Icon = point.icon;
                return (
                  <div
                    key={point.title}
                    className="p-4 rounded-2xl bg-warm-50/60 dark:bg-charcoal-950/60 border border-warm-200 dark:border-charcoal-750/80 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <h4 className="text-xs font-bold text-warm-900 dark:text-charcoal-100">
                        {point.title}
                      </h4>
                    </div>
                    <p className="text-xs text-warm-600 dark:text-charcoal-400 leading-relaxed">
                      {point.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Transition Callout Banner */}
        <div className="p-6 rounded-2xl bg-brand-50/70 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600 dark:bg-brand-500 text-white flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-brand-900 dark:text-brand-200">
                FlowPilot replaces this fragmented coordination with one controlled workflow.
              </div>
              <p className="text-xs text-brand-800/80 dark:text-brand-300/80 mt-0.5">
                Every request follows a deterministic pipeline with AI understanding, human gates, and SLA guarantees.
              </p>
            </div>
          </div>

          <a
            href="#how-it-works"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 transition-colors shadow-2xs whitespace-nowrap self-start sm:self-auto"
          >
            <span>Explore the Architecture</span>
            <ArrowDown className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
};
