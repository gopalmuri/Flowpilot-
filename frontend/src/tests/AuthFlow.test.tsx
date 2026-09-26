import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { AuthProvider, useAuth } from '../context/AuthContext';
import * as AuthContextModule from '../context/AuthContext';
import * as authService from '../services/authService';
import * as apiClient from '../services/apiClient';

describe('Authentication Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('LoginPage Component', () => {
    it('submits credentials and navigates to dashboard on success', async () => {
      const mockLogin = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: null,
        organizations: [],
        activeOrganization: null,
        activeRole: null,
        isAuthenticated: false,
        isLoading: false,
        login: mockLogin,
        register: vi.fn(),
        logout: vi.fn(),
        switchOrganization: vi.fn(),
        refreshProfile: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<div>Dashboard Home Target</div>} />
          </Routes>
        </MemoryRouter>
      );

      const emailInput = screen.getByLabelText(/Work Email/i);
      const passwordInput = screen.getByLabelText(/^Password$/i);
      const submitBtn = screen.getByRole('button', { name: /Sign In/i });

      fireEvent.change(emailInput, { target: { value: 'pilot@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'Secret123!' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith({
          email: 'pilot@example.com',
          password: 'Secret123!',
        });
        expect(screen.getByText('Dashboard Home Target')).toBeInTheDocument();
      });
    });

    it('displays error alert when login fails', async () => {
      const mockLogin = vi.fn().mockRejectedValue(new Error('Invalid email or password. Please try again.'));
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: null,
        organizations: [],
        activeOrganization: null,
        activeRole: null,
        isAuthenticated: false,
        isLoading: false,
        login: mockLogin,
        register: vi.fn(),
        logout: vi.fn(),
        switchOrganization: vi.fn(),
        refreshProfile: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/Work Email/i), {
        target: { value: 'wrong@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'WrongPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/Invalid email or password/i)).toBeInTheDocument();
      });
    });

    it('preserves and navigates to redirect path after login', async () => {
      const mockLogin = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: null,
        organizations: [],
        activeOrganization: null,
        activeRole: null,
        isAuthenticated: false,
        isLoading: false,
        login: mockLogin,
        register: vi.fn(),
        logout: vi.fn(),
        switchOrganization: vi.fn(),
        refreshProfile: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/login?redirect=%2Fworkflows%3Fstatus%3Dactive']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/workflows" element={<div>Workflows Filtered Target</div>} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/Work Email/i), {
        target: { value: 'pilot@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'Secret123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith({
          email: 'pilot@example.com',
          password: 'Secret123!',
        });
        expect(screen.getByText('Workflows Filtered Target')).toBeInTheDocument();
      });
    });
  });

  describe('RegisterPage Component', () => {
    it('enforces password complexity checklist before enabling submit button', async () => {
      const mockRegister = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: null,
        organizations: [],
        activeOrganization: null,
        activeRole: null,
        isAuthenticated: false,
        isLoading: false,
        login: vi.fn(),
        register: mockRegister,
        logout: vi.fn(),
        switchOrganization: vi.fn(),
        refreshProfile: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/dashboard" element={<div>Dashboard Target</div>} />
          </Routes>
        </MemoryRouter>
      );

      const submitBtn = screen.getByRole('button', { name: /Create Account/i });
      expect(submitBtn).toBeDisabled();

      const nameInput = screen.getByLabelText(/Full Name/i);
      const emailInput = screen.getByLabelText(/Work Email/i);
      const passwordInput = screen.getByLabelText(/Master Password/i);

      fireEvent.change(nameInput, { target: { value: 'Alex Morgan' } });
      fireEvent.change(emailInput, { target: { value: 'alex@example.com' } });

      // Weak: only lowercase
      fireEvent.change(passwordInput, { target: { value: 'short' } });
      expect(submitBtn).toBeDisabled();

      // Missing special character and length
      fireEvent.change(passwordInput, { target: { value: 'Aa1' } });
      expect(submitBtn).toBeDisabled();

      // Valid password meeting all 5 requirements: >= 10 chars, uppercase, lowercase, digit, special
      fireEvent.change(passwordInput, { target: { value: 'SuperSecret123!' } });
      expect(submitBtn).not.toBeDisabled();

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith({
          email: 'alex@example.com',
          full_name: 'Alex Morgan',
          password: 'SuperSecret123!',
          organization_name: undefined,
        });
        expect(screen.getByText('Dashboard Target')).toBeInTheDocument();
      });
    });
  });

  describe('AuthProvider Session & Logout', () => {
    it('restores user session on mount via silent token refresh', async () => {
      vi.spyOn(apiClient, 'requestTokenRefresh').mockResolvedValue('refreshed_access_token');
      vi.spyOn(authService, 'fetchCurrentUser').mockResolvedValue({
        user: {
          id: 'usr-42',
          email: 'restored@flowpilot.internal',
          full_name: 'Restored Commander',
          is_active: true,
          is_superuser: false,
          created_at: new Date().toISOString(),
        },
        organizations: [
          { id: 'org-42', name: 'Alpha Org', slug: 'alpha', role: 'ADMIN' },
        ],
        active_organization_id: 'org-42',
        active_role: 'ADMIN',
      });

      const ConsumerComponent = () => {
        const { user, activeOrganization, activeRole, isLoading } = useAuth();
        if (isLoading) return <div>Session Loading...</div>;
        return (
          <div>
            <div data-testid="user-email">{user?.email}</div>
            <div data-testid="org-name">{activeOrganization?.name}</div>
            <div data-testid="active-role">{activeRole}</div>
          </div>
        );
      };

      render(
        <AuthProvider>
          <ConsumerComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('user-email')).toHaveTextContent('restored@flowpilot.internal');
        expect(screen.getByTestId('org-name')).toHaveTextContent('Alpha Org');
        expect(screen.getByTestId('active-role')).toHaveTextContent('ADMIN');
      });
    });

    it('ensures logout clears frontend auth state even if server logout request rejects', async () => {
      vi.spyOn(apiClient, 'requestTokenRefresh').mockResolvedValue('token');
      vi.spyOn(authService, 'fetchCurrentUser').mockResolvedValue({
        user: {
          id: 'usr-1',
          email: 'logout@test.com',
          full_name: 'Logout Test',
          is_active: true,
          is_superuser: false,
          created_at: new Date().toISOString(),
        },
        organizations: [{ id: 'org-1', name: 'Org 1', slug: 'org1', role: 'VIEWER' }],
        active_organization_id: 'org-1',
        active_role: 'VIEWER',
      });
      // Server error on logout
      vi.spyOn(authService, 'logoutUser').mockRejectedValue(new Error('500 Internal Server Error'));

      const TestLogoutComponent = () => {
        const { user, isAuthenticated, logout } = useAuth();
        return (
          <div>
            <div data-testid="auth-state">{isAuthenticated ? 'LOGGED_IN' : 'LOGGED_OUT'}</div>
            <div data-testid="user-status">{user ? user.email : 'NONE'}</div>
            <button onClick={() => logout()}>Trigger Logout</button>
          </div>
        );
      };

      render(
        <AuthProvider>
          <TestLogoutComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('auth-state')).toHaveTextContent('LOGGED_IN');
      });

      fireEvent.click(screen.getByText('Trigger Logout'));

      await waitFor(() => {
        expect(screen.getByTestId('auth-state')).toHaveTextContent('LOGGED_OUT');
        expect(screen.getByTestId('user-status')).toHaveTextContent('NONE');
      });
    });
  });
});
