import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIRunSimulatorModal } from '../components/workflow/ai/AIRunSimulatorModal';
import * as WorkflowServiceModule from '../services/workflowService';

describe('AIRunSimulatorModal', () => {
  const mockOnClose = vi.fn();
  const mockOnExecuteLiveRun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <AIRunSimulatorModal
        isOpen={false}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        onExecuteLiveRun={mockOnExecuteLiveRun}
        isRunningLive={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal header, scenario presets, and JSON editor when open', () => {
    render(
      <AIRunSimulatorModal
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        workflowName="Enterprise Lead Qualification"
        currentNodes={[]}
        currentEdges={[]}
        onExecuteLiveRun={mockOnExecuteLiveRun}
        isRunningLive={false}
      />
    );

    expect(screen.getByText('AI Run Simulator & Test Dispatch')).toBeInTheDocument();
    expect(screen.getByText('Payload Studio')).toBeInTheDocument();
    expect(screen.getByText('Simulated Dry-Run')).toBeInTheDocument();
    expect(screen.getByText(/Happy Path/i)).toBeInTheDocument();
    expect(screen.getByText(/Edge Case/i)).toBeInTheDocument();
    expect(screen.getByText(/Negative Branch/i)).toBeInTheDocument();
    expect(screen.getByText('Execute Live Run')).toBeInTheDocument();
  });

  it('generates sample payload when a scenario preset is clicked', async () => {
    const mockPayloadResponse = {
      scenario: 'edge_case',
      summary: 'Boundary test with threshold lead score of 75',
      payload: { lead_score: 75, company: 'Edge Co', email: 'edge@test.com' },
      target_trigger: 'webhook_1',
    };

    vi.spyOn(WorkflowServiceModule, 'simulatePayloadWithAI').mockResolvedValueOnce(
      mockPayloadResponse
    );

    render(
      <AIRunSimulatorModal
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        workflowName="Enterprise Lead Qualification"
        currentNodes={[]}
        currentEdges={[]}
        onExecuteLiveRun={mockOnExecuteLiveRun}
        isRunningLive={false}
      />
    );

    const edgeCaseButton = screen.getByText(/Edge Case/i);
    fireEvent.click(edgeCaseButton);

    await waitFor(() => {
      expect(WorkflowServiceModule.simulatePayloadWithAI).toHaveBeenCalledWith(
        'org-1',
        'wf-1',
        expect.objectContaining({ scenario: 'edge_case' })
      );
      expect(
        screen.getByText(/Boundary test with threshold lead score of 75/i)
      ).toBeInTheDocument();
    });
  });

  it('executes dry-run simulation and renders step-by-step traversal results', async () => {
    const mockSimResponse = {
      overall_outcome: 'COMPLETED' as const,
      simulation_summary: 'All steps executed cleanly along the qualified path.',
      active_step_ids: ['step_webhook', 'step_cond'],
      steps: [
        {
          step_id: 'step_webhook',
          step_name: 'Inbound Webhook Trigger',
          step_type: 'WEBHOOK_TRIGGER',
          status: 'SUCCESS' as const,
          simulated_output: { received: true },
          reasoning: 'Trigger received the mock payload successfully.',
        },
        {
          step_id: 'step_cond',
          step_name: 'Lead Score Rule',
          step_type: 'CONDITION',
          status: 'SUCCESS' as const,
          branch_taken: 'true',
          simulated_output: { evaluation: true },
          reasoning: 'Evaluated lead_score 85 >= 75 as TRUE.',
        },
      ],
      latency_ms: 12,
    };

    vi.spyOn(WorkflowServiceModule, 'simulateWorkflowRunWithAI').mockResolvedValueOnce(
      mockSimResponse
    );

    render(
      <AIRunSimulatorModal
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        workflowName="Enterprise Lead Qualification"
        currentNodes={[]}
        currentEdges={[]}
        onExecuteLiveRun={mockOnExecuteLiveRun}
        isRunningLive={false}
      />
    );

    const simulateButton = screen.getByRole('button', { name: /Simulate Dry-Run/i });
    fireEvent.click(simulateButton);

    await waitFor(() => {
      expect(WorkflowServiceModule.simulateWorkflowRunWithAI).toHaveBeenCalled();
      expect(screen.getByText(/OUTCOME: COMPLETED/i)).toBeInTheDocument();
      expect(screen.getByText('Inbound Webhook Trigger')).toBeInTheDocument();
      expect(screen.getByText('Lead Score Rule')).toBeInTheDocument();
      expect(screen.getByText(/Branch: true/i)).toBeInTheDocument();
    });
  });

  it('dispatches live execution with valid parsed payload', () => {
    render(
      <AIRunSimulatorModal
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        workflowName="Enterprise Lead Qualification"
        currentNodes={[]}
        currentEdges={[]}
        onExecuteLiveRun={mockOnExecuteLiveRun}
        isRunningLive={false}
      />
    );

    const executeButton = screen.getByRole('button', { name: /Execute Live Run/i });
    fireEvent.click(executeButton);

    expect(mockOnExecuteLiveRun).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'control_plane_test' })
    );
  });
});
