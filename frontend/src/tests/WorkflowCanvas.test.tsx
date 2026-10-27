import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { WorkflowCanvas } from '../components/workflow/builder/WorkflowCanvas';
import { WorkflowConnectionSchema, WorkflowStepSchema } from '../types/workflow';

const steps: WorkflowStepSchema[] = [
  { step_key: 'start', step_type: 'WEBHOOK_TRIGGER', name: 'New lead', config: {}, ui_position: { x: 0, y: 0 } },
  { step_key: 'notify', step_type: 'SLACK_NOTIFICATION', name: 'Tell sales', config: { channel: '#sales' }, ui_position: { x: 0, y: 190 } },
];
const connections: WorkflowConnectionSchema[] = [{ source_step_key: 'start', target_step_key: 'notify', condition_label: null }];

const handlers = () => ({
  onSelect: vi.fn(),
  onMoveNode: vi.fn(),
  onConnect: vi.fn(),
  onDeleteSteps: vi.fn(),
  onDeleteConnections: vi.fn(),
});

describe('WorkflowCanvas', () => {
  beforeAll(() => {
    // jsdom has no layout engine; React Flow only needs these to mount.
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    // @ts-expect-error minimal DOMMatrixReadOnly stand-in for jsdom
    window.DOMMatrixReadOnly = class { m22 = 1; constructor() {} };
  });

  it('renders the steps as nodes with real zoom and fit controls', () => {
    render(<WorkflowCanvas steps={steps} connections={connections} selectedKey={null} {...handlers()} />);
    expect(screen.getByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument();
    expect(screen.getByText('New lead')).toBeInTheDocument();
    expect(screen.getByText('Posts to #sales')).toBeInTheDocument();
    for (const name of ['Zoom in', 'Zoom out', 'Fit view']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  });

  it('reports a node click as a selection', () => {
    const h = handlers();
    render(<WorkflowCanvas steps={steps} connections={connections} selectedKey={null} {...h} />);
    fireEvent.click(screen.getByText('Tell sales'));
    expect(h.onSelect).toHaveBeenCalledWith('notify');
  });

  it('shows a useful empty state and a skeleton while the assistant works', () => {
    const { rerender } = render(<WorkflowCanvas steps={[]} connections={[]} selectedKey={null} {...handlers()} />);
    expect(screen.getByText('Your workflow will appear here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit view' })).toBeDisabled();
    rerender(<WorkflowCanvas steps={[]} connections={[]} selectedKey={null} isLoading {...handlers()} />);
    expect(screen.getByText('Designing your workflow…')).toBeInTheDocument();
    expect(screen.queryByText('Your workflow will appear here')).not.toBeInTheDocument();
  });
});
