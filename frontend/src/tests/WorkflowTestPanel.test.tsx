import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowTestPanel } from '../components/workflow/builder/WorkflowTestPanel';
import * as WorkflowServiceModule from '../services/workflowService';
import { AISimulateExecutionResponse } from '../types/workflowAI';

const steps = [
  { step_key: 'start', step_type: 'MANUAL_TRIGGER', name: 'Start', config: {}, ui_position: { x: 0, y: 0 } },
  { step_key: 'ok', step_type: 'HUMAN_APPROVAL', name: 'Manager approval', config: { approver_role: 'MANAGER' }, ui_position: { x: 0, y: 1 } },
];
const connections = [{ source_step_key: 'start', target_step_key: 'ok', condition_label: null }];

const renderPanel = (props: Partial<React.ComponentProps<typeof WorkflowTestPanel>> = {}) =>
  render(
    <WorkflowTestPanel organizationId="org-1" steps={steps} connections={connections} onClose={() => undefined} {...props} />
  );

describe('WorkflowTestPanel (dry run)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('always says nothing is sent or saved', () => {
    renderPanel();
    expect(screen.getByText('Dry run: nothing is sent or saved')).toBeInTheDocument();
  });

  it('generates sample data for the picked scenario, runs it and explains each step', async () => {
    const gen = vi.spyOn(WorkflowServiceModule, 'simulateProposalPayload').mockResolvedValue({
      scenario: 'edge_case', payload: { amount: 5 }, summary: 'A small order.', target_trigger: 'start',
    });
    const run = vi.spyOn(WorkflowServiceModule, 'simulateProposalRun').mockResolvedValue({
      overall_outcome: 'PENDING_APPROVAL',
      simulation_summary: 'Stopped at approval.',
      active_step_ids: ['start', 'ok'],
      latency_ms: 1,
      steps: [
        { step_id: 'start', step_name: 'start', step_type: 'MANUAL_TRIGGER', status: 'SUCCESS', simulated_output: {}, reasoning: 'Started with the sample.' },
        { step_id: 'ok', step_name: 'ok', step_type: 'HUMAN_APPROVAL', status: 'WAITING_APPROVAL', branch_taken: 'approved', simulated_output: { waiting: true }, reasoning: 'Needs a manager.' },
      ],
    });
    renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Edge case/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate sample data' }));
    await waitFor(() => expect(gen).toHaveBeenCalledWith('org-1', { steps, connections, scenario: 'edge_case' }));

    expect(await screen.findByLabelText(/Sample data/)).toHaveValue(JSON.stringify({ amount: 5 }, null, 2));
    expect(screen.getByText('A small order.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));

    await waitFor(() => expect(run).toHaveBeenCalledWith('org-1', { steps, connections, payload: { amount: 5 } }));
    expect(await screen.findByText('It would pause for a person to approve.')).toBeInTheDocument();
    expect(screen.getByText('Stopped at approval.')).toBeInTheDocument();
    expect(screen.getByText('Manager approval')).toBeInTheDocument(); // the step's own name, not its id
    expect(screen.getByText('Waits for a person')).toBeInTheDocument();
    expect(screen.getByText('Worked')).toBeInTheDocument();
    expect(screen.getByText('Needs a manager.')).toBeInTheDocument();
    expect(screen.getByText(/Took the "approved" path/)).toBeInTheDocument();
  });

  it('lets the user type their own sample data and run it', async () => {
    const run = vi.spyOn(WorkflowServiceModule, 'simulateProposalRun').mockResolvedValue({
      overall_outcome: 'COMPLETED', simulation_summary: 'All good.', active_step_ids: [], latency_ms: 1, steps: [],
    });
    renderPanel();
    expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled(); // nothing to run yet
    fireEvent.change(screen.getByLabelText(/Sample data/), { target: { value: '{"name":"Ana"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('org-1', { steps, connections, payload: { name: 'Ana' } }));
    expect(await screen.findByText('Everything would run through to the end.')).toBeInTheDocument();
  });

  it('shows loading states while generating and while running', async () => {
    let finishGen: (v: { scenario: string; payload: Record<string, unknown>; summary: string }) => void = () => undefined;
    vi.spyOn(WorkflowServiceModule, 'simulateProposalPayload').mockImplementation(
      () => new Promise((resolve) => { finishGen = resolve as typeof finishGen; })
    );
    let finishRun: (v: AISimulateExecutionResponse) => void = () => undefined;
    vi.spyOn(WorkflowServiceModule, 'simulateProposalRun').mockImplementation(
      () => new Promise((resolve) => { finishRun = resolve; })
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Generate sample data' }));
    const generating = await screen.findByRole('button', { name: 'Generating…' });
    expect(generating).toBeDisabled();
    finishGen({ scenario: 'happy_path', payload: { a: 1 }, summary: '' });

    fireEvent.click(await screen.findByRole('button', { name: 'Run test' }));
    expect(await screen.findByRole('button', { name: 'Testing…' })).toBeDisabled();
    finishRun({ overall_outcome: 'COMPLETED', simulation_summary: 'Done.', active_step_ids: [], latency_ms: 1, steps: [] });
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run test' })).toBeEnabled();
  });

  it('shows a parse error and blocks the run for invalid JSON', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Sample data/), { target: { value: '{ nope' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/not valid JSON/i);
    expect(screen.getByLabelText(/Sample data/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled();
  });

  it('shows a failed step with its error and a halted outcome', async () => {
    vi.spyOn(WorkflowServiceModule, 'simulateProposalRun').mockResolvedValue({
      overall_outcome: 'HALTED_ON_ERROR',
      simulation_summary: 'Stopped at the CRM step.',
      active_step_ids: ['start'],
      latency_ms: 1,
      steps: [
        { step_id: 'ok', step_name: 'ok', step_type: 'MOCK_CRM_CREATE', status: 'FAILED', simulated_output: { error: 'Email is missing' }, reasoning: 'The lead had no email.' },
      ],
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Sample data/), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));

    expect(await screen.findByText('It would hit an error and stop.')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('The lead had no email.')).toBeInTheDocument();
    expect(screen.getByText('Email is missing')).toBeInTheDocument();
  });

  it('marks results as out of date when the workflow changes after a run', async () => {
    vi.spyOn(WorkflowServiceModule, 'simulateProposalRun').mockResolvedValue({
      overall_outcome: 'COMPLETED', simulation_summary: 'Fine.', active_step_ids: [], latency_ms: 1, steps: [],
    });
    const { rerender } = renderPanel();
    fireEvent.change(screen.getByLabelText(/Sample data/), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    expect(await screen.findByText('Fine.')).toBeInTheDocument();
    expect(screen.queryByText(/has changed since this test/)).not.toBeInTheDocument();

    rerender(
      <WorkflowTestPanel
        organizationId="org-1"
        steps={[...steps, { step_key: 'x', step_type: 'MANUAL_TRIGGER', name: 'Extra', config: {}, ui_position: { x: 0, y: 2 } }]}
        connections={connections}
        onClose={() => undefined}
      />
    );
    expect(screen.getByText(/has changed since this test/)).toBeInTheDocument();
  });

  it('is disabled with an explanation for an invalid workflow, and shows the limit message on 429', async () => {
    const { unmount } = renderPanel({ disabled: true, disabledReason: 'Fix the 2 problems first.' });
    expect(screen.getByText('Fix the 2 problems first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate sample data' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Sample data/), { target: { value: '{}' } });
    expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled();
    unmount();

    vi.spyOn(WorkflowServiceModule, 'simulateProposalPayload').mockRejectedValue(
      new Error('Daily AI limit reached. Try again tomorrow.')
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Generate sample data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Daily AI limit reached');
  });

  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close test panel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
