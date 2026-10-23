import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIWorkflowAssistantDrawer } from '../components/workflow/ai/AIWorkflowAssistantDrawer';
import * as WorkflowServiceModule from '../services/workflowService';
import { AIWorkflowProposal } from '../types/workflowAI';

describe('AIWorkflowAssistantDrawer', () => {
  const mockOnClose = vi.fn();
  const mockOnPreview = vi.fn();
  const mockOnDiscardPreview = vi.fn();
  const mockOnApplyProposal = vi.fn();
  const mockOnUndo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <AIWorkflowAssistantDrawer
        isOpen={false}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        isPreviewing={false}
        onPreview={mockOnPreview}
        onDiscardPreview={mockOnDiscardPreview}
        onApplyProposal={mockOnApplyProposal}
        canUndo={false}
        onUndo={mockOnUndo}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders header, Grok AI badge, and welcome message when open', () => {
    render(
      <AIWorkflowAssistantDrawer
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        workflowName="Lead Pipeline"
        currentNodes={[]}
        currentEdges={[]}
        isPreviewing={false}
        onPreview={mockOnPreview}
        onDiscardPreview={mockOnDiscardPreview}
        onApplyProposal={mockOnApplyProposal}
        canUndo={false}
        onUndo={mockOnUndo}
      />
    );

    expect(screen.getByText('AI Workflow Assistant')).toBeInTheDocument();
    expect(screen.getByText('Grok AI')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/E.g. If lead is high value/i)
    ).toBeInTheDocument();
  });

  it('submits a prompt and displays proposed DAG with diff summary and action buttons', async () => {
    const mockProposal: AIWorkflowProposal = {
      steps: [
        {
          step_key: 'webhook_1',
          step_type: 'WEBHOOK_TRIGGER',
          name: 'Inbound Hook',
          config: {},
          ui_position: { x: 200, y: 100 },
        },
        {
          step_key: 'approval_1',
          step_type: 'HUMAN_APPROVAL',
          name: 'Manager Sign-off',
          config: { approver_role: 'MANAGER' },
          ui_position: { x: 200, y: 240 },
        },
      ],
      connections: [
        {
          source_step_key: 'webhook_1',
          target_step_key: 'approval_1',
          condition_label: null,
        },
      ],
      diff_summary: {
        added_steps: ['Inbound Hook (webhook_1)', 'Manager Sign-off (approval_1)'],
        removed_steps: [],
        modified_steps: [],
        reconnected_edges: ['webhook_1 → approval_1'],
      },
      valid: true,
      errors: [],
      warnings: [],
    };

    vi.spyOn(WorkflowServiceModule, 'assistWorkflowWithAI').mockResolvedValueOnce({
      mode: 'proposal',
      message: 'Here is your lead workflow proposal with human approval gate.',
      proposal: mockProposal,
      clarification_questions: [],
      template_suggestions: [],
      tokens_used: 120,
      latency_ms: 300,
      provider: 'grok',
      model: 'grok-1',
    });

    render(
      <AIWorkflowAssistantDrawer
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        isPreviewing={false}
        onPreview={mockOnPreview}
        onDiscardPreview={mockOnDiscardPreview}
        onApplyProposal={mockOnApplyProposal}
        canUndo={false}
        onUndo={mockOnUndo}
      />
    );

    const textarea = screen.getByPlaceholderText(/E.g. If lead is high value/i);
    fireEvent.change(textarea, { target: { value: 'Build lead triage workflow' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/Here is your lead workflow proposal/i)).toBeInTheDocument();
      expect(screen.getByText('Proposed Workflow DAG')).toBeInTheDocument();
      expect(screen.getByText('Valid DAG')).toBeInTheDocument();
      expect(screen.getByText('Preview on Canvas')).toBeInTheDocument();
      expect(screen.getByText('Apply Changes')).toBeInTheDocument();
    });

    // Test Preview button
    fireEvent.click(screen.getByText('Preview on Canvas'));
    expect(mockOnPreview).toHaveBeenCalledWith(mockProposal);

    // Test Apply button
    fireEvent.click(screen.getByText('Apply Changes'));
    expect(mockOnApplyProposal).toHaveBeenCalledWith(mockProposal);
  });

  it('renders clarification questions with clickable option chips', async () => {
    vi.spyOn(WorkflowServiceModule, 'assistWorkflowWithAI').mockResolvedValueOnce({
      mode: 'clarification',
      message: 'I need a few details to configure notifications accurately.',
      proposal: null,
      clarification_questions: [
        {
          id: 'q_channel',
          question: 'Which Slack channel should alerts be dispatched to?',
          options: ['#sales-alerts', '#executive-ops', '#general'],
        },
      ],
      template_suggestions: [],
      tokens_used: 80,
      latency_ms: 250,
      provider: 'grok',
      model: 'grok-1',
    });

    render(
      <AIWorkflowAssistantDrawer
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        isPreviewing={false}
        onPreview={mockOnPreview}
        onDiscardPreview={mockOnDiscardPreview}
        onApplyProposal={mockOnApplyProposal}
        canUndo={false}
        onUndo={mockOnUndo}
      />
    );

    const textarea = screen.getByPlaceholderText(/E.g. If lead is high value/i);
    fireEvent.change(textarea, { target: { value: 'Send notifications' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Clarification Needed:')).toBeInTheDocument();
      expect(screen.getByText(/Which Slack channel/i)).toBeInTheDocument();
      expect(screen.getByText('#sales-alerts')).toBeInTheDocument();
      expect(screen.getByText('#executive-ops')).toBeInTheDocument();
    });
  });

  it('renders undo button and calls onUndo when canUndo is true', () => {
    render(
      <AIWorkflowAssistantDrawer
        isOpen={true}
        onClose={mockOnClose}
        organizationId="org-1"
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        isPreviewing={false}
        onPreview={mockOnPreview}
        onDiscardPreview={mockOnDiscardPreview}
        onApplyProposal={mockOnApplyProposal}
        canUndo={true}
        onUndo={mockOnUndo}
      />
    );

    const undoBtn = screen.getByTitle('Undo last applied AI changes');
    expect(undoBtn).toBeInTheDocument();
    fireEvent.click(undoBtn);
    expect(mockOnUndo).toHaveBeenCalled();
  });
});
