import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { WorkflowsPage } from '../pages/workflows/WorkflowsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as WorkflowServiceModule from '../services/workflowService';
import { Workflow, WorkflowStatus } from '../types/workflow';

const mockOrg = {
  id: 'org-test-1',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'ADMIN' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const mockWorkflows: Workflow[] = [
  {
    id: 'wf-001',
    organization_id: 'org-test-1',
    name: 'Inbound Lead Qualification',
    description: 'Classify and route enterprise leads to Mock CRM',
    status: WorkflowStatus.ACTIVE,
    active_version_id: 'ver-001',
    webhook_key: 'whk_lead_qual',
    created_by: 'usr-001',
    created_at: '2026-01-10T00:00:00Z',
    updated_at: '2026-01-10T00:00:00Z',
    version_count: 2,
    active_version: {
      id: 'ver-001',
      workflow_id: 'wf-001',
      version_number: 1,
      status: 'PUBLISHED',
      created_by: 'usr-001',
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    },
  },
  {
    id: 'wf-002',
    organization_id: 'org-test-1',
    name: 'Customer Support Escalation',
    description: 'Process incoming support tickets and alert Slack',
    status: WorkflowStatus.DRAFT,
    active_version_id: null,
    webhook_key: null,
    created_by: 'usr-001',
    created_at: '2026-01-12T00:00:00Z',
    updated_at: '2026-01-12T00:00:00Z',
    version_count: 1,
    active_version: null,
  },
];

describe('WorkflowsPage Catalog Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'usr-001',
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

    vi.spyOn(WorkflowServiceModule, 'listWorkflows').mockResolvedValue({
      items: mockWorkflows,
      total: 2,
      page: 1,
      page_size: 20,
      total_pages: 1,
    });
  });

  it('renders workflow catalog header, filters, and workflow cards', async () => {
    render(
      <MemoryRouter>
        <WorkflowsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Workflow Orchestration')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search workflows by name or description/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Inbound Lead Qualification')).toBeInTheDocument();
      expect(screen.getByText('Customer Support Escalation')).toBeInTheDocument();
    });

    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('DRAFT').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Active: v1')).toBeInTheDocument();
  });

  it('filters workflows based on search input query', async () => {
    render(
      <MemoryRouter>
        <WorkflowsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Inbound Lead Qualification')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search workflows by name or description/i);
    fireEvent.change(searchInput, { target: { value: 'Escalation' } });

    expect(screen.queryByText('Inbound Lead Qualification')).not.toBeInTheDocument();
    expect(screen.getByText('Customer Support Escalation')).toBeInTheDocument();
  });

  it('filters workflows by clicking status tabs', async () => {
    render(
      <MemoryRouter>
        <WorkflowsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Inbound Lead Qualification')).toBeInTheDocument();
    });

    const activeTab = screen.getByRole('button', { name: 'ACTIVE' });
    fireEvent.click(activeTab);

    expect(WorkflowServiceModule.listWorkflows).toHaveBeenCalledWith('org-test-1', {
      status: 'ACTIVE',
    });
  });

  it('opens New Workflow modal and submits creation', async () => {
    const createdWorkflow: Workflow = {
      id: 'wf-003',
      organization_id: 'org-test-1',
      name: 'Automated Invoice Generator',
      description: 'Generate invoices upon completion',
      status: WorkflowStatus.DRAFT,
      active_version_id: null,
      webhook_key: null,
      created_by: 'usr-001',
      created_at: '2026-01-15T00:00:00Z',
      updated_at: '2026-01-15T00:00:00Z',
      version_count: 1,
      active_version: null,
    };

    vi.spyOn(WorkflowServiceModule, 'createWorkflow').mockResolvedValue(createdWorkflow);

    render(
      <MemoryRouter>
        <WorkflowsPage />
      </MemoryRouter>
    );

    const newBtn = screen.getByRole('button', { name: /New Workflow/i });
    fireEvent.click(newBtn);

    expect(screen.getByText('Create New Workflow')).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/e\.g\. Inbound Lead Qualification/i);
    fireEvent.change(nameInput, { target: { value: 'Automated Invoice Generator' } });

    const submitBtn = screen.getByRole('button', { name: /Create & Open Editor/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(WorkflowServiceModule.createWorkflow).toHaveBeenCalledWith('org-test-1', {
        name: 'Automated Invoice Generator',
        description: undefined,
      });
    });
  });

  it('enforces RBAC by hiding New Workflow button for VIEWER role', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'usr-viewer',
        email: 'viewer@acme.com',
        full_name: 'Viewer User',
        is_active: true,
        is_superuser: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      organizations: [mockOrg],
      activeOrganization: mockOrg,
      activeRole: 'VIEWER',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
      refreshProfile: vi.fn(),
    });

    render(
      <MemoryRouter>
        <WorkflowsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Inbound Lead Qualification')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /New Workflow/i })).not.toBeInTheDocument();
  });
});
