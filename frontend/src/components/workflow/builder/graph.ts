import { Edge, MarkerType, Node } from '@xyflow/react';
import { WorkflowConnectionSchema, WorkflowStepSchema } from '../../../types/workflow';
import { connectionToEdge, stepToNode } from '../../../utils/workflowGraphMapper';
import {
  WorkflowEdgeData,
  WorkflowNodeData,
  validateWorkflowGraph,
} from '../../../utils/workflowGraphValidator';
import { AICatalogStep } from '../../../types/workflowAI';

/** Node cards are ~272px wide and ~100-130px tall, so give them room to breathe. */
const X_GAP = 310;
const Y_GAP = 135;

/** Lays steps out top-to-bottom by distance from the start, branches side by side. */
export function layoutSteps(
  steps: WorkflowStepSchema[],
  connections: WorkflowConnectionSchema[]
): Record<string, { x: number; y: number }> {
  const keys = steps.map((s) => s.step_key);
  const incoming = new Map<string, number>(keys.map((k) => [k, 0]));
  const out = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const c of connections) {
    if (!incoming.has(c.source_step_key) || !incoming.has(c.target_step_key)) continue;
    out.get(c.source_step_key)!.push(c.target_step_key);
    incoming.set(c.target_step_key, (incoming.get(c.target_step_key) || 0) + 1);
  }

  const level = new Map<string, number>();
  const queue = keys.filter((k) => (incoming.get(k) || 0) === 0);
  queue.forEach((k) => level.set(k, 0));
  const remaining = new Map(incoming);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of out.get(cur) || []) {
      level.set(next, Math.max(level.get(next) ?? 0, (level.get(cur) ?? 0) + 1));
      remaining.set(next, (remaining.get(next) || 1) - 1);
      if ((remaining.get(next) || 0) === 0) queue.push(next);
    }
  }

  const perLevel = new Map<number, string[]>();
  for (const k of keys) {
    const l = level.get(k) ?? 0;
    perLevel.set(l, [...(perLevel.get(l) || []), k]);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  perLevel.forEach((levelKeys, l) => {
    levelKeys.forEach((k, i) => {
      positions[k] = { x: (i - (levelKeys.length - 1) / 2) * X_GAP, y: l * Y_GAP };
    });
  });
  return positions;
}

/** Returns the same steps with a fresh, readable layout (AI-supplied positions are not meaningful). */
export function withLayout(
  steps: WorkflowStepSchema[],
  connections: WorkflowConnectionSchema[]
): WorkflowStepSchema[] {
  const positions = layoutSteps(steps, connections);
  return steps.map((s) => ({ ...s, ui_position: positions[s.step_key] ?? s.ui_position }));
}

export interface GraphDecorations {
  selectedKey?: string | null;
  catalog?: Record<string, AICatalogStep>;
  errorKeys?: Set<string>;
  isDark?: boolean;
}

export function nodeIdFor(stepKey: string): string {
  return `node-${stepKey}`;
}

/** React Flow nodes and edges for the working steps and connections. */
export function buildGraph(
  steps: WorkflowStepSchema[],
  connections: WorkflowConnectionSchema[],
  deco: GraphDecorations = {}
): { nodes: Node<WorkflowNodeData>[]; edges: Edge<WorkflowEdgeData>[] } {
  const edgeColor = deco.isDark ? '#64748B' : '#94A3B8';
  const nodes: Node<WorkflowNodeData>[] = steps.map((s, idx) => {
    const base = stepToNode(s, idx);
    const entry = deco.catalog?.[s.step_type];
    return {
      ...base,
      selected: deco.selectedKey === s.step_key,
      data: {
        ...base.data,
        hideKey: true,
        catalogLabel: entry?.label,
        testMode: Boolean(entry?.is_mock),
        hasError: deco.errorKeys?.has(s.step_key) ?? false,
      },
    };
  });
  const edges: Edge<WorkflowEdgeData>[] = connections.map((c, i) => {
    const e = connectionToEdge(c, i);
    return {
      ...e,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: edgeColor },
      style: { strokeWidth: 1.75, stroke: edgeColor },
      labelStyle: { fontSize: 12, fontWeight: 500, fill: deco.isDark ? '#CBD5E1' : '#475569' },
      labelBgStyle: { fill: deco.isDark ? '#0F172A' : '#FFFFFF', fillOpacity: 0.95 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    };
  });
  return { nodes, edges };
}

/** Pulls the step a client-validator message is about (`Step 'key' ...`), if any. */
export function stepKeyFromError(message: string, stepKeys: Set<string>): string | null {
  const m = message.match(/'([^']+)'/);
  return m && stepKeys.has(m[1]) ? m[1] : null;
}

/** Turns "Step 'check' (CONDITION) requires ..." into "\"Check lead size\" requires ..." for display. */
export function humanizeValidationError(message: string, stepNames: Record<string, string>): string {
  return message.replace(/Step '([^']+)'( \([A-Z_]+\))?/g, (_m, key: string) => `"${stepNames[key] || key}"`);
}

export interface WorkingValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  errorsByKey: Record<string, string[]>;
}

/** Client-side re-validation of the working copy using the editor's own validator. */
export function validateWorking(
  steps: WorkflowStepSchema[],
  connections: WorkflowConnectionSchema[]
): WorkingValidation {
  const { nodes, edges } = buildGraph(steps, connections);
  const res = validateWorkflowGraph(nodes, edges);
  const names: Record<string, string> = {};
  const keys = new Set<string>();
  steps.forEach((s) => {
    names[s.step_key] = s.name;
    keys.add(s.step_key);
  });
  const errorsByKey: Record<string, string[]> = {};
  const errors = res.errors.map((raw) => {
    const human = humanizeValidationError(raw, names);
    const key = stepKeyFromError(raw, keys);
    if (key) errorsByKey[key] = [...(errorsByKey[key] || []), human];
    return human;
  });
  const warnings = res.warnings.map((w) => humanizeValidationError(w, names));
  return { valid: res.valid, errors, warnings, errorsByKey };
}
