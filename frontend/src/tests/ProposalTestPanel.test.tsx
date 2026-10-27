import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { WorkflowsPage } from '../pages/workflows/WorkflowsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as WorkflowServiceModule from '../services/workflowService';
import { Workflow } from '../types/workflow';

describe('WorkflowsPage last-run status', () => {
  const base = (id: string, name: string, extra: Partial<Workflow>): Workflow => ({
    id, organization_id: 'org-1', name, description: '', status: 'DRAFT', active_version_id: null,
    created_by: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version_count: 1, ...extra,
  });

  it('shows failed, completed and never-run states as text', async () => {
    vi.restoreAllMocks();
    const org = { id: 'org-1', name: 'Acme', slug: 'a', role: 'ADMIN', created_at: '' };
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({ activeOrganization: org, activeRole: 'ADMIN' } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
    vi.spyOn(WorkflowServiceModule, 'getAITemplates').mockResolvedValue([]);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    vi.spyOn(WorkflowServiceModule, 'listWorkflows').mockResolvedValue({
      items: [
        base('a', 'Alpha', { last_run_status: 'FAILED', last_run_at: twoHoursAgo }),
        base('b', 'Beta', { last_run_status: 'COMPLETED', last_run_at: twoHoursAgo }),
        base('c', 'Gamma', { last_run_status: null, last_run_at: null }),
      ],
      total: 3, page: 1, page_size: 20, total_pages: 1,
    });
    render(<MemoryRouter><WorkflowsPage /></MemoryRouter>);
    expect(await screen.findByText('Last run: Failed 2h ago')).toBeInTheDocument();
    expect(screen.getByText('Last run: Completed 2h ago')).toBeInTheDocument();
    expect(screen.getByText('Never run')).toBeInTheDocument();
  });
});
