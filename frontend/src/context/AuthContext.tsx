import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  AuthContextType,
  LoginInitiateResponse,
  LoginPayload,
  OrganizationRole,
  OrganizationSummary,
  RegisterPayload,
  User,
  VerifyLoginOtpPayload,
} from '../types/auth';
import {
  fetchCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  resendLoginOtpService,
  resendVerificationOtp,
  verifyEmailUser,
  verifyLoginOtpUser,
} from '../services/authService';
import {
  clearAuthStorage,
  getRefreshToken,
  requestTokenRefresh,
  setActiveOrganizationId,
  setOnAuthFailure,
} from '../services/apiClient';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<OrganizationSummary | null>(null);
  const [activeRole, setActiveRole] = useState<OrganizationRole | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Sync active organization and role
  const syncActiveOrg = useCallback(
    (orgs: OrganizationSummary[], preferredOrgId?: string | null, preferredRole?: OrganizationRole | null) => {
      if (!orgs || orgs.length === 0) {
        setActiveOrganization(null);
        setActiveRole(null);
        setActiveOrganizationId(null);
        return;
      }

      let selected = preferredOrgId
        ? orgs.find((o) => o.id === preferredOrgId)
        : null;

      if (!selected) {
        selected = orgs[0];
      }

      setActiveOrganization(selected);
      setActiveRole(preferredRole || selected.role);
      setActiveOrganizationId(selected.id);
    },
    []
  );

  // Refresh user profile and organizations from trusted backend
  const refreshProfile = useCallback(async () => {
    try {
      const data = await fetchCurrentUser();
      setUser(data.user);
      setOrganizations(data.organizations || []);
      syncActiveOrg(data.organizations || [], data.active_organization_id, data.active_role);
    } catch {
      setUser(null);
      setOrganizations([]);
      setActiveOrganization(null);
      setActiveRole(null);
      clearAuthStorage();
    }
  }, [syncActiveOrg]);

  // Session restoration on mount
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      setIsLoading(true);
      try {
        // Attempt silent refresh via HttpOnly cookie
        const token = await requestTokenRefresh();
        if (token && isMounted) {
          await refreshProfile();
        }
      } catch {
        // Unauthenticated session
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    // Register auth failure callback
    setOnAuthFailure(() => {
      if (isMounted) {
        setUser(null);
        setOrganizations([]);
        setActiveOrganization(null);
        setActiveRole(null);
        clearAuthStorage();
      }
    });

    initSession();

    return () => {
      isMounted = false;
      setOnAuthFailure(null);
    };
  }, [refreshProfile]);

  // Organization switcher
  const switchOrganization = useCallback(
    (organizationId: string) => {
      const target = organizations.find((o) => o.id === organizationId);
      if (!target) {
        // Prevent switching to an organization not belonging to user
        return;
      }
      setActiveOrganization(target);
      setActiveRole(target.role);
      setActiveOrganizationId(target.id);
    },
    [organizations]
  );

  // Login credentials handler - triggers 2FA OTP
  const login = useCallback(
    async (payload: LoginPayload): Promise<LoginInitiateResponse> => {
      setIsLoading(true);
      try {
        return await loginUser(payload);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Verify Login 2FA OTP handler
  const verifyLoginOtp = useCallback(
    async (payload: VerifyLoginOtpPayload) => {
      setIsLoading(true);
      try {
        await verifyLoginOtpUser(payload);
        await refreshProfile();
      } finally {
        setIsLoading(false);
      }
    },
    [refreshProfile]
  );

  // Resend Login OTP handler
  const resendLoginOtp = useCallback(
    async (email: string) => {
      await resendLoginOtpService(email);
    },
    []
  );

  // Register handler - sends verification OTP
  const register = useCallback(
    async (payload: RegisterPayload) => {
      setIsLoading(true);
      try {
        return await registerUser(payload);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Email verification handler
  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      setIsLoading(true);
      try {
        await verifyEmailUser(email, code);
        await refreshProfile();
      } finally {
        setIsLoading(false);
      }
    },
    [refreshProfile]
  );

  // Resend OTP handler
  const resendVerificationCode = useCallback(
    async (email: string) => {
      await resendVerificationOtp(email);
    },
    []
  );

  // Logout handler
  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      const rToken = getRefreshToken();
      await logoutUser(rToken);
    } catch {
      // Gracefully ignore server logout failures; frontend state is always cleared
    } finally {
      setUser(null);
      setOrganizations([]);
      setActiveOrganization(null);
      setActiveRole(null);
      clearAuthStorage();
      setIsLoading(false);
    }
  }, []);

  const value: AuthContextType = {
    user,
    organizations,
    activeOrganization,
    activeRole,
    isAuthenticated: !!user,
    isLoading,
    login,
    verifyLoginOtp,
    resendLoginOtp,
    register,
    verifyEmail,
    resendVerificationCode,
    logout,
    switchOrganization,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
