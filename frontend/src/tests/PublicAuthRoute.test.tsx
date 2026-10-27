import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PublicAuthRoute } from '../routes/AppRoutes';
import * as AuthContextModule from '../context/AuthContext';

function mockAuth(isLoading: boolean, isAuthenticated = false) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    isLoading,
    isAuthenticated,
  } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
}

function tree() {
  return (
    <MemoryRouter>
      <PublicAuthRoute>
        <div>login form</div>
      </PublicAuthRoute>
    </MemoryRouter>
  );
}

describe('PublicAuthRoute', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders nothing while the session is first being restored, then the form', () => {
    mockAuth(true);
    const { rerender } = render(tree());
    expect(screen.queryByText('login form')).not.toBeInTheDocument();

    mockAuth(false);
    rerender(tree());
    expect(screen.getByText('login form')).toBeInTheDocument();
  });

  it('keeps the form mounted when a later request (login, verify code) flips isLoading', () => {
    // Regression: hiding the form during login() unmounted the page, which reset it to the password step, so the
    // "enter your code" screen never appeared and every retry sent another code.
    mockAuth(false);
    const { rerender } = render(tree());
    expect(screen.getByText('login form')).toBeInTheDocument();

    mockAuth(true);
    rerender(tree());
    expect(screen.getByText('login form')).toBeInTheDocument();

    mockAuth(false);
    rerender(tree());
    expect(screen.getByText('login form')).toBeInTheDocument();
  });
});
