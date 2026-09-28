import React from 'react';
import { Node } from '@xyflow/react';
import {
  X,
  Trash2,
} from 'lucide-react';
import { StepType } from '../../../types/workflow';
import { WorkflowNodeData } from '../../../utils/workflowGraphValidator';

interface NodeConfigPanelProps {
  selectedNode: Node<WorkflowNodeData> | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  onDeleteNode: (nodeId: string) => void;
  isReadOnly?: boolean;
}

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({
  selectedNode,
  onClose,
  onUpdateNode,
  onDeleteNode,
  isReadOnly = false,
}) => {
  if (!selectedNode) return null;

  const { id, data } = selectedNode;
  const stepType = data.step_type;
  const config = data.config || {};

  const handleBasicChange = (field: 'name' | 'step_key', value: string) => {
    onUpdateNode(id, { [field]: value });
  };

  const handleConfigChange = (field: string, value: any) => {
    onUpdateNode(id, {
      config: {
        ...config,
        [field]: value,
      },
    });
  };

  const renderStepSpecificForm = () => {
    switch (stepType) {
      case StepType.WEBHOOK_TRIGGER:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Allowed HTTP Methods
              </label>
              <div className="flex gap-2">
                {['POST', 'GET', 'PUT'].map((method) => {
                  const allowed = config.allowed_methods || ['POST'];
                  const isChecked = allowed.includes(method);
                  return (
                    <label
                      key={method}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono cursor-pointer transition ${
                        isChecked
                          ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
                          : 'border-warm-300 dark:border-charcoal-700 bg-white dark:bg-charcoal-850 text-warm-600 dark:text-charcoal-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isReadOnly}
                        checked={isChecked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...allowed, method]
                            : allowed.filter((m: string) => m !== method);
                          handleConfigChange('allowed_methods', next.length ? next : ['POST']);
                        }}
                        className="hidden"
                      />
                      <span>{method}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case StepType.CONDITION:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Evaluation Field (dot-notated)
              </label>
              <input
                type="text"
                placeholder="payload.score"
                value={config.field || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('field', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 font-mono focus:outline-none focus:border-brand-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Operator
              </label>
              <select
                value={config.operator || 'eq'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('operator', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              >
                <option value="eq">Equal (==)</option>
                <option value="neq">Not Equal (!=)</option>
                <option value="gt">Greater Than (&gt;)</option>
                <option value="gte">Greater Than or Equal (&gt;=)</option>
                <option value="lt">Less Than (&lt;)</option>
                <option value="lte">Less Than or Equal (&lt;=)</option>
                <option value="contains">Contains</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Comparison Target Value
              </label>
              <input
                type="text"
                placeholder="e.g. 50, enterprise, true"
                value={config.value !== undefined ? String(config.value) : ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('value', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              />
            </div>
          </div>
        );

      case StepType.AI_CLASSIFICATION:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                AI Classification Model
              </label>
              <select
                value={config.model || 'gpt-4o-mini'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              >
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Prompt / Instructions
              </label>
              <textarea
                rows={3}
                placeholder="Classify this lead as ENTERPRISE, SMB, or CONSUMER based on company size and message."
                value={config.prompt || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('prompt', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600 resize-none font-mono"
              />
            </div>
          </div>
        );

      case StepType.VALIDATE_DATA:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Required Fields (comma-separated)
              </label>
              <input
                type="text"
                placeholder="email, name, company"
                value={(config.required_fields || []).join(', ')}
                disabled={isReadOnly}
                onChange={(e) =>
                  handleConfigChange(
                    'required_fields',
                    e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  )
                }
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              />
            </div>
          </div>
        );

      case StepType.MOCK_CRM_CREATE:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Target Entity Type
              </label>
              <select
                value={config.entity_type || 'lead'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('entity_type', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              >
                <option value="lead">Lead</option>
                <option value="contact">Contact</option>
                <option value="deal">Deal</option>
              </select>
            </div>
          </div>
        );

      case StepType.SLACK_NOTIFICATION:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Target Slack Channel
              </label>
              <input
                type="text"
                placeholder="#sales-alerts"
                value={config.channel || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('channel', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Message Content / Template
              </label>
              <textarea
                rows={3}
                placeholder="New lead received: {{steps.validate.output.email}}"
                value={config.message || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('message', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600 resize-none font-mono"
              />
            </div>
          </div>
        );

      case StepType.HUMAN_APPROVAL:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Required Approver Role
              </label>
              <select
                value={config.approver_role || 'MANAGER'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('approver_role', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              >
                <option value="MANAGER">Manager or higher</option>
                <option value="ADMIN">Admin or higher</option>
                <option value="OWNER">Owner only</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Approval Request Title
              </label>
              <input
                type="text"
                placeholder="High-Value Enterprise Lead Review"
                value={config.title || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('title', e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
                Expiration Timeout (Hours)
              </label>
              <input
                type="number"
                min={1}
                max={720}
                value={config.timeout_hours || 24}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('timeout_hours', parseInt(e.target.value, 10) || 24)}
                className="w-full px-3 py-1.5 bg-white dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600"
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs md:hidden z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] md:relative md:inset-auto md:max-h-full md:z-auto w-full md:w-80 bg-white dark:bg-charcoal-900 border-t md:border-t-0 md:border-l border-warm-300 dark:border-charcoal-750 rounded-t-2xl md:rounded-none shadow-elevated md:shadow-subtle flex flex-col select-none transition-all duration-200">
        {/* Mobile Pull Handle */}
        <div className="w-10 h-1 bg-warm-300 dark:bg-charcoal-700 rounded-full mx-auto mt-2 mb-1 md:hidden flex-shrink-0" />

        {/* Panel Header */}
        <div className="p-3.5 sm:p-4 border-b border-warm-200 dark:border-charcoal-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 className="text-xs font-semibold text-warm-900 dark:text-charcoal-100 uppercase tracking-wider">
            Step Configuration
          </h3>
          <span className="text-[10px] font-mono text-brand-600 dark:text-brand-400 block mt-0.5">
            {stepType}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!isReadOnly && (
            <button
              type="button"
              onClick={() => onDeleteNode(id)}
              className="p-1.5 rounded-lg text-warm-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
              title="Delete Step"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-700 dark:hover:text-charcoal-200 hover:bg-warm-100 dark:hover:bg-charcoal-800 transition"
            title="Close Panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Core Attributes */}
        <div className="space-y-3 pb-4 border-b border-warm-200 dark:border-charcoal-800">
          <div>
            <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
              Step Label / Name
            </label>
            <input
              type="text"
              value={data.name || ''}
              disabled={isReadOnly}
              onChange={(e) => handleBasicChange('name', e.target.value)}
              className="w-full px-3 py-1.5 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/20"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-warm-700 dark:text-charcoal-300 mb-1">
              Step Key (DAG Identifier)
            </label>
            <input
              type="text"
              value={data.step_key || ''}
              disabled={isReadOnly}
              onChange={(e) => handleBasicChange('step_key', e.target.value)}
              className="w-full px-3 py-1.5 bg-warm-50 dark:bg-charcoal-850 border border-warm-300 dark:border-charcoal-700 rounded-lg text-xs text-warm-900 dark:text-charcoal-100 font-mono focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
        </div>

        {/* Step-Specific Configuration Form */}
        <div className="space-y-2">
          <span className="text-[10px] font-semibold text-warm-500 dark:text-charcoal-400 uppercase tracking-wider block mb-2">
            Execution Parameters
          </span>
          {renderStepSpecificForm()}
        </div>
      </div>
    </div>
  </>
  );
};