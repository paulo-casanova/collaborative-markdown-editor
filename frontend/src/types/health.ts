export interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  timestamp?: string;
  database?: {
    status: string;
    latency_ms: number;
    pool_active_connections?: number;
    pool_idle_connections?: number;
  };
  storage?: {
    status: string;
    backend?: string;
    free_bytes?: number;
    free_space_bytes?: number;
    writable?: boolean;
  };
  active_collab_rooms?: number;
  persistence?: {
    status?: string;
    total_flushes?: number;
    total_snapshots?: number;
    total_evictions?: number;
  };
}
