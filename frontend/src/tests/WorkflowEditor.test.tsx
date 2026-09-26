import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkflowEditorPage } from '../pages/workflows/WorkflowEditorPage';
import * as AuthContextModule from '../context/AuthContext';
import * as WorkflowServiceModule from '../services/workflowService';
import {
  Workflow,
  WorkflowVersionDetail,
  StepType,
  WorkflowStatus,
} from '../types/workflow';
import {
  validateWorkflowGraph,
  WorkflowNodeData,
  WorkflowEdgeData,
} from '../utils/workflowGraphValidator';
import { Node, Edge } from '@xyflow/react';

// Mock ResizeObserver for React Flow in JSDOM environment
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mockOrg = {
  id: 'org-test-1',
  name: 'Acme Test Corp',
  slug: 'acme-test',
  role: 'ADMIN' as any,
  created_at: '2026-01-01T00:00:00Z',
};

const mockWorkflow: Workflow = {
  id: 'wf-001',
  organization_id: 'org-test-1',
  name: 'Enterprise Lead Pipeline',
  description: 'Validates and routes inbound leads',
  status: WorkflowStatus.DRAFT,
  active_version_id: 'ver-001',
  webhook_key: 'whk_lead_pipe',
  created_by: 'usr-001',
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
  version_count: 1,
  active_version: null,
};

const mockVersionDetail: WorkflowVersionDetail = {
  id: 'ver-001',
  workflow_id: 'wf-001',
  version_number: 1,
  status: 'DRAFT',
  definition: {},
  created_by: 'usr-001',
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
  steps: [
    {
      id: 'step-01',
      workflow_version_id: 'ver-001',
      step_key: 'inbound_webhook',
      step_type: StepType.WEBHOOK_TRIGGER,
      name: 'Inbound Webhook',
      config: { allowed_methods: ['POST'] },
      ui_position: { x: 100, y: 100 },
    },
    {
      id: 'step-02',
      workflow_version_id: 'ver-001',
      step_key: 'validate_payload',
      step_type: StepType.VALIDATE_DATA,
      name: 'Validate Payload',
      config: { required_fields: ['email', 'company'] },
      ui_position: { x: 100, y: 250 },
    },
  ],
  connections: [
    {
      id: 'conn-01',
      workflow_version_id: 'ver-001',
      source_step_id: 'step-01',
      target_step_id: 'step-02',
      condition_label: null,
    },
  ],
};

describe('WorkflowEditor Visual Builder Tests', () => {
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

    vi.spyOn(WorkflowServiceModule, 'getWorkflow').mockResolvedValue(mockWorkflow);
    vi.spyOn(WorkflowServiceModule, 'listWorkflowVersions').mockResolvedValue([
      {
        id: 'ver-001',
        workflow_id: 'wf-001',
        version_number: 1,
        status: 'DRAFT',
        created_by: 'usr-001',
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      },
    ]);
    vi.spyOn(WorkflowServiceModule, 'getWorkflowVersion').mockResolvedValue(mockVersionDetail);
    vi.spyOn(WorkflowServiceModule, 'updateWorkflowVersion').mockResolvedValue(mockVersionDetail);
    vi.spyOn(WorkflowServiceModule, 'validateWorkflowVersion').mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });
    vi.spyOn(WorkflowServiceModule, 'publishWorkflowVersion').mockResolvedValue({
      id: 'ver-001',
      workflow_id: 'wf-001',
      version_number: 1,
      status: 'PUBLISHED',
      created_by: 'usr-001',
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    });
  });

  it('loads workflow version data and renders toolbar and nodes', async () => {
    render(
      <MemoryRouter initialEntries={['/workflows/wf-001']}>
        <Routes>
          <Route path="/workflows/:workflowId" element={<WorkflowEditorPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Enterprise Lead Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Inbound Webhook')).toBeInTheDocument();
      expect(screen.getByText('Validate Payload')).toBeInTheDocument();
    });

    expect(screen.getByText('Save Draft')).toBeInTheDocument();
    expect(screen.getByText('Publish Version')).toBeInTheDocument();
    expect(screen.getByText('Validate')).toBeInTheDocument();
    expect(screen.getByText(/Node Palette/i)).toBeInTheDocument();
  });

  it('selects a node and opens configuration panel with editable fields', async () => {
    render(
      <MemoryRouter initialEntries={['/workflows/wf-001']}>
        <Routes>
          <Route path="/workflows/:workflowId" element={<WorkflowEditorPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Validate Payload')).toBeInTheDocument();
    });

    const stepNode = screen.getByText('Validate Payload');
    fireEvent.click(stepNode);

    await waitFor(() => {
      expect(screen.getByText('Step Configuration')).toBeInTheDocument();
      expect(screen.getByText('VALIDATE_DATA')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Validate Payload')).toBeInTheDocument();
      expect(screen.getByDisplayValue('validate_payload')).toBeInTheDocument();
    });
  });

  it('executes client-side validation logic correctly', () => {
    // 1. Missing trigger test
    const nodesWithoutTrigger: Node<WorkflowNodeData>[] = [
      {
        id: 'node-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          step_key: 'validate_step',
          step_type: StepType.VALIDATE_DATA,
          name: 'Validate',
          config: { required_fields: ['email'] },
        },
      },
    ];
    const validationResult1 = validateWorkflowGraph(nodesWithoutTrigger, []);
    expect(validationResult1.valid).toBe(false);
    expect(validationResult1.errors).toContain(
      'Workflow must contain exactly one trigger step (WEBHOOK_TRIGGER or MANUAL_TRIGGER)'
    );

    // 2. Valid trigger + node connected
    const validNodes: Node<WorkflowNodeData>[] = [
      {
        id: 'node-trig',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          step_key: 'start',
          step_type: StepType.MANUAL_TRIGGER,
          name: 'Start',
          config: {},
        },
      },
      {
        id: 'node-proc',
        type: 'workflowNode',
        position: { x: 0, y: 100 },
        data: {
          step_key: 'check',
          step_type: StepType.VALIDATE_DATA,
          name: 'Check',
          config: { required_fields: ['id'] },
        },
      },
    ];
    const validEdges: Edge<WorkflowEdgeData>[] = [
      {
        id: 'e1',
        source: 'node-trig',
        target: 'node-proc',
      },
    ];
    const validationResult2 = validateWorkflowGraph(validNodes, validEdges);
    expect(validationResult2.valid).toBe(true);
    expect(validationResult2.errors).toHaveLength(0);

    // 3. Cycle detection test (Kahn's Algorithm)
    const cyclicEdges: Edge<WorkflowEdgeData>[] = [
      { id: 'e1', source: 'node-trig', target: 'node-proc' },
      { id: 'e2', source: 'node-proc', target: 'node-trig' },
    ];
    const validationResult3 = validateWorkflowGraph(validNodes, cyclicEdges);
    expect(validationResult3.valid).toBe(false);
    expect(
      validationResult3.errors.some((e) => e.includes('circular') || e.includes('cannot be the target'))
    ).toBe(true);
  });

  it('runs authoritative validate endpoint when Validate button is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/workflows/wf-001']}>
        <Routes>
          <Route path="/workflows/:workflowId" element={<WorkflowEditorPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Enterprise Lead Pipeline')).toBeInTheDocument();
    });

    const validateBtn = screen.getByRole('button', { name: /Validate/i });
    fireEvent.click(validateBtn);

    await waitFor(() => {
      expect(WorkflowServiceModule.validateWorkflowVersion).toHaveBeenCalledWith(
        'org-test-1',
        'wf-001',
        'ver-001'
      );
    });
  });

  it('enforces read-only canvas mode for VIEWER role', async () => {
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
      <MemoryRouter initialEntries={['/workflows/wf-001']}>
        <Routes>
          <Route path="/workflows/:workflowId" element={<WorkflowEditorPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Enterprise Lead Pipeline')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Read-Only/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Save Draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Publish Version')).not.toBeInTheDocument();
  });
});
