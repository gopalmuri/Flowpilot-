import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AIBuilderPage } from '../pages/workflows/AIBuilderPage';
import * as AuthContextModule from '../context/AuthContext';
import * as WorkflowServiceModule from '../services/workflowService';
import { AIWorkflowAssistResponse, AIWorkflowProposal } from '../types/workflowAI';

// React Flow needs real layout; the preview is covered by its own graph tests.
vi.mock('../components/workflow/ai/ProposalPreview', () => ({
  ProposalPreview: ({ steps }: { steps: unknown[] }) => <div data-testid="preview-stub">{steps.length} steps</div>,
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

function renderPage(initialPrompt = 'Tell sales about new leads') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/workflows/new/ai', state: { prompt: initialPrompt } }]}>
      <Routes>
        <Route path="/workflows/new/ai" element={<AIBuilderPage />} />
        <Route path="/workflows/:id" element={<div>Editor opened</div>} />
      </Routes>
    </MemoryRouter>
  );
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

  it('renders the summary, steps and setup checklist for a proposal', async () => {
    vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockResolvedValue(
      response({
        proposal: validProposal,
        summary: 'Whenever an email arrives, the sales team is told on Slack.',
        suggested_name: 'Lead alerts',
        setup_needed: [
          { id: 's1', kind: 'integration', title: 'Connect Gmail', detail: 'Needed to read your inbox.', action: 'connect_gmail', blocking: true },
          { id: 's2', kind: 'config', title: 'Pick a Slack channel', detail: 'Choose where alerts go.', step_key: 'notify', action: 'edit_step', blocking: false },
        ],
        unsupported: ['Waiting for a few days'],
      })
    );

    renderPage();

    expect(await screen.findByText(/the sales team is told on Slack/i)).toBeInTheDocument();
    expect(screen.getByTestId('preview-stub')).toHaveTextContent('2 steps');
    expect(screen.getByText('Setup needed')).toBeInTheDocument();
    expect(screen.getAllByText('Connect Gmail').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect Gmail/i })).toHaveAttribute('href', '/integrations');
    expect(screen.getByText(/done|fill this in on the step itself/i)).toBeInTheDocument();
    expect(screen.getByText('Waiting for a few days')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow name')).toHaveValue('Lead alerts');
    // No technical jargon in the visible copy.
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
  });

  it('creates the draft and opens the editor', async () => {
    vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockResolvedValue(
      response({ proposal: validProposal, summary: 'Alerts the team.', suggested_name: 'Lead alerts' })
    );
    const create = vi.spyOn(WorkflowServiceModule, 'createDraftFromAIProposal').mockResolvedValue({
      workflow_id: 'wf-new',
      version_id: 'v-1',
      name: 'Lead alerts',
      status: 'DRAFT',
      valid: true,
      warnings: [],
    });

    renderPage();
    const createBtn = await screen.findByRole('button', { name: /Create draft/i });
    await waitFor(() => expect(createBtn).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Workflow name'), { target: { value: 'Lead alerts v2' } });
    fireEvent.click(createBtn);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith('org-1', {
      name: 'Lead alerts v2',
      description: 'Alerts the team.',
      steps: validProposal.steps,
      connections: validProposal.connections,
    });
    expect(await screen.findByText('Editor opened')).toBeInTheDocument();
  });

  it('shows the friendly daily-limit message when the AI limit is reached', async () => {
    vi.spyOn(WorkflowServiceModule, 'buildWorkflowWithAI').mockRejectedValue(
      new Error('Your team has used all of its AI requests for today. It resets tomorrow.')
    );

    renderPage();

    expect(await screen.findByText(/used all of its AI requests for today/i)).toBeInTheDocument();
    expect(screen.getByText('Daily AI limit reached')).toBeInTheDocument();
  });
});
