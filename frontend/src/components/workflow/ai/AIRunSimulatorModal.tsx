import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Play,
  Sparkles,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { Node, Edge } from '@xyflow/react';
import { WorkflowNodeData, WorkflowEdgeData } from '../../../utils/workflowGraphValidator';
import { serializeGraph } from '../../../utils/workflowGraphMapper';
import {
  AISimulatePayloadRequest,
  AISimulatePayloadResponse,
  AISimulateExecutionRequest,
  AISimulateExecutionResponse,
  AISimulateScenario,
} from '../../../types/workflowAI';
import {
  simulatePayloadWithAI,
  simulateWorkflowRunWithAI,
} from '../../../services/workflowService';

interface AIRunSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  workflowId: string;
  workflowName?: string;
  currentNodes: Node<WorkflowNodeData>[];
  currentEdges: Edge<WorkflowEdgeData>[];
  onExecuteLiveRun: (payload: Record<string, any>) => void;
  isRunningLive: boolean;
  runError?: string | null;
}

export const AIRunSimulatorModal: React.FC<AIRunSimulatorModalProps> = ({
  isOpen,
  onClose,
  organizationId,
  workflowId,
  workflowName,
  currentNodes,
  currentEdges,
  onExecuteLiveRun,
  isRunningLive,
  runError,
}) => {
  const [activeTab, setActiveTab] = useState<'payload' | 'simulation'>('payload');
  const [payloadText, setPayloadText] = useState<string>(
    JSON.stringify(
      {
        source: 'control_plane_test',
        lead_score: 85,
        email: 'alex.morgan@enterprise.com',
        company: 'Acme Global',
        tier: 'enterprise',
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );

  const [selectedScenario, setSelectedScenario] = useState<AISimulateScenario>('happy_path');
  const [customInstruction, setCustomInstruction] = useState<string>('');
  const [isGeneratingPayload, setIsGeneratingPayload] = useState<boolean>(false);
  const [payloadSummary, setPayloadSummary] = useState<string | null>(null);

  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<AISimulateExecutionResponse | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});

  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Reset or focus on open
  useEffect(() => {
    if (isOpen) {
      setJsonError(null);
      setSimulationResult(null);
    }
  }, [isOpen]);

  const parsedPayload = useMemo(() => {
    try {
      const obj = JSON.parse(payloadText);
      return obj;
    } catch {
      return null;
    }
  }, [payloadText]);

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(payloadText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFormatPayload = () => {
    try {
      const obj = JSON.parse(payloadText);
      setPayloadText(JSON.stringify(obj, null, 2));
      setJsonError(null);
    } catch (err: any) {
      setJsonError(`Invalid JSON syntax: ${err.message}`);
    }
  };

  const handleGeneratePayload = async (scenario: AISimulateScenario = selectedScenario) => {
    if (!organizationId || !workflowId || isGeneratingPayload) return;
    setIsGeneratingPayload(true);
    setJsonError(null);

    try {
      const serialized = serializeGraph(currentNodes, currentEdges);
      const req: AISimulatePayloadRequest = {
        steps: serialized.steps as any,
        connections: serialized.connections as any,
        scenario,
        custom_instruction: customInstruction.trim() || undefined,
      };

      const res: AISimulatePayloadResponse = await simulatePayloadWithAI(organizationId, workflowId, req);
      setPayloadText(JSON.stringify(res.payload, null, 2));
      setPayloadSummary(res.summary);
      setSelectedScenario(scenario);
    } catch (err: any) {
      setJsonError(err?.message || 'Failed to generate sample payload with AI.');
    } finally {
      setIsGeneratingPayload(false);
    }
  };

  const handleRunSimulation = async () => {
    if (!organizationId || !workflowId || isSimulating) return;

    let payloadObj: Record<string, any>;
    try {
      payloadObj = JSON.parse(payloadText);
      setJsonError(null);
    } catch (err: any) {
      setJsonError(`Invalid JSON syntax: ${err.message}`);
      return;
    }

    setIsSimulating(true);
    try {
      const serialized = serializeGraph(currentNodes, currentEdges);
      const req: AISimulateExecutionRequest = {
        steps: serialized.steps as any,
        connections: serialized.connections as any,
        payload: payloadObj,
      };

      const res: AISimulateExecutionResponse = await simulateWorkflowRunWithAI(organizationId, workflowId, req);
      setSimulationResult(res);
      setActiveTab('simulation');
    } catch (err: any) {
      setJsonError(err?.message || 'Dry-run simulation request failed.');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleDispatchLive = () => {
    try {
      const obj = JSON.parse(payloadText);
      onExecuteLiveRun(obj);
    } catch (err: any) {
      setJsonError(`Invalid JSON payload: ${err.message}`);
      setActiveTab('payload');
    }
  };

  const toggleStepExpand = (stepId: string) => {
    setExpandedStepIds((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-charcoal-900 border border-warm-300 dark:border-charcoal-750 rounded-2xl shadow-modal overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-warm-200 dark:border-charcoal-800 bg-warm-50/50 dark:bg-charcoal-900">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-500/10 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-200 dark:border-teal-800/40">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">
                  AI Run Simulator & Test Dispatch
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-950/80 text-[10px] font-semibold text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                  Grok Engine
                </span>
              </div>
              <p className="text-xs text-warm-500 dark:text-charcoal-400 truncate max-w-md">
                Workflow: <span className="font-semibold">{workflowName || 'Draft Workflow'}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-700 dark:hover:text-charcoal-200 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-5 border-b border-warm-200 dark:border-charcoal-800 bg-white dark:bg-charcoal-900 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('payload')}
            className={`px-3 py-2.5 font-semibold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'payload'
                ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                : 'border-transparent text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:hover:text-charcoal-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Payload Studio</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('simulation')}
            className={`px-3 py-2.5 font-semibold border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'simulation'
                ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                : 'border-transparent text-warm-500 dark:text-charcoal-400 hover:text-warm-800 dark:hover:text-charcoal-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Simulated Dry-Run</span>
            {simulationResult && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block ml-0.5" />
            )}
          </button>
        </div>

        {/* Error Banners */}
        {runError && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
            <span>{runError}</span>
          </div>
        )}
        {jsonError && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
            <span>{jsonError}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'payload' && (
            <div className="space-y-4">
              {/* Scenario Generator Chips */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-warm-800 dark:text-charcoal-200">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    <span>AI Scenario Presets</span>
                  </span>
                  <span className="text-[11px] font-normal text-warm-500 dark:text-charcoal-400">
                    Matches your trigger schema & DAG conditions
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isGeneratingPayload}
                    onClick={() => handleGeneratePayload('happy_path')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      selectedScenario === 'happy_path'
                        ? 'bg-teal-50 dark:bg-teal-950/60 border-teal-300 dark:border-teal-700 text-teal-800 dark:text-teal-200 ring-1 ring-teal-500/20'
                        : 'bg-warm-50 dark:bg-charcoal-850 border-warm-200 dark:border-charcoal-750 text-warm-700 dark:text-charcoal-300 hover:bg-warm-100'
                    }`}
                  >
                    <span>🌟</span>
                    <span>Happy Path (Qualifying)</span>
                  </button>
                  <button
                    type="button"
                    disabled={isGeneratingPayload}
                    onClick={() => handleGeneratePayload('edge_case')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      selectedScenario === 'edge_case'
                        ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 ring-1 ring-amber-500/20'
                        : 'bg-warm-50 dark:bg-charcoal-850 border-warm-200 dark:border-charcoal-750 text-warm-700 dark:text-charcoal-300 hover:bg-warm-100'
                    }`}
                  >
                    <span>⚠️</span>
                    <span>Edge Case (Boundary)</span>
                  </button>
                  <button
                    type="button"
                    disabled={isGeneratingPayload}
                    onClick={() => handleGeneratePayload('failure')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      selectedScenario === 'failure'
                        ? 'bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200 ring-1 ring-red-500/20'
                        : 'bg-warm-50 dark:bg-charcoal-850 border-warm-200 dark:border-charcoal-750 text-warm-700 dark:text-charcoal-300 hover:bg-warm-100'
                    }`}
                  >
                    <span>🛑</span>
                    <span>Negative Branch (Rejection)</span>
                  </button>
                </div>
              </div>

              {/* Custom Prompt Generator */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Custom payload prompt (e.g. 'German company with 250 seats and $80k ARR')..."
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleGeneratePayload('custom');
                    }
                  }}
                  className="flex-1 px-3 py-1.5 bg-warm-50 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-xl text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
                />
                <button
                  type="button"
                  disabled={isGeneratingPayload}
                  onClick={() => handleGeneratePayload('custom')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold shadow-2xs transition disabled:opacity-50 cursor-pointer"
                >
                  {isGeneratingPayload ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>Generate</span>
                </button>
              </div>

              {/* AI Explanation Banner */}
              {payloadSummary && (
                <div className="p-2.5 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/40 text-xs text-teal-800 dark:text-teal-200 flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-teal-600 dark:text-teal-400" />
                  <span>{payloadSummary}</span>
                </div>
              )}

              {/* JSON Editor & Actions */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-warm-800 dark:text-charcoal-200 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-warm-500" />
                    <span>Input JSON Payload</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleFormatPayload}
                      className="text-[11px] font-mono text-warm-600 dark:text-charcoal-300 hover:underline cursor-pointer"
                    >
                      Format JSON
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyPayload}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-warm-600 dark:text-charcoal-300 hover:underline cursor-pointer"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
                <textarea
                  rows={9}
                  value={payloadText}
                  onChange={(e) => {
                    setPayloadText(e.target.value);
                    if (jsonError) setJsonError(null);
                  }}
                  className="w-full p-3 bg-warm-50 dark:bg-charcoal-950 border border-warm-300 dark:border-charcoal-750 rounded-xl text-xs font-mono text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600 transition-all resize-none shadow-2xs"
                />
              </div>
            </div>
          )}

          {activeTab === 'simulation' && (
            <div className="space-y-4">
              {!simulationResult ? (
                <div className="text-center py-10 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 mx-auto flex items-center justify-center border border-teal-200 dark:border-teal-800/40">
                    <Play className="w-6 h-6 fill-current" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-warm-900 dark:text-charcoal-100">
                      No Simulation Run Yet
                    </h4>
                    <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-1 max-w-sm mx-auto">
                      Click "Simulate Dry-Run" below to evaluate DAG branch decisions and step outputs non-destructively against your payload.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isSimulating}
                    onClick={handleRunSimulation}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-subtle transition cursor-pointer"
                  >
                    {isSimulating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>Run Simulation Now</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Overall Outcome Banner */}
                  <div
                    className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                      simulationResult.overall_outcome === 'COMPLETED'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-100'
                        : simulationResult.overall_outcome === 'PENDING_APPROVAL'
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-100'
                        : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-900 dark:text-red-100'
                    }`}
                  >
                    {simulationResult.overall_outcome === 'COMPLETED' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                    ) : simulationResult.overall_outcome === 'PENDING_APPROVAL' ? (
                      <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Outcome: {simulationResult.overall_outcome.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[11px] opacity-75 font-mono">
                          ({simulationResult.latency_ms}ms)
                        </span>
                      </div>
                      <p className="text-xs mt-0.5 leading-relaxed">
                        {simulationResult.simulation_summary}
                      </p>
                    </div>
                  </div>

                  {/* Step-by-Step Traversal Timeline */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-bold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
                      Simulated Traversal ({simulationResult.steps.length} Steps)
                    </h5>
                    <div className="space-y-2">
                      {simulationResult.steps.map((st, idx) => {
                        const isExpanded = !!expandedStepIds[st.step_id];
                        return (
                          <div
                            key={st.step_id || idx}
                            className={`rounded-xl border transition-all overflow-hidden ${
                              st.status === 'SKIPPED'
                                ? 'bg-warm-100/50 dark:bg-charcoal-850/50 border-warm-200 dark:border-charcoal-800 opacity-60'
                                : st.status === 'WAITING_APPROVAL'
                                ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'
                                : st.status === 'FAILED'
                                ? 'bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-800/40'
                                : 'bg-white dark:bg-charcoal-900 border-warm-200 dark:border-charcoal-750'
                            }`}
                          >
                            <div
                              onClick={() => toggleStepExpand(st.step_id)}
                              className="p-3 flex items-center justify-between cursor-pointer hover:bg-warm-50 dark:hover:bg-charcoal-800/60 transition"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="w-5 h-5 rounded-full bg-warm-200 dark:bg-charcoal-800 text-[10px] font-bold text-warm-700 dark:text-charcoal-300 flex items-center justify-center flex-shrink-0">
                                  {idx + 1}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-warm-900 dark:text-charcoal-100 truncate">
                                      {st.step_name}
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-warm-100 dark:bg-charcoal-800 text-warm-600 dark:text-charcoal-400">
                                      {st.step_type}
                                    </span>
                                    {st.branch_taken && (
                                      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                        Branch: {st.branch_taken}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-warm-600 dark:text-charcoal-300 mt-0.5 line-clamp-1">
                                    {st.reasoning}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    st.status === 'SUCCESS'
                                      ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300'
                                      : st.status === 'WAITING_APPROVAL'
                                      ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300'
                                      : st.status === 'SKIPPED'
                                      ? 'bg-warm-200 dark:bg-charcoal-800 text-warm-600 dark:text-charcoal-400'
                                      : 'bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-300'
                                  }`}
                                >
                                  {st.status}
                                </span>
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-warm-400" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-warm-400" />
                                )}
                              </div>
                            </div>

                            {/* Expanded Output Details */}
                            {isExpanded && (
                              <div className="p-3 border-t border-warm-200 dark:border-charcoal-800 bg-warm-50 dark:bg-charcoal-950 text-xs space-y-2">
                                <div>
                                  <span className="font-semibold text-warm-700 dark:text-charcoal-300">
                                    Reasoning:
                                  </span>{' '}
                                  <span className="text-warm-800 dark:text-charcoal-200">
                                    {st.reasoning}
                                  </span>
                                </div>
                                {st.simulated_output && Object.keys(st.simulated_output).length > 0 && (
                                  <div>
                                    <span className="font-semibold text-warm-700 dark:text-charcoal-300 block mb-1">
                                      Simulated Output:
                                    </span>
                                    <pre className="p-2.5 rounded-lg bg-warm-100 dark:bg-charcoal-900 text-[11px] font-mono overflow-x-auto text-warm-900 dark:text-charcoal-100">
                                      {JSON.stringify(st.simulated_output, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-warm-200 dark:border-charcoal-800 bg-warm-50/60 dark:bg-charcoal-900">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSimulating}
              onClick={handleRunSimulation}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800/80 text-teal-800 dark:text-teal-200 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
            >
              {isSimulating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              )}
              <span>Simulate Dry-Run</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-100 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isRunningLive || isSimulating || !parsedPayload}
              onClick={handleDispatchLive}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-subtle transition disabled:opacity-50 cursor-pointer"
            >
              {isRunningLive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Execute Live Run</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
