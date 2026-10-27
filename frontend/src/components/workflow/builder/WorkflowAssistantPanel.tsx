import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Send, Sparkles } from 'lucide-react';
import { AIClarificationQuestion, AITemplateSuggestion, AIWorkflowTemplate } from '../../../types/workflowAI';
import { AssistantMessage, BuilderMessage } from './AssistantMessage';
import { focusRing, panel } from './styles';

const MAX_OPTIONS = 5;

const THINKING_MESSAGES = [
  'Understanding what you need…',
  'Choosing steps…',
  'Connecting them together…',
  'Checking the flow…',
  'Nearly there…',
];

interface QuestionsProps {
  questions: AIClarificationQuestion[];
  onSubmit: (text: string) => void;
  onSkip: () => void;
}

/** Clarifying questions as option buttons, with an "Other" free-text answer. Sends once every question is answered. */
const ClarificationQuestions: React.FC<QuestionsProps> = ({ questions, onSubmit, onSkip }) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const answer = (q: AIClarificationQuestion, value: string) => {
    const v = value.trim();
    if (!v) return;
    const next = { ...answers, [q.id]: v };
    if (questions.every((x) => next[x.id])) {
      onSubmit(questions.length === 1 ? v : questions.map((x) => `${x.question} ${next[x.id]}`).join('\n'));
    } else {
      setAnswers(next);
    }
  };

  const unanswered = questions.filter((q) => !answers[q.id]);

  return (
    <div className="ml-11 space-y-4" aria-label="A few quick questions">
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="text-[15px] font-medium text-warm-900 dark:text-charcoal-100">{q.question}</legend>
          {answers[q.id] ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-400">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              {answers[q.id]}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {q.options.slice(0, MAX_OPTIONS).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => answer(q, opt)}
                    className={`rounded-lg border border-warm-300 bg-white px-3 py-1.5 text-sm font-medium text-warm-800 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 dark:border-charcoal-700 dark:bg-charcoal-900 dark:text-charcoal-200 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 cursor-pointer ${focusRing}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  answer(q, other[q.id] || '');
                }}
              >
                <label className="sr-only" htmlFor={`other-${q.id}`}>
                  Other answer for: {q.question}
                </label>
                <input
                  id={`other-${q.id}`}
                  type="text"
                  value={other[q.id] || ''}
                  onChange={(e) => setOther((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="Other…"
                  className={`min-w-0 flex-1 rounded-lg border border-warm-300 bg-white px-3 py-1.5 text-sm text-warm-900 placeholder:text-warm-500 dark:border-charcoal-700 dark:bg-charcoal-900 dark:text-charcoal-100 dark:placeholder:text-charcoal-500 focus:border-brand-500 ${focusRing}`}
                />
                <button
                  type="submit"
                  disabled={!(other[q.id] || '').trim()}
                  className={`rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40 disabled:hover:bg-transparent dark:text-brand-400 dark:hover:bg-brand-500/10 cursor-pointer ${focusRing}`}
                >
                  Use this
                </button>
              </form>
            </>
          )}
        </fieldset>
      ))}
      {unanswered.length > 0 && (
        <button
          type="button"
          onClick={onSkip}
          className={`rounded text-sm text-warm-500 underline underline-offset-2 hover:text-brand-700 dark:text-charcoal-400 dark:hover:text-brand-400 cursor-pointer ${focusRing}`}
        >
          Skip, just choose for me
        </button>
      )}
    </div>
  );
};

interface WorkflowAssistantPanelProps {
  messages: BuilderMessage[];
  isThinking: boolean;
  questions: AIClarificationQuestion[];
  templatePicks: AITemplateSuggestion[];
  starterTemplates: AIWorkflowTemplate[];
  examplePrompts: string[];
  hasWorkflow: boolean;
  /** When set the composer is disabled and this explains why. */
  lockedReason?: string | null;
  input: string;
  onInputChange: (v: string) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  className?: string;
}

export const WorkflowAssistantPanel: React.FC<WorkflowAssistantPanelProps> = ({
  messages,
  isThinking,
  questions,
  templatePicks,
  starterTemplates,
  examplePrompts,
  hasWorkflow,
  lockedReason,
  input,
  onInputChange,
  onSend,
  onRetry,
  inputRef,
  className = '',
}) => {
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isThinking) return;
    setThinkingIdx(0);
    const t = window.setInterval(() => setThinkingIdx((i) => (i + 1) % THINKING_MESSAGES.length), 1800);
    return () => window.clearInterval(t);
  }, [isThinking]);

  useEffect(() => {
    // Scroll only the message list. scrollIntoView() also scrolls every ancestor, which on load pushed the whole page
    // down so the title and actions were off-screen on mobile.
    const list = endRef.current?.parentElement;
    list?.scrollTo?.({ top: list.scrollHeight, behavior: 'smooth' });
  }, [messages, isThinking, questions]);

  const composerDisabled = isThinking || Boolean(lockedReason);
  const lastIsError = messages.length > 0 && messages[messages.length - 1].tone === 'error';

  return (
    <section aria-label="Workflow Assistant" className={`${panel} flex min-h-0 flex-col overflow-hidden ${className}`}>
      <div className="flex items-start gap-3 border-b border-warm-200 px-5 py-4 dark:border-charcoal-800">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white dark:bg-brand-500">
          <Sparkles className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-warm-900 dark:text-charcoal-100">Workflow Assistant</h2>
          <p className="text-sm text-warm-600 dark:text-charcoal-400">
            Describe your process or ask for changes. I update the workflow and explain what changed.
          </p>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 space-y-5 overflow-y-auto px-5 py-5"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Chat messages"
      >
        {messages.length === 0 && !isThinking && (
          <div className="space-y-5">
            <p className="text-[15px] leading-relaxed text-warm-800 dark:text-charcoal-200">
              Tell me what you would like to automate, in your own words. For example:
            </p>
            <ul className="space-y-2">
              {examplePrompts.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => onSend(p)}
                    className={`w-full rounded-lg border border-warm-300 bg-white px-3.5 py-2.5 text-left text-sm text-warm-800 transition-colors hover:border-brand-500 hover:bg-brand-50 dark:border-charcoal-700 dark:bg-charcoal-900 dark:text-charcoal-200 dark:hover:bg-brand-500/10 cursor-pointer ${focusRing}`}
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            {starterTemplates.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Or start from a template</h3>
                <ul className="mt-2 space-y-2">
                  {starterTemplates.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onSend(t.prompt)}
                        className={`w-full rounded-lg px-3.5 py-2 text-left transition-colors hover:bg-warm-100 dark:hover:bg-charcoal-800 cursor-pointer ${focusRing}`}
                      >
                        <span className="block text-sm font-medium text-warm-900 dark:text-charcoal-100">{t.title}</span>
                        <span className="block text-sm text-warm-600 dark:text-charcoal-400">{t.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <AssistantMessage
            key={m.id}
            message={m}
            onRetry={i === messages.length - 1 && lastIsError ? onRetry : undefined}
            retryDisabled={isThinking}
          />
        ))}

        {questions.length > 0 && !isThinking && (
          <ClarificationQuestions
            key={questions.map((q) => q.id).join('|')}
            questions={questions}
            onSubmit={onSend}
            onSkip={() => onSend('Please choose sensible defaults for anything I did not answer.')}
          />
        )}

        {templatePicks.length > 0 && !isThinking && (
          <div className="ml-11">
            <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Pick a starting point</h3>
            <ul className="mt-2 space-y-1">
              {templatePicks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSend(t.prompt)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-warm-100 dark:hover:bg-charcoal-800 cursor-pointer ${focusRing}`}
                  >
                    <span className="block text-sm font-medium text-warm-900 dark:text-charcoal-100">{t.title}</span>
                    <span className="block text-sm text-warm-600 dark:text-charcoal-400">{t.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isThinking && (
          <div role="status" aria-live="polite" className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15">
              <Loader2 className="w-4 h-4 animate-spin text-brand-600 dark:text-brand-400" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[15px] font-medium text-warm-900 dark:text-charcoal-100">{THINKING_MESSAGES[thinkingIdx]}</p>
              <p className="text-sm text-warm-500 dark:text-charcoal-400">This usually takes about 10 seconds.</p>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-warm-200 p-4 dark:border-charcoal-800"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(input);
        }}
      >
        <label htmlFor="builder-input" className="sr-only">
          {hasWorkflow ? 'Describe a change to this workflow' : 'Describe what you want to automate'}
        </label>
        {lockedReason && <p className="mb-2 text-sm text-warm-600 dark:text-charcoal-400">{lockedReason}</p>}
        <div className="relative rounded-xl border border-warm-300 bg-white transition-colors focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30 dark:border-charcoal-700 dark:bg-charcoal-900">
          <textarea
            id="builder-input"
            ref={inputRef}
            rows={2}
            value={input}
            disabled={composerDisabled}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend(input);
              }
            }}
            placeholder={hasWorkflow ? 'Describe a change to this workflow...' : 'Describe your process...'}
            className="w-full resize-none bg-transparent py-3 pl-4 pr-14 text-[15px] text-warm-900 placeholder:text-warm-500 focus:outline-none disabled:opacity-60 dark:text-charcoal-100 dark:placeholder:text-charcoal-500"
          />
          <button
            type="submit"
            disabled={composerDisabled || !input.trim()}
            aria-label="Send"
            className={`absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand-500 dark:hover:bg-brand-600 cursor-pointer ${focusRing}`}
          >
            {isThinking ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
        <p className="mt-2 text-xs text-warm-500 dark:text-charcoal-400">Enter to send, Shift+Enter for a new line.</p>
      </form>
    </section>
  );
};
