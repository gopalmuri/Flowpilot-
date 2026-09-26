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
  ReactFlowInstance,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Clock,
  Save,
  CheckCircle2,
  UploadCloud,
  Loader2,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  Workflow,
  WorkflowVersionDetail,
  WorkflowVersionSummary,
  StepType,
  WorkflowValidationResult,
  WorkflowVersionUpdateRequest,
} from '../../types/workflow';
import {
  getWorkflow,
  getWorkflowVersion,
  listWorkflowVersions,
  createWorkflowVersion,
  updateWorkflowVersion,
  validateWorkflowVersion,
  publishWorkflowVersion,
} from '../../services/workflowService';
import { WorkflowNode } from '../../components/workflow/nodes/WorkflowNode';
import { NodePalette } from '../../components/workflow/palette/NodePalette';
import { NodeConfigPanel } from '../../components/workflow/config/NodeConfigPanel';
import { ValidationBar } from '../../components/workflow/ValidationBar';
import { SLAConfigModal } from '../../components/workflow/SLAConfigModal';
import {
  WorkflowNodeData,
  WorkflowEdgeData,
  validateWorkflowGraph,
} from '../../utils/workflowGraphValidator';

const nodeTypes = {
  workflowNode: WorkflowNode,
};

export const WorkflowEditorContent: React.FC = () => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { activeOrganization, activeRole } = useAuth();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [activeVersion, setActiveVersion] = useState<WorkflowVersionDetail | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<WorkflowEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isSlaModalOpen, setIsSlaModalOpen] = useState<boolean>(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [validationResult, setValidationResult] = useState<WorkflowValidationResult | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const isReadOnly = useMemo(() => {
    if (activeRole === 'VIEWER' || activeRole === 'OPERATOR') return true;
    if (workflow?.status === 'ARCHIVED') return true;
    if (activeVersion?.status === 'PUBLISHED') return true;
    return false;
  }, [activeRole, workflow?.status, activeVersion?.status]);

  // Load workflow & versions
  const loadWorkflowData = useCallback(async () => {
    if (!activeOrganization || !workflowId) return;
    setIsLoading(true);
    setError(null);

    try {
      const wf = await getWorkflow(activeOrganization.id, workflowId);
      setWorkflow(wf);

      const verList = await listWorkflowVersions(activeOrganization.id, workflowId);
      setVersions(verList);

      let targetVerId = wf.active_version_id;
      if (!targetVerId && verList.length > 0) {
        targetVerId = verList[0].id;
      }

      if (targetVerId) {
        const verDetail = await getWorkflowVersion(activeOrganization.id, workflowId, targetVerId);
        setActiveVersion(verDetail);

        // Map steps to nodes
        const initialNodes: Node<WorkflowNodeData>[] = (verDetail.steps || []).map((step, idx) => ({
          id: step.id,
          type: 'workflowNode',
          position: step.ui_position && typeof step.ui_position.x === 'number'
            ? { x: step.ui_position.x, y: step.ui_position.y }
            : { x: 250, y: 80 + idx * 120 },
          data: {
            step_key: step.step_key,
            step_type: step.step_type as StepType,
            name: step.name,
            config: step.config || {},
          },
        }));

        // Map connections to edges
        const initialEdges: Edge<WorkflowEdgeData>[] = (verDetail.connections || []).map((conn) => ({
          id: conn.id || `e-${conn.source_step_id}-${conn.target_step_id}`,
          source: conn.source_step_id,
          target: conn.target_step_id,
          sourceHandle: conn.condition_label || undefined,
          label: conn.condition_label || undefined,
          data: { condition_label: conn.condition_label },
          type: 'default',
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#94a3b8',
          },
        }));

        setNodes(initialNodes);
        setEdges(initialEdges);

        // Run initial client-side validation
        const initialValidation = validateWorkflowGraph(initialNodes, initialEdges);
        setValidationResult(initialValidation);
      }
    } catch (err: any) {
      console.error('Failed to load workflow version:', err);
      setError(err?.response?.data?.detail || err.message || 'Failed to load workflow');
    } finally {
      setIsLoading(false);
    }
  }, [activeOrganization, workflowId, setNodes, setEdges]);

  useEffect(() => {
    loadWorkflowData();
  }, [loadWorkflowData]);

  // Client-side validation whenever nodes or edges change
  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) {
      const result = validateWorkflowGraph(nodes, edges);
      setValidationResult(result);
    }
  }, [nodes, edges]);

  // Window beforeunload confirmation for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Edge Connection Logic
  const onConnect = useCallback(
    (connection: Connection) => {
      if (isReadOnly) return;
      if (!connection.source || !connection.target) return;

      // Rule: No self-referencing loops
      if (connection.source === connection.target) {
        setError('A step cannot connect directly to itself.');
        setTimeout(() => setError(null), 4000);
        return;
      }

      // Rule: Triggers cannot be the target of a connection
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (
        targetNode?.data.step_type === StepType.WEBHOOK_TRIGGER ||
        targetNode?.data.step_type === StepType.MANUAL_TRIGGER
      ) {
        setError('Trigger steps cannot receive incoming connections.');
        setTimeout(() => setError(null), 4000);
        return;
      }

      const conditionLabel = connection.sourceHandle || null;

      const newEdge: Edge<WorkflowEdgeData> = {
        ...connection,
        id: `e-${connection.source}-${connection.target}-${conditionLabel || 'default'}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: conditionLabel || undefined,
        label: conditionLabel || undefined,
        data: { condition_label: conditionLabel },
        type: 'default',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#94a3b8',
        },
      };

      setEdges((eds) => addEdge(newEdge, eds));
      setIsDirty(true);
    },
    [nodes, isReadOnly, setEdges]
  );

  // Drag and Drop from Node Palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (isReadOnly || !reactFlowInstance || !reactFlowWrapper.current) return;

      const stepType = event.dataTransfer.getData('application/reactflow-step-type');
      if (!stepType) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const uniqueId = `node_${Date.now()}`;
      const defaultKey = `${stepType.toLowerCase()}_${nodes.length + 1}`;

      const newNode: Node<WorkflowNodeData> = {
        id: uniqueId,
        type: 'workflowNode',
        position,
        data: {
          step_key: defaultKey,
          step_type: stepType as StepType,
          name: `${stepType.replace('_', ' ')}`,
          config: {},
        },
      };

      setNodes((nds) => nds.concat(newNode));
      setSelectedNodeId(uniqueId);
      setIsDirty(true);
    },
    [isReadOnly, reactFlowInstance, nodes.length, setNodes]
  );

  // Click on Node to open Configuration Panel
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Update Node Data from Config Panel
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

  // Delete Node
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

  // Save Draft (PUT /versions/{versionId})
  const handleSave = async () => {
    if (!activeOrganization || !workflowId || !activeVersion || isReadOnly) return;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Map node ID back to unique step_key for connections
      const idToKeyMap = new Map(nodes.map((n) => [n.id, n.data.step_key]));

      const payload: WorkflowVersionUpdateRequest = {
        steps: nodes.map((node) => ({
          step_key: node.data.step_key,
          step_type: node.data.step_type,
          name: node.data.name || node.data.step_key,
          config: node.data.config || {},
          ui_position: {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          },
        })),
        connections: edges
          .map((edge) => {
            const sourceKey = idToKeyMap.get(edge.source);
            const targetKey = idToKeyMap.get(edge.target);
            if (!sourceKey || !targetKey) return null;
            return {
              source_step_key: sourceKey,
              target_step_key: targetKey,
              condition_label: edge.data?.condition_label || null,
            };
          })
          .filter(Boolean) as any[],
      };

      const updated = await updateWorkflowVersion(
        activeOrganization.id,
        workflowId,
        activeVersion.id,
        payload
      );

      setActiveVersion(updated);
      setIsDirty(false);
      setSuccessMessage('Draft saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to save draft:', err);
      setError(err?.response?.data?.detail || err.message || 'Failed to save workflow draft');
    } finally {
      setIsSaving(false);
    }
  };

  // Run Authoritative Backend Validation
  const handleValidate = async () => {
    if (!activeOrganization || !workflowId || !activeVersion) return;

    setIsValidating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (isDirty) {
        await handleSave();
      }

      const result = await validateWorkflowVersion(
        activeOrganization.id,
        workflowId,
        activeVersion.id
      );

      setValidationResult(result);
      if (result.valid) {
        setSuccessMessage('Workflow DAG is authoritative & valid');
        setTimeout(() => setSuccessMessage(null), 4000);
      } else {
        setError(`Validation failed with ${result.errors.length} error(s)`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Validation request failed');
    } finally {
      setIsValidating(false);
    }
  };

  // Publish Workflow Version
  const handlePublish = async () => {
    if (!activeOrganization || !workflowId || !activeVersion || isReadOnly) return;

    if (validationResult && !validationResult.valid) {
      setError('Cannot publish an invalid workflow. Resolve all validation errors first.');
      return;
    }

    if (!window.confirm('Are you sure you want to publish this version? Published versions become immutable.')) {
      return;
    }

    setIsPublishing(true);
    setError(null);

    try {
      if (isDirty) {
        await handleSave();
      }

      await publishWorkflowVersion(activeOrganization.id, workflowId, activeVersion.id);

      // Reload workflow and version details
      await loadWorkflowData();
      setSuccessMessage('Version published successfully and is now active');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Publishing failed');
    } finally {
      setIsPublishing(false);
    }
  };

  // Create New Version from current
  const handleCreateNewVersion = async () => {
    if (!activeOrganization || !workflowId || !activeVersion) return;
    if (isDirty && !window.confirm('You have unsaved changes. Create new version anyway?')) return;

    setIsLoading(true);
    try {
      const newVer = await createWorkflowVersion(
        activeOrganization.id,
        workflowId,
        activeVersion.id
      );
      // Reload to switch to newly cloned draft version
      const verDetail = await getWorkflowVersion(activeOrganization.id, workflowId, newVer.id);
      setActiveVersion(verDetail);
      await loadWorkflowData();
      setSuccessMessage(`Created and switched to draft version v${newVer.version_number}`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to create new version');
    } finally {
      setIsLoading(false);
    }
  };

  // Switch versions
  const handleSwitchVersion = async (versionId: string) => {
    if (isDirty && !window.confirm('You have unsaved changes. Switch version anyway?')) return;
    if (!activeOrganization || !workflowId) return;

    setIsLoading(true);
    try {
      const verDetail = await getWorkflowVersion(activeOrganization.id, workflowId, versionId);
      setActiveVersion(verDetail);

      const initialNodes: Node<WorkflowNodeData>[] = (verDetail.steps || []).map((step, idx) => ({
        id: step.id,
        type: 'workflowNode',
        position: step.ui_position && typeof step.ui_position.x === 'number'
          ? { x: step.ui_position.x, y: step.ui_position.y }
          : { x: 250, y: 80 + idx * 120 },
        data: {
          step_key: step.step_key,
          step_type: step.step_type as StepType,
          name: step.name,
          config: step.config || {},
        },
      }));

      const initialEdges: Edge<WorkflowEdgeData>[] = (verDetail.connections || []).map((conn) => ({
        id: conn.id || `e-${conn.source_step_id}-${conn.target_step_id}`,
        source: conn.source_step_id,
        target: conn.target_step_id,
        sourceHandle: conn.condition_label || undefined,
        label: conn.condition_label || undefined,
        data: { condition_label: conn.condition_label },
        type: 'default',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      }));

      setNodes(initialNodes);
      setEdges(initialEdges);
      setIsDirty(false);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to switch version');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  if (isLoading && !workflow) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-xs text-slate-400">Loading visual workflow editor...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] -m-6 bg-slate-950 overflow-hidden">
      {/* Top Header / Action Toolbar */}
      <div className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between z-10">
        {/* Left: Workflow metadata */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (isDirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
              navigate('/workflows');
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Back to workflows catalog"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white tracking-tight">
                {workflow?.name || 'Workflow Builder'}
              </h2>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  workflow?.status === 'ACTIVE'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : workflow?.status === 'ARCHIVED'
                    ? 'bg-slate-800 border-slate-700 text-slate-400'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                }`}
              >
                {workflow?.status}
              </span>
              {isDirty && (
                <span className="text-[10px] text-amber-400 font-medium">
                  •• Unsaved changes
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              {versions.length > 1 ? (
                <div className="flex items-center gap-1">
                  <span>Version:</span>
                  <select
                    value={activeVersion?.id || ''}
                    onChange={(e) => handleSwitchVersion(e.target.value)}
                    className="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded text-[10px] text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version_number} ({v.status})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span>Version: v{activeVersion?.version_number || 1} ({activeVersion?.status})</span>
              )}
              {isReadOnly && <span className="text-rose-400 font-semibold">•• Read-Only</span>}
            </div>
          </div>
        </div>

        {/* Toolbar Action Buttons */}
        <div className="flex items-center gap-2">
          {successMessage && (
            <span className="text-xs text-emerald-400 mr-2 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {successMessage}
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsSlaModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 transition"
            title="Configure SLA targets for this version"
          >
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>SLA</span>
            {activeVersion?.definition?.sla?.enabled && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            )}
          </button>

          <button
            type="button"
            onClick={handleValidate}
            disabled={isValidating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 transition disabled:opacity-50"
          >
            <CheckCircle2 className={`w-3.5 h-3.5 ${isValidating ? 'animate-spin' : ''}`} />
            Validate
          </button>

          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !isDirty}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving...' : 'Save Draft'}
              </button>

              <button
                type="button"
                onClick={handlePublish}
                disabled={Boolean(isPublishing || (validationResult && !validationResult.valid))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-500 transition disabled:opacity-50 shadow-sm"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                {isPublishing ? 'Publishing...' : 'Publish Version'}
              </button>
            </>
          )}

          {activeVersion?.status === 'PUBLISHED' && (
            <button
              type="button"
              onClick={handleCreateNewVersion}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-500 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              New Draft Version
            </button>
          )}
        </div>
      </div>

      {/* Editor Body: Palette + Canvas + Config Panel */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Left Palette */}
        <NodePalette isReadOnly={isReadOnly} />

        {/* Center: React Flow Canvas */}
        <div ref={reactFlowWrapper} className="flex-1 h-full relative">
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-rose-500/90 text-white text-xs rounded-xl shadow-xl flex items-center gap-2 backdrop-blur-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="ml-2 text-white/80 hover:text-white"
              >
                ×
              </button>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange as any}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes as any}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
            deleteKeyCode={isReadOnly ? null : ['Backspace', 'Delete']}
            nodesDraggable={!isReadOnly}
            nodesConnectable={!isReadOnly}
            elementsSelectable={true}
          >
            <Background color="#1e293b" gap={16} size={1} />
            <Controls className="!bg-slate-900 !border-slate-800 !text-slate-200 fill-slate-200" />
            <MiniMap
              nodeColor={(node: any) => {
                const stepType = node.data?.step_type;
                if (stepType === StepType.WEBHOOK_TRIGGER || stepType === StepType.MANUAL_TRIGGER)
                  return '#06b6d4';
                if (stepType === StepType.CONDITION) return '#f59e0b';
                if (stepType === StepType.HUMAN_APPROVAL) return '#f43f5e';
                return '#3b82f6';
              }}
              className="!bg-slate-900/90 !border-slate-800 rounded-xl"
            />
          </ReactFlow>

          {/* Bottom Validation Bar */}
          <ValidationBar validationResult={validationResult} />
        </div>

        {/* Right Configuration Panel */}
        {selectedNode && (
          <NodeConfigPanel
            selectedNode={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
            isReadOnly={isReadOnly}
          />
        )}
      </div>
      {/* SLA Configuration Modal */}
      <SLAConfigModal
        isOpen={isSlaModalOpen}
        onClose={() => setIsSlaModalOpen(false)}
        workflowId={workflowId || ''}
        version={activeVersion}
        onSaveSuccess={(newSla) => {
          if (activeVersion) {
            setActiveVersion({
              ...activeVersion,
              definition: {
                ...(activeVersion.definition || {}),
                sla: newSla,
              },
            });
          }
          setSuccessMessage('SLA configuration updated');
          setTimeout(() => setSuccessMessage(null), 3000);
        }}
      />
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
