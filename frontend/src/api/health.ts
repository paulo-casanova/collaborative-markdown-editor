import { apiRequest } from './client';
import { HealthResponse } from '../types/health';
import { setStoredAuthnProvider } from './auth';

export async function fetchHealthStatus(): Promise<HealthResponse> {
  const health = await apiRequest<HealthResponse>('/api/v1/health');
  if (health?.authn_provider) {
    setStoredAuthnProvider(health.authn_provider);
  }
  return health;
}
