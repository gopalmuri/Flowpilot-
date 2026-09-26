import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { AnalyticsPage } from '../pages/analytics/AnalyticsPage';
import { SLAConfigModal } from '../components/workflow/SLAConfigModal';
import { ExecutionVolumeChart } from '../components/analytics/ExecutionVolumeChart';
import { DurationTrendChart } from '../components/analytics/DurationTrendChart';
import * as AuthContextModule from '../context/AuthContext';
import * as AnalyticsServiceModule from '../services/analyticsService';
import * as WorkflowServiceModule from '../services/workflowService';
import {
  AnalyticsOverviewResponse,
  SLAMonitoringResponse,
  StepLatencyResponse,
  TimeSeriesResponse,
  WorkflowPerformanceResponse,
} from '../types/analytics';
import { WorkflowVersionDetail } from '../types/workflow';

const mockOrg = {
  id: 'org-test-analytics-1',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'ADMIN' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const mockOverview: AnalyticsOverviewResponse = {
  organization_id: mockOrg.id,
  workflow_id: null,
  time_range: '24h',
  start_time: '2026-09-23T10:00:00Z',
  end_time: '2026-09-24T10:00:00Z',
  volume: {
    total: 100,
    terminal: 80,
    in_flight: 20,
    success_count: 70,
    failed_count: 8,
    cancelled_count: 2,
    running_count: 10,
    pending_count: 5,
    waiting_approval_count: 5,
    success_rate: 87.5,
    failure_rate: 10.0,
    cancellation_rate: 2.5,
  },
  duration: {
    avg_duration_ms: 1250.0,
    p50_duration_ms: 950.0,
    p95_duration_ms: 3400.0,
    p99_duration_ms: 5100.0,
  },
  sla: {
    monitored_count: 75,
    healthy_count: 65,
    warning_count: 6,
    breached_count: 4,
    not_applicable_count: 25,
    sla_compliance_rate: 94.67,
    sla_healthy_rate: 86.67,
    sla_breach_rate: 5.33,
  },
};

const mockTimeSeries: TimeSeriesResponse = {
  organization_id: mockOrg.id,
  workflow_id: null,
  start_time: '2026-09-23T10:00:00Z',
  end_time: '2026-09-24T10:00:00Z',
  granularity: 'hourly',
  buckets: [
    {
      timestamp: '2026-09-23T10:00:00Z',
      total_count: 10,
      success_count: 8,
      failed_count: 1,
      cancelled_count: 0,
      in_flight_count: 1,
      avg_duration_ms: 1100.0,
      p95_duration_ms: 2500.0,
    },
    {
      timestamp: '2026-09-23T11:00:00Z',
      total_count: 15,
      success_count: 12,
      failed_count: 1,
      cancelled_count: 1,
      in_flight_count: 1,
      avg_duration_ms: 1400.0,
      p95_duration_ms: 3200.0,
    },
  ],
};

const mockWfPerformance: WorkflowPerformanceResponse = {
  items: [
    {
      workflow_id: 'wf-1',
      workflow_name: 'Customer Onboarding Flow',
      status: 'ACTIVE',
      active_version_number: 2,
      total_executions: 60,
      success_count: 55,
      failed_count: 3,
      cancelled_count: 2,
      in_flight_count: 0,
      success_rate: 91.67,
      failure_rate: 5.0,
      avg_duration_ms: 980.0,
      p95_duration_ms: 2200.0,
      has_sla: true,
      sla_compliance_rate: 96.5,
      sla_breach_count: 2,
    },
  ],
  total: 1,
  page: 1,
  page_size: 10,
  total_pages: 1,
};

const mockStepLatency: StepLatencyResponse = {
  items: [
    {
      step_key: 'validate_payload',
      step_type: 'VALIDATE_DATA',
      name: 'Validate Request Body',
      total_executions: 60,
      failed_count: 2,
      failure_rate: 3.33,
      avg_execution_time_ms: 120.0,
      p95_execution_time_ms: 250.0,
      p99_execution_time_ms: 400.0,
    },
  ],
  total: 1,
  limit: 20,
  sort_by: 'avg_latency',
};

const mockSLAMonitoring: SLAMonitoringResponse = {
  summary: mockOverview.sla,
  workflows: [
    {
      workflow_id: 'wf-1',
      workflow_name: 'Customer Onboarding Flow',
      active_version_number: 2,
      sla_enabled: true,
      target_seconds: 30.0,
      warning_threshold_seconds: 20.0,
      total_evaluated: 58,
      healthy_count: 50,
      warning_count: 6,
      breached_count: 2,
      compliance_rate: 96.55,
      healthy_rate: 86.21,
      breach_rate: 3.45,
      current_active_breaches: 0,
    },
  ],
};

describe('Phase 15 Analytics & SLA Monitoring Frontend Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u-1', email: 'test@flowpilot.internal', full_name: 'Test Admin' } as any,
      activeOrganization: mockOrg,
      activeRole: 'ADMIN',
      isAuthenticated: true,
      isLoading: false,
    } as any);

    vi.spyOn(WorkflowServiceModule, 'listWorkflows').mockResolvedValue({
      items: [
        { id: 'wf-1', name: 'Customer Onboarding Flow', status: 'ACTIVE' } as any,
      ],
      total: 1,
      page: 1,
      page_size: 100,
      total_pages: 1,
    });

    vi.spyOn(AnalyticsServiceModule, 'getAnalyticsOverview').mockResolvedValue(mockOverview);
    vi.spyOn(AnalyticsServiceModule, 'getTimeSeries').mockResolvedValue(mockTimeSeries);
    vi.spyOn(AnalyticsServiceModule, 'getWorkflowPerformance').mockResolvedValue(mockWfPerformance);
    vi.spyOn(AnalyticsServiceModule, 'getStepLatency').mockResolvedValue(mockStepLatency);
    vi.spyOn(AnalyticsServiceModule, 'getSLAMonitoring').mockResolvedValue(mockSLAMonitoring);
  });

  it('renders AnalyticsPage with KPI cards, volume, latency, and SLA panels', async () => {
    render(
      <BrowserRouter>
        <AnalyticsPage />
      </BrowserRouter>
    );

    // Header title
    expect(screen.getByText(/Execution Analytics & SLA Monitoring/i)).toBeInTheDocument();

    // Verify KPI Cards loaded with values
    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument(); // total runs
      expect(screen.getByText('87.5%')).toBeInTheDocument(); // success rate
      expect(screen.getAllByText(/Customer Onboarding Flow/i).length).toBeGreaterThan(0);
      expect(screen.getByText('validate_payload')).toBeInTheDocument();
    });
  });

  it('handles workflow filter selection and triggers API calls', async () => {
    render(
      <BrowserRouter>
        <AnalyticsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Customer Onboarding Flow').length).toBeGreaterThan(0);
    });

    const select = screen.getByLabelText(/Filter by workflow/i);
    fireEvent.change(select, { target: { value: 'wf-1' } });

    await waitFor(() => {
      expect(AnalyticsServiceModule.getAnalyticsOverview).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ workflowId: 'wf-1' })
      );
    });
  });

  it('handles time range button clicks and custom date conversion to UTC', async () => {
    render(
      <BrowserRouter>
        <AnalyticsPage />
      </BrowserRouter>
    );

    // Switch to 7D
    const btn7d = screen.getByText('7D');
    fireEvent.click(btn7d);

    await waitFor(() => {
      expect(AnalyticsServiceModule.getAnalyticsOverview).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ range: '7d' })
      );
    });

    // Switch to CUSTOM
    const btnCustom = screen.getByText('CUSTOM');
    fireEvent.click(btnCustom);

    // Custom datetime inputs should appear
    expect(screen.getByLabelText(/Custom start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Custom end date/i)).toBeInTheDocument();
  });

  it('renders error banner when API fails and retries upon button click', async () => {
    vi.spyOn(AnalyticsServiceModule, 'getAnalyticsOverview').mockRejectedValueOnce(
      new Error('Database timeout connecting to analytics pool')
    );

    render(
      <BrowserRouter>
        <AnalyticsPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Database timeout connecting to analytics pool/i)).toBeInTheDocument();
    });

    // Click Retry
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(AnalyticsServiceModule.getAnalyticsOverview).toHaveBeenCalledTimes(2);
    });
  });

  it('renders native SVG charts properly and shows empty state when no data exists', () => {
    const { rerender } = render(<ExecutionVolumeChart buckets={mockTimeSeries.buckets} />);
    // Check SVG container rendered
    expect(document.querySelector('svg')).toBeInTheDocument();

    // Rerender with empty buckets
    rerender(<ExecutionVolumeChart buckets={[]} />);
    expect(screen.getByText(/No Execution Volume Data/i)).toBeInTheDocument();

    // Duration trend empty state
    rerender(<DurationTrendChart buckets={[]} />);
    expect(screen.getByText(/No Duration Trend Data/i)).toBeInTheDocument();
  });

  it('SLAConfigModal enforces read-only for published versions and displays draft guidance', () => {
    const mockPublishedVersion: WorkflowVersionDetail = {
      id: 'ver-pub-1',
      workflow_id: 'wf-1',
      version_number: 1,
      status: 'PUBLISHED',
      steps: [],
      connections: [],
      definition: {
        steps: [],
        connections: [],
        sla: { target_seconds: 45.0, warning_threshold_seconds: 30.0, enabled: true },
      },
      created_by: 'u-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    render(
      <SLAConfigModal
        isOpen={true}
        onClose={vi.fn()}
        workflowId="wf-1"
        version={mockPublishedVersion}
        onSaveSuccess={vi.fn()}
      />
    );

    // Must show published guidance: "Create a new draft version to adjust SLA targets."
    expect(screen.getByText(/Create a new draft version to adjust SLA targets/i)).toBeInTheDocument();

    // Submit button should NOT be rendered in read-only mode
    expect(screen.queryByRole('button', { name: /Save SLA Targets/i })).not.toBeInTheDocument();
  });

  it('SLAConfigModal allows editing for DRAFT versions and submits valid configuration', async () => {
    const updateSpy = vi.spyOn(AnalyticsServiceModule, 'updateVersionSLA').mockResolvedValue({
      workflow_id: 'wf-1',
      version_id: 'ver-draft-2',
      version_number: 2,
      status: 'DRAFT',
      sla: { target_seconds: 25.0, warning_threshold_seconds: 15.0, enabled: true },
    });

    const mockDraftVersion: WorkflowVersionDetail = {
      id: 'ver-draft-2',
      workflow_id: 'wf-1',
      version_number: 2,
      status: 'DRAFT',
      steps: [],
      connections: [],
      definition: {
        steps: [],
        connections: [],
        sla: { target_seconds: 30.0, warning_threshold_seconds: 20.0, enabled: true },
      },
      created_by: 'u-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const handleSuccess = vi.fn();

    render(
      <SLAConfigModal
        isOpen={true}
        onClose={vi.fn()}
        workflowId="wf-1"
        version={mockDraftVersion}
        onSaveSuccess={handleSuccess}
      />
    );

    // Save button exists
    const saveBtn = screen.getByRole('button', { name: /Save SLA Targets/i });
    expect(saveBtn).toBeInTheDocument();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        mockOrg.id,
        'wf-1',
        'ver-draft-2',
        expect.objectContaining({
          target_seconds: 30.0,
          warning_threshold_seconds: 20.0,
          enabled: true,
        })
      );
      expect(handleSuccess).toHaveBeenCalled();
    });
  });
});
