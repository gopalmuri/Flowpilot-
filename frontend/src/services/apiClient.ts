import { TokenResponse } from '../types/auth';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

// Secure in-memory token storage (XSS protected: NOT stored in localStorage)
let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;
let activeOrganizationId: string | null = null;

// Auth failure listener callback (for redirecting to /login?redirect=...)
type AuthFailureHandler = () => void;
let onAuthFailureHandler: AuthFailureHandler | null = null;

export function setOnAuthFailure(handler: AuthFailureHandler | null) {
  onAuthFailureHandler = handler;
}

export function setTokens(accessToken: string | null, refreshToken: string | null = null) {
  memoryAccessToken = accessToken;
  if (refreshToken !== null) {
    memoryRefreshToken = refreshToken;
  }
}

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

export function getRefreshToken(): string | null {
  return memoryRefreshToken;
}

export function setActiveOrganizationId(orgId: string | null) {
  activeOrganizationId = orgId;
}

export function getActiveOrganizationId(): string | null {
  return activeOrganizationId;
}

export function clearAuthStorage() {
  memoryAccessToken = null;
  memoryRefreshToken = null;
  activeOrganizationId = null;
}

// ------------------------------------------------------------------------------
// Token Refresh Mutex and Queue
// ------------------------------------------------------------------------------
let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function processQueue(token: string | null) {
  refreshQueue.forEach((callback) => callback(token));
  refreshQueue = [];
}

export async function requestTokenRefresh(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise<string | null>((resolve) => {
      refreshQueue.push(resolve);
    });
  }

  isRefreshing = true;

  try {
    const url = `${API_BASE_URL}/api/v1/auth/refresh`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        refresh_token: memoryRefreshToken || '',
      }),
    });

    if (!response.ok) {
      clearAuthStorage();
      processQueue(null);
      if (onAuthFailureHandler) {
        onAuthFailureHandler();
      }
      return null;
    }

    const data: TokenResponse = await response.json();
    setTokens(data.access_token, data.refresh_token);
    processQueue(data.access_token);
    return data.access_token;
  } catch (_err) {
    clearAuthStorage();
    processQueue(null);
    if (onAuthFailureHandler) {
      onAuthFailureHandler();
    }
    return null;
  } finally {
    isRefreshing = false;
  }
}

// ------------------------------------------------------------------------------
// Core API Request Wrapper
// ------------------------------------------------------------------------------
export interface ApiRequestOptions extends RequestInit {
  _retry?: boolean;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  // Construct headers
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // If payload is not FormData, default to application/json
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Attach Access Token if present
  if (memoryAccessToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${memoryAccessToken}`;
  }

  // Attach Active Organization Context header
  if (activeOrganizationId && !headers['X-Organization-Id']) {
    headers['X-Organization-Id'] = activeOrganizationId;
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Network error occurred');
  }

  // Handle 401 Unauthorized with single-retry token refresh
  const isAuthEndpoint =
    endpoint.includes('/auth/login') ||
    endpoint.includes('/auth/register') ||
    endpoint.includes('/auth/refresh') ||
    endpoint.includes('/auth/logout');

  if (response.status === 401 && !options._retry && !isAuthEndpoint) {
    options._retry = true;
    const newToken = await requestTokenRefresh();

    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retryOptions: RequestInit = {
        ...options,
        headers,
        credentials: 'include',
      };
      const retryResponse = await fetch(url, retryOptions);
      if (!retryResponse.ok) {
        const errorData = await retryResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || `Request failed with status ${retryResponse.status}`);
      }
      return retryResponse.status === 204 ? (null as T) : await retryResponse.json();
    } else {
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json();
}
