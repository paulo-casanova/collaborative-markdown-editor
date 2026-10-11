import { apiRequest } from './client';
import { HealthResponse } from '../types/health';

export async function fetchHealthStatus(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/v1/health');
}
