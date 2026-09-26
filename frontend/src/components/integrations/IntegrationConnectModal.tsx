import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Lock,
  MessageSquare,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  Integration,
  IntegrationCreatePayload,
  IntegrationTestResult,
  IntegrationType,
  IntegrationUpdatePayload,
} from '../../types/integration';
import { testIntegration } from '../../services/integrationService';

interface IntegrationConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  integrationType: IntegrationType;
  existingIntegration?: Integration | null;
  organizationId: string;
  userRole?: string;
  onSave: (payload: IntegrationCreatePayload | IntegrationUpdatePayload) => Promise<void>;
  isSubmitting?: boolean;
}

export const IntegrationConnectModal: React.FC<IntegrationConnectModalProps> = ({
  isOpen,
  onClose,
  integrationType,
  existingIntegration,
  organizationId,
  userRole = 'VIEWER',
  onSave,
  isSubmitting = false,
}) => {
  const [name, setName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [channel, setChannel] = useState('#general');
  const [mockMode, setMockMode] = useState(false);
  const [simulatedLatency, setSimulatedLatency] = useState(15);
  const [apiKey, setApiKey] = useState('');

  const [testResult, setTestResult] = useState<IntegrationTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = ['OWNER', 'ADMIN'].includes(userRole.toUpperCase());
  const isEditing = !!existingIntegration;

  useEffect(() => {
    if (existingIntegration) {
      setName(existingIntegration.name);
      if (existingIntegration.type === 'SLACK') {
        setChannel(existingIntegration.config?.channel || '#general');
        setMockMode(!!existingIntegration.config?.mock_mode);
        setWebhookUrl('');
      } else {
        setSimulatedLatency(existingIntegration.config?.simulated_latency_ms ?? 15);
        setApiKey('');
      }
    } else {
      setName(integrationType === 'SLACK' ? 'Team Slack Alerts' : 'Production CRM Simulator');
      setChannel('#general');
      setMockMode(false);
      setSimulatedLatency(15);
      setWebhookUrl('');
      setApiKey('');
    }
    setTestResult(null);
    setErrorMessage(null);
  }, [existingIntegration, integrationType, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    setErrorMessage(null);

    const credentials: Record<string, any> = {};
    const config: Record<string, any> = {};

    if (integrationType === 'SLACK') {
      config.channel = channel.trim() || '#general';
      config.mock_mode = mockMode;
      if (webhookUrl.trim()) {
        credentials.webhook_url = webhookUrl.trim();
      }
    } else {
      config.simulated_latency_ms = Number(simulatedLatency) || 0;
      if (apiKey.trim()) {
        credentials.api_key = apiKey.trim();
      }
    }

    try {
      if (isEditing) {
        const payload: IntegrationUpdatePayload = {
          name: name.trim(),
          config,
        };
        if (Object.keys(credentials).length > 0) {
          payload.credentials = credentials;
        }
        await onSave(payload);
      } else {
        const payload: IntegrationCreatePayload = {
          name: name.trim(),
          type: integrationType,
          credentials,
          config,
        };
        await onSave(payload);
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save integration.');
    }
  };

  const handleTestExisting = async () => {
    if (!existingIntegration) return;
    setIsTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      const res = await testIntegration(organizationId, existingIntegration.id);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        status: 'error',
        latency_ms: 0,
        message: err.message || 'Handshake failed',
        tested_at: new Date().toISOString(),
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              {integrationType === 'SLACK' ? (
                <MessageSquare className="w-5 h-5" />
              ) : (
                <Building2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                {isEditing ? 'Configure Integration' : 'Connect Integration'}
              </h2>
              <p className="text-xs text-slate-400">
                {integrationType === 'SLACK'
                  ? 'Slack Webhook & Block Kit Notifications'
                  : 'High-Fidelity CRM Simulator & Deduplication'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {!canManage && (
            <div className="flex items-start space-x-2.5 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Insufficient Permissions:</span> Your role is <span className="font-semibold uppercase">{userRole}</span>. Only organization <span className="font-semibold">OWNER</span> or <span className="font-semibold">ADMIN</span> can configure or update credentials.
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
              {errorMessage}
            </div>
          )}

          {/* Integration Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Integration Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage || isSubmitting}
              placeholder="e.g. Sales Team Slack"
              className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Slack Specific Fields */}
          {integrationType === 'SLACK' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Incoming Webhook URL
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    disabled={!canManage || isSubmitting}
                    placeholder={
                      existingIntegration?.has_credentials
                        ? '•••••••• (configured, enter new URL to rotate)'
                        : 'https://hooks.slack.com/services/T00/B00/XXXX'
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Credentials are encrypted at rest with AES-256-GCM. Never exposed in API responses.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Default Channel
                </label>
                <input
                  type="text"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  disabled={!canManage || isSubmitting}
                  placeholder="#leads-hot"
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="mock-mode-toggle"
                  checked={mockMode}
                  onChange={(e) => setMockMode(e.target.checked)}
                  disabled={!canManage || isSubmitting}
                  className="rounded border-slate-800 text-indigo-500 focus:ring-indigo-500"
                />
                <label htmlFor="mock-mode-toggle" className="text-xs text-slate-300">
                  Simulate Delivery (Mock mode without outbound HTTP network call)
                </label>
              </div>
            </>
          )}

          {/* Mock CRM Specific Fields */}
          {integrationType === 'MOCK_CRM' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Simulated Network Latency (ms)
                </label>
                <input
                  type="number"
                  min="0"
                  max="2000"
                  value={simulatedLatency}
                  onChange={(e) => setSimulatedLatency(Number(e.target.value))}
                  disabled={!canManage || isSubmitting}
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Simulates realistic round-trip cloud CRM latency (HubSpot/Salesforce).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Simulated API Key / Secret (Optional)
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={!canManage || isSubmitting}
                    placeholder={
                      existingIntegration?.has_credentials
                        ? '•••••••• (configured, enter new value to rotate)'
                        : 'sk-crm-prod-secret'
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
                </div>
              </div>
            </>
          )}

          {/* Diagnostic Test Result */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start space-x-2.5 ${
                testResult.status === 'healthy'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
              }`}
            >
              {testResult.status === 'healthy' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-semibold">
                  {testResult.status === 'healthy' ? 'Handshake Verified' : 'Connection Failed'} ({testResult.latency_ms}ms)
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">{testResult.message}</div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            {isEditing && (
              <button
                type="button"
                onClick={handleTestExisting}
                disabled={isTesting || isSubmitting}
                className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50"
              >
                {isTesting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-indigo-400" />
                )}
                <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
              </button>
            )}

            <div className="flex items-center space-x-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canManage || isSubmitting}
                className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-600/25 transition-colors disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Saving...' : isEditing ? 'Update Integration' : 'Connect'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
