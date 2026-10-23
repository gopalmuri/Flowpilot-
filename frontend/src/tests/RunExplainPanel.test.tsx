import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RunExplainPanel } from '../components/executions/RunExplainPanel';
import { ExecutionTimelineDrawer } from '../components/executions/ExecutionTimelineDrawer';
import * as AuthContextModule from '../context/AuthContext';
import * as WorkflowServiceModule from '../services/workflowService';
import { AIRunExplainResponse } from '../types/workflowAI';
import { WorkflowRunDetail } from '../types/execution';

const explainResponse: AIRunExplainResponse = {
  run_id: 'run-1',
  run_status: 'FAILED',
  explanation: 'The approval step waited too long and timed out.',
  next_steps: ['Give approvers more time', 'Pick a backup approver'],
  failed_steps: [{ step_key: 'approve_1', name: 'Manager approval', step_type: 'HUMAN_APPROVAL', error: 'Timed out after 24 hours' }],
  suggested_fix: {
    steps: [
      { step_key: 'approve_1', step_type: 'HUMAN_APPROVAL', name: 'Manager approval', config: { timeout_hours: 72 }, ui_position: { x: 0, y: 0 } },
    ],
    connections: [],
    diff_summary: { added_steps: [], removed_steps: [], modified_steps: ['approve_1'], reconnected_edges: [] },
    valid: true,
    errors: [],
    warnings: [],
  },
  base_version_id: 'ver-9',
  used_ai: true,
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <RunExplainPanel organizationId="org-1" workflowId="wf-1" runId="run-1" />
    </MemoryRouter>
  );
}

describe('RunExplainPanel (explain and fix)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('explains the failure in plain language and shows the suggested fix', async () => {
    const explain = vi.spyOn(WorkflowServiceModule, 'explainRunWithAI').mockResolvedValue(explainResponse);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Explain & fix with AI/i }));

    expect(await screen.findByText(/waited too long and timed out/i)).toBeInTheDocument();
    expect(explain).toHaveBeenCalledWith('org-1', 'wf-1', 'run-1');
    expect(screen.getByText('Give approvers more time')).toBeInTheDocument();
    expect(screen.getByText('Timed out after 24 hours')).toBeInTheDocument();
    expect(screen.getByText('Will be changed')).toBeInTheDocument();
  });

  it('applies the fix as a new draft cloned from the base version', async () => {
    vi.spyOn(WorkflowServiceModule, 'explainRunWithAI').mockResolvedValue(explainResponse);
    const apply = vi.spyOn(WorkflowServiceModule, 'applyProposalAsNewDraft').mockResolvedValue({} as never);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Explain & fix with AI/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Apply as new draft/i }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith('org-1', 'wf-1', 'ver-9', explainResponse.suggested_fix));
    expect(await screen.findByText('Saved as a new draft')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in editor/i })).toHaveAttribute('href', '/workflows/wf-1');
  });

  it('does not offer an invalid fix', async () => {
    vi.spyOn(WorkflowServiceModule, 'explainRunWithAI').mockResolvedValue({
      ...explainResponse,
      suggested_fix: { ...explainResponse.suggested_fix!, valid: false, errors: ['Missing approver.'] },
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Explain & fix with AI/i }));
    expect(await screen.findByRole('button', { name: /Apply as new draft/i })).toBeDisabled();
  });

  it('shows a readable error when the explanation cannot be loaded', async () => {
    vi.spyOn(WorkflowServiceModule, 'explainRunWithAI').mockRejectedValue(new Error('Daily AI limit reached.'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Explain & fix with AI/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Daily AI limit reached.');
  });
});

describe('ExecutionTimelineDrawer explain button', () => {
  const baseRun = {
    id: 'run-1',
    organization_id: 'org-1',
    workflow_id: 'wf-1',
    workflow_version_id: 'ver-9',
    workflow_name: 'Invoice approvals',
    trigger_type: 'MANUAL',
    trigger_payload: {},
    correlation_id: 'corr-1',
    started_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    step_runs: [],
    approvals: [],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      activeOrganization: { id: 'org-1', name: 'Acme' },
      activeRole: 'ADMIN',
    } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
  });

  it('is shown for a failed run', () => {
    render(
      <MemoryRouter>
        <ExecutionTimelineDrawer run={{ ...baseRun, status: 'FAILED' } as WorkflowRunDetail} isOpen onClose={() => undefined} />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /Explain & fix with AI/i })).toBeInTheDocument();
  });

  it('is not shown for a completed run', () => {
    render(
      <MemoryRouter>
        <ExecutionTimelineDrawer run={{ ...baseRun, status: 'COMPLETED' } as WorkflowRunDetail} isOpen onClose={() => undefined} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /Explain & fix with AI/i })).not.toBeInTheDocument();
  });
});
