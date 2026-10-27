import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GmailIntegrationCard } from '../components/integrations/GmailIntegrationCard';
import { IntegrationsPage } from '../pages/integrations/IntegrationsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as GmailServiceModule from '../services/gmailService';
import * as IntegrationServiceModule from '../services/integrationService';
import * as WorkflowServiceModule from '../services/workflowService';
import { GmailAccount, GmailAccountsResponse } from '../types/gmail';

const account = (overrides: Partial<GmailAccount> = {}): GmailAccount => ({
  integration_id: 'int-gmail-1',
  organization_id: 'org-1',
  organization_name: 'Acme Test Corp',
  mailbox: 'owner@business.example',
  integration_status: 'CONNECTED',
  health: 'healthy',
  health_reasons: [],
  connected_at: '2026-10-17T09:00:00Z',
  granted_scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  workflow_id: 'wf-1',
  sync_state: 'OK',
  last_sync_at: '2026-10-17T10:00:00Z',
  last_sync_error: null,
  watch_status: 'ACTIVE',
  watch_expiration: '2026-10-24T09:00:00Z',
  ...overrides,
});

const response = (items: GmailAccount[], overrides: Partial<GmailAccountsResponse> = {}): GmailAccountsResponse => ({
  items,
  oauth_configured: true,
  pubsub_configured: true,
  poll_interval_seconds: 120,
  scheduler: { healthy: true, last_tick: '2026-10-17T10:00:00Z' },
  ...overrides,
});

const renderCard = (props: Partial<React.ComponentProps<typeof GmailIntegrationCard>> = {}) =>
  render(
    <GmailIntegrationCard
      organizationId="org-1"
      organizationName="Acme Test Corp"
      canManage
      canSync
      onFeedback={vi.fn()}
      {...props}
    />
  );

describe('Gmail integration card', () => {
  const assign = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign, pathname: '/integrations', search: '' },
    });
    vi.spyOn(WorkflowServiceModule, 'listWorkflows').mockResolvedValue({
      items: [{ id: 'wf-1', name: 'Inbound triage', status: 'ACTIVE' }],
      total: 1,
      page: 1,
      page_size: 100,
    } as any);
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('shows a healthy mailbox with its verified address, ownership, watch and last sync', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([account()]));
    renderCard();

    expect(await screen.findByText('owner@business.example')).toBeInTheDocument();
    expect(screen.getByText(/Owned by Acme Test Corp/)).toBeInTheDocument();
    expect(screen.getByTestId('gmail-health')).toHaveTextContent('Healthy');
    expect(screen.getByTestId('gmail-watch')).toHaveTextContent(/Active until/);
    expect(screen.getByTestId('gmail-last-sync').textContent).not.toBe('Never');
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it('makes an unhealthy mailbox obvious instead of showing it as connected', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(
      response(
        [
          account({
            health: 'degraded',
            health_reasons: ['scheduler_not_running', 'watch_failed', 'sync_error:rate_limited', 'no_workflow_configured'],
            watch_status: 'FAILED',
            watch_error: 'server_error',
            last_sync_error: 'rate_limited',
            last_sync_at: null,
            workflow_id: null,
          }),
        ],
        { scheduler: { healthy: false, last_tick: null } }
      )
    );
    renderCard();

    expect(await screen.findByTestId('gmail-health')).toHaveTextContent('Needs attention');
    expect(screen.getByTestId('gmail-watch')).toHaveTextContent(/Failed \(server_error\)/);
    expect(screen.getByTestId('gmail-last-sync')).toHaveTextContent('Never');
    const reasons = screen.getByTestId('gmail-reasons');
    expect(reasons).toHaveTextContent(/watch could not be registered/i);
    expect(reasons).toHaveTextContent(/Last sync failed \(rate_limited\)/);
    expect(reasons).toHaveTextContent(/No workflow is selected/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/scheduler \(Celery Beat\) has not reported in/i);
  });

  it('asks for a reconnect when Google no longer accepts the authorization', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(
      response([account({ health: 'needs_reauth', health_reasons: ['reauthorization_required'], integration_status: 'ERROR', sync_state: 'NEEDS_REAUTH' })])
    );
    const start = vi.spyOn(GmailServiceModule, 'startGmailAuthorization').mockResolvedValue('https://accounts.google.com/o/oauth2/auth?state=abc');
    renderCard();

    expect(await screen.findByTestId('gmail-health')).toHaveTextContent('Reconnect required');
    expect(screen.queryByRole('button', { name: /Sync now/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Reconnect$/i }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('org-1', { integrationId: 'int-gmail-1', workflowId: undefined }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?state=abc'));
  });

  it('starts the connection through the server and sends the browser to Google', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([]));
    const start = vi.spyOn(GmailServiceModule, 'startGmailAuthorization').mockResolvedValue('https://accounts.google.com/o/oauth2/auth?state=xyz');
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /Connect Gmail/i }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('org-1', { integrationId: undefined, workflowId: undefined }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?state=xyz'));
  });

  it('cannot connect when the server has no Google OAuth configuration', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([], { oauth_configured: false }));
    renderCard();
    expect(await screen.findByText(/Google OAuth is not configured on this server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Gmail/i })).toBeDisabled();
  });

  it('synchronises now and disconnects only after confirmation', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([account()]));
    const sync = vi.spyOn(GmailServiceModule, 'syncGmailNow').mockResolvedValue();
    const disconnect = vi.spyOn(GmailServiceModule, 'disconnectGmail').mockResolvedValue();
    const confirm = vi.spyOn(window, 'confirm');
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /Sync now/i }));
    await waitFor(() => expect(sync).toHaveBeenCalledWith('org-1', 'int-gmail-1'));

    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }));
    expect(disconnect).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith('org-1', 'int-gmail-1'));
  });

  it('lets only owners and admins connect, change or disconnect; managers can still sync', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([account()]));
    renderCard({ canManage: false, canSync: true });
    expect(await screen.findByRole('button', { name: /Sync now/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reconnect$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Workflow started by new mail/i)).not.toBeInTheDocument();
  });

  it('shows nothing about mailboxes to roles that may not see them', async () => {
    const list = vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([account()]));
    renderCard({ canManage: false, canSync: false });
    expect(await screen.findByText(/Ask an owner, admin or manager/i)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByText('owner@business.example')).not.toBeInTheDocument();
  });

  it('saves the chosen workflow through the integration API', async () => {
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([account({ workflow_id: null })]));
    const update = vi.spyOn(IntegrationServiceModule, 'updateIntegration').mockResolvedValue({} as any);
    renderCard();
    const select = await screen.findByLabelText(/Workflow started by new mail/i);
    await screen.findByRole('option', { name: 'Inbound triage' });
    fireEvent.change(select, { target: { value: 'wf-1' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith('org-1', 'int-gmail-1', { config: { workflow_id: 'wf-1' } }));
  });
});

describe('Integrations page and the Google redirect', () => {
  const originalLocation = window.location;
  const org = { id: 'org-1', name: 'Acme Test Corp', slug: 'acme', role: 'ADMIN' as any, created_at: '2026-01-01T00:00:00Z' };

  const mountWithSearch = (search: string) => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, search, pathname: '/integrations', assign: vi.fn() },
    });
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', email: 'a@acme.com', full_name: 'A', is_active: true, is_superuser: false, created_at: '2026-01-01T00:00:00Z' },
      organizations: [org],
      activeOrganization: org,
      activeRole: 'ADMIN',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
      refreshProfile: vi.fn(),
    });
    vi.spyOn(IntegrationServiceModule, 'listIntegrations').mockResolvedValue({
      items: [
        { id: 'int-gmail-1', organization_id: 'org-1', type: 'GMAIL', name: 'Gmail owner@business.example', status: 'CONNECTED', has_credentials: true, config: {}, created_at: '', updated_at: '' },
      ],
      total: 1,
    } as any);
    vi.spyOn(GmailServiceModule, 'listGmailAccounts').mockResolvedValue(response([]));
    vi.spyOn(WorkflowServiceModule, 'listWorkflows').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 } as any);
    return render(<IntegrationsPage />);
  };

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('explains a failed connection in plain language and clears the URL', async () => {
    mountWithSearch('?gmail=error&reason=mailbox_in_use');
    expect(await screen.findByText(/Gmail was not connected\. That mailbox is already connected/i)).toBeInTheDocument();
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/integrations');
  });

  it('confirms a successful connection', async () => {
    mountWithSearch('?gmail=connected');
    expect(await screen.findByText(/Gmail mailbox connected\./i)).toBeInTheDocument();
  });

  it('does not list Gmail mailboxes in the generic credential-based list', async () => {
    mountWithSearch('');
    await waitFor(() => expect(IntegrationServiceModule.listIntegrations).toHaveBeenCalled());
    expect(screen.queryByText('Gmail owner@business.example')).not.toBeInTheDocument();
    expect(await screen.findByText(/Connected Integrations \(0\)/)).toBeInTheDocument();
  });
});
