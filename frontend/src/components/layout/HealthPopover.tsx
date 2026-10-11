import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, HardDrive, Users, Clock, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchHealthStatus } from '../../api/health';

function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export const HealthPopover: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: health, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchHealthStatus,
    refetchInterval: 30000,
    retry: 1,
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isHealthy = !isError && health?.status === 'healthy';
  const version = health?.version || 'v0.1.0';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded-full border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover transition-colors"
        title="Backend Health & Version Status"
      >
        <span className="relative flex h-2 w-2">
          {isHealthy && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isHealthy ? 'bg-emerald-500' : isError ? 'bg-rose-500' : 'bg-amber-500'
            }`}
          ></span>
        </span>
        <span className="text-cme-text-muted font-semibold">v{version.replace(/^v/, '')}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 p-4 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl z-50 text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-cme-border-base mb-3">
            <div className="flex items-center gap-2">
              {isHealthy ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-500" />
              )}
              <span className="font-semibold text-cme-text-base">System Health & Telemetry</span>
            </div>
            <button
              onClick={() => refetch()}
              className="p-1 hover:bg-cme-bg-hover rounded text-cme-text-muted transition-colors"
              title="Refresh Health Probe"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isLoading ? (
            <div className="py-4 text-center text-cme-text-muted">Probing daemon status...</div>
          ) : isError || !health ? (
            <div className="py-2 text-rose-500">
              Backend service unreachable at <code className="font-mono">/api/v1/health</code>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Status & Version */}
              <div className="flex justify-between items-center text-cme-text-muted">
                <span>Version & Status</span>
                <span className="font-mono font-medium text-cme-text-base">
                  v{health.version} ({health.status})
                </span>
              </div>

              {/* Uptime */}
              <div className="flex justify-between items-center text-cme-text-muted">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cme-text-subtle" />
                  <span>Uptime</span>
                </span>
                <span className="font-mono text-cme-text-base">{formatUptime(health.uptime_seconds)}</span>
              </div>

              {/* Database */}
              <div className="flex justify-between items-center text-cme-text-muted">
                <span className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-sky-500" />
                  <span>PostgreSQL</span>
                </span>
                <span className="font-mono text-cme-text-base">
                  {health.database?.status === 'connected' ? (
                    <span className="text-emerald-500 font-medium">
                      Connected ({health.database.latency_ms?.toFixed(2)} ms)
                    </span>
                  ) : (
                    <span className="text-rose-500 font-medium">Disconnected</span>
                  )}
                </span>
              </div>

              {/* Storage */}
              <div className="flex justify-between items-center text-cme-text-muted">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-amber-500" />
                  <span>POSIX Storage</span>
                </span>
                <span className="font-mono text-cme-text-base">
                  {health.storage?.status === 'writable' ? (
                    <span>
                      Writable ({formatBytes(health.storage.free_bytes || health.storage.free_space_bytes)} free)
                    </span>
                  ) : (
                    <span className="text-rose-500">Read-Only</span>
                  )}
                </span>
              </div>

              {/* Collaborative Rooms */}
              <div className="flex justify-between items-center text-cme-text-muted">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Active Rooms</span>
                </span>
                <span className="font-mono font-medium text-cme-text-base">
                  {health.active_collab_rooms ?? 0} active
                </span>
              </div>

              {/* Persistence Stats */}
              {health.persistence && (
                <div className="pt-2 border-t border-cme-border-base text-[11px] text-cme-text-subtle flex justify-between">
                  <span>Persistence Flushes: {health.persistence.total_flushes ?? 0}</span>
                  <span>Snapshots: {health.persistence.total_snapshots ?? 0}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
