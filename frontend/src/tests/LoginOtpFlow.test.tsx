import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/auth/LoginPage';
import * as AuthContextModule from '../context/AuthContext';

function mockAuth(over: Record<string, unknown>) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: null,
    organizations: [],
    activeOrganization: null,
    activeRole: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    verifyLoginOtp: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    switchOrganization: vi.fn(),
    refreshProfile: vi.fn(),
    ...over,
  } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>Dashboard Home Target</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Login with a 6-digit code (two steps)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows the code step after the password step, then signs in with the code', async () => {
    const login = vi.fn().mockResolvedValue({ message: 'sent', email: 'pilot@example.com', requires_otp: true });
    const verifyLoginOtp = vi.fn().mockResolvedValue(undefined);
    mockAuth({ login, verifyLoginOtp });
    renderLogin();

    fireEvent.change(screen.getByLabelText(/Work Email/i), { target: { value: 'pilot@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(await screen.findByText(/6-Digit Verification Code/i)).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1); // one code is sent, not one per click

    const boxes = document.querySelectorAll('input[autocomplete="one-time-code"]');
    expect(boxes).toHaveLength(6);
    fireEvent.change(boxes[0], { target: { value: '123456' } }); // paste fills all six

    fireEvent.click(screen.getByRole('button', { name: /Verify & Sign In/i }));
    await waitFor(() => expect(verifyLoginOtp).toHaveBeenCalledWith({ email: 'pilot@example.com', code: '123456' }));
    expect(await screen.findByText('Dashboard Home Target')).toBeInTheDocument();
  });

  it('stays on the code step and shows the error when the code is wrong', async () => {
    const login = vi.fn().mockResolvedValue({ message: 'sent', email: 'pilot@example.com', requires_otp: true });
    const verifyLoginOtp = vi.fn().mockRejectedValue(new Error('Invalid or expired verification code.'));
    mockAuth({ login, verifyLoginOtp });
    renderLogin();

    fireEvent.change(screen.getByLabelText(/Work Email/i), { target: { value: 'pilot@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Secret123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await screen.findByText(/6-Digit Verification Code/i);

    fireEvent.change(document.querySelectorAll('input[autocomplete="one-time-code"]')[0], { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify & Sign In/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid or expired/i);
    expect(screen.getByText(/6-Digit Verification Code/i)).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);
  });
});
