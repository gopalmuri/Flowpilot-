import { Edge, MarkerType, Node } from '@xyflow/react';
import { WorkflowEdgeData, WorkflowNodeData } from './workflowGraphValidator';

/**
 * Translation layer between the backend workflow DAG (steps + connections) and
 * React Flow nodes/edges. The backend identifies branches with `condition_label`,
 * so a branch label doubles as the id of the source handle it leaves from.
 */

const BRANCH_HANDLES: Record<string, string[]> = {
  CONDITION: ['true', 'false'],
  HUMAN_APPROVAL: ['approved', 'rejected'],
};

export function branchHandlesFor(stepType: string): string[] {
  return BRANCH_HANDLES[stepType] ?? [];
}

export const EDGE_STYLE = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#69716C' },
  style: { strokeWidth: 1.5, stroke: '#69716C' },
} as const;

export function stepToNode(step: any, idx: number): Node<WorkflowNodeData> {
  return {
    id: step.id || `node-${step.step_key}`,
    type: 'workflowNode',
    position: step.ui_position || step.position || { x: 250, y: 100 + idx * 140 },
    data: {
      step_key: step.step_key,
      name: step.name,
      step_type: step.step_type,
      config: step.config || {},
      error_policy: step.error_policy || { max_retries: 3, retry_delay_ms: 1000 },
      timeout_seconds: step.timeout_seconds || 60,
    },
  };
}

export function connectionToEdge(conn: any, idx: number): Edge<WorkflowEdgeData> {
  const source = conn.source_step_id || `node-${conn.source_step_key}`;
  const target = conn.target_step_id || `node-${conn.target_step_key}`;
  const label: string | undefined = conn.condition_label || undefined;
  return {
    id: conn.id || `edge-${source}-${target}-${idx}`,
    source,
    target,
    sourceHandle: label,
    label,
    data: { condition_label: conn.condition_label ?? null },
    ...EDGE_STYLE,
  };
}

export interface SerializedStep {
  step_key: string;
  step_type: string;
  name: string;
  config: Record<string, any>;
  ui_position: { x: number; y: number };
}

export interface SerializedConnection {
  source_step_key: string;
  target_step_key: string;
  condition_label: string | null;
}

/** Builds the payload for PUT /versions/{id}. Uses step keys, never React Flow node ids. */
export function serializeGraph(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge<WorkflowEdgeData>[]
): { steps: SerializedStep[]; connections: SerializedConnection[] } {
  const keyById = new Map(nodes.map((n) => [n.id, n.data.step_key as string]));

  const steps = nodes.map((n) => ({
    step_key: n.data.step_key as string,
    step_type: n.data.step_type as string,
    name: n.data.name as string,
    config: n.data.config,
    ui_position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
  }));

  const connections: SerializedConnection[] = [];
  for (const e of edges) {
    const source = keyById.get(e.source);
    const target = keyById.get(e.target);
    if (!source || !target) continue;
    const label = e.sourceHandle || (typeof e.label === 'string' ? e.label : null) || null;
    connections.push({ source_step_key: source, target_step_key: target, condition_label: label });
  }
  return { steps, connections };
}
