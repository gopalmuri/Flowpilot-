import React, { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Edge,
  Node,
  NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { WorkflowNode } from '../nodes/WorkflowNode';
import { EDGE_STYLE, connectionToEdge, stepToNode } from '../../../utils/workflowGraphMapper';
import { WorkflowEdgeData, WorkflowNodeData } from '../../../utils/workflowGraphValidator';
import { WorkflowConnectionSchema, WorkflowStepSchema } from '../../../types/workflow';
import { useTheme } from '../../../context/ThemeContext';

const nodeTypes: NodeTypes = { workflowNode: WorkflowNode as unknown as NodeTypes[string] };

const X_GAP = 280;
const Y_GAP = 150;

/** Lays steps out top-to-bottom by distance from the start, so the preview always reads clearly. */
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

interface ProposalPreviewProps {
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
  className?: string;
}

const PreviewCanvas: React.FC<ProposalPreviewProps> = ({ steps, connections, className }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const { nodes, edges, signature } = useMemo(() => {
    const positions = layoutSteps(steps, connections);
    const builtNodes: Node<WorkflowNodeData>[] = steps.map((s, idx) => {
      const n = stepToNode({ ...s, ui_position: positions[s.step_key] }, idx);
      return { ...n, draggable: false, selectable: false, data: { ...n.data, hideKey: true } };
    });
    const builtEdges: Edge<WorkflowEdgeData>[] = connections.map(connectionToEdge);
    return {
      nodes: builtNodes,
      edges: builtEdges,
      signature: `${steps.map((s) => s.step_key).join('|')}#${connections.length}`,
    };
  }, [steps, connections]);

  return (
    <div
      className={className ?? 'h-72 sm:h-96'}
      role="img"
      aria-label={`Preview of your workflow with ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
      data-testid="proposal-preview"
    >
      <ReactFlow
        key={signature}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 0.9 }}
        colorMode={isDark ? 'dark' : 'light'}
        defaultEdgeOptions={{ ...EDGE_STYLE }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={isDark ? '#2A332E' : '#DDD9D0'} gap={16} size={1} style={{ backgroundColor: isDark ? '#101513' : '#F5F3EE' }} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

/** Read-only, auto-fitting picture of a proposed workflow. */
export const ProposalPreview: React.FC<ProposalPreviewProps> = (props) => (
  <ReactFlowProvider>
    <PreviewCanvas {...props} />
  </ReactFlowProvider>
);
