import { apiRequest, clearAuthStorage, setTokens } from './apiClient';
import {
  LoginInitiateResponse,
  LoginPayload,
  RegisterPayload,
  TokenResponse,
  UserMeResponse,
  UserRegisterResponse,
  OrganizationSummary,
  VerifyLoginOtpPayload,
} from '../types/auth';

export async function loginUser(payload: LoginPayload): Promise<LoginInitiateResponse> {
  return await apiRequest<LoginInitiateResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function verifyLoginOtpUser(payload: VerifyLoginOtpPayload): Promise<TokenResponse> {
  const data = await apiRequest<TokenResponse>('/api/v1/auth/verify-login-otp', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function resendLoginOtpService(email: string): Promise<{ message: string }> {
  return await apiRequest<{ message: string }>('/api/v1/auth/resend-login-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function registerUser(payload: RegisterPayload): Promise<UserRegisterResponse> {
  return await apiRequest<UserRegisterResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function verifyEmailUser(email: string, code: string): Promise<TokenResponse> {
  const data = await apiRequest<TokenResponse>('/api/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
  setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function resendVerificationOtp(email: string): Promise<{ message: string }> {
  return await apiRequest<{ message: string }>('/api/v1/auth/resend-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function logoutUser(refreshToken?: string | null): Promise<void> {
  try {
    await apiRequest('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken || null }),
    });
  } catch {
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
