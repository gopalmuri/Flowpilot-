import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles,
  X,
  Send,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Eye,
  Check,
  ArrowRight,
  Layers,
  HelpCircle,
  Undo2,
  Square,
} from 'lucide-react';
import {
  AIChatMessage,
  AIWorkflowAssistRequest,
  AIWorkflowAssistResponse,
  AIWorkflowProposal,
  AITemplateSuggestion,
} from '../../../types/workflowAI';
import { Node, Edge } from '@xyflow/react';
import { WorkflowNodeData, WorkflowEdgeData } from '../../../utils/workflowGraphValidator';
import { serializeGraph } from '../../../utils/workflowGraphMapper';
import { assistWorkflowWithAI } from '../../../services/workflowService';


interface AIWorkflowAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  workflowId: string;
  workflowName?: string;
  workflowDescription?: string;
  currentNodes: Node<WorkflowNodeData>[];
  currentEdges: Edge<WorkflowEdgeData>[];
  isPreviewing: boolean;
  onPreview: (proposal: AIWorkflowProposal) => void;
  onDiscardPreview: () => void;
  onApplyProposal: (proposal: AIWorkflowProposal) => void;
  canUndo: boolean;
  onUndo: () => void;
  initialPrompt?: string | null;
  onClearInitialPrompt?: () => void;
}

export const AIWorkflowAssistantDrawer: React.FC<AIWorkflowAssistantDrawerProps> = ({
  isOpen,
  onClose,
  organizationId,
  workflowId,
  workflowName,
  workflowDescription,
  currentNodes,
  currentEdges,
  isPreviewing,
  onPreview,
  onDiscardPreview,
  onApplyProposal,
  canUndo,
  onUndo,
  initialPrompt,
  onClearInitialPrompt,
}) => {

  const [messages, setMessages] = useState<AIChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi! I am your AI Workflow Architect. Describe what you want to automate in plain English (e.g. "Ingest website leads, classify with AI, and require manager sign-off before CRM"), and I will generate the complete workflow DAG for you.',
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeProposal, setActiveProposal] = useState<AIWorkflowProposal | null>(null);
  const [clarificationQuestions, setClarificationQuestions] = useState<any[]>([]);
  const [templateSuggestions, setTemplateSuggestions] = useState<AITemplateSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };


  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      textareaRef.current?.focus();
    }
  }, [isOpen, messages, isLoading]);

  const handleSendPrompt = useCallback(
    async (promptToSend?: string) => {
      const text = (promptToSend || inputPrompt).trim();
      if (!text || isLoading) return;

      setError(null);
      setInputPrompt('');
      setClarificationQuestions([]);

      // Add user message to thread
      const updatedMessages: AIChatMessage[] = [
        ...messages,
        { role: 'user', content: text },
      ];
      setMessages(updatedMessages);
      setIsLoading(true);

      // Serialize current graph from canvas
      const serialized = serializeGraph(currentNodes, currentEdges);

      const requestPayload: AIWorkflowAssistRequest = {
        prompt: text,
        conversation_history: updatedMessages,
        current_steps: serialized.steps as any,
        current_connections: serialized.connections as any,
        workflow_name: workflowName,
        workflow_description: workflowDescription,
      };

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response: AIWorkflowAssistResponse = await assistWorkflowWithAI(
          organizationId,
          workflowId,
          requestPayload,
          controller.signal
        );

        // Add assistant response to messages
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: response.message },
        ]);

        if (response.proposal) {
          setActiveProposal(response.proposal);
        }

        if (response.clarification_questions?.length) {
          setClarificationQuestions(response.clarification_questions);
        }

        if (response.template_suggestions?.length) {
          setTemplateSuggestions(response.template_suggestions);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: 'Request was cancelled.' },
          ]);
        } else {
          const errMsg = err.message || 'Failed to generate workflow. Please try again.';
          setError(errMsg);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `⚠️ Error: ${errMsg}` },
          ]);
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [
      inputPrompt,
      isLoading,
      messages,
      currentNodes,
      currentEdges,
      organizationId,
      workflowId,
      workflowName,
      workflowDescription,
    ]
  );

  useEffect(() => {
    if (isOpen && initialPrompt) {
      handleSendPrompt(initialPrompt);
      onClearInitialPrompt?.();
    }
  }, [isOpen, initialPrompt, handleSendPrompt, onClearInitialPrompt]);

  const handleCancelRequest = () => {

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSelectOption = (option: string) => {
    handleSendPrompt(option);
  };

  const handleSelectTemplate = (template: AITemplateSuggestion) => {
    handleSendPrompt(template.prompt);
  };

  const handleApply = () => {
    if (activeProposal) {
      onApplyProposal(activeProposal);
      setActiveProposal(null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '✅ Changes applied to your canvas! You can save this version or continue refining.',
        },
      ]);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        role: 'assistant',
        content:
          'Chat reset. Describe any workflow and I will design or modify the DAG for you.',
      },
    ]);
    setActiveProposal(null);
    setClarificationQuestions([]);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[460px] bg-white dark:bg-charcoal-900 border-l border-warm-200 dark:border-charcoal-800 shadow-2xl flex flex-col transition-all duration-300"
      aria-label="AI Workflow Assistant"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-warm-200 dark:border-charcoal-800 bg-warm-50/70 dark:bg-charcoal-850/80">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800/60 shadow-2xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">
                AI Workflow Assistant
              </h2>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/50">
                Grok AI
              </span>
            </div>
            <p className="text-[11px] text-warm-500 dark:text-charcoal-400">
              Natural language workflow generator &amp; refiner
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="p-1.5 rounded-md text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
              title="Undo last applied AI changes"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleClearChat}
            className="p-1.5 rounded-md text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
            title="Reset conversation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-warm-600 dark:text-charcoal-400 hover:text-warm-900 dark:hover:text-charcoal-200 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition cursor-pointer"
            title="Close Assistant"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 leading-relaxed shadow-2xs ${
                msg.role === 'user'
                  ? 'bg-brand-600 text-white dark:bg-brand-500'
                  : 'bg-warm-100 dark:bg-charcoal-800 text-warm-900 dark:text-charcoal-100 border border-warm-200 dark:border-charcoal-750'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {/* Loading Spinner Indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-warm-100 dark:bg-charcoal-800 text-warm-600 dark:text-charcoal-300 w-fit border border-warm-200 dark:border-charcoal-750">
            <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" />
            <span className="text-xs font-medium">Grok is designing workflow...</span>
          </div>
        )}

        {/* Clarification Questions (Quick Chips) */}
        {clarificationQuestions.length > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 space-y-2.5 animate-fadeIn">
            <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-semibold text-xs">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Clarification Needed:</span>
            </div>
            {clarificationQuestions.map((q) => (
              <div key={q.id} className="space-y-1.5">
                <p className="text-[11px] text-warm-700 dark:text-charcoal-300">{q.question}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {q.options?.map((opt: string, optIdx: number) => (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => handleSelectOption(opt)}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white dark:bg-charcoal-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/60 shadow-2xs transition cursor-pointer"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Proposal Card (Diff + Preview + Apply Flow) */}
        {activeProposal && (
          <div className="p-4 rounded-xl bg-warm-50 dark:bg-charcoal-850 border border-teal-200 dark:border-teal-800/60 space-y-3.5 shadow-subtle animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-teal-800 dark:text-teal-300 font-semibold text-xs">
                <Layers className="w-4 h-4" />
                <span>Proposed Workflow DAG</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  activeProposal.valid
                    ? 'bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300'
                    : 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                }`}
              >
                {activeProposal.valid ? 'Valid DAG' : 'Validation Issues'}
              </span>
            </div>

            {/* Diff Summary Breakdown */}
            <div className="space-y-1.5 text-[11px]">
              {activeProposal.diff_summary?.added_steps?.length > 0 && (
                <div className="text-teal-700 dark:text-teal-400 flex items-start gap-1">
                  <span className="font-bold">+ Added:</span>
                  <span>{activeProposal.diff_summary.added_steps.join(', ')}</span>
                </div>
              )}
              {activeProposal.diff_summary?.modified_steps?.length > 0 && (
                <div className="text-amber-700 dark:text-amber-400 flex items-start gap-1">
                  <span className="font-bold">~ Modified:</span>
                  <span>{activeProposal.diff_summary.modified_steps.join(', ')}</span>
                </div>
              )}
              {activeProposal.diff_summary?.removed_steps?.length > 0 && (
                <div className="text-red-700 dark:text-red-400 flex items-start gap-1">
                  <span className="font-bold">- Removed:</span>
                  <span>{activeProposal.diff_summary.removed_steps.join(', ')}</span>
                </div>
              )}
              {activeProposal.diff_summary?.reconnected_edges?.length > 0 && (
                <div className="text-warm-600 dark:text-charcoal-400 flex items-start gap-1">
                  <span className="font-bold">↔ Connections:</span>
                  <span>{activeProposal.diff_summary.reconnected_edges.slice(0, 3).join(', ')}</span>
                </div>
              )}
            </div>

            {/* Action Buttons: Preview and Apply */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => (isPreviewing ? onDiscardPreview() : onPreview(activeProposal))}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  isPreviewing
                    ? 'bg-teal-100 dark:bg-teal-950/80 border-teal-300 dark:border-teal-700 text-teal-800 dark:text-teal-200'
                    : 'bg-white dark:bg-charcoal-800 border-warm-300 dark:border-charcoal-700 hover:bg-warm-100 dark:hover:bg-charcoal-750 text-warm-800 dark:text-charcoal-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{isPreviewing ? 'Stop Preview' : 'Preview on Canvas'}</span>
              </button>

              <button
                type="button"
                onClick={handleApply}
                disabled={!activeProposal.valid}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white shadow-2xs transition disabled:opacity-40 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Changes</span>
              </button>
            </div>
          </div>
        )}

        {/* Template Suggestions Cards */}
        {templateSuggestions.length > 0 && (
          <div className="space-y-2 pt-2">
            <span className="text-[11px] font-semibold text-warm-500 dark:text-charcoal-400 uppercase tracking-wider">
              Recommended Starters:
            </span>
            <div className="grid gap-2">
              {templateSuggestions.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tmpl)}
                  className="w-full text-left p-3 rounded-xl bg-warm-50 dark:bg-charcoal-850 hover:bg-warm-100 dark:hover:bg-charcoal-800 border border-warm-200 dark:border-charcoal-750 transition cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-xs text-warm-900 dark:text-charcoal-100 group-hover:text-brand-600 dark:group-hover:text-brand-400">
                      {tmpl.title}
                    </h3>
                    <ArrowRight className="w-3.5 h-3.5 text-warm-400 group-hover:translate-x-0.5 transition" />
                  </div>
                  <p className="text-[11px] text-warm-500 dark:text-charcoal-400 mt-1 line-clamp-2">
                    {tmpl.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form Bar */}
      <div className="p-3 border-t border-warm-200 dark:border-charcoal-800 bg-warm-50/50 dark:bg-charcoal-900">
        {error && (
          <div className="mb-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <div className="flex items-end gap-2 bg-white dark:bg-charcoal-800 rounded-xl border border-warm-300 dark:border-charcoal-700 p-2 shadow-2xs focus-within:border-brand-500 dark:focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-500">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="E.g. If lead is high value, require manager sign-off..."
            className="flex-1 resize-none bg-transparent text-xs text-warm-900 dark:text-charcoal-100 placeholder-warm-400 dark:placeholder-charcoal-500 focus:outline-none leading-relaxed"
          />

          {isLoading ? (
            <button
              type="button"
              onClick={handleCancelRequest}
              className="p-2 rounded-lg bg-warm-200 dark:bg-charcoal-700 hover:bg-warm-300 dark:hover:bg-charcoal-600 text-warm-700 dark:text-charcoal-200 transition cursor-pointer"
              title="Cancel generation"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!inputPrompt.trim()}
              onClick={() => handleSendPrompt()}
              className="p-2 rounded-lg bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 text-white transition disabled:opacity-30 cursor-pointer"
              title="Send to Grok"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-warm-400 dark:text-charcoal-500 text-center">
          Press Enter to send · Changes preview first before applying to canvas
        </p>
      </div>
    </aside>
  );
};
