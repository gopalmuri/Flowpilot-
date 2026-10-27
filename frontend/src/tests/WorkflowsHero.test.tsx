import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WorkflowsPage } from '../pages/workflows/WorkflowsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as WorkflowServiceModule from '../services/workflowService';

const mockOrg = { id: 'org-1', name: 'Acme', slug: 'acme', role: 'ADMIN' as never, created_at: '2026-01-01T00:00:00Z' };

const BuilderProbe: React.FC = () => {
  const loc = useLocation();
  return <div>Builder page: {(loc.state as { prompt?: string } | null)?.prompt}</div>;
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/workflows']}>
      <Routes>
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/new/ai" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function mockAuth(role: string) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: null,
    organizations: [mockOrg],
    activeOrganization: mockOrg,
    activeRole: role,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    switchOrganization: vi.fn(),
    refreshProfile: vi.fn(),
  } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
}

describe('WorkflowsPage prompt-first hero', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuth('ADMIN');
    vi.spyOn(WorkflowServiceModule, 'listWorkflows').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
      total_pages: 1,
    });
    vi.spyOn(WorkflowServiceModule, 'getAITemplates').mockResolvedValue([
      { id: 't1', title: 'Lead alerts', description: 'Tell sales about new leads', prompt: 'Alert sales when a lead arrives', category: 'sales', uses: [] },
    ]);
  });

  it('submits the typed prompt with the button and opens the AI builder', async () => {
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to automate?' }), {
      target: { value: 'Send a thank-you email after each order' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Build with AI/i }));
    expect(await screen.findByText('Builder page: Send a thank-you email after each order')).toBeInTheDocument();
  });

  it('submits on Enter but not on Shift+Enter', async () => {
    renderPage();
    const box = screen.getByRole('textbox', { name: 'What do you want to automate?' });
    fireEvent.change(box, { target: { value: 'Remind me about unpaid invoices' } });

    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(screen.queryByText(/Builder page/)).not.toBeInTheDocument();

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Builder page: Remind me about unpaid invoices')).toBeInTheDocument();
  });

  it('does not submit an empty prompt', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Build with AI/i })).toBeDisabled();
  });

  it('fills the box when an example chip is clicked', () => {
    renderPage();
    const chip = screen.getByRole('button', { name: 'Follow up new leads' });
    fireEvent.click(chip);
    expect(screen.getByRole('textbox', { name: 'What do you want to automate?' })).toHaveValue(
      'When a new lead comes in, sort it by size and tell the sales team on Slack'
    );
  });

  it('keeps templates out of the way until asked, then opens the builder with the template prompt', async () => {
    renderPage();
    await waitFor(() => expect(WorkflowServiceModule.getAITemplates).toHaveBeenCalled());
    expect(screen.queryByText('Lead alerts')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /More templates/i }));
    fireEvent.click(await screen.findByText('Lead alerts'));
    expect(await screen.findByText('Builder page: Alert sales when a lead arrives')).toBeInTheDocument();
  });

  it('hides the templates row quietly when they cannot load', async () => {
    vi.spyOn(WorkflowServiceModule, 'getAITemplates').mockRejectedValue(new Error('offline'));
    renderPage();
    await waitFor(() => expect(WorkflowServiceModule.getAITemplates).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /templates/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Build with AI/i })).toBeInTheDocument();
  });

  it('hides the hero for roles that cannot create workflows', () => {
    mockAuth('VIEWER');
    renderPage();
    expect(screen.queryByRole('textbox', { name: 'What do you want to automate?' })).not.toBeInTheDocument();
  });
});
