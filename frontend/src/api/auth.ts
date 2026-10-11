import { apiRequest, TOKEN_STORAGE_KEY } from './client';
import { UserIdentity, PatToken } from '../types/auth';

export async function fetchCurrentUser(): Promise<UserIdentity> {
  return apiRequest<UserIdentity>('/api/v1/auth/me');
}

export async function loginUser(username: string, password: string): Promise<{ token: string; user?: UserIdentity }> {
  const result = await apiRequest<{ token: string; user?: UserIdentity }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (result.token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
  }
  return result;
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
