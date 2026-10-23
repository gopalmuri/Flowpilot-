import { describe, it, expect } from 'vitest';
import {
  branchHandlesFor,
  connectionToEdge,
  serializeGraph,
  stepToNode,
} from '../utils/workflowGraphMapper';

// Shapes copied from a live GET .../versions/{id} response of the seeded pipeline.
const steps = [
  { id: 'uuid-hook', step_key: 'webhook_inbound', step_type: 'WEBHOOK_TRIGGER', name: 'Inbound Webhook', config: {}, ui_position: { x: 60, y: 180 } },
  { id: 'uuid-cond', step_key: 'eval_enterprise', step_type: 'CONDITION', name: 'Is Enterprise Lead?', config: { field: 'x' }, ui_position: { x: 620, y: 180 } },
  { id: 'uuid-appr', step_key: 'manager_approval', step_type: 'HUMAN_APPROVAL', name: 'VP Approval Gate', config: {}, ui_position: { x: 900, y: 180 } },
  { id: 'uuid-crm', step_key: 'crm_lead', step_type: 'MOCK_CRM_CREATE', name: 'Create CRM Lead', config: {}, ui_position: { x: 1180, y: 180 } },
  { id: 'uuid-rej', step_key: 'slack_rejected', step_type: 'SLACK_NOTIFICATION', name: 'Notify Rejection', config: {}, ui_position: { x: 1180, y: 380 } },
];
const connections = [
  { id: 'c1', source_step_id: 'uuid-hook', target_step_id: 'uuid-cond', source_step_key: 'webhook_inbound', target_step_key: 'eval_enterprise', condition_label: null },
  { id: 'c2', source_step_id: 'uuid-cond', target_step_id: 'uuid-appr', source_step_key: 'eval_enterprise', target_step_key: 'manager_approval', condition_label: 'true' },
  { id: 'c3', source_step_id: 'uuid-appr', target_step_id: 'uuid-crm', source_step_key: 'manager_approval', target_step_key: 'crm_lead', condition_label: 'approved' },
  { id: 'c4', source_step_id: 'uuid-appr', target_step_id: 'uuid-rej', source_step_key: 'manager_approval', target_step_key: 'slack_rejected', condition_label: 'rejected' },
];

describe('workflow graph mapper', () => {
  it('exposes branch handles for condition and approval nodes only', () => {
    expect(branchHandlesFor('CONDITION')).toEqual(['true', 'false']);
    expect(branchHandlesFor('HUMAN_APPROVAL')).toEqual(['approved', 'rejected']);
    expect(branchHandlesFor('SLACK_NOTIFICATION')).toEqual([]);
  });

  it('turns steps into nodes using ui_position', () => {
    const node = stepToNode(steps[0], 0);
    expect(node.id).toBe('uuid-hook');
    expect(node.position).toEqual({ x: 60, y: 180 });
    expect(node.data.step_key).toBe('webhook_inbound');
  });

  it('never produces an "undefined" source handle for plain connections', () => {
    const edge = connectionToEdge(connections[0], 0);
    expect(edge.sourceHandle).toBeUndefined();
    expect(edge.source).toBe('uuid-hook');
    expect(edge.target).toBe('uuid-cond');
  });

  it('uses condition_label as the source handle and edge label for branches', () => {
    const edge = connectionToEdge(connections[3], 3);
    expect(edge.sourceHandle).toBe('rejected');
    expect(edge.label).toBe('rejected');
  });

  it('round-trips a loaded graph without losing labels, keys or positions', () => {
    const nodes = steps.map(stepToNode);
    const edges = connections.map(connectionToEdge);
    const out = serializeGraph(nodes, edges);

    expect(out.steps.map((s) => s.step_key)).toEqual(steps.map((s) => s.step_key));
    expect(out.steps[1].ui_position).toEqual({ x: 620, y: 180 });
    expect(out.connections).toEqual([
      { source_step_key: 'webhook_inbound', target_step_key: 'eval_enterprise', condition_label: null },
      { source_step_key: 'eval_enterprise', target_step_key: 'manager_approval', condition_label: 'true' },
      { source_step_key: 'manager_approval', target_step_key: 'crm_lead', condition_label: 'approved' },
      { source_step_key: 'manager_approval', target_step_key: 'slack_rejected', condition_label: 'rejected' },
    ]);
  });

  it('sends step keys, never node ids, and skips edges to missing nodes', () => {
    const nodes = steps.slice(0, 2).map(stepToNode);
    const edges = [connectionToEdge(connections[0], 0), connectionToEdge(connections[2], 2)];
    const out = serializeGraph(nodes, edges);
    expect(out.connections).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain('uuid-');
  });
});
