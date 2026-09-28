import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Lock,
  MessageSquare,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  Integration,
  IntegrationCreatePayload,
  IntegrationType,
  IntegrationUpdatePayload,
} from '../../types/integration';
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  testIntegration,
  updateIntegration,
} from '../../services/integrationService';
import { IntegrationConnectModal } from '../../components/integrations/IntegrationConnectModal';

export const IntegrationsPage: React.FC = () => {
  const { activeOrganization, activeRole } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedType, setSelectedType] = useState<IntegrationType>('SLACK');
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { status: string; latency_ms: number; message: string }>>({});
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const orgId = activeOrganization?.id;
  const canManage = ['OWNER', 'ADMIN'].includes(activeRole?.toUpperCase() || '');
  const canTest = ['OWNER', 'ADMIN', 'MANAGER'].includes(activeRole?.toUpperCase() || '');

  const loadData = useCallback(async () => {
    if (!orgId) {
      setIntegrations([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await listIntegrations(orgId);
      setIntegrations(res.items || []);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to load integrations.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenConnect = (type: IntegrationType) => {
    setSelectedType(type);
    setSelectedIntegration(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (integration: Integration) => {
    setSelectedType(integration.type);
    setSelectedIntegration(integration);
    setIsModalOpen(true);
  };

  const handleSave = async (payload: IntegrationCreatePayload | IntegrationUpdatePayload) => {
    if (!orgId) return;
    setIsSubmitting(true);
    try {
      if (selectedIntegration) {
        await updateIntegration(orgId, selectedIntegration.id, payload as IntegrationUpdatePayload);
        setFeedback({
          type: 'success',
          message: `Integration "${payload.name || selectedIntegration.name}" updated successfully.`,
        });
      } else {
        await createIntegration(orgId, payload as IntegrationCreatePayload);
        setFeedback({
          type: 'success',
          message: `Integration "${payload.name}" connected successfully.`,
        });
      }
      await loadData();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (integration: Integration) => {
    if (!orgId) return;
    if (!window.confirm(`Are you sure you want to disconnect integration "${integration.name}"?`)) {
      return;
    }

    try {
      await deleteIntegration(orgId, integration.id);
      setFeedback({
        type: 'success',
        message: `Integration "${integration.name}" disconnected.`,
      });
      await loadData();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to delete integration.',
      });
    }
  };

  const handleTestConnection = async (integration: Integration) => {
    if (!orgId) return;
    setTestingId(integration.id);
    setFeedback(null);
    try {
      const res = await testIntegration(orgId, integration.id);
      setTestResults((prev) => ({
        ...prev,
        [integration.id]: {
          status: res.status,
          latency_ms: res.latency_ms,
          message: res.message,
        },
      }));
      setFeedback({
        type: res.status === 'healthy' ? 'success' : 'error',
        message: `${integration.name}: ${res.message} (${res.latency_ms}ms)`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Handshake failed.',
      });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-warm-900 dark:text-charcoal-100 tracking-tight">Integrations Catalog</h1>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-1">
            Connect third-party messaging tools and CRM platforms with authenticated encryption at rest.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={isLoading}
          className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-medium text-warm-700 dark:text-charcoal-300 bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 hover:bg-warm-100 dark:bg-charcoal-800 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-600 dark:text-brand-400' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`flex items-start justify-between p-4 rounded-xl border text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-warm-500 dark:text-charcoal-400 hover:text-warm-900 dark:text-charcoal-100 transition-colors ml-4 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Available Connectors Catalog */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100 tracking-tight">Available Connectors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Slack Connector */}
          <div className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 hover:border-warm-300 dark:border-charcoal-700 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-600 dark:text-brand-400">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800/60 font-medium">
                  Messaging
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Slack Notifications</h3>
                <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-1">
                  Deliver formatted lead qualification alerts and Block Kit cards into Slack channels with strict SSRF filtering.
                </p>
              </div>
            </div>
            <div className="pt-4 mt-2 border-t border-warm-200 dark:border-charcoal-750 flex items-center justify-between">
              <span className="text-[11px] text-warm-400 dark:text-charcoal-500">Incoming Webhooks &bull; Block Kit</span>
              <button
                onClick={() => handleOpenConnect('SLACK')}
                disabled={!canManage}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 rounded-xl shadow-subtle transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect</span>
              </button>
            </div>
          </div>

          {/* Mock CRM Connector */}
          <div className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 hover:border-warm-300 dark:border-charcoal-700 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Building2 className="w-5 h-5" />
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60 font-medium">
                  CRM / Leads
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100">Mock CRM Simulator</h3>
                <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-1">
                  High-fidelity Salesforce and HubSpot simulator featuring Redis-backed persistence, atomic email deduplication, and latency metrics.
                </p>
              </div>
            </div>
            <div className="pt-4 mt-2 border-t border-warm-200 dark:border-charcoal-750 flex items-center justify-between">
              <span className="text-[11px] text-warm-400 dark:text-charcoal-500">Atomic HSETNX &bull; Multi-Process</span>
              <button
                onClick={() => handleOpenConnect('MOCK_CRM')}
                disabled={!canManage}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-subtle transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Connected Integrations Section */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-warm-900 dark:text-charcoal-100 tracking-tight">
          Connected Integrations ({integrations.length})
        </h2>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[220px] rounded-2xl bg-white dark:bg-charcoal-900 border border-warm-200 dark:border-charcoal-750 p-8">
            <RefreshCw className="w-8 h-8 animate-spin text-brand-600 dark:text-brand-400 mb-3" />
            <p className="text-xs text-warm-500 dark:text-charcoal-400">Loading configured integrations...</p>
          </div>
        ) : integrations.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[240px] p-8 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/60 flex items-center justify-center text-brand-600 dark:text-brand-400">
              <Plug className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-warm-900 dark:text-charcoal-100">No Integrations Connected</h3>
            <p className="text-xs text-warm-500 dark:text-charcoal-400 max-w-sm">
              Connect a Slack channel or Mock CRM simulator from the catalog above to authorize automated downstream actions.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5">
            {integrations.map((item) => {
              const testInfo = testResults[item.id];
              return (
                <div
                  key={item.id}
                  className="p-5 rounded-2xl bg-white dark:bg-charcoal-900 shadow-subtle border border-warm-200 dark:border-charcoal-750 hover:border-warm-300 dark:border-charcoal-700 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-7 h-7 rounded-lg bg-warm-100 dark:bg-charcoal-800 flex items-center justify-center text-warm-700 dark:text-charcoal-300">
                        {item.type === 'SLACK' ? (
                          <MessageSquare className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                        ) : (
                          <Building2 className="w-4 h-4 text-amber-400" />
                        )}
                      </div>
                      <span className="font-semibold text-sm text-warm-900 dark:text-charcoal-100">{item.name}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-brand-600 dark:text-brand-400 border border-emerald-500/20">
                        {item.status}
                      </span>
                      {item.has_credentials && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-warm-100 dark:bg-charcoal-800 text-warm-700 dark:text-charcoal-300 border border-warm-300 dark:border-charcoal-700">
                          <Lock className="w-3 h-3 text-brand-600 dark:text-brand-400" />
                          <span>AES-256</span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-warm-500 dark:text-charcoal-400">
                      <span>Type: <span className="font-mono text-warm-700 dark:text-charcoal-300">{item.type}</span></span>
                      {item.type === 'SLACK' && item.config?.channel && (
                        <span>Channel: <span className="font-mono text-warm-700 dark:text-charcoal-300">{item.config.channel}</span></span>
                      )}
                      {item.type === 'MOCK_CRM' && item.config?.simulated_latency_ms !== undefined && (
                        <span>Latency Config: <span className="font-mono text-warm-700 dark:text-charcoal-300">{item.config.simulated_latency_ms}ms</span></span>
                      )}
                      <span>Connected: {new Date(item.created_at).toLocaleDateString()}</span>
                      {testInfo && (
                        <span
                          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded font-mono text-[11px] ${
                            testInfo.status === 'healthy'
                              ? 'bg-emerald-500/10 text-emerald-300'
                              : 'bg-rose-500/10 text-rose-300'
                          }`}
                        >
                          <span>{testInfo.status === 'healthy' ? 'Handshake' : 'Error'}: {testInfo.latency_ms}ms</span>
                        </span>
                      )}
                    </div>

                    {testInfo && testInfo.status !== 'healthy' && (
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs mt-2">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                          <div>
                            <span className="font-semibold">Connection failed:</span> {testInfo.message || 'Authentication rejected by provider.'}
                          </div>
                        </div>
                        {canTest && (
                          <button
                            onClick={() => handleTestConnection(item)}
                            disabled={testingId === item.id}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium transition"
                          >
                            Retry Connection
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 sm:self-center">
                    {canTest && (
                      <button
                        onClick={() => handleTestConnection(item)}
                        disabled={testingId === item.id}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium text-warm-700 dark:text-charcoal-300 bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-700 transition-colors flex items-center space-x-1.5 disabled:opacity-50"
                      >
                        {testingId === item.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-600 dark:text-brand-400" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                        )}
                        <span>Test</span>
                      </button>
                    )}

                    {canManage && (
                      <>
                        <button
                          onClick={() => handleOpenEdit(item)}
                          className="px-3 py-1.5 rounded-xl text-xs font-medium text-warm-700 dark:text-charcoal-300 bg-warm-100 dark:bg-charcoal-800 hover:bg-warm-200 dark:hover:bg-charcoal-700 transition-colors flex items-center space-x-1.5"
                        >
                          <Settings className="w-3.5 h-3.5 text-warm-500 dark:text-charcoal-400" />
                          <span>Configure</span>
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      <IntegrationConnectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        integrationType={selectedType}
        existingIntegration={selectedIntegration}
        organizationId={orgId || ''}
        userRole={activeRole || 'VIEWER'}
        onSave={handleSave}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};
