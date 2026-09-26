import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogsPage } from '../pages/audit/AuditLogsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as AuditServiceModule from '../services/auditService';
import { AuditLog } from '../types/audit';

const mockOrg = {
  id: 'org-test-audit-1',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'ADMIN' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const mockLogs: AuditLog[] = [
  {
    id: 'audit-11111111-aaaa-bbbb-cccc-dddddddddddd',
    organization_id: 'org-test-audit-1',
    user_id: 'user-admin-1',
    actor_name: 'Jane Doe',
    actor_email: 'jane@flowpilot.internal',
    action: 'execution.completed',
    resource_type: 'workflow_run',
    resource_id: 'run-12345678-aaaa-bbbb-cccc-dddddddddddd',
    details: { duration_ms: 1240, steps_completed: 4 },
    ip_address: '192.168.1.100',
    created_at: '2026-09-24T09:00:00Z',
  },
  {
    id: 'audit-22222222-aaaa-bbbb-cccc-dddddddddddd',
    organization_id: 'org-test-audit-1',
    user_id: null,
    actor_name: null,
    actor_email: null,
    action: 'workflow.created',
    resource_type: 'workflow',
    resource_id: 'wf-98765432-aaaa-bbbb-cccc-dddddddddddd',
    details: { name: 'Customer Onboarding', trigger_type: 'WEBHOOK' },
    ip_address: null,
    created_at: '2026-09-24T08:30:00Z',
  },
];

describe('AuditLogsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user-admin-1', email: 'jane@flowpilot.internal', full_name: 'Jane Doe' } as any,
      activeOrganization: mockOrg as any,
      activeRole: 'ADMIN',
      organizations: [mockOrg] as any,
      isLoading: false,
      isAuthenticated: true,
      refreshProfile: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
    });

    vi.spyOn(AuditServiceModule, 'listAuditLogs').mockResolvedValue({
      items: mockLogs,
      total: 2,
      page: 1,
      page_size: 20,
      total_pages: 1,
    });

    vi.spyOn(AuditServiceModule, 'getAuditLogDetail').mockResolvedValue(mockLogs[0]);
  });

  it('renders system audit logs header, filters, and log entries', async () => {
    render(<AuditLogsPage />);

    expect(screen.getByText('System Audit Logs')).toBeInTheDocument();
    expect(screen.getByText('All Actions')).toBeInTheDocument();
    expect(screen.getByText('All Resources')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('execution.completed')).toBeInTheDocument();
      expect(screen.getByText('workflow.created')).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('System Worker')).toBeInTheDocument();
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });
  });

  it('filters audit logs by action and search input', async () => {
    render(<AuditLogsPage />);

    const searchInput = screen.getByPlaceholderText('Search action or resource ID...');
    fireEvent.change(searchInput, { target: { value: 'run-1234' } });

    await waitFor(() => {
      expect(AuditServiceModule.listAuditLogs).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ search: 'run-1234' })
      );
    });
  });

  it('opens audit detail modal and shows sanitized JSON payload', async () => {
    render(<AuditLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('execution.completed')).toBeInTheDocument();
    });

    const inspectButtons = screen.getAllByTitle('Inspect Audit Metadata');
    fireEvent.click(inspectButtons[0]);

    await waitFor(() => {
      expect(AuditServiceModule.getAuditLogDetail).toHaveBeenCalledWith(
        mockOrg.id,
        mockLogs[0].id
      );
      expect(screen.getByText('Audit Event Details')).toBeInTheDocument();
      expect(screen.getByText(/Sanitized Event Details Payload/i)).toBeInTheDocument();
      expect(screen.getByText(/"duration_ms": 1240/)).toBeInTheDocument();
    });
  });

  it('displays access restricted message for Viewer or Operator roles', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user-viewer-1', email: 'viewer@flowpilot.internal', full_name: 'Viewer' } as any,
      activeOrganization: mockOrg as any,
      activeRole: 'VIEWER',
      organizations: [mockOrg] as any,
      isLoading: false,
      isAuthenticated: true,
      refreshProfile: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
    });

    render(<AuditLogsPage />);

    expect(screen.getByText('Audit Trail Access Restricted')).toBeInTheDocument();
    expect(screen.getByText(/Viewing immutable audit trail logs is restricted to/i)).toBeInTheDocument();
    expect(AuditServiceModule.listAuditLogs).not.toHaveBeenCalled();
  });
});
