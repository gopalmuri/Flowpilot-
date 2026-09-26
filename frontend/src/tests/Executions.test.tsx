import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionsPage } from '../pages/executions/ExecutionsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as ExecutionServiceModule from '../services/executionService';
import { WorkflowRun, WorkflowRunDetail } from '../types/execution';

const mockOrg = {
  id: 'org-test-exec-1',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'ADMIN' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const mockRuns: WorkflowRun[] = [
  {
    id: 'run-11111111-aaaa-bbbb-cccc-dddddddddddd',
    organization_id: 'org-test-exec-1',
    workflow_id: 'wf-1',
    workflow_name: 'Lead Routing Pipeline',
    workflow_version_id: 'ver-1',
    status: 'COMPLETED',
    trigger_type: 'MANUAL',
    trigger_payload: { message: 'test payload' },
    correlation_id: 'corr-001',
    duration_ms: 2150,
    started_at: '2026-09-23T10:00:00Z',
    completed_at: '2026-09-23T10:00:02.150Z',
    created_at: '2026-09-23T10:00:00Z',
    updated_at: '2026-09-23T10:00:02.150Z',
  },
  {
    id: 'run-22222222-aaaa-bbbb-cccc-dddddddddddd',
    organization_id: 'org-test-exec-1',
    workflow_id: 'wf-2',
    workflow_name: 'Webhook Ingestion Pipeline',
    workflow_version_id: 'ver-2',
    status: 'RUNNING',
    trigger_type: 'WEBHOOK',
    trigger_payload: { event: 'user.created' },
    correlation_id: 'corr-002',
    duration_ms: null,
    started_at: '2026-09-23T10:05:00Z',
    completed_at: null,
    created_at: '2026-09-23T10:05:00Z',
    updated_at: '2026-09-23T10:05:00Z',
  },
];

const mockRunDetail: WorkflowRunDetail = {
  ...mockRuns[0],
  approvals: [
    {
      id: 'appr-1',
      workflow_run_id: mockRuns[0].id,
      step_id: 'step-3',
      status: 'APPROVED',
      reviewed_by: 'user-admin-1',
      reviewer_name: 'Admin User',
      reviewer_email: 'admin@flowpilot.internal',
      comment: 'Lead approved for enterprise sync',
      created_at: '2026-09-23T10:00:01Z',
      resolved_at: '2026-09-23T10:00:02Z',
    },
  ],
  step_runs: [
    {
      id: 'step-run-1',
      workflow_run_id: mockRuns[0].id,
      step_id: 'step-1',
      step_key: 'start',
      step_type: 'MANUAL_TRIGGER',
      status: 'COMPLETED',
      input_data: {},
      output_data: { triggered: true },
      execution_time_ms: 12,
      started_at: '2026-09-23T10:00:00Z',
      completed_at: '2026-09-23T10:00:00.012Z',
    },
    {
      id: 'step-run-2',
      workflow_run_id: mockRuns[0].id,
      step_id: 'step-2',
      step_key: 'classify_lead',
      step_type: 'AI_CLASSIFICATION',
      status: 'COMPLETED',
      input_data: { text: 'high priority' },
      output_data: { category: 'lead', score: 0.95 },
      execution_time_ms: 85,
      started_at: '2026-09-23T10:00:00.015Z',
      completed_at: '2026-09-23T10:00:00.100Z',
    },
  ],
};

describe('ExecutionsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user-1', email: 'test@flowpilot.internal', full_name: 'Test' } as any,
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

    vi.spyOn(ExecutionServiceModule, 'listExecutions').mockResolvedValue({
      items: mockRuns,
      total: 2,
      page: 1,
      page_size: 20,
      total_pages: 1,
    });

    vi.spyOn(ExecutionServiceModule, 'getExecutionDetail').mockResolvedValue(mockRunDetail);
    vi.spyOn(ExecutionServiceModule, 'cancelExecution').mockResolvedValue({
      ...mockRuns[1],
      status: 'CANCELLED',
    });
  });

  it('renders executions telemetry header, filters, and run items', async () => {
    render(<ExecutionsPage />);

    expect(screen.getByText('Execution Telemetry & History')).toBeInTheDocument();
    expect(screen.getByText('All Statuses')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
      expect(screen.getByText('Lead Routing Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Webhook Ingestion Pipeline')).toBeInTheDocument();
      expect(screen.getByText('corr-001')).toBeInTheDocument();
      expect(screen.getByText('corr-002')).toBeInTheDocument();
      expect(screen.getByText('2.15s')).toBeInTheDocument();
    });
  });

  it('filters runs by status when filter pill is clicked', async () => {
    render(<ExecutionsPage />);

    await waitFor(() => {
      expect(ExecutionServiceModule.listExecutions).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ status: undefined, page: 1, pageSize: 20 })
      );
    });

    const runningPills = screen.getAllByText('Running');
    fireEvent.click(runningPills[0]);

    await waitFor(() => {
      expect(ExecutionServiceModule.listExecutions).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ status: 'RUNNING', page: 1, pageSize: 20 })
      );
    });
  });

  it('filters runs by trigger type and search query', async () => {
    render(<ExecutionsPage />);

    const searchInput = screen.getByPlaceholderText('Search by correlation ID or workflow name...');
    fireEvent.change(searchInput, { target: { value: 'corr-001' } });

    await waitFor(() => {
      expect(ExecutionServiceModule.listExecutions).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ search: 'corr-001' })
      );
    });
  });

  it('opens timeline drawer when run is clicked', async () => {
    render(<ExecutionsPage />);

    await waitFor(() => {
      expect(screen.getByText('corr-001')).toBeInTheDocument();
    });

    // Click view button
    const viewButtons = screen.getAllByTitle('View Timeline');
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(ExecutionServiceModule.getExecutionDetail).toHaveBeenCalledWith(
        mockOrg.id,
        mockRuns[0].id
      );
      expect(screen.getAllByText('Lead Routing Pipeline').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Step Execution Timeline (2)')).toBeInTheDocument();
      expect(screen.getByText('classify_lead')).toBeInTheDocument();
      expect(screen.getByText(/"Lead approved for enterprise sync"/)).toBeInTheDocument();
    });
  });

  it('cancels an active run when cancel button is clicked', async () => {
    render(<ExecutionsPage />);

    await waitFor(() => {
      expect(screen.getByText('corr-002')).toBeInTheDocument();
    });

    const cancelButtons = screen.getAllByTitle('Cancel Execution');
    expect(cancelButtons.length).toBeGreaterThan(0);
    fireEvent.click(cancelButtons[0]);

    await waitFor(() => {
      expect(ExecutionServiceModule.cancelExecution).toHaveBeenCalledWith(
        mockOrg.id,
        mockRuns[1].id
      );
    });
  });
});
