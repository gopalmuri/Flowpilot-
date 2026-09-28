import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  UploadCloud,
  Loader2,
  ShieldAlert,
  Plus,
  X,
  Play,
  History,
  Key,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Workflow,
  WorkflowVersionDetail,
  WorkflowVersionSummary,
  StepType,
  WorkflowValidationResult,
  WorkflowVersionUpdateRequest,
} from '../../types/workflow';
import { WorkflowRun } from '../../types/execution';
import {
  getWorkflow,
  getWorkflowVersion,
  listWorkflowVersions,
  updateWorkflowVersion,
  validateWorkflowVersion,
  publishWorkflowVersion,
} from '../../services/workflowService';
import { listExecutions, triggerExecution } from '../../services/executionService';
import { WorkflowNode } from '../../components/workflow/nodes/WorkflowNode';
import { NodePalette } from '../../components/workflow/palette/NodePalette';
import { NodeConfigPanel } from '../../components/workflow/config/NodeConfigPanel';
import { ValidationBar } from '../../components/workflow/ValidationBar';
import { Breadcrumbs } from '../../components/ui/Breadcrumbs';
import { StatusBadge } from '../../components/ui/StatusBadge';
import {
  WorkflowNodeData,
  WorkflowEdgeData,
  validateWorkflowGraph,
} from '../../utils/workflowGraphValidator';

const nodeTypes = {
  workflowNode: WorkflowNode as any,
};

type ActiveEditorTab = 'builder' | 'overview' | 'executions' | 'versions' | 'sla';

export const WorkflowEditorContent: React.FC = () => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { activeOrganization, activeRole } = useAuth();
  const { resolvedTheme } = useTheme();

  // Active top-level tab
  const [activeTab, setActiveTab] = useState<ActiveEditorTab>('builder');

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [activeVersion, setActiveVersion] = useState<WorkflowVersionDetail | null>(null);
  const [versionsList, setVersionsList] = useState<WorkflowVersionSummary[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(false);

  // Graph state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<WorkflowEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Operation state
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isMobilePaletteOpen, setIsMobilePaletteOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  // Modals
  const [isPublishConfirmOpen, setIsPublishConfirmOpen] = useState<boolean>(false);
  const [isRunModalOpen, setIsRunModalOpen] = useState<boolean>(false);
  const [runPayload, setRunPayload] = useState<string>('{\n  "source": "control_plane_test",\n  "timestamp": "' + new Date().toISOString() + '"\n}');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [validationResult, setValidationResult] = useState<WorkflowValidationResult | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const isReadOnly = useMemo(() => {
    if (activeRole === 'VIEWER' || activeRole === 'OPERATOR') return true;
    if (workflow?.status === 'ARCHIVED') return true;
    if (activeVersion?.status === 'PUBLISHED') return true;
    return false;
  }, [activeRole, workflow?.status, activeVersion?.status]);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  const validateCurrentGraph = useCallback((currentNodes: Node<WorkflowNodeData>[], currentEdges: Edge<WorkflowEdgeData>[]) => {
    const res = validateWorkflowGraph(currentNodes, currentEdges);
    setValidationResult(res);
    return res;
  }, []);

  const populateGraph = useCallback((version: WorkflowVersionDetail) => {
    const stepsList = version.steps || version.definition?.steps || [];
    const connectionsList = version.connections || version.definition?.connections || [];

    const rawNodes = stepsList.map((step: any, idx: number) => ({
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
    }));

    const rawEdges = connectionsList.map((conn: any, idx: number) => {
      const srcId = conn.source_step_id || `node-${conn.source_step_key}`;
      const tgtId = conn.target_step_id || `node-${conn.target_step_key}`;
      return {
        id: conn.id || `edge-${srcId}-${tgtId}-${idx}`,
        source: srcId,
        target: tgtId,
        sourceHandle: conn.condition_branch === null ? undefined : String(conn.condition_branch),
        label: conn.condition_label || (conn.condition_branch === null ? undefined : conn.condition_branch ? 'true' : 'false'),
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: '#69716C',
        },
        style: { strokeWidth: 1.5, stroke: '#69716C' },
      };
    });

    setNodes(rawNodes);
    setEdges(rawEdges);
    setIsDirty(false);
    validateCurrentGraph(rawNodes, rawEdges);
  }, [setNodes, setEdges, validateCurrentGraph]);

  const loadWorkflowData = useCallback(async () => {
    if (!activeOrganization || !workflowId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [wf, vList] = await Promise.all([
        getWorkflow(activeOrganization.id, workflowId),
        listWorkflowVersions(activeOrganization.id, workflowId),
      ]);
      setWorkflow(wf);
      setVersionsList(vList || []);

      const targetVerId = wf.active_version_id || (vList && vList.length > 0 ? vList[0].id : null);
      if (targetVerId) {
        const vDetail = await getWorkflowVersion(activeOrganization.id, workflowId, targetVerId);
        setActiveVersion(vDetail);
        populateGraph(vDetail);
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to load workflow.');
    } finally {
      setIsLoading(false);
    }
  }, [activeOrganization?.id, workflowId, populateGraph]);

  useEffect(() => {
    loadWorkflowData();
  }, [loadWorkflowData]);

  // Load executions when Executions tab is clicked
  useEffect(() => {
    if (activeTab === 'executions' && activeOrganization && workflowId) {
      setIsLoadingRuns(true);
      listExecutions(activeOrganization.id, { workflowId, pageSize: 20 })
        .then((res) => setWorkflowRuns(res.items || []))
        .catch(() => setWorkflowRuns([]))
        .finally(() => setIsLoadingRuns(false));
    }
  }, [activeTab, activeOrganization, workflowId]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (isReadOnly) return;
      setIsDirty(true);
      setEdges((eds) => {
        const newEdges = addEdge(
          {
            ...params,
            type: 'smoothstep',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: '#69716C',
            },
            style: { strokeWidth: 1.5, stroke: '#69716C' },
          },
          eds
        );
        validateCurrentGraph(nodes, newEdges);
        return newEdges;
      });
    },
    [isReadOnly, nodes, setEdges, validateCurrentGraph]
  );

  const handleAddNode = useCallback(
    (stepType: StepType) => {
      if (isReadOnly) return;
      const count = nodes.length + 1;
      const stepKey = `${stepType.toLowerCase()}_${count}`;
      const newNode: Node<WorkflowNodeData> = {
        id: `node-${stepKey}`,
        type: 'workflowNode',
        position: { x: 300 + (count % 3) * 40, y: 150 + count * 60 },
        data: {
          step_key: stepKey,
          name: `${stepType.replace(/_/g, ' ')} ${count}`,
          step_type: stepType,
          config: {},
          error_policy: { max_retries: 3, retry_delay_ms: 1000 },
          timeout_seconds: 60,
        },
      };

      setNodes((nds) => {
        const updated = nds.concat(newNode);
        setIsDirty(true);
        validateCurrentGraph(updated, edges);
        return updated;
      });
      setSelectedNodeId(newNode.id);
    },
    [isReadOnly, nodes, edges, setNodes, validateCurrentGraph]
  );

  const handleUpdateNode = useCallback(
    (nodeId: string, updatedData: Partial<WorkflowNodeData>) => {
      if (isReadOnly) return;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                ...updatedData,
              },
            };
          }
          return node;
        })
      );
      setIsDirty(true);
    },
    [isReadOnly, setNodes]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (isReadOnly) return;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      setIsDirty(true);
    },
    [isReadOnly, selectedNodeId, setNodes, setEdges]
  );

  const handleValidateAuthoritative = async () => {
    if (!activeOrganization || !workflowId || !activeVersion) return;
    setIsValidating(true);
    try {
      const res = await validateWorkflowVersion(activeOrganization.id, workflowId, activeVersion.id);
      setValidationResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Validation request failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!activeOrganization || !workflowId || !activeVersion || isReadOnly) return;
    setIsSaving(true);
    setError(null);
    try {
      const definition = {
        steps: nodes.map((n) => ({
          id: n.id,
          step_key: n.data.step_key,
          name: n.data.name,
          step_type: n.data.step_type,
          config: n.data.config,
          error_policy: n.data.error_policy,
          timeout_seconds: n.data.timeout_seconds,
          position: n.position,
        })),
        connections: edges.map((e) => ({
          source_step_key: e.source.replace('node-', ''),
          target_step_key: e.target.replace('node-', ''),
          condition_branch: e.sourceHandle === 'true' ? true : e.sourceHandle === 'false' ? false : null,
        })),
      };

      const payload: WorkflowVersionUpdateRequest = {
        steps: definition.steps as any,
        connections: definition.connections as any,
      };
      const updated = await updateWorkflowVersion(activeOrganization.id, workflowId, activeVersion.id, payload);
      setActiveVersion(updated);
      setIsDirty(false);
      setSuccessMessage('Workflow version saved.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to save version.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmPublish = async () => {
    if (!activeOrganization || !workflowId || !activeVersion || isReadOnly) return;
    setIsPublishing(true);
    setError(null);
    try {
      await publishWorkflowVersion(activeOrganization.id, workflowId, activeVersion.id);
      setIsPublishConfirmOpen(false);
      await loadWorkflowData();
      setSuccessMessage('Workflow published successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to publish version.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleTriggerRun = async () => {
    if (!activeOrganization || !workflow) return;
    setIsRunning(true);
    setRunError(null);
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(runPayload);
      } catch {
        throw new Error('Invalid JSON payload');
      }
      const res = await triggerExecution(activeOrganization.id, workflow.id, parsed);
      setIsRunModalOpen(false);
      navigate(`/executions?search=${encodeURIComponent(res.correlation_id)}`);
    } catch (err: any) {
      setRunError(err?.response?.data?.detail || err.message || 'Execution dispatch failed');
    } finally {
      setIsRunning(false);
    }
  };

  const isDark = resolvedTheme === 'dark';
  const canvasBg = isDark ? '#101513' : '#F5F3EE';
  const dotColor = isDark ? '#2A332E' : '#DDD9D0';

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-6rem)] bg-warm-100 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-2xl">
        <Loader2 className="w-8 h-8 text-brand-600 dark:text-brand-400 animate-spin mb-3" />
        <span className="text-xs text-warm-600 dark:text-charcoal-400 font-medium">Loading orchestration canvas...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Breadcrumb Navigation */}
      <Breadcrumbs
        items={[
          { label: 'Workflows', to: '/workflows' },
          { label: 'Workflow Details', current: true },
        ]}
      />

      {/* Main Container */}
      <div className="flex flex-col h-[calc(100vh-8.5rem)] bg-warm-100 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-2xl overflow-hidden shadow-subtle select-none">
        {/* Editor Toolbar Header */}
        <div className="h-auto py-2 sm:py-0 sm:h-14 px-3 sm:px-4 bg-white dark:bg-charcoal-900 border-b border-warm-300 dark:border-charcoal-750 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-4 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/workflows')}
              aria-label="Back to workflows"
              className="p-1.5 rounded-lg border border-warm-200 dark:border-charcoal-750 hover:bg-warm-100 dark:hover:bg-charcoal-800 text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 transition-colors flex-shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-warm-900 dark:text-charcoal-100 tracking-tight truncate max-w-[110px] xs:max-w-[180px] sm:max-w-xs">
                  {workflow?.name || 'Workflow Editor'}
                </h2>
                {activeVersion && (
                  <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-warm-100 dark:bg-charcoal-800 text-brand-700 dark:text-brand-400 border border-warm-300 dark:border-charcoal-750 flex-shrink-0">
                    v{activeVersion.version_number} &bull; {activeVersion.status}
                  </span>
                )}
                {isReadOnly && (
                  <span className="hidden xs:inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 items-center gap-1 flex-shrink-0">
                    <ShieldAlert className="w-3 h-3" />
                    Read-Only
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Operational View Tabs */}
          <div className="flex items-center p-1 bg-warm-100 dark:bg-charcoal-850 rounded-xl border border-warm-200 dark:border-charcoal-750 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('builder')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'builder'
                  ? 'bg-white dark:bg-charcoal-750 text-brand-700 dark:text-brand-300 shadow-2xs'
                  : 'text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              Builder
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-white dark:bg-charcoal-750 text-brand-700 dark:text-brand-300 shadow-2xs'
                  : 'text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('executions')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'executions'
                  ? 'bg-white dark:bg-charcoal-750 text-brand-700 dark:text-brand-300 shadow-2xs'
                  : 'text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              Executions
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('versions')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'versions'
                  ? 'bg-white dark:bg-charcoal-750 text-brand-700 dark:text-brand-300 shadow-2xs'
                  : 'text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              Versions
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sla')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'sla'
                  ? 'bg-white dark:bg-charcoal-750 text-brand-700 dark:text-brand-300 shadow-2xs'
                  : 'text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200'
              }`}
            >
              SLA &amp; Triggers
            </button>
          </div>

          {/* Right Toolbar Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-auto sm:ml-0">
            {error && (
              <span className="text-xs text-red-600 dark:text-red-400 max-w-xs truncate hidden lg:inline">
                {error}
              </span>
            )}
            {successMessage && (
              <span className="text-xs text-brand-600 dark:text-brand-400 max-w-xs truncate hidden lg:inline">
                {successMessage}
              </span>
            )}

            {/* Run Button */}
            {workflow?.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => setIsRunModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warm-100 dark:bg-charcoal-850 hover:bg-warm-200 dark:hover:bg-charcoal-800 border border-warm-300 dark:border-charcoal-750 text-xs font-semibold text-brand-700 dark:text-brand-400 transition cursor-pointer"
                title="Run Workflow"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span className="hidden sm:inline">Run</span>
              </button>
            )}

            <button
              type="button"
              disabled={isValidating}
              onClick={handleValidateAuthoritative}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-warm-100 dark:bg-charcoal-850 hover:bg-warm-200 dark:hover:bg-charcoal-800 border border-warm-300 dark:border-charcoal-750 text-xs font-semibold text-warm-800 dark:text-charcoal-200 transition disabled:opacity-40 cursor-pointer"
              title="Validate workflow graph"
            >
              {isValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span className="hidden xs:inline">Validate</span>
            </button>

            {!isReadOnly && (
              <>
                <button
                  type="button"
                  disabled={isSaving || !isDirty}
                  onClick={handleSave}
                  className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-warm-100 dark:bg-charcoal-850 hover:bg-warm-200 dark:hover:bg-charcoal-800 border border-warm-300 dark:border-charcoal-750 text-xs font-semibold text-warm-800 dark:text-charcoal-200 transition disabled:opacity-40 cursor-pointer"
                  title="Save Draft"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Save Draft</span>
                  <span className="sm:hidden">Save</span>
                </button>

                <button
                  type="button"
                  disabled={isPublishing || activeVersion?.status === 'PUBLISHED'}
                  onClick={() => setIsPublishConfirmOpen(true)}
                  className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-xs font-semibold text-white shadow-subtle transition disabled:opacity-40 cursor-pointer"
                  title="Publish Version"
                >
                  {isPublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                  <span>Publish Version</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* TAB 1: VISUAL BUILDER (Default view, keeping all existing tests passing) */}
        {activeTab === 'builder' && (
          <div className="flex-1 flex flex-col min-h-0 relative">
            <ValidationBar
              validationResult={validationResult}
              isValidating={isValidating}
            />

            <div className="flex-1 flex relative overflow-hidden">
              <NodePalette onAddNode={handleAddNode} disabled={isReadOnly} />

              <div className="flex-1 h-full w-full relative" ref={reactFlowWrapper}>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={(changes) => {
                    if (isReadOnly) return;
                    setIsDirty(true);
                    onNodesChange(changes);
                  }}
                  onEdgesChange={(changes) => {
                    if (isReadOnly) return;
                    setIsDirty(true);
                    onEdgesChange(changes);
                  }}
                  onConnect={onConnect}
                  nodeTypes={nodeTypes}
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  onPaneClick={() => setSelectedNodeId(null)}
                  fitView
                  attributionPosition="bottom-left"
                  defaultEdgeOptions={{
                    type: 'smoothstep',
                    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#69716C' },
                    style: { strokeWidth: 1.5, stroke: '#69716C' },
                  }}
                >
                  <Background color={dotColor} gap={16} size={1} style={{ backgroundColor: canvasBg }} />
                  <Controls className="!bg-white dark:!bg-charcoal-900 !border !border-warm-300 dark:!border-charcoal-750 !rounded-xl !shadow-subtle [&>button]:!border-b-warm-200 dark:[&>button]:!border-b-charcoal-800" />
                  <MiniMap
                    nodeColor={() => (isDark ? '#222925' : '#E8E5DF')}
                    maskColor={isDark ? 'rgba(16, 21, 19, 0.75)' : 'rgba(245, 243, 238, 0.75)'}
                    className="!bg-white dark:!bg-charcoal-900 !border !border-warm-300 dark:!border-charcoal-750 !rounded-xl !shadow-subtle !hidden sm:!block"
                  />
                </ReactFlow>

                {/* Mobile Floating Palette Trigger */}
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => setIsMobilePaletteOpen(true)}
                    className="md:hidden absolute bottom-4 left-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold shadow-elevated"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Step</span>
                  </button>
                )}
              </div>

              {selectedNode && (
                <NodeConfigPanel
                  selectedNode={selectedNode}
                  isReadOnly={isReadOnly}
                  onClose={() => setSelectedNodeId(null)}
                  onUpdateNode={handleUpdateNode}
                  onDeleteNode={handleDeleteNode}
                />
              )}

              {/* Mobile Palette Bottom Sheet */}
              {isMobilePaletteOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
                  <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-xs"
                    onClick={() => setIsMobilePaletteOpen(false)}
                  />
                  <div className="relative mt-auto w-full bg-white dark:bg-charcoal-900 border-t border-warm-300 dark:border-charcoal-750 rounded-t-2xl p-4 shadow-modal max-h-[70vh] overflow-y-auto">
                    <div className="flex items-center justify-between pb-3 border-b border-warm-200 dark:border-charcoal-800 mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-warm-900 dark:text-charcoal-100">
                        Node Palette
                      </h3>
                      <button
                        type="button"
                        onClick={() => setIsMobilePaletteOpen(false)}
                        className="p-1 rounded-lg text-warm-500 hover:bg-warm-100 dark:hover:bg-charcoal-800"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <NodePalette
                      onAddNode={(st) => {
                        handleAddNode(st);
                        setIsMobilePaletteOpen(false);
                      }}
                      disabled={isReadOnly}
                      isMobileSheet={true}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: OVERVIEW & TELEMETRY */}
        {activeTab === 'overview' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="max-w-4xl space-y-6">
              <div>
                <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                  Workflow Operational Overview
                </h3>
                <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-1">
                  Status, configuration, and telemetry boundaries for this automated orchestration.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-2xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-warm-500 dark:text-charcoal-400 block mb-1">
                    State
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={workflow?.status || 'DRAFT'} size="sm" />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-2xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-warm-500 dark:text-charcoal-400 block mb-1">
                    Active Version
                  </span>
                  <span className="text-base font-bold text-warm-900 dark:text-charcoal-100">
                    {activeVersion ? `v${activeVersion.version_number}` : 'None'}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-2xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-warm-500 dark:text-charcoal-400 block mb-1">
                    Total Steps
                  </span>
                  <span className="text-base font-bold text-warm-900 dark:text-charcoal-100">
                    {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 shadow-2xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-warm-500 dark:text-charcoal-400 block mb-1">
                    Trigger Mode
                  </span>
                  <span className="text-xs font-semibold text-brand-700 dark:text-brand-400 font-mono">
                    {workflow?.webhook_key ? 'WEBHOOK & MANUAL' : 'MANUAL DISPATCH'}
                  </span>
                </div>
              </div>

              {/* Description & Metadata */}
              <div className="p-5 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 space-y-3">
                <h4 className="text-xs font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                  Description
                </h4>
                <p className="text-xs text-warm-700 dark:text-charcoal-300 leading-relaxed">
                  {workflow?.description || 'No description provided.'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-warm-200 dark:border-charcoal-800 text-xs">
                  <div>
                    <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Created At</span>
                    <span className="text-warm-900 dark:text-charcoal-100 font-mono text-[11px]">
                      {workflow?.created_at ? new Date(workflow.created_at).toLocaleString() : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-warm-500 dark:text-charcoal-400 block text-[11px]">Last Updated</span>
                    <span className="text-warm-900 dark:text-charcoal-100 font-mono text-[11px]">
                      {workflow?.updated_at ? new Date(workflow.updated_at).toLocaleString() : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: EXECUTIONS HISTORY */}
        {activeTab === 'executions' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                  Execution History
                </h3>
                <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-0.5">
                  Recent runs dispatched for this workflow.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsRunModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold shadow-2xs"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Now</span>
              </button>
            </div>

            {isLoadingRuns ? (
              <div className="py-12 text-center text-xs text-warm-500">Loading execution records...</div>
            ) : workflowRuns.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 space-y-2">
                <History className="w-6 h-6 text-warm-400 mx-auto" />
                <p className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">
                  No Executions Yet
                </p>
                <p className="text-[11px] text-warm-500 dark:text-charcoal-400">
                  This workflow has not recorded any execution runs. Click &ldquo;Run Now&rdquo; to test it.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 overflow-hidden divide-y divide-warm-100 dark:divide-charcoal-800">
                {workflowRuns.map((run) => (
                  <div
                    key={run.id}
                    onClick={() => navigate(`/executions?search=${encodeURIComponent(run.correlation_id)}`)}
                    className="p-3.5 flex items-center justify-between hover:bg-warm-50 dark:hover:bg-charcoal-850 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <StatusBadge status={run.status} size="sm" />
                      <div>
                        <span className="text-xs font-mono font-semibold text-warm-900 dark:text-charcoal-100 block">
                          {run.correlation_id}
                        </span>
                        <span className="text-[11px] text-warm-500 dark:text-charcoal-400">
                          Trigger: {run.trigger_type} &bull; Started {new Date(run.started_at).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-mono text-warm-700 dark:text-charcoal-300 block">
                        {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(2)}s` : 'In-flight'}
                      </span>
                      <span className="text-[10px] text-brand-600 dark:text-brand-400 font-semibold hover:underline">
                        View Timeline &rarr;
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: VERSION MANAGEMENT */}
        {activeTab === 'versions' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                Workflow Version History
              </h3>
              <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-0.5">
                Inspect immutable published versions and active draft specifications.
              </p>
            </div>

            <div className="space-y-3">
              {versionsList.map((ver) => {
                const isCurrentActive = activeVersion?.id === ver.id;
                const isPublished = ver.status === 'PUBLISHED';

                return (
                  <div
                    key={ver.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isCurrentActive
                        ? 'bg-white dark:bg-charcoal-900 border-brand-500/50 shadow-subtle'
                        : 'bg-warm-50/50 dark:bg-charcoal-850/50 border-warm-300 dark:border-charcoal-750'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded-lg bg-warm-100 dark:bg-charcoal-800 text-xs font-mono font-bold text-warm-900 dark:text-charcoal-100 border border-warm-300 dark:border-charcoal-750">
                          v{ver.version_number}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-warm-900 dark:text-charcoal-100">
                              Version {ver.version_number}
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                isPublished
                                  ? 'bg-brand-100 dark:bg-brand-950/60 text-brand-800 dark:text-brand-300 border border-brand-200 dark:border-brand-800'
                                  : 'bg-warm-200 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300'
                              }`}
                            >
                              {ver.status}
                            </span>
                          </div>
                          <span className="text-[11px] text-warm-500 dark:text-charcoal-400 block mt-0.5">
                            Created {new Date(ver.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {!isPublished && !isReadOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsPublishConfirmOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-2xs cursor-pointer"
                          >
                            Publish Version
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 5: SLA & TRIGGERS */}
        {activeTab === 'sla' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="max-w-3xl space-y-6">
              <div>
                <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                  Inbound Webhook &amp; SLA Configuration
                </h3>
                <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-1">
                  Authenticate HTTP triggers and enforce maximum latency SLAs.
                </p>
              </div>

              {/* Webhook Configuration Card */}
              <div className="p-5 rounded-xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                  <h4 className="text-xs font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                    Webhook Trigger Endpoint
                  </h4>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-warm-700 dark:text-charcoal-300 mb-1">
                    HTTP POST URL
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/api/v1/organizations/${activeOrganization?.id}/workflows/${workflow?.id}/runs?async_dispatch=true`}
                      className="flex-1 p-2 bg-warm-50 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-lg text-xs font-mono text-warm-800 dark:text-charcoal-200"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `${window.location.origin}/api/v1/organizations/${activeOrganization?.id}/workflows/${workflow?.id}/runs?async_dispatch=true`
                        );
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                      }}
                      className="p-2 rounded-lg bg-warm-100 dark:bg-charcoal-800 border border-warm-300 dark:border-charcoal-700 text-warm-600 dark:text-charcoal-300 hover:text-warm-900"
                      title="Copy URL"
                    >
                      {copiedKey ? <Check className="w-4 h-4 text-brand-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-warm-700 dark:text-charcoal-300 mb-1">
                    Webhook Secret Key
                  </label>
                  <input
                    type="password"
                    readOnly
                    value={workflow?.webhook_key || 'whk_default_sec_masked'}
                    className="w-full p-2 bg-warm-50 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-lg text-xs font-mono text-warm-800 dark:text-charcoal-200"
                  />
                  <p className="text-[10px] text-warm-500 dark:text-charcoal-400 mt-1">
                    Pass in HTTP header: <code className="font-mono">X-FlowPilot-Signature</code> or Bearer token.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PUBLISH CONFIRMATION MODAL */}
      {isPublishConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl p-5 shadow-modal space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800 flex items-center justify-center text-brand-600 dark:text-brand-400 flex-shrink-0">
                <UploadCloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">
                  Publish version v{activeVersion?.version_number}?
                </h3>
                <p className="text-xs text-warm-600 dark:text-charcoal-400 mt-0.5">
                  Production activation confirmation
                </p>
              </div>
            </div>

            <p className="text-xs text-warm-700 dark:text-charcoal-300 leading-relaxed bg-warm-50 dark:bg-charcoal-850 p-3 rounded-xl border border-warm-200 dark:border-charcoal-750">
              This version will become the active, immutable workflow definition for all new automated executions. Existing in-flight runs will finish on their registered version.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-warm-200 dark:border-charcoal-800">
              <button
                type="button"
                disabled={isPublishing}
                onClick={() => setIsPublishConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPublishing}
                onClick={handleConfirmPublish}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-subtle transition disabled:opacity-50 cursor-pointer"
              >
                {isPublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                <span>Publish Version</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RUN WORKFLOW MODAL */}
      {isRunModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl p-5 shadow-modal space-y-4">
            <div className="flex items-center justify-between border-b border-warm-200 dark:border-charcoal-800 pb-3">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-brand-600 dark:text-brand-400 fill-current" />
                <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">
                  Dispatch Run: {workflow?.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRunModalOpen(false)}
                className="text-warm-400 hover:text-warm-700 dark:hover:text-charcoal-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {runError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-xs text-red-700 dark:text-red-300">
                {runError}
              </div>
            )}

            <div>
              <label className="flex items-center justify-between text-xs font-semibold text-warm-800 dark:text-charcoal-200 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400" />
                  <span>Input Payload (JSON)</span>
                </span>
                <span className="text-[10px] font-mono text-warm-500 dark:text-charcoal-400">
                  Initial step input
                </span>
              </label>
              <textarea
                rows={6}
                value={runPayload}
                onChange={(e) => setRunPayload(e.target.value)}
                className="w-full p-3 bg-warm-50 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-xl text-xs font-mono text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600 dark:focus:border-brand-500 transition-all resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-warm-200 dark:border-charcoal-800">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setIsRunModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRunning}
                onClick={handleTriggerRun}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-subtle transition disabled:opacity-50"
              >
                {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>Execute Workflow</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const WorkflowEditorPage: React.FC = () => {
  return (
    <ReactFlowProvider>
      <WorkflowEditorContent />
    </ReactFlowProvider>
  );
};
