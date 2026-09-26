import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalsPage } from '../pages/approvals/ApprovalsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as ApprovalServiceModule from '../services/approvalService';
import { ApprovalRequest } from '../types/approval';

const mockOrg = {
  id: 'org-test-1',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'ADMIN' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const mockPendingApproval: ApprovalRequest = {
  id: 'appr-001',
  organization_id: 'org-test-1',
  workflow_run_id: 'run-alpha-12345678',
  step_run_id: 'step-001',
  step_key: 'human_gate_lead',
  status: 'PENDING',
  required_role: 'ADMIN',
  context_snapshot: {
    company: 'BigCorp',
    lead_score: 95,
    category: 'ENTERPRISE',
  },
  requested_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600000).toISOString(),
};

const mockHistoryApproval: ApprovalRequest = {
  id: 'appr-002',
  organization_id: 'org-test-1',
  workflow_run_id: 'run-beta-87654321',
  step_run_id: 'step-002',
  step_key: 'crm_create_gate',
  status: 'APPROVED',
  required_role: 'MEMBER',
  context_snapshot: {
    company: 'SmallBiz',
    category: 'SMB',
  },
  requested_at: new Date(Date.now() - 7200000).toISOString(),
  resolved_at: new Date(Date.now() - 3600000).toISOString(),
  decision_comment: 'Approved by lead manager',
};

describe('Approvals Module Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'usr-1', email: 'admin@acme.com', full_name: 'Admin User', is_active: true, is_superuser: false, created_at: '2026-01-01T00:00:00Z' },
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

    vi.spyOn(ApprovalServiceModule, 'listApprovals').mockImplementation(async (_orgId, status) => {
      if (status === 'PENDING') {
        return {
          items: [mockPendingApproval],
          total: 1,
          page: 1,
          page_size: 20,
        };
      }
      return {
        items: [mockPendingApproval, mockHistoryApproval],
        total: 2,
        page: 1,
        page_size: 50,
      };
    });

    vi.spyOn(ApprovalServiceModule, 'approveRequest').mockResolvedValue({
      ...mockPendingApproval,
      status: 'APPROVED',
      resolved_at: new Date().toISOString(),
      decision_comment: 'LGTM',
    });

    vi.spyOn(ApprovalServiceModule, 'rejectRequest').mockResolvedValue({
      ...mockPendingApproval,
      status: 'REJECTED',
      resolved_at: new Date().toISOString(),
      decision_comment: 'Not qualified',
    });
  });

  it('renders pending approvals and displays badge count', async () => {
    render(<ApprovalsPage />);

    expect(screen.getByText(/Loading approval requests.../i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('human_gate_lead')).toBeInTheDocument();
    });

    expect(screen.getByText('Pending Review')).toBeInTheDocument();
    expect(screen.getByText('Requires: ADMIN')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('switches tabs to Resolution History', async () => {
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('human_gate_lead')).toBeInTheDocument();
    });

    const historyTab = screen.getByRole('button', { name: /Resolution History/i });
    fireEvent.click(historyTab);

    await waitFor(() => {
      expect(screen.getByText('crm_create_gate')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.getByText(/Approved by lead manager/i)).toBeInTheDocument();
    });
  });

  it('opens approval action modal with context snapshot', async () => {
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('human_gate_lead')).toBeInTheDocument();
    });

    const reviewButton = screen.getByRole('button', { name: /Review & Authorize/i });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText(/Review Approval Request/i)).toBeInTheDocument();
      expect(screen.getByText(/BigCorp/i)).toBeInTheDocument();
      expect(screen.getByText(/ENTERPRISE/i)).toBeInTheDocument();
    });
  });

  it('disables approval actions if active role is below required role', async () => {
    // Override auth with VIEWER role
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'usr-2', email: 'viewer@acme.com', full_name: 'Viewer User', is_active: true, is_superuser: false, created_at: '2026-01-01T00:00:00Z' },
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

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('human_gate_lead')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Review & Authorize/i }));

    await waitFor(() => {
      expect(screen.getByText(/Insufficient Permissions:/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Approve & Resume/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Reject Step/i })).not.toBeInTheDocument();
    });
  });

  it('submits approval decision with comment', async () => {
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('human_gate_lead')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Review & Authorize/i }));

    await waitFor(() => {
      expect(screen.getByText(/Review Approval Request/i)).toBeInTheDocument();
    });

    const commentInput = screen.getByPlaceholderText(/Add audit rationale or context/i);
    fireEvent.change(commentInput, { target: { value: 'Verified deal size' } });

    const approveButton = screen.getByRole('button', { name: /Approve & Resume/i });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(ApprovalServiceModule.approveRequest).toHaveBeenCalledWith(
        'org-test-1',
        'appr-001',
        { comment: 'Verified deal size' }
      );
    });
  });

  it('submits rejection decision with comment', async () => {
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('human_gate_lead')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Review & Authorize/i }));

    await waitFor(() => {
      expect(screen.getByText(/Review Approval Request/i)).toBeInTheDocument();
    });

    const commentInput = screen.getByPlaceholderText(/Add audit rationale or context/i);
    fireEvent.change(commentInput, { target: { value: 'Fake email domain' } });

    const rejectButton = screen.getByRole('button', { name: /Reject Step/i });
    fireEvent.click(rejectButton);

    await waitFor(() => {
      expect(ApprovalServiceModule.rejectRequest).toHaveBeenCalledWith(
        'org-test-1',
        'appr-001',
        { comment: 'Fake email domain' }
      );
    });
  });

  it('displays empty inbox zero state when no pending approvals exist', async () => {
    vi.spyOn(ApprovalServiceModule, 'listApprovals').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    });

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('Inbox Zero')).toBeInTheDocument();
    });
  });
});
