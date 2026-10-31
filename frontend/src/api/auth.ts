import { apiRequest, TOKEN_STORAGE_KEY } from './client';
import { UserIdentity, PatToken, UpdateProfileRequest } from '../types/auth';

export const AUTHN_PROVIDER_STORAGE_KEY = 'cme_authn_provider';

export function getStoredAuthnProvider(): string {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      const p = storage.getItem(AUTHN_PROVIDER_STORAGE_KEY);
      if (p) return p;
    }
  } catch {}
  return 'delegated';
}

export function setStoredAuthnProvider(provider: string): void {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage && provider) {
      storage.setItem(AUTHN_PROVIDER_STORAGE_KEY, provider);
    }
  } catch {}
}

export function normalizeUser(data: any): UserIdentity {
  const u = (data && data.user) ? data.user : data;
  const authnProvider = data?.authn_provider || u?.authn_provider;
  if (authnProvider) {
    setStoredAuthnProvider(authnProvider);
  }
  return {
    user_id: u?.user_id || u?.id || '',
    username: u?.username || '',
    display_name: u?.display_name || u?.username || '',
    avatar_color: u?.avatar_color || '#3b82f6',
    is_system_admin: Boolean(u?.is_system_admin ?? u?.is_admin ?? false),
    is_admin: Boolean(u?.is_admin ?? u?.is_system_admin ?? false),
    id: u?.id || u?.user_id || '',
    effective_teams: data?.effective_teams || u?.effective_teams || [],
    created_at: u?.created_at,
    authn_provider: authnProvider,
    can_change_password: Boolean(data?.can_change_password ?? u?.can_change_password ?? false),
  };
}

export async function fetchCurrentUser(): Promise<UserIdentity> {
  const data = await apiRequest<any>('/api/v1/auth/me');
  return normalizeUser(data);
}

export async function loginUser(username: string, password: string): Promise<{ token: string; user?: UserIdentity }> {
  const result = await apiRequest<{ token: string; user?: any }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (result.token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
  }
  return {
    token: result.token,
    user: result.user ? normalizeUser(result.user) : undefined,
  };
}

export async function logoutUser(): Promise<void> {
  try {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export async function listTokens(): Promise<PatToken[]> {
  const result = await apiRequest<{ tokens: PatToken[] } | PatToken[]>('/api/v1/auth/tokens');
  if (Array.isArray(result)) return result;
  return result.tokens || [];
}

export async function createToken(name?: string): Promise<{ token: string; name?: string }> {
  return apiRequest<{ token: string; name?: string }>('/api/v1/auth/tokens', {
    method: 'POST',
    body: JSON.stringify({ name: name || 'API Token' }),
  });
}

export async function updateCurrentUserProfile(req: UpdateProfileRequest): Promise<UserIdentity> {
  const result = await apiRequest<{ status: string; user: any }>('/api/v1/users/me', {
    method: 'PATCH',
    body: JSON.stringify(req),
  });
  return normalizeUser(result.user || result);
}
