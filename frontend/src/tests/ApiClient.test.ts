import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  apiRequest,
  setTokens,
  clearAuthStorage,
  getAccessToken,
  setActiveOrganizationId,
  setOnAuthFailure,
} from '../services/apiClient';

describe('ApiClient', () => {
  beforeEach(() => {
    clearAuthStorage();
    vi.restoreAllMocks();
  });

  it('attaches Authorization and X-Organization-Id headers to requests', async () => {
    setTokens('mock_access_token');
    setActiveOrganizationId('org-uuid-123');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;

    await apiRequest('/api/v1/test');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer mock_access_token');
    expect(options.headers['X-Organization-Id']).toBe('org-uuid-123');
  });

  it('intercepts 401, triggers refresh, and retries original request', async () => {
    setTokens('expired_token', 'valid_refresh_token');

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new_fresh_token',
            refresh_token: 'new_refresh_token',
            token_type: 'bearer',
            expires_in: 1800,
          }),
        });
      }

      // First call fails with 401, second retry succeeds with 200
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ detail: 'Token expired' }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: 'secret_data' }),
      });
    });
    global.fetch = mockFetch;

    const result = await apiRequest('/api/v1/resource');
    expect(result).toEqual({ data: 'secret_data' });
    expect(getAccessToken()).toBe('new_fresh_token');
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1: original, 2: refresh, 3: retry
  });

  it('deduplicates concurrent refresh requests when multiple 401s occur', async () => {
    setTokens('expired_token');

    let refreshCallCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCallCount++;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              json: async () => ({
                access_token: 'shared_new_token',
                refresh_token: 'shared_refresh_token',
                token_type: 'bearer',
                expires_in: 1800,
              }),
            });
          }, 20);
        });
      }

      // Original request fails with 401 on first try
      const hasAuth = (mockFetch as any).mock?.calls?.some(
        (c: any) => c[1]?.headers?.Authorization === 'Bearer shared_new_token'
      );
      if (hasAuth) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });
      }

      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Unauthorized' }),
      });
    });
    global.fetch = mockFetch;

    // Trigger two concurrent requests that both 401
    const p1 = apiRequest('/api/v1/data1');
    const p2 = apiRequest('/api/v1/data2');

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ success: true });
    expect(r2).toEqual({ success: true });
    // Crucial: Only 1 refresh request was executed!
    expect(refreshCallCount).toBe(1);
  });

  it('clears auth storage and calls onAuthFailure when token refresh fails', async () => {
    setTokens('expired_token');
    const failureHandler = vi.fn();
    setOnAuthFailure(failureHandler);

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ detail: 'Refresh token invalid' }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Unauthorized' }),
      });
    });
    global.fetch = mockFetch;

    await expect(apiRequest('/api/v1/protected')).rejects.toThrow(/Session expired/);
    expect(getAccessToken()).toBeNull();
    expect(failureHandler).toHaveBeenCalledTimes(1);
  });
});
