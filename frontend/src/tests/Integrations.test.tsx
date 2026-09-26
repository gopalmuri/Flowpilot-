import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrationsPage } from '../pages/integrations/IntegrationsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as IntegrationServiceModule from '../services/integrationService';
import { Integration } from '../types/integration';

const mockOrg = {
  id: 'org-test-int',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'ADMIN' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const mockCrmIntegration: Integration = {
  id: 'int-crm-1',
  organization_id: 'org-test-int',
  type: 'MOCK_CRM',
  name: 'Production CRM Simulator',
  status: 'CONNECTED',
  has_credentials: true,
  config: { simulated_latency_ms: 15 },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockSlackIntegration: Integration = {
  id: 'int-slack-2',
  organization_id: 'org-test-int',
  type: 'SLACK',
  name: 'Sales Slack Alerts',
  status: 'CONNECTED',
  has_credentials: true,
  config: { channel: '#sales-alerts', mock_mode: true },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('Integrations Page & Connectors Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'usr-1',
        email: 'admin@acme.com',
        full_name: 'Admin User',
        is_active: true,
        is_superuser: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      organizations: [mockOrg],
      activeOrganization: mockOrg,
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
      items: [mockCrmIntegration, mockSlackIntegration],
      total: 2,
    });

    vi.spyOn(IntegrationServiceModule, 'createIntegration').mockResolvedValue({
      id: 'int-new-3',
      organization_id: 'org-test-int',
      type: 'SLACK',
      name: 'DevOps Slack',
      status: 'CONNECTED',
      has_credentials: true,
      config: { channel: '#devops' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    vi.spyOn(IntegrationServiceModule, 'testIntegration').mockResolvedValue({
      status: 'healthy',
      latency_ms: 14.5,
      message: 'Slack webhook handshake verified successfully',
      tested_at: new Date().toISOString(),
    });

    vi.spyOn(IntegrationServiceModule, 'deleteIntegration').mockResolvedValue();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders available connectors catalog and connected integrations list', async () => {
    render(<IntegrationsPage />);

    expect(screen.getByText(/Loading configured integrations.../i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Production CRM Simulator')).toBeInTheDocument();
      expect(screen.getByText('Sales Slack Alerts')).toBeInTheDocument();
    });

    expect(screen.getByText('Slack Notifications')).toBeInTheDocument();
    expect(screen.getByText('Mock CRM Simulator')).toBeInTheDocument();
    expect(screen.getByText('Connected Integrations (2)')).toBeInTheDocument();
  });

  it('opens connect modal when Connect is clicked on Slack connector', async () => {
    render(<IntegrationsPage />);

    await waitFor(() => {
      expect(screen.getByText('Slack Notifications')).toBeInTheDocument();
    });

    const connectButtons = screen.getAllByRole('button', { name: /Connect/i });
    fireEvent.click(connectButtons[0]); // First Connect button

    await waitFor(() => {
      expect(screen.getByText('Connect Integration')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g. Sales Team Slack')).toBeInTheDocument();
      expect(screen.getByText(/Default Channel/i)).toBeInTheDocument();
    });
  });

  it('executes connection test and displays live latency result', async () => {
    render(<IntegrationsPage />);

    await waitFor(() => {
      expect(screen.getByText('Sales Slack Alerts')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByRole('button', { name: /Test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(IntegrationServiceModule.testIntegration).toHaveBeenCalledWith(
        'org-test-int',
        mockCrmIntegration.id
      );
      expect(screen.getByText(/Handshake: 14.5ms/i)).toBeInTheDocument();
    });
  });

  it('enforces RBAC by hiding/disabling manage actions for VIEWER role', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'usr-viewer',
        email: 'viewer@acme.com',
        full_name: 'Viewer User',
        is_active: true,
        is_superuser: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      organizations: [{ ...mockOrg, role: 'VIEWER' as any }],
      activeOrganization: { ...mockOrg, role: 'VIEWER' as any },
      activeRole: 'VIEWER',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
      refreshProfile: vi.fn(),
    });

    render(<IntegrationsPage />);

    await waitFor(() => {
      expect(screen.getByText('Production CRM Simulator')).toBeInTheDocument();
    });

    // Connect buttons are disabled for VIEWER
    const connectButtons = screen.getAllByRole('button', { name: /Connect/i });
    connectButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });

    // Configure and Delete buttons should not be rendered
    expect(screen.queryByRole('button', { name: /Configure/i })).not.toBeInTheDocument();
  });

  it('deletes an integration when Disconnect is clicked and confirmed', async () => {
    render(<IntegrationsPage />);

    await waitFor(() => {
      expect(screen.getByText('Production CRM Simulator')).toBeInTheDocument();
    });

    // Click trash button (using svg/selector or finding button)
    const allButtons = screen.getAllByRole('button');
    // Find button containing svg or trash
    const trashButtons = allButtons.filter((btn) => btn.className.includes('rose'));
    expect(trashButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(trashButtons[0]);

    await waitFor(() => {
      expect(IntegrationServiceModule.deleteIntegration).toHaveBeenCalledWith(
        'org-test-int',
        mockCrmIntegration.id
      );
    });
  });
});
