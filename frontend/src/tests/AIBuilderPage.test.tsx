import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AIBuilderPage } from '../pages/workflows/AIBuilderPage';
import { ToastProvider } from '../context/ToastContext';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ToastContainer } from '../components/ui/ToastContainer';
import * as AuthContextModule from '../context/AuthContext';
import * as WorkflowServiceModule from '../services/workflowService';
import { AIWorkflowAssistResponse, AIWorkflowProposal } from '../types/workflowAI';

// React Flow needs real layout (it is covered by its own graph tests); this stub exposes the page's contract with it.
vi.mock('../components/workflow/builder/WorkflowCanvas', () => ({
  WorkflowCanvas: (p: {
    steps: Array<{ step_key: string; name: string }>;
    selectedKey: string | null;
    isLoading?: boolean;
    onSelect: (k: string | null) => void;
  }) => (
    <div data-testid="canvas-stub" data-loading={String(Boolean(p.isLoading))} data-selected={p.selectedKey ?? ''}>
      {p.steps.map((s) => (
        <button key={s.step_key} type="button" onClick={() => p.onSelect(s.step_key)}>
          canvas-{s.step_key}
        </button>
      ))}
    </div>
  ),
}));

const mockOrg = { id: 'org-1', name: 'Acme', slug: 'acme', role: 'ADMIN' as never, created_at: '2026-01-01T00:00:00Z' };

const validProposal: AIWorkflowProposal = {
  steps: [
    { step_key: 'start', step_type: 'WEBHOOK_TRIGGER', name: 'New email arrives', config: {}, ui_position: { x: 0, y: 0 } },
    { step_key: 'notify', step_type: 'SLACK_NOTIFICATION', name: 'Tell the team', config: { channel: '#sales' }, ui_position: { x: 0, y: 100 } },
  ],
  connections: [{ source_step_key: 'start', target_step_key: 'notify', condition_label: null }],
  diff_summary: { added_steps: ['start', 'notify'], removed_steps: [], modified_steps: [], reconnected_edges: [] },
  valid: true,
  errors: [],
  warnings: [],
};

function response(partial: Partial<AIWorkflowAssistResponse>): AIWorkflowAssistResponse {
  return {
    mode: 'proposal',
    message: 'Here is a first version.',
    proposal: null,
    clarification_questions: [],
    template_suggestions: [],
    tokens_used: 0,
    latency_ms: 0,
    provider: 'mock',
    model: 'mock',
    ...partial,
  };
}

function renderPage(initialPrompt = 'Tell sales about new leads', strict = false) {
  const page = (
    <ToastProvider>
      <MemoryRouter initialEntries={[{ pathname: '/workflows/new/ai', state: { prompt: initialPrompt } }]}>
        <Routes>
          <Route path="/workflows/new/ai" element={<AIBuilderPage />} />
          <Route path="/workflows/:id" element={<div>Editor opened</div>} />
          <Route path="/workflows" element={<div>Workflow list</div>} />
        </Routes>
      </MemoryRouter>
      <ConfirmModal />
      <ToastContainer />
    </ToastProvider>
  );
  return render(strict ? <React.StrictMode>{page}</React.StrictMode> : page);
}

const created = {
  workflow_id: 'wf-new',
  version_id: 'v-1',
  name: 'Lead alerts',
  status: 'DRAFT',
  valid: true,
  warnings: [],
};

/** Loads the valid proposal and returns once the page is ready to act on it. */
async function loadProposal(extra: Partial<AIWorkflowAssistResponse> = {}) {
  const build = vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockResolvedValue(
    response({ proposal: validProposal, summary: 'Alerts the team.', suggested_name: 'Lead alerts', ...extra })
  );
  renderPage();
  await waitFor(() => expect(screen.getByLabelText('Workflow name')).toHaveValue('Lead alerts'));
  return build;
}

async function createDraft() {
  vi.spyOn(WorkflowServiceModule, 'createDraftFromAIProposal').mockResolvedValue(created);
  fireEvent.click(await screen.findByRole('button', { name: /Create draft/i }));
  return screen.findByRole('button', { name: 'Save changes' });
}

describe('AIBuilderPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      organizations: [mockOrg],
      activeOrganization: mockOrg,
      activeRole: 'ADMIN',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
      refreshProfile: vi.fn(),
    } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
    vi.spyOn(WorkflowServiceModule, 'getAICatalog').mockResolvedValue([]);
    vi.spyOn(WorkflowServiceModule, 'getAITemplates').mockResolvedValue([]);
  });

  describe('conversation', () => {
    it('sends the prompt from the home page and shows clarification options as buttons that send the answer', async () => {
      const build = vi
        .spyOn(WorkflowServiceModule, 'buildWorkflowWithAI')
        .mockResolvedValueOnce(
          response({
            mode: 'clarification',
            message: 'One quick question.',
            clarification_questions: [{ id: 'q1', question: 'Where should alerts go?', options: ['Slack', 'Email'] }],
          })
        )
        .mockResolvedValueOnce(response({ mode: 'explanation', message: 'Got it, Slack it is.' }));

      renderPage();

      expect(await screen.findByText('Where should alerts go?')).toBeInTheDocument();
      expect(build).toHaveBeenCalledTimes(1);
      expect(build.mock.calls[0][1].prompt).toBe('Tell sales about new leads');

      fireEvent.click(screen.getByRole('button', { name: 'Slack' }));

      await waitFor(() => expect(build).toHaveBeenCalledTimes(2));
      expect(build.mock.calls[1][1].prompt).toBe('Slack');
      // The earlier turns travel as conversation history.
      expect(build.mock.calls[1][1].conversation_history.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(await screen.findByText('Got it, Slack it is.')).toBeInTheDocument();
    });

    it('still gets its answer when React StrictMode mounts the page twice (as in dev)', async () => {
      // The mock honours the abort signal like fetch does, so a page that cancels its own request is caught.
      const build = vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockImplementation(
        (_org, _payload, signal) =>
          new Promise((resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            setTimeout(() => resolve(response({ mode: 'explanation', message: 'Here you go.' })), 20);
          })
      );

      renderPage('Tell sales about new leads', true);

      expect(await screen.findByText('Here you go.')).toBeInTheDocument();
      expect(build).toHaveBeenCalledTimes(1);
      // and it is no longer shown as busy
      expect(screen.queryByText(/choosing steps|checking the flow|thinking/i)).not.toBeInTheDocument();
    });

    it('shows clear progress while the AI is working, then the answer', async () => {
      let release: (r: AIWorkflowAssistResponse) => void = () => undefined;
      vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockImplementation(
        () => new Promise((resolve) => { release = resolve; })
      );

      renderPage();

      expect(await screen.findByRole('status')).toHaveTextContent(/understanding what you need|choosing steps/i);
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-loading', 'true');

      release(response({ mode: 'explanation', message: 'All done.' }));
      expect(await screen.findByText('All done.')).toBeInTheDocument();
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-loading', 'false');
    });

    it('lets the user answer with free text instead of an option', async () => {
      const build = vi
        .spyOn(WorkflowServiceModule, 'buildWorkflowWithAI')
        .mockResolvedValueOnce(
          response({
            mode: 'clarification',
            message: 'Quick question.',
            clarification_questions: [{ id: 'q1', question: 'Who approves?', options: ['Manager'] }],
          })
        )
        .mockResolvedValueOnce(response({ mode: 'explanation', message: 'Noted.' }));

      renderPage();
      const other = await screen.findByLabelText(/Other answer for: Who approves/i);
      fireEvent.change(other, { target: { value: 'The finance lead' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use this' }));

      await waitFor(() => expect(build).toHaveBeenCalledTimes(2));
      expect(build.mock.calls[1][1].prompt).toBe('The finance lead');
    });

    it('shows the friendly daily-limit message when the AI limit is reached', async () => {
      vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockRejectedValue(
        new Error('Your team has used all of its AI requests for today. It resets tomorrow.')
      );

      renderPage();

      expect(await screen.findByText(/used all of its AI requests for today/i)).toBeInTheDocument();
      expect(screen.getByText('Daily AI limit reached')).toBeInTheDocument();
    });

    it('offers Retry after an error and resends the same request without duplicating it', async () => {
      const build = vi
        .spyOn(WorkflowServiceModule, 'buildWorkflowWithAI')
        .mockRejectedValueOnce(new Error('The assistant had a hiccup.'))
        .mockResolvedValueOnce(response({ mode: 'explanation', message: 'Worked the second time.' }));

      renderPage('Tell sales about new leads');

      expect(await screen.findByText('The assistant had a hiccup.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Worked the second time.')).toBeInTheDocument();
      expect(build).toHaveBeenCalledTimes(2);
      expect(build.mock.calls[1][1].prompt).toBe('Tell sales about new leads');
      // The failed attempt is not sent as history, and the question is shown once.
      expect(build.mock.calls[1][1].conversation_history).toEqual([]);
      expect(screen.getAllByText('Tell sales about new leads')).toHaveLength(1);
      expect(screen.queryByText('The assistant had a hiccup.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

  describe('workflow details and inspector', () => {
    it('shows the real summary, ordered steps, change summary and setup requirements', async () => {
      await loadProposal({
        setup_needed: [
          { id: 's1', kind: 'integration', title: 'Connect Gmail', detail: 'Needed to read your inbox.', action: 'connect_gmail', blocking: true },
          { id: 's2', kind: 'config', title: 'Pick a Slack channel', detail: 'Choose where alerts go.', step_key: 'notify', action: 'edit_step', blocking: false },
        ],
        unsupported: ['Waiting for a few days'],
      });

      const details = await screen.findByTestId('workflow-details');
      expect(within(details).getByText('Alerts the team.')).toBeInTheDocument();
      expect(within(details).getByRole('heading', { name: 'Setup requirements' })).toBeInTheDocument();
      expect(within(details).getByText('Required')).toBeInTheDocument();
      expect(within(details).getByRole('link', { name: /Connect Gmail/i })).toHaveAttribute('href', '/integrations');
      expect(within(details).getByRole('link', { name: /Connect Gmail/i })).toHaveAttribute('target', '_blank');
      expect(within(details).getByText('Waiting for a few days')).toBeInTheDocument();
      // Steps are an ordered list with the step names, and the assistant reply summarises what changed.
      const stepButtons = within(details).getAllByRole('button', { name: /Open settings/ });
      expect(stepButtons.map((b) => b.textContent)).toEqual([
        expect.stringContaining('New email arrives'),
        expect.stringContaining('Tell the team'),
      ]);
      expect(screen.getByText('Changes to the workflow')).toBeInTheDocument();
      expect(screen.getByText(/New email arrives, Tell the team/)).toBeInTheDocument();
      // No Slack action is offered (the app has no Slack settings page) and no technical jargon.
      expect(screen.queryByRole('link', { name: /Configure Slack/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/step_key|step_type|DAG/i)).not.toBeInTheDocument();
    });

    it('disables Create draft and explains the problem when the proposal is invalid', async () => {
      vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockResolvedValue(
        response({
          proposal: { ...validProposal, valid: false, errors: ['The Slack step is missing a message.'] },
          suggested_name: 'Broken one',
        })
      );

      renderPage();

      expect(await screen.findByText('The Slack step is missing a message.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create draft/i })).toBeDisabled();
      expect(screen.getByText(/Fix 1 problem before creating the draft/)).toBeInTheDocument();
    });

    it('selecting a step shows only that step in the inspector, with its own integration note', async () => {
      await loadProposal({
        setup_needed: [
          {
            id: 's9',
            kind: 'integration',
            title: 'Slack is in test mode',
            detail: 'Messages are recorded in FlowPilot but not posted to a live channel.',
            step_key: 'notify',
            blocking: false,
          },
        ],
      });

      expect(screen.queryByTestId('workflow-inspector')).not.toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'canvas-notify' }));

      const inspector = await screen.findByTestId('workflow-inspector');
      expect(within(inspector).getByRole('heading', { name: 'Tell the team' })).toBeInTheDocument();
      expect(within(inspector).getByLabelText('Target Slack Channel')).toHaveValue('#sales');
      expect(within(inspector).getByText(/recorded in FlowPilot but not posted to a live channel/)).toBeInTheDocument();
      // Nothing about the other step, and the overview is replaced.
      expect(within(inspector).queryByText('New email arrives')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workflow-details')).not.toBeInTheDocument();

      fireEvent.click(within(inspector).getByRole('button', { name: 'Close step settings' }));
      expect(await screen.findByTestId('workflow-details')).toBeInTheDocument();
    });

    it('selecting a step from the Steps list opens its settings', async () => {
      await loadProposal();
      fireEvent.click(await screen.findByRole('button', { name: /Step 1: New email arrives/ }));
      expect(await screen.findByRole('region', { name: 'Settings for New email arrives' })).toBeInTheDocument();
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', 'start');
    });

    it('edits in the inspector change the working copy and are sent as current_steps on the next AI turn', async () => {
      const build = await loadProposal();
      fireEvent.click(await screen.findByRole('button', { name: 'canvas-notify' }));
      fireEvent.change(await screen.findByLabelText('Target Slack Channel'), { target: { value: '#vip' } });

      build.mockResolvedValueOnce(response({ mode: 'explanation', message: 'Okay.' }));
      fireEvent.change(screen.getByPlaceholderText('Describe a change to this workflow...'), {
        target: { value: 'Also ask a manager' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => expect(build).toHaveBeenCalledTimes(2));
      const sent = build.mock.calls[1][1];
      expect(sent.prompt).toBe('Also ask a manager');
      expect(sent.current_steps.find((s) => s.step_key === 'notify')?.config.channel).toBe('#vip');
      expect(sent.current_connections).toEqual(validProposal.connections);
    });

    it('re-validates after an edit and shows the problem', async () => {
      await loadProposal();
      fireEvent.click(await screen.findByRole('button', { name: 'canvas-notify' }));
      fireEvent.change(await screen.findByLabelText('Target Slack Channel'), { target: { value: '' } });

      const inspector = screen.getByTestId('workflow-inspector');
      expect(await within(inspector).findByRole('alert')).toHaveTextContent(/"Tell the team" requires/);
      expect(screen.getByRole('button', { name: /Create draft/i })).toBeDisabled();
    });
  });

  describe('draft lifecycle', () => {
    it('creates the draft once, stays on the page, and offers Save changes, Open in editor and a separate Activate', async () => {
      await loadProposal();
      const create = vi.spyOn(WorkflowServiceModule, 'createDraftFromAIProposal').mockResolvedValue(created);

      const createBtn = await screen.findByRole('button', { name: /Create draft/i });
      await waitFor(() => expect(createBtn).toBeEnabled());
      fireEvent.change(screen.getByLabelText('Workflow name'), { target: { value: 'Lead alerts v2' } });
      fireEvent.click(createBtn);
      fireEvent.click(createBtn); // a double click must not create two drafts

      expect(await screen.findByRole('button', { name: 'Save changes' })).toBeDisabled(); // nothing changed yet
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          name: 'Lead alerts v2',
          description: 'Alerts the team.',
          connections: validProposal.connections,
          steps: validProposal.steps.map((s) => expect.objectContaining({ step_key: s.step_key, config: s.config })),
        })
      );
      expect(screen.queryByText('Editor opened')).not.toBeInTheDocument();
      expect(screen.getByTestId('workflow-status')).toHaveTextContent('Draft saved');
      expect(screen.getByText(/Your workflow is a draft\. Nothing runs until you activate it\./)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open in editor' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: /Create draft/i })).not.toBeInTheDocument();
      expect(await screen.findByText(/is saved as a draft/)).toBeInTheDocument();
    });

    it('does not claim success when creating the draft fails, and allows trying again', async () => {
      await loadProposal();
      const create = vi
        .spyOn(WorkflowServiceModule, 'createDraftFromAIProposal')
        .mockRejectedValueOnce(new Error('Name already taken'))
        .mockResolvedValueOnce(created);

      const createBtn = await screen.findByRole('button', { name: /Create draft/i });
      await waitFor(() => expect(createBtn).toBeEnabled());
      fireEvent.click(createBtn);

      expect((await screen.findAllByText('Name already taken')).length).toBeGreaterThan(0);
      expect(screen.queryByText(/is saved as a draft/)).not.toBeInTheDocument();
      expect(screen.getByTestId('workflow-status')).toHaveTextContent('not saved yet');
      await waitFor(() => expect(screen.getByRole('button', { name: /Create draft/i })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /Create draft/i }));
      expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('Save changes updates the same draft version and the name, and only reports success afterwards', async () => {
      await loadProposal();
      await createDraft();
      const updateVersion = vi.spyOn(WorkflowServiceModule, 'updateWorkflowVersion').mockResolvedValue({} as never);
      const updateName = vi.spyOn(WorkflowServiceModule, 'updateWorkflow').mockResolvedValue({} as never);

      fireEvent.click(await screen.findByRole('button', { name: 'canvas-notify' }));
      fireEvent.change(await screen.findByLabelText('Target Slack Channel'), { target: { value: '#vip' } });
      fireEvent.change(screen.getByLabelText('Workflow name'), { target: { value: 'Renamed' } });
      expect(screen.getByTestId('workflow-status')).toHaveTextContent('unsaved changes');

      const save = screen.getByRole('button', { name: 'Save changes' });
      await waitFor(() => expect(save).toBeEnabled());
      fireEvent.click(save);

      await waitFor(() => expect(updateVersion).toHaveBeenCalledTimes(1));
      expect(updateName).toHaveBeenCalledWith('org-1', 'wf-new', { name: 'Renamed' });
      const [org, wf, ver, payload] = updateVersion.mock.calls[0];
      expect([org, wf, ver]).toEqual(['org-1', 'wf-new', 'v-1']);
      expect(payload.steps.find((s) => s.step_key === 'notify')?.config.channel).toBe('#vip');
      expect(await screen.findByText('Your changes are saved to the draft.')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-status')).toHaveTextContent('Draft saved');
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    });

    it('keeps unsaved state and shows the error when saving fails', async () => {
      await loadProposal();
      await createDraft();
      vi.spyOn(WorkflowServiceModule, 'updateWorkflowVersion').mockRejectedValue(new Error('Version is locked'));

      fireEvent.click(await screen.findByRole('button', { name: 'canvas-notify' }));
      fireEvent.change(await screen.findByLabelText('Target Slack Channel'), { target: { value: '#vip' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      expect((await screen.findAllByText('Version is locked')).length).toBeGreaterThan(0);
      expect(screen.queryByText('Your changes are saved to the draft.')).not.toBeInTheDocument();
      expect(screen.getByTestId('workflow-status')).toHaveTextContent('unsaved changes');
    });

    it('Activate asks for confirmation, then publishes and enables in order, and only then reports success', async () => {
      await loadProposal();
      await createDraft();
      const order: string[] = [];
      const publish = vi.spyOn(WorkflowServiceModule, 'publishWorkflowVersion').mockImplementation(async () => {
        order.push('publish');
        return {} as never;
      });
      const enable = vi.spyOn(WorkflowServiceModule, 'enableWorkflow').mockImplementation(async () => {
        order.push('enable');
        return {} as never;
      });

      fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
      const dialog = await screen.findByRole('dialog');
      expect(publish).not.toHaveBeenCalled(); // nothing happens before the user confirms
      fireEvent.click(within(dialog).getByRole('button', { name: 'Activate workflow' }));

      expect(await screen.findByText(/is now active/)).toBeInTheDocument();
      expect(order).toEqual(['publish', 'enable']);
      expect(publish).toHaveBeenCalledWith('org-1', 'wf-new', 'v-1');
      expect(enable).toHaveBeenCalledWith('org-1', 'wf-new');
      expect(screen.getByTestId('workflow-status')).toHaveTextContent('Active');
      expect(screen.getByRole('button', { name: 'Open workflow' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Describe a change to this workflow...')).toBeDisabled();
    });

    it('surfaces the real error when activation fails and does not claim success', async () => {
      await loadProposal();
      await createDraft();
      vi.spyOn(WorkflowServiceModule, 'publishWorkflowVersion').mockRejectedValue(
        new Error('Cannot publish: Gmail is not connected.')
      );
      const enable = vi.spyOn(WorkflowServiceModule, 'enableWorkflow').mockResolvedValue({} as never);

      fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activate workflow' }));

      expect((await screen.findAllByText('Cannot publish: Gmail is not connected.')).length).toBeGreaterThan(0);
      expect(enable).not.toHaveBeenCalled();
      expect(screen.queryByText(/is now active/)).not.toBeInTheDocument();
      expect(screen.getByTestId('workflow-status')).not.toHaveTextContent('Active');
    });

    it('does not allow Activate while there are unsaved changes', async () => {
      await loadProposal();
      await createDraft();
      fireEvent.click(await screen.findByRole('button', { name: 'canvas-notify' }));
      fireEvent.change(await screen.findByLabelText('Target Slack Channel'), { target: { value: '#vip' } });

      expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
      expect(screen.getByText(/Save them before activating/)).toBeInTheDocument();
    });

    it('warns before leaving with an unsaved workflow, and leaves when confirmed', async () => {
      await loadProposal();
      fireEvent.click(await screen.findByRole('button', { name: 'Back to workflows' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Leave without saving?')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Stay here' }));
      expect(screen.queryByText('Workflow list')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Back to workflows' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave anyway' }));
      expect(await screen.findByText('Workflow list')).toBeInTheDocument();
    });
  });

  describe('layout', () => {
    it('on small screens a tab switcher shows one panel at a time', async () => {
      await loadProposal();
      const assistantTab = screen.getByRole('tab', { name: /Assistant/ });
      const workflowTab = screen.getByRole('tab', { name: /Workflow/ });
      const assistantPane = screen.getByTestId('assistant-pane');
      const workflowPane = screen.getByTestId('workflow-pane');

      expect(assistantTab).toHaveAttribute('aria-selected', 'true');
      expect(assistantPane.className).toMatch(/\bflex\b/);
      expect(workflowPane.className).toMatch(/\bhidden\b/);
      // The workflow tab is flagged as updated because the assistant just changed it.
      expect(workflowTab).toHaveTextContent('(updated)');

      fireEvent.click(workflowTab);
      expect(workflowTab).toHaveAttribute('aria-selected', 'true');
      expect(assistantTab).toHaveAttribute('aria-selected', 'false');
      expect(workflowPane.className).toMatch(/\bflex\b/);
      expect(workflowPane.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      expect(assistantPane.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(workflowTab).not.toHaveTextContent('(updated)');
    });

    it('opens the test panel from Test workflow', async () => {
      await loadProposal();
      const testBtn = screen.getByRole('button', { name: /Test workflow/ });
      fireEvent.click(testBtn);
      expect(await screen.findByText('Dry run: nothing is sent or saved')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate sample data' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Close test panel' }));
      expect(screen.queryByText('Dry run: nothing is sent or saved')).not.toBeInTheDocument();
    });
  });
});
