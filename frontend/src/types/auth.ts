export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
}

export interface UserMeResponse {
  user: User;
  organizations: OrganizationSummary[];
  active_organization_id: string | null;
  active_role: OrganizationRole | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface LoginPayload {
  email: string;
  password: string;
  organization_id?: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  organization_name?: string;
}

export interface AuthContextType {
  user: User | null;
  organizations: OrganizationSummary[];
  activeOrganization: OrganizationSummary | null;
  activeRole: OrganizationRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => void;
  refreshProfile: () => Promise<void>;
}
