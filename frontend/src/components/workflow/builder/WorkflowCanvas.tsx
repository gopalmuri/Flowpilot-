import React, { CSSProperties, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Node,
  NodeTypes,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize, Minus, Plus, ScanSearch, Workflow as WorkflowIcon } from 'lucide-react';
import { WorkflowNode } from '../nodes/WorkflowNode';
import { WorkflowConnectionSchema, WorkflowStepSchema } from '../../../types/workflow';
import { AICatalogStep } from '../../../types/workflowAI';
import { WorkflowNodeData } from '../../../utils/workflowGraphValidator';
import { useTheme } from '../../../context/ThemeContext';
import { buildGraph } from './graph';
import { iconBtn } from './styles';

const nodeTypes: NodeTypes = { workflowNode: WorkflowNode as unknown as NodeTypes[string] };

const keyOf = (nodeId: string) => (nodeId.startsWith('node-') ? nodeId.slice('node-'.length) : nodeId);

export interface WorkflowCanvasProps {
  steps: WorkflowStepSchema[];
  connections: WorkflowConnectionSchema[];
  selectedKey: string | null;
  onSelect: (stepKey: string | null) => void;
  onMoveNode: (stepKey: string, position: { x: number; y: number }) => void;
  onConnect: (connection: WorkflowConnectionSchema) => void;
  onDeleteSteps: (stepKeys: string[]) => void;
  onDeleteConnections: (connections: WorkflowConnectionSchema[]) => void;
  catalog?: Record<string, AICatalogStep>;
  errorKeys?: Set<string>;
  readOnly?: boolean;
  /** True while the assistant is building or changing the workflow. */
  isLoading?: boolean;
  /** Bump to re-frame the view (for example when a hidden tab becomes visible). */
  fitSignal?: number;
}

const SkeletonCanvas: React.FC = () => (
  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-warm-50/80 dark:bg-charcoal-950/80" aria-hidden="true">
    <p className="text-sm font-medium text-warm-700 dark:text-charcoal-200">Designing your workflow…</p>
    <div className="flex flex-col items-center gap-6 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex w-[272px] items-start gap-3 rounded-xl border border-warm-300 bg-white p-3.5 dark:border-charcoal-750 dark:bg-charcoal-900">
          <div className="h-10 w-10 rounded-lg bg-warm-200 dark:bg-charcoal-800" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-16 rounded bg-warm-200 dark:bg-charcoal-800" />
            <div className="h-3.5 w-40 rounded bg-warm-200 dark:bg-charcoal-800" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const Inner: React.FC<WorkflowCanvasProps> = ({
  steps,
  connections,
  selectedKey,
  onSelect,
  onMoveNode,
  onConnect,
  onDeleteSteps,
  onDeleteConnections,
  catalog,
  errorKeys,
  readOnly = false,
  isLoading = false,
  fitSignal = 0,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const graph = useMemo(
    () => buildGraph(steps, connections, { selectedKey, catalog, errorKeys, isDark }),
    [steps, connections, selectedKey, catalog, errorKeys, isDark]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>(graph.nodes);

  // Re-sync from the working copy, keeping React Flow's measured sizes so nodes do not flash hidden.
  useEffect(() => {
    setNodes((prev) =>
      graph.nodes.map((n) => {
        const old = prev.find((p) => p.id === n.id);
        return old?.measured ? { ...n, measured: old.measured } : n;
      })
    );
  }, [graph.nodes, setNodes]);

  /** A readable default: 65-100% zoom, anchored to the trigger when the flow is taller than the panel. */
  const showReadable = useCallback(() => {
    const el = wrapRef.current;
    const list = rf.getNodes();
    if (!el || list.length === 0) return;
    const b = rf.getNodesBounds(list);
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h || !b.width || !b.height) {
      void rf.fitView({ padding: 0.1, maxZoom: 1 });
      return;
    }
    const pad = 40;
    const fit = Math.min((w - pad * 2) / b.width, (h - pad * 2) / b.height);
    // Keep text legible (65% floor), but on phone-width canvases let the whole flow fit: side-by-side branches were
    // being cut off at the screen edges.
    const floor = w < 520 ? 0.5 : 0.65;
    const z = Math.min(1, Math.max(floor, fit));
    const x = w / 2 - (b.x + b.width / 2) * z;
    const y = z >= fit ? h / 2 - (b.y + b.height / 2) * z : pad - b.y * z;
    void rf.setViewport({ x, y, zoom: z }, { duration: 200 });
  }, [rf]);

  const keysSig = steps.map((s) => s.step_key).join('|');
  useEffect(() => {
    const t = window.setTimeout(showReadable, 120);
    return () => window.clearTimeout(t);
    // Re-frame when steps are added or removed, or when asked to (tab switch). Not on every edit or drag.
  }, [keysSig, fitSignal, showReadable]);

  const empty = steps.length === 0;

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full bg-warm-50 dark:bg-charcoal-950"
      role="region"
      aria-label="Workflow canvas"
      aria-describedby="canvas-help"
      data-testid="workflow-canvas"
    >
      <p id="canvas-help" className="sr-only">
        Press Tab to move between steps and Enter to open a step's settings. Use the zoom buttons to change the view.
      </p>
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelect(node.data.step_key as string)}
        onPaneClick={() => onSelect(null)}
        onSelectionChange={({ nodes: sel }) => {
          if (sel.length === 1) onSelect(sel[0].data.step_key as string);
        }}
        onNodeDragStop={(_, node) =>
          onMoveNode(node.data.step_key as string, { x: Math.round(node.position.x), y: Math.round(node.position.y) })
        }
        onConnect={(c) => {
          if (readOnly || !c.source || !c.target) return;
          onConnect({
            source_step_key: keyOf(c.source),
            target_step_key: keyOf(c.target),
            condition_label: c.sourceHandle ?? null,
          });
        }}
        onNodesDelete={(deleted) => onDeleteSteps(deleted.map((n) => n.data.step_key as string))}
        onEdgesDelete={(deleted) =>
          onDeleteConnections(
            deleted.map((e) => ({
              source_step_key: keyOf(e.source),
              target_step_key: keyOf(e.target),
              condition_label: e.sourceHandle ?? null,
            }))
          )
        }
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        minZoom={0.25}
        maxZoom={1.75}
        panOnScroll
        colorMode={isDark ? 'dark' : 'light'}
        proOptions={{ hideAttribution: true }}
        style={{ '--xy-background-color': 'transparent' } as CSSProperties}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color={isDark ? '#273449' : '#CBD5E1'}
        />
        <Panel position="top-right" className="!m-3">
          <div
            role="toolbar"
            aria-label="Canvas controls"
            className="flex items-center gap-0.5 rounded-lg border border-warm-300 bg-white p-1 shadow-subtle dark:border-charcoal-750 dark:bg-charcoal-900"
          >
            <button type="button" className={iconBtn} aria-label="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })}>
              <Minus className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="min-w-[44px] text-center text-sm tabular-nums text-warm-600 dark:text-charcoal-300" aria-live="off">
              {Math.round(zoom * 100)}%
            </span>
            <button type="button" className={iconBtn} aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })}>
              <Plus className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="mx-1 h-5 w-px bg-warm-300 dark:bg-charcoal-700" aria-hidden="true" />
            <button
              type="button"
              className={iconBtn}
              aria-label="Fit view"
              disabled={empty}
              onClick={() => void rf.fitView({ padding: 0.15, duration: 250 })}
            >
              <Maximize className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" className={iconBtn} aria-label="Reset to readable size" disabled={empty} onClick={showReadable}>
              <ScanSearch className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {empty && !isLoading && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-warm-400 shadow-subtle border border-warm-300 dark:bg-charcoal-900 dark:border-charcoal-750 dark:text-charcoal-500">
            <WorkflowIcon className="w-6 h-6" aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold text-warm-900 dark:text-charcoal-100">Your workflow will appear here</h3>
          <p className="max-w-xs text-sm text-warm-600 dark:text-charcoal-400">
            Tell the assistant what to automate. You can then pan, zoom, and click any step to configure it.
          </p>
        </div>
      )}

      {isLoading && empty && <SkeletonCanvas />}
      {isLoading && !empty && (
        <div
          className="absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-lg border border-warm-300 bg-white px-3 py-1.5 text-sm font-medium text-warm-700 shadow-subtle dark:border-charcoal-750 dark:bg-charcoal-900 dark:text-charcoal-200"
          aria-hidden="true"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
          Updating workflow…
        </div>
      )}
    </div>
  );
};

/** Editable React Flow canvas for the working copy of the workflow. */
export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = (props) => (
  <ReactFlowProvider>
    <Inner {...props} />
  </ReactFlowProvider>
);
