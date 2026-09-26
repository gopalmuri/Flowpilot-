import { apiRequest, clearAuthStorage, setTokens } from './apiClient';
import {
  LoginPayload,
  RegisterPayload,
  TokenResponse,
  User,
  UserMeResponse,
  OrganizationSummary,
} from '../types/auth';

export async function loginUser(payload: LoginPayload): Promise<TokenResponse> {
  const data = await apiRequest<TokenResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function registerUser(payload: RegisterPayload): Promise<User> {
  return await apiRequest<User>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logoutUser(refreshToken?: string | null): Promise<void> {
  try {
    await apiRequest('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken || null }),
    });
  } catch (_e) {
    // Ignore server error on logout; frontend state must always be cleared
  } finally {
    clearAuthStorage();
  }
}

export async function fetchCurrentUser(): Promise<UserMeResponse> {
  return await apiRequest<UserMeResponse>('/api/v1/auth/me', {
    method: 'GET',
  });
}

export async function fetchUserOrganizations(): Promise<OrganizationSummary[]> {
  return await apiRequest<OrganizationSummary[]>('/api/v1/organizations', {
    method: 'GET',
  });
}
