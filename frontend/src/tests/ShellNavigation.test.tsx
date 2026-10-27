import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { StatusBadge } from '../components/ui/StatusBadge';
import { MetricCard } from '../components/ui/MetricCard';

const renderSidebar = (path: string, props: React.ComponentProps<typeof Sidebar> = {}) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar {...props} />
    </MemoryRouter>
  );

describe('Sidebar navigation', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('renders every group and link', () => {
    renderSidebar('/dashboard');
    for (const group of ['Workspace', 'Operations', 'Governance', 'Settings']) {
      expect(screen.getAllByText(group).length).toBeGreaterThan(0);
    }
    const nav = screen.getByRole('navigation', { name: /Main Navigation/i });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/dashboard',
      '/workflows',
      '/executions',
      '/approvals',
      '/integrations',
      '/analytics',
      '/analytics#sla',
      '/audit',
      '/status',
      '/settings',
    ]);
  });

  it('marks only the active route with aria-current=page and indigo styling', () => {
    renderSidebar('/workflows/abc');
    const nav = screen.getByRole('navigation', { name: /Main Navigation/i });
    const current = within(nav)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/workflows');
    expect(current[0].className).toContain('bg-brand-50');
    expect(current[0].className).toContain('font-semibold');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('distinguishes Analytics from SLA Monitoring by hash', () => {
    renderSidebar('/analytics#sla');
    expect(screen.getByRole('link', { name: 'SLA Monitoring' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Analytics' })).not.toHaveAttribute('aria-current');
  });

  it('shows the profile block when a profile is provided', () => {
    renderSidebar('/dashboard', { profile: { name: 'Alex Vance', role: 'OWNER' } });
    const block = screen.getByTestId('sidebar-profile');
    expect(within(block).getByText('Alex Vance')).toBeInTheDocument();
    expect(within(block).getByText('owner')).toBeInTheDocument();
  });

  it('collapses and expands the desktop sidebar', () => {
    renderSidebar('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: /Collapse sidebar/i }));
    expect(screen.getByRole('button', { name: /Expand sidebar/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('Mobile navigation drawer', () => {
  const Harness = () => {
    const [open, setOpen] = React.useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          open-nav
        </button>
        <Sidebar isMobileOpen={open} onCloseMobile={() => setOpen(false)} />
        <Link to="/executions">go-executions</Link>
      </>
    );
  };
  const renderHarness = () =>
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>
    );

  it('is a labelled modal dialog that focuses inside on open', () => {
    renderHarness();
    const dialog = screen.getByRole('dialog', { name: /Navigation menu/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', () => {
    renderHarness();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the overlay is clicked', () => {
    renderHarness();
    fireEvent.click(screen.getByTestId('mobile-nav-overlay'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on the close button and when a nav link is chosen', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: /Close mobile navigation/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('open-nav'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('link', { name: 'Executions' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the route changes elsewhere', () => {
    renderHarness();
    fireEvent.click(screen.getByText('go-executions'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('traps Tab focus inside the drawer', () => {
    renderHarness();
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>('a[href], button');
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe('Semantic status colours', () => {
  it.each(['ACTIVE', 'COMPLETED', 'APPROVED', 'HEALTHY'])('%s renders as emerald (success)', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('emerald');
    expect(badge.className).not.toContain('brand-');
  });

  it('RUNNING is indigo, not success green', () => {
    const { container } = render(<StatusBadge status="RUNNING" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('brand-');
    expect(badge.className).not.toContain('emerald');
  });

  it('FAILED is red and PENDING is amber', () => {
    expect((render(<StatusBadge status="FAILED" />).container.firstElementChild as HTMLElement).className).toContain('red');
    expect((render(<StatusBadge status="PENDING" />).container.firstElementChild as HTMLElement).className).toContain('amber');
  });

  it('MetricCard success variant is emerald and default is neutral', () => {
    const Icon = () => <svg />;
    const { container, rerender } = render(
      <MemoryRouter>
        <MetricCard label="Success" value={1} icon={Icon as never} variant="success" />
      </MemoryRouter>
    );
    expect(container.innerHTML).toContain('emerald');
    expect(container.innerHTML).not.toMatch(/bg-brand-50/);
    rerender(
      <MemoryRouter>
        <MetricCard label="Total" value={1} icon={Icon as never} />
      </MemoryRouter>
    );
    expect(container.innerHTML).not.toContain('emerald');
  });
});
