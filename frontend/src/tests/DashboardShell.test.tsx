import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Header } from '../components/layout/Header';
import { Sidebar } from '../components/layout/Sidebar';
import { DashboardLayout } from '../layouts/DashboardLayout';
import * as AuthContextModule from '../context/AuthContext';
import { OrganizationSummary, User } from '../types/auth';

const mockUser: User = {
  id: 'usr-pilot-1',
  email: 'pilot@flowpilot.internal',
  full_name: 'Alex Vance',
  is_active: true,
  is_superuser: false,
  created_at: new Date().toISOString(),
};

const mockOrganizations: OrganizationSummary[] = [
  {
    id: 'org-1',
    name: 'Primary Enterprise',
    slug: 'primary-ent',
    role: 'OWNER',
  },
  {
    id: 'org-2',
    name: 'Secondary Logistics',
    slug: 'secondary-logistics',
    role: 'ADMIN',
  },
];

describe('Dashboard Shell & Navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'healthy' }),
    });
  });

  describe('Header Component', () => {
    it('displays user name, email, initials, and verified role badge', async () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: mockUser,
        organizations: mockOrganizations,
        activeOrganization: mockOrganizations[0],
        activeRole: 'OWNER',
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
          <Header />
        </MemoryRouter>
      );

      // Verify initials "AV" for Alex Vance
      expect(screen.getByText('AV')).toBeInTheDocument();
      // Verify user full name
      expect(screen.getByText('Alex Vance')).toBeInTheDocument();
      // Verify active role
      expect(screen.getAllByText(/OWNER/i).length).toBeGreaterThan(0);
      // Verify active org name
      expect(screen.getByText('Primary Enterprise')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText(/healthy/i)).toBeInTheDocument();
      });
    });

    it('opens organization switcher dropdown and triggers switchOrganization upon selecting another org', async () => {
      const mockSwitchOrg = vi.fn();
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: mockUser,
        organizations: mockOrganizations,
        activeOrganization: mockOrganizations[0],
        activeRole: 'OWNER',
        isAuthenticated: true,
        isLoading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        switchOrganization: mockSwitchOrg,
        refreshProfile: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/healthy/i)).toBeInTheDocument();
      });

      // Click the org switcher button
      const orgButton = screen.getByRole('button', { name: /Select active organization/i });
      fireEvent.click(orgButton);

      // Verify dropdown displays organizations
      expect(screen.getByText('Your Organizations')).toBeInTheDocument();
      expect(screen.getByText('Secondary Logistics')).toBeInTheDocument();

      // Click the second organization
      fireEvent.click(screen.getByText('Secondary Logistics'));

      expect(mockSwitchOrg).toHaveBeenCalledWith('org-2');
    });

    it('opens user menu and invokes logout when sign out is clicked', async () => {
      const mockLogout = vi.fn();
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: mockUser,
        organizations: mockOrganizations,
        activeOrganization: mockOrganizations[0],
        activeRole: 'OWNER',
        isAuthenticated: true,
        isLoading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: mockLogout,
        switchOrganization: vi.fn(),
        refreshProfile: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/healthy/i)).toBeInTheDocument();
      });

      // Open user dropdown
      const userButton = screen.getByRole('button', { name: /User profile and account settings/i });
      fireEvent.click(userButton);

      // Find Sign out button
      const signOutBtn = screen.getByRole('button', { name: /Sign out/i });
      expect(signOutBtn).toBeInTheDocument();

      fireEvent.click(signOutBtn);
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sidebar Navigation', () => {
    it('renders all 7 navigation items with correct links', () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar />
        </MemoryRouter>
      );

      const nav = screen.getByRole('navigation', { name: /Main Navigation/i });
      expect(nav).toBeInTheDocument();

      // Check all 7 links exist
      expect(screen.getByRole('link', { name: /Dashboard/i })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('link', { name: /Workflows/i })).toHaveAttribute('href', '/workflows');
      expect(screen.getByRole('link', { name: /Integrations/i })).toHaveAttribute('href', '/integrations');
      expect(screen.getByRole('link', { name: /Executions/i })).toHaveAttribute('href', '/executions');
      expect(screen.getByRole('link', { name: /Approvals/i })).toHaveAttribute('href', '/approvals');
      expect(screen.getByRole('link', { name: /Settings/i })).toHaveAttribute('href', '/settings');
      expect(screen.getByRole('link', { name: /System Status/i })).toHaveAttribute('href', '/status');
    });

    it('manages mobile drawer open and close interactions', () => {
      const mockCloseMobile = vi.fn();

      const { rerender } = render(
        <MemoryRouter>
          <Sidebar isMobileOpen={false} onCloseMobile={mockCloseMobile} />
        </MemoryRouter>
      );

      // When closed, dialog is not in document
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Rerender with isMobileOpen = true
      rerender(
        <MemoryRouter>
          <Sidebar isMobileOpen={true} onCloseMobile={mockCloseMobile} />
        </MemoryRouter>
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Click close button inside mobile drawer
      const closeBtn = screen.getByRole('button', { name: /Close mobile navigation/i });
      fireEvent.click(closeBtn);
      expect(mockCloseMobile).toHaveBeenCalledTimes(1);
    });
  });

  describe('DashboardLayout Integration', () => {
    it('integrates Header and Sidebar and renders nested route outlet', async () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: mockUser,
        organizations: mockOrganizations,
        activeOrganization: mockOrganizations[0],
        activeRole: 'OWNER',
        isAuthenticated: true,
        isLoading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        switchOrganization: vi.fn(),
        refreshProfile: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route element={<DashboardLayout />}>
              <Route path="/dashboard" element={<div>Dashboard Child View</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('FlowPilot')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Child View')).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: /Main Navigation/i })).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText(/healthy/i)).toBeInTheDocument();
      });
    });
  });
});
