import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Wand2,
  ListChecks,
  Clock,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  buildWorkflowWithAI,
  createDraftFromAIProposal,
  getAICatalog,
  getAITemplates,
} from '../../services/workflowService';
import {
  AIChatMessage,
  AICatalogStep,
  AIClarificationQuestion,
  AISetupItem,
  AITemplateSuggestion,
  AIWorkflowAssistResponse,
  AIWorkflowProposal,
  AIWorkflowTemplate,
} from '../../types/workflowAI';
import { ProposalPreview } from '../../components/workflow/ai/ProposalPreview';
import { SetupChecklist } from '../../components/workflow/ai/SetupChecklist';
import { EXAMPLE_PROMPTS } from '../../components/workflow/ai/examplePrompts';

interface BuilderMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  tone?: 'normal' | 'error' | 'limit';
}

const THINKING_MESSAGES = [
  'Understanding what you need…',
  'Choosing steps…',
  'Connecting them together…',
  'Checking the flow…',
  'Nearly there…',
];

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 5;
const OTHER_PLACEHOLDER = 'Something else…';

const LIMIT_PATTERN = /limit|too many|quota|for today|tomorrow|429/i;

function friendlyError(err: unknown): { text: string; tone: 'error' | 'limit' } {
  const raw = err instanceof Error ? err.message : '';
  if (raw && LIMIT_PATTERN.test(raw)) return { text: raw, tone: 'limit' };
  if (raw && !/^request failed with status|failed to fetch|network/i.test(raw)) {
    return { text: raw, tone: 'error' };
  }
  return {
    text: "I couldn't reach the assistant just now. Check your connection and try again; your conversation is still here.",
    tone: 'error',
  };
}

const AssistantAvatar: React.FC = () => (
  <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/60 flex items-center justify-center flex-shrink-0">
    <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
  </div>
);

export const AIBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeOrganization, activeRole } = useAuth();
  const { showSuccess, showError } = useToast();

  const [messages, setMessages] = useState<BuilderMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingIdx, setThinkingIdx] = useState(0);

  const [proposal, setProposal] = useState<AIWorkflowProposal | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [setupItems, setSetupItems] = useState<AISetupItem[]>([]);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  const [questions, setQuestions] = useState<AIClarificationQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [templatePicks, setTemplatePicks] = useState<AITemplateSuggestion[]>([]);
  const [starterTemplates, setStarterTemplates] = useState<AIWorkflowTemplate[]>([]);
  const [catalog, setCatalog] = useState<AICatalogStep[]>([]);

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const nameTouchedRef = useRef(false);
  nameTouchedRef.current = nameTouched;
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const initialSentRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Latest values for the async send handler, which must not close over stale state.
  const stateRef = useRef({ messages, proposal, workflowName });
  stateRef.current = { messages, proposal, workflowName };

  const canEdit = activeRole === 'OWNER' || activeRole === 'ADMIN' || activeRole === 'MANAGER';
  const orgId = activeOrganization?.id;

  const labelByType = useMemo(() => {
    const m: Record<string, string> = {};
    catalog.forEach((c) => {
      m[c.step_type] = c.label;
    });
    return m;
  }, [catalog]);

  // Catalog (for plain-language labels) and templates (starter ideas): both are optional extras.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    getAICatalog(orgId)
      .then((c) => !cancelled && setCatalog(Array.isArray(c) ? c : []))
      .catch(() => undefined);
    getAITemplates(orgId)
      .then((t) => !cancelled && setStarterTemplates(Array.isArray(t) ? t.slice(0, 4) : []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Rotate plain-language progress messages while the assistant works.
  useEffect(() => {
    if (!isThinking) return;
    setThinkingIdx(0);
    const t = window.setInterval(() => setThinkingIdx((i) => (i + 1) % THINKING_MESSAGES.length), 1800);
    return () => window.clearInterval(t);
  }, [isThinking]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, isThinking, questions]);

  const applyResponse = useCallback((res: AIWorkflowAssistResponse) => {
    setQuestions([]);
    setAnswers({});
    setOtherText({});
    setTemplatePicks([]);

    const next: BuilderMessage = {
      id: ++idRef.current,
      role: 'assistant',
      content: res.message,
      tone: res.mode === 'error' ? 'error' : 'normal',
    };
    setMessages((prev) => [...prev, next]);

    if (res.mode === 'proposal' && res.proposal) {
      setProposal(res.proposal);
      setSummary(res.summary ?? null);
      setSetupItems(res.setup_needed ?? []);
      setUnsupported(res.unsupported ?? []);
      if (res.suggested_name && (!nameTouchedRef.current || !stateRef.current.workflowName.trim())) {
        setWorkflowName(res.suggested_name);
      }
    } else if (res.mode === 'clarification') {
      setQuestions((res.clarification_questions ?? []).slice(0, MAX_QUESTIONS));
    } else if (res.mode === 'suggestion') {
      setTemplatePicks(res.template_suggestions ?? []);
    }
    if (res.mode !== 'proposal') {
      // Keep any earlier proposal on screen, but surface fresh heads-ups from this turn.
      if (res.unsupported?.length) setUnsupported(res.unsupported);
    }
  }, []);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || !orgId || isThinking) return;

      const { messages: prior, proposal: current, workflowName: name } = stateRef.current;
      const history: AIChatMessage[] = prior
        .filter((m) => m.tone !== 'error' && m.tone !== 'limit')
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, { id: ++idRef.current, role: 'user', content: text }]);
      setInput('');
      setQuestions([]);
      setTemplatePicks([]);
      setIsThinking(true);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      try {
        const res = await buildWorkflowWithAI(
          orgId,
          {
            prompt: text,
            conversation_history: history,
            current_steps: current?.steps ?? [],
            current_connections: current?.connections ?? [],
            workflow_name: name.trim() || undefined,
          },
          controller.signal
        );
        if (controller.signal.aborted) return;
        applyResponse(res);
      } catch (err) {
        if (controller.signal.aborted) return;
        const f = friendlyError(err);
        setMessages((prev) => [...prev, { id: ++idRef.current, role: 'assistant', content: f.text, tone: f.tone }]);
      } finally {
        if (abortRef.current === controller) {
          setIsThinking(false);
          inputRef.current?.focus();
        }
      }
    },
    [orgId, isThinking, applyResponse]
  );

  // Send the prompt that came from the home-page box exactly once.
  useEffect(() => {
    if (initialSentRef.current || !orgId) return;
    const stateObj = location.state as { prompt?: string } | null;
    const fromQuery = new URLSearchParams(location.search).get('prompt');
    const initial = (stateObj?.prompt || fromQuery || '').trim();
    initialSentRef.current = true;
    if (initial) {
      void send(initial);
    }
  }, [orgId]);

  const answerQuestion = (q: AIClarificationQuestion, value: string) => {
    const v = value.trim();
    if (!v) return;
    const nextAnswers = { ...answers, [q.id]: v };
    if (questions.every((x) => nextAnswers[x.id])) {
      const combined =
        questions.length === 1
          ? v
          : questions.map((x) => `${x.question} ${nextAnswers[x.id]}`).join('\n');
      void send(combined);
    } else {
      setAnswers(nextAnswers);
    }
  };

  const unanswered = questions.filter((q) => !answers[q.id]);

  const handleCreate = async () => {
    if (!orgId || !proposal || !proposal.valid || isCreating) return;
    const name = workflowName.trim();
    if (!name) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await createDraftFromAIProposal(orgId, {
        name,
        description: summary ?? undefined,
        steps: proposal.steps,
        connections: proposal.connections,
      });
      showSuccess(`"${created.name}" is saved as a draft. Nothing runs until you turn it on.`, 'Draft created');
      navigate(`/workflows/${created.workflow_id}`);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Something went wrong saving your draft.';
      setCreateError(msg);
      showError(msg, 'Could not create draft');
      setIsCreating(false);
    }
  };

  const canCreate = Boolean(proposal?.valid) && workflowName.trim().length > 0 && !isCreating && canEdit;
  const blockingSetup = setupItems.filter((s) => s.blocking).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link
            to="/workflows"
            className="inline-flex items-center gap-1 text-xs font-medium text-warm-600 dark:text-charcoal-400 hover:text-brand-700 dark:hover:text-brand-400 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            All workflows
          </Link>
          <h1 className="text-xl sm:text-2xl font-extrabold text-warm-900 dark:text-charcoal-100 tracking-tight mt-1">
            Build a workflow with AI
          </h1>
          <p className="text-xs sm:text-sm text-warm-600 dark:text-charcoal-400 mt-0.5">
            Describe it, review it, then turn it on when you are ready.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-800 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800/60 rounded-lg px-2.5 py-1.5">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          Nothing runs until you turn it on.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* LEFT: conversation */}
        <section
          aria-label="Conversation with the assistant"
          className="rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle flex flex-col lg:h-[calc(100vh-13rem)] lg:min-h-[480px] min-h-[420px] max-h-[75vh] lg:max-h-none"
        >
          <div
            className="flex-1 overflow-y-auto p-4 space-y-4"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Chat messages"
          >
            {messages.length === 0 && !isThinking && (
              <div className="space-y-4 animate-in fade-in duration-300">
                <div className="flex items-start gap-2.5">
                  <AssistantAvatar />
                  <div className="rounded-2xl rounded-tl-sm bg-warm-100 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 px-3.5 py-2.5 text-sm text-warm-800 dark:text-charcoal-200 leading-relaxed">
                    Hi! Tell me what you would like to automate, in your own words. I will sketch it out and you can
                    adjust it just by asking.
                  </div>
                </div>
                <div className="pl-9 flex flex-wrap gap-2">
                  {EXAMPLE_PROMPTS.slice(0, 4).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void send(p)}
                      className="text-left text-xs px-3 py-1.5 rounded-full border border-warm-300 dark:border-charcoal-700 bg-white dark:bg-charcoal-900 text-warm-700 dark:text-charcoal-300 hover:border-brand-500 hover:text-brand-700 dark:hover:text-brand-400 transition cursor-pointer"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                {starterTemplates.length > 0 && (
                  <div className="pl-9 space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 dark:text-charcoal-400">
                      Or start from a template
                    </div>
                    <div className="grid gap-2">
                      {starterTemplates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => void send(t.prompt)}
                          className="text-left p-2.5 rounded-xl border border-warm-200 dark:border-charcoal-750 bg-warm-50 dark:bg-charcoal-850 hover:border-brand-500 transition cursor-pointer"
                        >
                          <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">{t.title}</div>
                          <div className="text-[11px] text-warm-600 dark:text-charcoal-400 mt-0.5">{t.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-200">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 dark:bg-brand-500 text-white px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200">
                  <AssistantAvatar />
                  <div
                    className={`max-w-[85%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap border ${
                      m.tone === 'error'
                        ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/60 text-red-800 dark:text-red-300'
                        : m.tone === 'limit'
                        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
                        : 'bg-warm-100 dark:bg-charcoal-850 border-warm-200 dark:border-charcoal-750 text-warm-800 dark:text-charcoal-200'
                    }`}
                  >
                    {m.tone === 'limit' && (
                      <div className="flex items-center gap-1.5 font-semibold mb-1">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        Daily AI limit reached
                      </div>
                    )}
                    {m.tone === 'error' && (
                      <div className="flex items-center gap-1.5 font-semibold mb-1">
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                        That did not work
                      </div>
                    )}
                    {m.content}
                  </div>
                </div>
              )
            )}

            {/* Clarifying questions */}
            {questions.length > 0 && !isThinking && (
              <div className="pl-9 space-y-3 animate-in fade-in duration-200" aria-label="A few quick questions">
                {questions.map((q) => (
                  <fieldset key={q.id} className="space-y-2">
                    <legend className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">{q.question}</legend>
                    {answers[q.id] ? (
                      <div className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-brand-50 dark:bg-brand-900/30 border border-brand-300 dark:border-brand-700 text-brand-800 dark:text-brand-300">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        {answers[q.id]}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {q.options.slice(0, MAX_OPTIONS).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => answerQuestion(q, opt)}
                              className="text-xs px-3 py-1.5 rounded-full border border-warm-300 dark:border-charcoal-700 bg-white dark:bg-charcoal-900 text-warm-800 dark:text-charcoal-200 hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition cursor-pointer"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            answerQuestion(q, otherText[q.id] || '');
                          }}
                        >
                          <label className="sr-only" htmlFor={`other-${q.id}`}>
                            Other answer for: {q.question}
                          </label>
                          <input
                            id={`other-${q.id}`}
                            type="text"
                            value={otherText[q.id] || ''}
                            onChange={(e) => setOtherText((prev) => ({ ...prev, [q.id]: e.target.value }))}
                            placeholder={OTHER_PLACEHOLDER}
                            className="flex-1 min-w-0 px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none focus:border-brand-600"
                          />
                          <button
                            type="submit"
                            disabled={!(otherText[q.id] || '').trim()}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-warm-200 dark:bg-charcoal-800 text-warm-800 dark:text-charcoal-200 hover:bg-warm-300 dark:hover:bg-charcoal-750 disabled:opacity-40 transition cursor-pointer"
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
                    onClick={() => void send('Please choose sensible defaults for anything I did not answer.')}
                    className="text-[11px] font-medium text-warm-600 dark:text-charcoal-400 hover:text-brand-700 dark:hover:text-brand-400 underline underline-offset-2 cursor-pointer"
                  >
                    Skip, just choose for me
                  </button>
                )}
              </div>
            )}

            {/* Template picker */}
            {templatePicks.length > 0 && !isThinking && (
              <div className="pl-9 space-y-2 animate-in fade-in duration-200">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 dark:text-charcoal-400">
                  Pick a starting point
                </div>
                {templatePicks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void send(t.prompt)}
                    className="w-full text-left p-3 rounded-xl border border-warm-200 dark:border-charcoal-750 bg-warm-50 dark:bg-charcoal-850 hover:border-brand-500 transition cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">{t.title}</div>
                    <div className="text-[11px] text-warm-600 dark:text-charcoal-400 mt-0.5">{t.description}</div>
                  </button>
                ))}
              </div>
            )}

            {isThinking && (
              <div className="flex items-start gap-2.5" role="status">
                <AssistantAvatar />
                <div className="rounded-2xl rounded-tl-sm bg-warm-100 dark:bg-charcoal-850 border border-warm-200 dark:border-charcoal-750 px-3.5 py-2.5 text-sm text-warm-700 dark:text-charcoal-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600 dark:text-teal-400" aria-hidden="true" />
                  <span>{THINKING_MESSAGES[thinkingIdx]}</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Composer */}
          <form
            className="border-t border-warm-200 dark:border-charcoal-800 p-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="builder-input" className="sr-only">
              {proposal ? 'Ask for a change' : 'Describe what you want to automate'}
            </label>
            <textarea
              id="builder-input"
              ref={inputRef}
              rows={2}
              value={input}
              disabled={isThinking}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={
                proposal
                  ? 'Ask for a change, e.g. "also ask a manager to approve it"'
                  : 'Describe what you want to automate…'
              }
              className="flex-1 resize-none px-3 py-2 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-xl text-sm text-warm-900 dark:text-charcoal-100 placeholder:text-warm-500 dark:placeholder:text-charcoal-500 focus:outline-none focus:border-brand-600 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isThinking || !input.trim()}
              aria-label="Send"
              className="h-10 w-10 flex items-center justify-center rounded-xl bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white disabled:opacity-40 transition cursor-pointer flex-shrink-0"
            >
              {isThinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </section>

        {/* RIGHT: live preview */}
        <section
          aria-label="Workflow preview"
          className="rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-subtle overflow-hidden"
        >
          {!proposal ? (
            <div className="p-8 sm:p-12 text-center space-y-3 min-h-[320px] flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-2xl bg-warm-100 dark:bg-charcoal-800 border border-warm-200 dark:border-charcoal-700 flex items-center justify-center">
                <Wand2 className="w-6 h-6 text-warm-500 dark:text-charcoal-400" aria-hidden="true" />
              </div>
              <h2 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">Your workflow will appear here</h2>
              <p className="text-xs text-warm-600 dark:text-charcoal-400 max-w-xs">
                As soon as I understand what you need, you will see each step laid out so you can review it before
                anything is saved.
              </p>
            </div>
          ) : (
            <div className="animate-in fade-in duration-300">
              <ProposalPreview steps={proposal.steps} connections={proposal.connections} />

              <div className="p-4 sm:p-5 space-y-5 border-t border-warm-200 dark:border-charcoal-800">
                {summary && (
                  <div className="space-y-1">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-warm-800 dark:text-charcoal-200">
                      What this does
                    </h2>
                    <p className="text-sm text-warm-700 dark:text-charcoal-300 leading-relaxed">{summary}</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-warm-800 dark:text-charcoal-200">
                    <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                    Steps
                  </h3>
                  <ol className="space-y-1">
                    {proposal.steps.map((s, i) => (
                      <li key={s.step_key} className="text-xs text-warm-700 dark:text-charcoal-300 flex gap-2">
                        <span className="w-4 text-right text-warm-500 dark:text-charcoal-500">{i + 1}.</span>
                        <span>
                          <span className="font-semibold text-warm-900 dark:text-charcoal-100">{s.name}</span>
                          {labelByType[s.step_type] && labelByType[s.step_type] !== s.name && (
                            <span className="text-warm-500 dark:text-charcoal-400"> · {labelByType[s.step_type]}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                {!proposal.valid && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 text-xs space-y-1.5"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-red-800 dark:text-red-300">
                      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                      This version has a problem, so it cannot be saved yet
                    </div>
                    <ul className="list-disc pl-5 text-red-700 dark:text-red-300 space-y-0.5">
                      {proposal.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                    <p className="text-red-700 dark:text-red-300">Ask me to fix it in the chat on the left.</p>
                  </div>
                )}

                {proposal.valid && proposal.warnings.length > 0 && (
                  <ul className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-900 dark:text-amber-200 space-y-0.5 list-disc pl-7">
                    {proposal.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}

                <SetupChecklist items={setupItems} />

                {unsupported.length > 0 && (
                  <div className="p-3 rounded-xl bg-warm-100 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 text-xs space-y-1">
                    <div className="font-semibold text-warm-900 dark:text-charcoal-100">Not available yet</div>
                    <p className="text-warm-700 dark:text-charcoal-300">
                      Some of what you asked for is not supported today, so it is left out of this version:
                    </p>
                    <ul className="list-disc pl-5 text-warm-700 dark:text-charcoal-300">
                      {unsupported.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Create */}
                <div className="pt-4 border-t border-warm-200 dark:border-charcoal-800 space-y-3">
                  <div>
                    <label
                      htmlFor="workflow-name"
                      className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1"
                    >
                      Workflow name
                    </label>
                    <input
                      id="workflow-name"
                      type="text"
                      value={workflowName}
                      maxLength={255}
                      onChange={(e) => {
                        setWorkflowName(e.target.value);
                        setNameTouched(true);
                      }}
                      placeholder="Give your workflow a name"
                      className="w-full px-3 py-2 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-sm text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
                    />
                  </div>

                  {createError && (
                    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
                      {createError}
                    </p>
                  )}

                  {!canEdit && (
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Your role can view workflows but not create them. Ask a manager or admin to save this one.
                    </p>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={!canCreate}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white text-sm font-semibold shadow-subtle disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer btn-micro-hover"
                    >
                      {isCreating ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span>{isCreating ? 'Creating…' : 'Create draft'}</span>
                    </button>
                    <p className="text-xs text-warm-600 dark:text-charcoal-400">
                      Saved as a draft. Nothing runs until you turn it on. You can test it with sample data in the
                      editor right after.
                    </p>
                  </div>
                  {blockingSetup > 0 && proposal.valid && (
                    <p className="text-[11px] text-amber-800 dark:text-amber-300">
                      You can still save the draft now and finish the {blockingSetup} required setup{' '}
                      {blockingSetup === 1 ? 'item' : 'items'} before turning it on.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AIBuilderPage;
