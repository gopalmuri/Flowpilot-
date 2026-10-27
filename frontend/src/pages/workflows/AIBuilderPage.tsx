import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  buildWorkflowWithAI,
  createDraftFromAIProposal,
  enableWorkflow,
  getAICatalog,
  getAITemplates,
  publishWorkflowVersion,
  updateWorkflow,
  updateWorkflowVersion,
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
import { WorkflowConnectionSchema, WorkflowStepSchema } from '../../types/workflow';
import { EXAMPLE_PROMPTS } from '../../components/workflow/ai/examplePrompts';
import { humanizeKey } from '../../components/workflow/ai/ProposalDiffSummary';
import { BuilderMessage, MessageChanges } from '../../components/workflow/builder/AssistantMessage';
import { WorkflowAssistantPanel } from '../../components/workflow/builder/WorkflowAssistantPanel';
import { WorkflowBuilderHeader } from '../../components/workflow/builder/WorkflowBuilderHeader';
import { WorkflowCanvas } from '../../components/workflow/builder/WorkflowCanvas';
import { WorkflowDetails } from '../../components/workflow/builder/WorkflowDetails';
import { WorkflowInspector } from '../../components/workflow/builder/WorkflowInspector';
import { WorkflowTestPanel } from '../../components/workflow/builder/WorkflowTestPanel';
import { WorkflowLifecycle } from '../../components/workflow/builder/WorkflowStatusIndicator';
import { validateWorking, withLayout } from '../../components/workflow/builder/graph';
import { panel } from '../../components/workflow/builder/styles';

const MAX_QUESTIONS = 3;
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

const errMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** Signature of the workflow content; positions are optional so a drag is not counted as a "content edit". */
function contentSig(steps: WorkflowStepSchema[], connections: WorkflowConnectionSchema[], withPositions: boolean): string {
  return JSON.stringify({
    s: steps.map((s) => [s.step_key, s.step_type, s.name, s.config, withPositions ? s.ui_position : null]),
    c: connections.map((c) => [c.source_step_key, c.target_step_key, c.condition_label ?? null]),
  });
}

const unique = (list: string[]) => Array.from(new Set(list));

function buildChanges(
  proposal: AIWorkflowProposal,
  previous: WorkflowStepSchema[]
): MessageChanges | undefined {
  const names: Record<string, string> = {};
  previous.forEach((s) => (names[s.step_key] = s.name));
  proposal.steps.forEach((s) => (names[s.step_key] = s.name));
  const label = (k: string) => names[k] || humanizeKey(k);
  const d = proposal.diff_summary;
  if (!d) return undefined;
  const changes: MessageChanges = {
    added: d.added_steps.map(label),
    removed: d.removed_steps.map(label),
    modified: d.modified_steps.map(label),
    reconnected: d.reconnected_edges.length,
  };
  return changes.added.length || changes.removed.length || changes.modified.length || changes.reconnected
    ? changes
    : undefined;
}

type MobileTab = 'assistant' | 'workflow';
interface DraftRef {
  workflowId: string;
  versionId: string;
}

export const AIBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeOrganization, activeRole } = useAuth();
  const { showSuccess, showError, confirm } = useToast();

  // Conversation
  const [messages, setMessages] = useState<BuilderMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [questions, setQuestions] = useState<AIClarificationQuestion[]>([]);
  const [templatePicks, setTemplatePicks] = useState<AITemplateSuggestion[]>([]);
  const [starterTemplates, setStarterTemplates] = useState<AIWorkflowTemplate[]>([]);
  const [catalog, setCatalog] = useState<AICatalogStep[]>([]);

  // Working copy of the workflow. Inspector edits change this; it is what is saved and sent to the AI next turn.
  const [steps, setSteps] = useState<WorkflowStepSchema[]>([]);
  const [connections, setConnections] = useState<WorkflowConnectionSchema[]>([]);
  const [proposal, setProposal] = useState<AIWorkflowProposal | null>(null);
  const [baselineSig, setBaselineSig] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [setupItems, setSetupItems] = useState<AISetupItem[]>([]);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  // UI
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('assistant');
  const [workflowUpdated, setWorkflowUpdated] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  // Lifecycle: nothing saved -> draft saved -> (published) -> active
  const [draft, setDraft] = useState<DraftRef | null>(null);
  const [savedSig, setSavedSig] = useState('');
  const [savedName, setSavedName] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const nameTouchedRef = useRef(false);
  nameTouchedRef.current = nameTouched;
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const initialSentRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Selecting a step opens the sheet so its settings are one click away.
  useEffect(() => {
    if (selectedKey) setSheetOpen(true);
  }, [selectedKey]);
  const lastRequestRef = useRef<string | null>(null);
  const busyRef = useRef({ create: false, save: false, activate: false });
  // Latest values for the async send handler, which must not close over stale state.
  const stateRef = useRef({ messages, steps, connections, workflowName, draft });
  stateRef.current = { messages, steps, connections, workflowName, draft };

  const canEdit = activeRole === 'OWNER' || activeRole === 'ADMIN' || activeRole === 'MANAGER';
  const orgId = activeOrganization?.id;
  const hasWorkflow = steps.length > 0;

  const catalogByType = useMemo(() => {
    const m: Record<string, AICatalogStep> = {};
    catalog.forEach((c) => {
      m[c.step_type] = c;
    });
    return m;
  }, [catalog]);

  // Catalog (plain-language names) and templates (starter ideas): both are optional extras.
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

  // Deliberately NOT aborting the in-flight request on unmount: React StrictMode (dev) mounts, unmounts and
  // remounts every page, which would cancel the first prompt while the "send once" guard stops it being resent,
  // leaving the user staring at their own message. A newer send() still cancels an older one (see send()).

  // ---- Derived workflow state -------------------------------------------------------------------------
  const validation = useMemo(
    () => (steps.length > 0 ? validateWorking(steps, connections) : { valid: false, errors: [], warnings: [], errorsByKey: {} as Record<string, string[]> }),
    [steps, connections]
  );
  const edited = proposal !== null && contentSig(steps, connections, false) !== baselineSig;
  const errors = useMemo(
    () => unique([...(!edited && proposal && !proposal.valid ? proposal.errors : []), ...validation.errors]),
    [edited, proposal, validation.errors]
  );
  const warnings = useMemo(
    () => unique([...(!edited && proposal ? proposal.warnings : []), ...validation.warnings]),
    [edited, proposal, validation.warnings]
  );
  const isValid = hasWorkflow && errors.length === 0;
  const errorKeys = useMemo(() => new Set(Object.keys(validation.errorsByKey)), [validation.errorsByKey]);
  const blockingSetup = setupItems.filter((s) => s.blocking);

  const contentChanged = draft !== null && contentSig(steps, connections, true) !== savedSig;
  const nameChanged = draft !== null && workflowName.trim() !== savedName;
  const dirty = contentChanged || nameChanged;
  const locked = isActive;
  const hasUnsaved = !locked && (draft ? dirty : hasWorkflow);

  const lifecycle: WorkflowLifecycle = isActive
    ? 'active'
    : isPublished
    ? 'published'
    : draft
    ? dirty
      ? 'dirty'
      : 'saved'
    : 'unsaved';

  const nameOk = workflowName.trim().length > 0;
  const busy = isCreating || isSaving || isActivating;
  const canCreate = !draft && hasWorkflow && isValid && nameOk && canEdit && !busy;
  const canSave = draft !== null && !locked && !isPublished && dirty && nameOk && canEdit && !busy;
  const canActivate = draft !== null && !locked && !dirty && isValid && canEdit && !busy;

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let hint: string | null = null;
  if (actionError) hint = actionError;
  else if (!canEdit && hasWorkflow) hint = 'Your role can view workflows but not create them. Ask a manager or admin.';
  else if (!draft) {
    if (!hasWorkflow) hint = 'Describe your workflow to the assistant to get started.';
    else if (!isValid) hint = `Fix ${plural(errors.length, 'problem', 'problems')} before creating the draft.`;
    else if (!nameOk) hint = 'Name your workflow to create the draft.';
    else if (blockingSetup.length > 0)
      hint = `You can create the draft now. ${plural(blockingSetup.length, 'required setup item', 'required setup items')} to finish before activating.`;
  } else if (!locked) {
    if (dirty) hint = 'You have unsaved changes. Save them before activating.';
    else if (!isValid) hint = `Fix ${plural(errors.length, 'problem', 'problems')} before activating.`;
    else if (isPublished) hint = 'Published, but not yet active. Activate to turn it on.';
  }

  // ---- Leaving the page --------------------------------------------------------------------------------
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  const guardedNavigate = useCallback(
    (to: string) => {
      if (!hasUnsaved) {
        navigate(to);
        return;
      }
      confirm({
        title: 'Leave without saving?',
        message: draft
          ? 'You have changes that are not saved to your draft. If you leave now they will be lost.'
          : 'This workflow has not been saved as a draft yet. If you leave now it will be lost.',
        confirmLabel: 'Leave anyway',
        cancelLabel: 'Stay here',
        variant: 'warning',
        onConfirm: () => navigate(to),
      });
    },
    [hasUnsaved, draft, confirm, navigate]
  );

  // ---- Assistant ---------------------------------------------------------------------------------------
  const applyResponse = useCallback((res: AIWorkflowAssistResponse) => {
    setQuestions([]);
    setTemplatePicks([]);

    const next: BuilderMessage = {
      id: ++idRef.current,
      role: 'assistant',
      content: res.message,
      tone: res.mode === 'error' ? 'error' : 'normal',
    };

    if (res.mode === 'proposal' && res.proposal) {
      const p = res.proposal;
      next.changes = buildChanges(p, stateRef.current.steps);
      const laidOut = withLayout(p.steps, p.connections);
      setSteps(laidOut);
      setConnections(p.connections);
      setProposal(p);
      setBaselineSig(contentSig(laidOut, p.connections, false));
      setSummary(res.summary ?? null);
      setSetupItems(res.setup_needed ?? []);
      setUnsupported(res.unsupported ?? []);
      setSelectedKey((cur) => (cur && p.steps.some((s) => s.step_key === cur) ? cur : null));
      setWorkflowUpdated(true);
      if (res.suggested_name && !stateRef.current.draft && (!nameTouchedRef.current || !stateRef.current.workflowName.trim())) {
        setWorkflowName(res.suggested_name);
      }
    } else if (res.mode === 'clarification') {
      setQuestions((res.clarification_questions ?? []).slice(0, MAX_QUESTIONS));
    } else if (res.mode === 'suggestion') {
      setTemplatePicks(res.template_suggestions ?? []);
    }
    setMessages((prev) => [...prev, next]);
    if (res.mode !== 'proposal' && res.unsupported?.length) {
      // Keep any earlier workflow on screen, but surface fresh heads-ups from this turn.
      setUnsupported(res.unsupported);
    }
  }, []);

  const send = useCallback(
    async (rawText: string, opts?: { retry?: boolean }) => {
      const text = rawText.trim();
      if (!text || !orgId || isThinking || isActive) return;

      let prior = stateRef.current.messages;
      if (opts?.retry) {
        // Take back the failed attempt (its error and its question) so the retry is a clean resend.
        const copy = [...prior];
        while (copy.length && copy[copy.length - 1].role === 'assistant' && copy[copy.length - 1].tone && copy[copy.length - 1].tone !== 'normal') {
          copy.pop();
        }
        if (copy.length && copy[copy.length - 1].role === 'user') copy.pop();
        prior = copy;
      }
      const history: AIChatMessage[] = prior
        .filter((m) => m.tone !== 'error' && m.tone !== 'limit')
        .map((m) => ({ role: m.role, content: m.content }));
      const { steps: curSteps, connections: curConnections, workflowName: name } = stateRef.current;

      lastRequestRef.current = text;
      setMessages([...prior, { id: ++idRef.current, role: 'user', content: text }]);
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
            // The working copy, including any edits made in the inspector.
            current_steps: curSteps,
            current_connections: curConnections,
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
    [orgId, isThinking, isActive, applyResponse]
  );

  const retry = useCallback(() => {
    if (lastRequestRef.current) void send(lastRequestRef.current, { retry: true });
  }, [send]);

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

  // ---- Editing the working copy -----------------------------------------------------------------------
  const updateStep = useCallback(
    (key: string, patch: { name?: string; config?: Record<string, any> }) => {
      if (isActive) return;
      setSteps((prev) =>
        prev.map((s) => (s.step_key === key ? { ...s, name: patch.name ?? s.name, config: patch.config ?? s.config } : s))
      );
    },
    [isActive]
  );

  const moveStep = useCallback(
    (key: string, position: { x: number; y: number }) => {
      if (isActive) return;
      setSteps((prev) => prev.map((s) => (s.step_key === key ? { ...s, ui_position: position } : s)));
    },
    [isActive]
  );

  const addConnection = useCallback(
    (c: WorkflowConnectionSchema) => {
      if (isActive || c.source_step_key === c.target_step_key) return;
      setConnections((prev) =>
        prev.some(
          (x) =>
            x.source_step_key === c.source_step_key &&
            x.target_step_key === c.target_step_key &&
            (x.condition_label ?? null) === (c.condition_label ?? null)
        )
          ? prev
          : [...prev, c]
      );
    },
    [isActive]
  );

  const removeConnections = useCallback(
    (list: WorkflowConnectionSchema[]) => {
      if (isActive || list.length === 0) return;
      setConnections((prev) =>
        prev.filter(
          (x) =>
            !list.some(
              (d) =>
                d.source_step_key === x.source_step_key &&
                d.target_step_key === x.target_step_key &&
                (d.condition_label ?? null) === (x.condition_label ?? null)
            )
        )
      );
    },
    [isActive]
  );

  const removeSteps = useCallback(
    (keys: string[]) => {
      if (isActive || keys.length === 0) return;
      setSteps((prev) => prev.filter((s) => !keys.includes(s.step_key)));
      setConnections((prev) => prev.filter((c) => !keys.includes(c.source_step_key) && !keys.includes(c.target_step_key)));
      setSelectedKey((cur) => (cur && keys.includes(cur) ? null : cur));
    },
    [isActive]
  );

  // ---- Lifecycle actions ------------------------------------------------------------------------------
  const handleCreate = async () => {
    if (busyRef.current.create || !canCreate || !orgId) return;
    busyRef.current.create = true;
    setIsCreating(true);
    setActionError(null);
    const name = workflowName.trim();
    const snapshotSteps = steps;
    const snapshotConnections = connections;
    try {
      const created = await createDraftFromAIProposal(orgId, {
        name,
        description: summary ?? undefined,
        steps: snapshotSteps,
        connections: snapshotConnections,
      });
      setDraft({ workflowId: created.workflow_id, versionId: created.version_id });
      setSavedName(name);
      setSavedSig(contentSig(snapshotSteps, snapshotConnections, true));
      showSuccess(`"${created.name}" is saved as a draft. Nothing runs until you activate it.`, 'Draft created');
    } catch (err) {
      const msg = errMessage(err, 'Something went wrong saving your draft.');
      setActionError(msg);
      showError(msg, 'Could not create draft');
    } finally {
      busyRef.current.create = false;
      setIsCreating(false);
    }
  };

  const handleSave = async () => {
    if (busyRef.current.save || !canSave || !orgId || !draft) return;
    busyRef.current.save = true;
    setIsSaving(true);
    setActionError(null);
    const name = workflowName.trim();
    const snapshotSteps = steps;
    const snapshotConnections = connections;
    try {
      if (name !== savedName) {
        await updateWorkflow(orgId, draft.workflowId, { name });
        setSavedName(name);
      }
      await updateWorkflowVersion(orgId, draft.workflowId, draft.versionId, {
        steps: snapshotSteps,
        connections: snapshotConnections,
      });
      setSavedSig(contentSig(snapshotSteps, snapshotConnections, true));
      showSuccess('Your changes are saved to the draft.', 'Draft saved');
    } catch (err) {
      const msg = errMessage(err, 'Something went wrong saving your changes.');
      setActionError(msg);
      showError(msg, 'Could not save changes');
    } finally {
      busyRef.current.save = false;
      setIsSaving(false);
    }
  };

  const doActivate = async () => {
    if (busyRef.current.activate || !orgId || !draft) return;
    busyRef.current.activate = true;
    setIsActivating(true);
    setActionError(null);
    try {
      if (!isPublished) {
        await publishWorkflowVersion(orgId, draft.workflowId, draft.versionId);
        setIsPublished(true);
      }
      await enableWorkflow(orgId, draft.workflowId);
      setIsActive(true);
      setSelectedKey(null);
      setTestOpen(false);
      showSuccess(`"${workflowName.trim()}" is now active.`, 'Workflow activated');
    } catch (err) {
      const msg = errMessage(err, 'Something went wrong activating the workflow.');
      setActionError(msg);
      showError(msg, 'Could not activate');
    } finally {
      busyRef.current.activate = false;
      setIsActivating(false);
    }
  };

  const handleActivate = () => {
    if (!canActivate) return;
    const pending = blockingSetup.length
      ? ` ${plural(blockingSetup.length, 'required setup item is', 'required setup items are')} not finished (${blockingSetup
          .map((s) => s.title)
          .join(', ')}), so parts of it may not work yet.`
      : '';
    confirm({
      title: 'Activate this workflow?',
      message: `"${workflowName.trim()}" will be published and turned on. It will start running when its trigger fires.${pending}`,
      confirmLabel: 'Activate workflow',
      cancelLabel: 'Not yet',
      variant: 'brand',
      onConfirm: doActivate,
    });
  };

  const openEditor = () => {
    if (draft) guardedNavigate(`/workflows/${draft.workflowId}`);
  };

  const tabListRef = useRef<HTMLDivElement | null>(null);
  const switchTab = (tab: MobileTab) => {
    setMobileTab(tab);
    // On small screens the page header sits above the panels: bring the tab bar to the top so the chosen panel
    // (and the chat input at its bottom) fills the screen.
    window.requestAnimationFrame(() => tabListRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
    if (tab === 'workflow') {
      setWorkflowUpdated(false);
      setFitSignal((n) => n + 1);
    }
  };

  const selectedStep = selectedKey ? steps.find((s) => s.step_key === selectedKey) ?? null : null;
  const testDisabledReason = !isValid
    ? errors.length > 0
      ? `Fix the ${plural(errors.length, 'problem', 'problems')} listed under the workflow before testing.`
      : 'Add steps to the workflow before testing.'
    : undefined;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5">
      <WorkflowBuilderHeader
        name={workflowName}
        onNameChange={(v) => {
          setWorkflowName(v);
          setNameTouched(true);
        }}
        lifecycle={lifecycle}
        hasDraft={draft !== null}
        isCreating={isCreating}
        isSaving={isSaving}
        isActivating={isActivating}
        canCreate={canCreate}
        canSave={canSave}
        canActivate={canActivate}
        canTest={hasWorkflow}
        testOpen={testOpen}
        hint={hint}
        onBack={() => guardedNavigate('/workflows')}
        onTest={() => setTestOpen((o) => !o)}
        onCreate={handleCreate}
        onSave={handleSave}
        onOpenEditor={openEditor}
        onActivate={handleActivate}
      />

      <div
        ref={tabListRef}
        role="tablist"
        aria-label="Builder panels"
        className="grid grid-cols-2 gap-1 rounded-lg bg-warm-100 p-1 dark:bg-charcoal-850 lg:hidden"
      >
        {(['assistant', 'workflow'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`builder-tab-${tab}`}
            aria-selected={mobileTab === tab}
            aria-controls={`builder-panel-${tab}`}
            onClick={() => switchTab(tab)}
            className={`relative h-9 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 cursor-pointer ${
              mobileTab === tab
                ? 'bg-white text-warm-900 shadow-subtle dark:bg-charcoal-900 dark:text-charcoal-100'
                : 'text-warm-600 hover:text-warm-900 dark:text-charcoal-400 dark:hover:text-charcoal-100'
            }`}
          >
            {tab === 'assistant' ? 'Assistant' : 'Workflow'}
            {tab === 'workflow' && workflowUpdated && mobileTab !== 'workflow' && (
              <>
                <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
                <span className="sr-only"> (updated)</span>
              </>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:h-[calc(100dvh-24rem)] xl:h-[calc(100dvh-18.5rem)] lg:min-h-[460px] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* LEFT: assistant (about 40%) */}
        <div
          id="builder-panel-assistant"
          data-testid="assistant-pane"
          aria-labelledby="builder-tab-assistant"
          className={`${mobileTab === 'assistant' ? 'flex' : 'hidden'} h-[calc(100dvh-9rem)] min-h-[440px] flex-col scroll-mt-16 lg:flex lg:h-auto lg:min-h-0`}
        >
          <WorkflowAssistantPanel
            className="flex-1"
            messages={messages}
            isThinking={isThinking}
            questions={questions}
            templatePicks={templatePicks}
            starterTemplates={starterTemplates}
            examplePrompts={EXAMPLE_PROMPTS.slice(0, 4)}
            hasWorkflow={hasWorkflow}
            lockedReason={locked ? 'This workflow is active. Open it in the editor to make changes.' : null}
            input={input}
            onInputChange={setInput}
            onSend={(t) => void send(t)}
            onRetry={retry}
            inputRef={inputRef}
          />
        </div>

        {/* RIGHT: canvas and details (about 60%) */}
        <div
          id="builder-panel-workflow"
          data-testid="workflow-pane"
          aria-labelledby="builder-tab-workflow"
          className={`${mobileTab === 'workflow' ? 'flex' : 'hidden'} min-h-[680px] min-w-0 flex-col lg:flex lg:min-h-0`}
        >
          <section aria-label="Workflow" className={`${panel} relative flex min-h-0 flex-1 flex-col overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warm-200 px-5 py-3 dark:border-charcoal-800">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold text-warm-900 dark:text-charcoal-100">Workflow</h2>
                {hasWorkflow && (
                  <span className="text-sm text-warm-500 dark:text-charcoal-400">{plural(steps.length, 'step', 'steps')}</span>
                )}
              </div>
              {hasWorkflow && (
                <p
                  className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                    isValid ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {isValid ? (
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  )}
                  {isValid ? 'No problems found' : plural(errors.length, 'problem to fix', 'problems to fix')}
                </p>
              )}
            </div>

            {/* Canvas gets the full height; summary / inspector live in a bottom sheet that overlays it. */}
            <div className="relative min-h-[420px] flex-1 lg:min-h-0">
              <div className="absolute inset-x-0 top-0 bottom-[52px]">
                <WorkflowCanvas
                  steps={steps}
                  connections={connections}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  onMoveNode={moveStep}
                  onConnect={addConnection}
                  onDeleteSteps={removeSteps}
                  onDeleteConnections={removeConnections}
                  catalog={catalogByType}
                  errorKeys={errorKeys}
                  readOnly={locked}
                  isLoading={isThinking}
                  fitSignal={fitSignal}
                />
              </div>

              <div
                data-testid="details-sheet"
                className={`absolute inset-x-0 bottom-0 z-10 flex flex-col border-t border-warm-200 bg-white shadow-[0_-10px_24px_-14px_rgba(15,23,42,0.25)] transition-[max-height] duration-200 ease-out dark:border-charcoal-800 dark:bg-charcoal-900 ${
                  sheetOpen ? 'max-h-[64%]' : 'max-h-[52px]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSheetOpen((v) => !v)}
                  aria-expanded={sheetOpen}
                  aria-controls="builder-details-body"
                  className="flex h-[52px] w-full flex-shrink-0 items-center gap-3 px-5 text-left transition-colors hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-charcoal-850"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-warm-900 dark:text-charcoal-100">
                    {selectedStep
                      ? selectedStep.name
                      : hasWorkflow
                      ? summary || 'Workflow summary and setup'
                      : 'Summary and setup appear here'}
                  </span>
                  {hasWorkflow && setupItems.length > 0 && (
                    <span className="flex-shrink-0 text-xs text-warm-600 dark:text-charcoal-400">
                      {plural(setupItems.length, 'setup note', 'setup notes')}
                    </span>
                  )}
                  <ChevronUp
                    className={`h-4 w-4 flex-shrink-0 text-warm-500 transition-transform duration-200 dark:text-charcoal-400 ${
                      sheetOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>
                <div id="builder-details-body" className="min-h-0 flex-1 overflow-y-auto border-t border-warm-200 dark:border-charcoal-800">
                  {selectedStep ? (
                    <WorkflowInspector
                      key={selectedStep.step_key}
                      step={selectedStep}
                      catalogEntry={catalogByType[selectedStep.step_type]}
                      errors={validation.errorsByKey[selectedStep.step_key] ?? []}
                      setupItems={setupItems.filter((s) => s.step_key === selectedStep.step_key)}
                      readOnly={locked}
                      onChange={updateStep}
                      onDelete={(k) => removeSteps([k])}
                      onClose={() => setSelectedKey(null)}
                    />
                  ) : hasWorkflow ? (
                    <WorkflowDetails
                      summary={summary}
                      steps={steps}
                      catalog={catalogByType}
                      selectedKey={selectedKey}
                      onSelectStep={setSelectedKey}
                      errors={errors}
                      warnings={warnings}
                      setupItems={setupItems}
                      unsupported={unsupported}
                    />
                  ) : (
                    <p className="p-5 text-sm text-warm-600 dark:text-charcoal-400">
                      The summary, ordered steps and setup requirements show up here once the assistant proposes a workflow.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {testOpen && orgId && hasWorkflow && (
              <WorkflowTestPanel
                className="absolute inset-x-0 bottom-0 top-[22%] z-20"
                organizationId={orgId}
                steps={steps}
                connections={connections}
                disabled={!isValid}
                disabledReason={testDisabledReason}
                onClose={() => setTestOpen(false)}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AIBuilderPage;
