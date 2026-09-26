import React from 'react';
import { Node } from '@xyflow/react';
import {
  X,
  Trash2,
  Sliders,
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
  if (!selectedNode) {
    return (
      <div className="w-80 bg-slate-950 border-l border-slate-800 p-6 flex flex-col items-center justify-center text-center text-slate-500">
        <Sliders className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-xs">Select a step on the canvas to configure parameters</p>
      </div>
    );
  }

  const { id, data } = selectedNode;
  const stepType = data.step_type;
  const config = data.config || {};

  const handleConfigChange = (key: string, value: any) => {
    onUpdateNode(id, {
      config: {
        ...config,
        [key]: value,
      },
    });
  };

  const handleBasicChange = (field: 'name' | 'step_key', value: string) => {
    onUpdateNode(id, {
      [field]: value,
    });
  };

  const renderStepSpecificForm = () => {
    switch (stepType) {
      case StepType.WEBHOOK_TRIGGER:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                HMAC Secret Token (Optional)
              </label>
              <input
                type="password"
                placeholder="whsec_..."
                value={config.secret_token || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('secret_token', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Allowed HTTP Methods
              </label>
              <div className="flex gap-2">
                {['POST', 'PUT', 'GET'].map((m) => {
                  const methods = config.allowed_methods || ['POST'];
                  const isChecked = methods.includes(m);
                  return (
                    <label
                      key={m}
                      className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isReadOnly}
                        onChange={(e) => {
                          if (e.target.checked) {
                            handleConfigChange('allowed_methods', [...methods, m]);
                          } else {
                            handleConfigChange(
                              'allowed_methods',
                              methods.filter((x: string) => x !== m)
                            );
                          }
                        }}
                        className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                      />
                      <span>{m}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case StepType.MANUAL_TRIGGER:
        return (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400">
              Manual triggers accept test JSON payloads during interactive testing.
            </p>
          </div>
        );

      case StepType.AI_CLASSIFICATION:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Target Model
              </label>
              <select
                value={config.model || 'gpt-4o-mini'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="gpt-4o-mini">gpt-4o-mini (Fast & Efficient)</option>
                <option value="gpt-4o">gpt-4o (High Reasoning)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Prompt / Instructions
              </label>
              <textarea
                rows={3}
                placeholder="Classify the incoming lead intent based on company size and message..."
                value={config.prompt || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('prompt', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-purple-500 resize-none font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Candidate Categories (comma separated)
              </label>
              <input
                type="text"
                placeholder="enterprise, mid_market, smb, spam"
                value={(config.categories || []).join(', ')}
                disabled={isReadOnly}
                onChange={(e) =>
                  handleConfigChange(
                    'categories',
                    e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  )
                }
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-medium text-slate-300">
                  Confidence Threshold
                </label>
                <span className="text-[10px] text-purple-400 font-mono">
                  {config.confidence_threshold ?? 0.7}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={config.confidence_threshold ?? 0.7}
                disabled={isReadOnly}
                onChange={(e) =>
                  handleConfigChange('confidence_threshold', parseFloat(e.target.value))
                }
                className="w-full accent-purple-500 cursor-pointer"
              />
            </div>
          </div>
        );

      case StepType.CONDITION:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Context Field Path
              </label>
              <input
                type="text"
                placeholder="steps.classify.output.category"
                value={config.field || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('field', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Comparison Operator
              </label>
              <select
                value={config.operator || 'equals'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('operator', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              >
                <option value="equals">Equals (==)</option>
                <option value="not_equals">Not Equals (!=)</option>
                <option value="contains">Contains</option>
                <option value="greater_than">Greater Than (&gt;)</option>
                <option value="less_than">Less Than (&lt;)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Target Value
              </label>
              <input
                type="text"
                placeholder="enterprise"
                value={config.value || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('value', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        );

      case StepType.VALIDATE_DATA:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Required Fields (comma separated)
              </label>
              <input
                type="text"
                placeholder="email, full_name, plan"
                value={(config.required_fields || []).join(', ')}
                disabled={isReadOnly}
                onChange={(e) =>
                  handleConfigChange(
                    'required_fields',
                    e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  )
                }
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        );

      case StepType.MOCK_CRM_CREATE:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Target Entity Type
              </label>
              <select
                value={config.entity_type || 'lead'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('entity_type', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-teal-500"
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
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Target Slack Channel
              </label>
              <input
                type="text"
                placeholder="#sales-alerts"
                value={config.channel || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('channel', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Message Content / Template
              </label>
              <textarea
                rows={3}
                placeholder="New lead received: {{steps.validate.output.email}}"
                value={config.message || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('message', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none font-mono"
              />
            </div>
          </div>
        );

      case StepType.HUMAN_APPROVAL:
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Required Approver Role
              </label>
              <select
                value={config.approver_role || 'MANAGER'}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('approver_role', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-rose-500"
              >
                <option value="MANAGER">Manager or higher</option>
                <option value="ADMIN">Admin or higher</option>
                <option value="OWNER">Owner only</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Approval Request Title
              </label>
              <input
                type="text"
                placeholder="High-Value Enterprise Lead Review"
                value={config.title || ''}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('title', e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Expiration Timeout (Hours)
              </label>
              <input
                type="number"
                min={1}
                max={720}
                value={config.timeout_hours || 24}
                disabled={isReadOnly}
                onChange={(e) => handleConfigChange('timeout_hours', parseInt(e.target.value, 10) || 24)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="w-80 bg-slate-950 border-l border-slate-800 flex flex-col h-full select-none">
      {/* Panel Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
            Step Configuration
          </h3>
          <span className="text-[10px] font-mono text-cyan-400 block mt-0.5">
            {stepType}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!isReadOnly && (
            <button
              type="button"
              onClick={() => onDeleteNode(id)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
              title="Delete Step"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close Panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Core Attributes */}
        <div className="space-y-3 pb-4 border-b border-slate-800/80">
          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Step Label / Name
            </label>
            <input
              type="text"
              value={data.name || ''}
              disabled={isReadOnly}
              onChange={(e) => handleBasicChange('name', e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Step Key (DAG Identifier)
            </label>
            <input
              type="text"
              value={data.step_key || ''}
              disabled={isReadOnly}
              onChange={(e) => handleBasicChange('step_key', e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Step-Specific Configuration Form */}
        <div className="space-y-2">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            Execution Parameters
          </span>
          {renderStepSpecificForm()}
        </div>
      </div>
    </div>
  );
};
