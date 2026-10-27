import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { WorkflowNode } from '../components/workflow/nodes/WorkflowNode';
import { buildGraph, layoutSteps, validateWorking, withLayout } from '../components/workflow/builder/graph';
import { describeStep } from '../components/workflow/builder/stepMeta';
import { WorkflowConnectionSchema, WorkflowStepSchema } from '../types/workflow';

const step = (key: string, type: string, name: string, config: Record<string, unknown> = {}): WorkflowStepSchema => ({
  step_key: key,
  step_type: type,
  name,
  config,
  ui_position: { x: 0, y: 0 },
});

const steps = [
  step('start', 'WEBHOOK_TRIGGER', 'New lead'),
  step('check', 'CONDITION', 'Big company?', { field: 'payload.size', operator: 'gt', value: 100 }),
  step('approve', 'HUMAN_APPROVAL', 'Manager sign-off', { approver_role: 'MANAGER' }),
  step('notify', 'SLACK_NOTIFICATION', 'Tell sales', { channel: '#sales' }),
];
const connections: WorkflowConnectionSchema[] = [
  { source_step_key: 'start', target_step_key: 'check', condition_label: null },
  { source_step_key: 'check', target_step_key: 'approve', condition_label: 'true' },
  { source_step_key: 'check', target_step_key: 'notify', condition_label: 'false' },
];

describe('builder graph helpers', () => {
  it('lays steps out top to bottom with branches side by side and no overlap', () => {
    const pos = layoutSteps(steps, connections);
    expect(pos.start.y).toBeLessThan(pos.check.y);
    expect(pos.check.y).toBeLessThan(pos.approve.y);
    expect(pos.approve.y).toBe(pos.notify.y);
    expect(Math.abs(pos.approve.x - pos.notify.x)).toBeGreaterThanOrEqual(300); // nodes are ~272px wide
    expect(withLayout(steps, connections).map((s) => s.ui_position)).toEqual(steps.map((s) => pos[s.step_key]));
  });

  it('builds nodes and arrowed edges whose branch labels become source handles', () => {
    const { nodes, edges } = buildGraph(steps, connections, {
      selectedKey: 'check',
      catalog: { SLACK_NOTIFICATION: { step_type: 'SLACK_NOTIFICATION', label: 'Slack message', category: '', description: '', example_config: {}, edge_labels: [], is_trigger: false, is_mock: true } },
      errorKeys: new Set(['approve']),
    });
    expect(nodes.find((n) => n.data.step_key === 'check')?.selected).toBe(true);
    expect(nodes.find((n) => n.data.step_key === 'notify')?.data.testMode).toBe(true);
    expect(nodes.find((n) => n.data.step_key === 'approve')?.data.hasError).toBe(true);
    const branch = edges.find((e) => e.sourceHandle === 'true');
    expect(branch?.target).toBe('node-approve');
    expect(edges.every((e) => e.markerEnd)).toBe(true);
  });

  it('re-validates the working copy and attributes problems to the right step in plain language', () => {
    expect(validateWorking(steps, connections).valid).toBe(true);
    const broken = steps.map((s) => (s.step_key === 'notify' ? { ...s, config: {} } : s));
    const res = validateWorking(broken, connections);
    expect(res.valid).toBe(false);
    expect(res.errorsByKey.notify[0]).toMatch(/"Tell sales" requires/);
    expect(res.errors.join(' ')).not.toMatch(/SLACK_NOTIFICATION/);
    // a removed trigger is caught too
    expect(validateWorking(steps.slice(1), connections.slice(1)).errors.join(' ')).toMatch(/trigger/i);
  });

  it('describes steps from their real configuration', () => {
    expect(describeStep('SLACK_NOTIFICATION', { channel: '#sales' })).toBe('Posts to #sales');
    expect(describeStep('CONDITION', { field: 'payload.size', operator: 'gt', value: 100 })).toBe('If payload.size is greater than 100');
    expect(describeStep('HUMAN_APPROVAL', { approver_role: 'ADMIN' })).toBe('Needs admin approval');
    expect(describeStep('AI_CLASSIFICATION', { categories: ['ENTERPRISE', 'SMB'] })).toBe('Sorts into ENTERPRISE, SMB');
    expect(describeStep('SLACK_NOTIFICATION', {})).toBe('Sends a Slack message');
  });
});

describe('WorkflowNode', () => {
  const renderNode = (data: Record<string, unknown>, selected = false) =>
    render(
      <ReactFlowProvider>
        <WorkflowNode {...(({ data, selected }) as unknown as React.ComponentProps<typeof WorkflowNode>)} />
      </ReactFlowProvider>
    );

  it('shows title, plain description, type label and branch labels', () => {
    renderNode({ step_key: 'check', step_type: 'CONDITION', name: 'Big company?', config: { field: 'payload.size', operator: 'gt', value: 100 }, hideKey: true });
    expect(screen.getByText('Big company?')).toBeInTheDocument();
    expect(screen.getByText('If payload.size is greater than 100')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.queryByText(/key:/)).not.toBeInTheDocument();
  });

  it('labels AI and approval steps, flags test mode and problems with text, and falls back to the catalog name', () => {
    renderNode({ step_key: 'c', step_type: 'AI_CLASSIFICATION', name: '', catalogLabel: 'AI sorts the request', config: {}, testMode: true, hasError: true });
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('AI sorts the request')).toBeInTheDocument();
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('key: c')).toBeInTheDocument(); // the editor still shows keys
  });

  it('shows a selected ring', () => {
    renderNode({ step_key: 'n', step_type: 'SLACK_NOTIFICATION', name: 'Tell sales', config: { channel: '#sales' } }, true);
    expect(screen.getByTestId('workflow-node-n').className).toMatch(/ring-brand-500/);
  });
});
