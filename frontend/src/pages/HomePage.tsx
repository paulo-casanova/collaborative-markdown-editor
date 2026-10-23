import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  BookOpen,
  Shield,
  Layers,
  Zap,
  Users,
} from 'lucide-react';
import { fetchCurrentUser } from '../api/auth';
import { fetchHealthStatus } from '../api/health';
import { useUIStore } from '../stores/uiStore';
import { Badge } from '../components/common/Badge';

export const HomePage: React.FC = () => {
  const { setBreadcrumbs, setLoginModalOpen } = useUIStore();

  useEffect(() => {
    setBreadcrumbs([{ label: 'Workspaces', path: '/', isCurrent: true }]);
  }, [setBreadcrumbs]);

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });


  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchHealthStatus,
  });

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-8">
      {/* Hero Welcome Banner */}
      <div className="p-6 md:p-8 rounded-2xl bg-gradient-to-r from-cme-primary/10 via-cme-bg-subtle to-cme-accent/10 border border-cme-border-base relative overflow-hidden">
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2.5">
            <img src="/cme-icon-light.png" alt="CME" className="w-6 h-6 object-contain dark:hidden" />
            <img src="/cme-icon-dark.png" alt="CME" className="w-6 h-6 object-contain hidden dark:block" />
            <span className="text-xs font-semibold uppercase tracking-wider text-cme-primary">
              Real-Time Collaboration Platform
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-cme-text-base">
            {user ? `Welcome back, ${user.display_name || user.username}` : 'Welcome to CME'}
          </h1>
          <p className="text-sm text-cme-text-muted max-w-2xl leading-relaxed">
            High-performance Collaborative Markdown Editor powered by modern C++23, uWebSockets,
            native Yjs CRDT reconciliation, and POSIX atomic storage.
          </p>

          <div className="pt-2 flex flex-wrap gap-3">
            {user ? (
              <Badge variant="primary" size="md">
                Logged in as @{user.username}
              </Badge>
            ) : (
              <button
                onClick={() => setLoginModalOpen(true)}
                className="px-4 py-2 bg-cme-primary text-white font-medium rounded-lg text-xs hover:bg-cme-primary-hover transition-colors shadow-sm"
              >
                Sign In to Start Editing
              </button>
            )}
            {health && (
              <Badge variant="success" size="md">
                CME Core v{health.version} Online
              </Badge>
            )}
            {user?.is_system_admin && (
              <Link to="/admin">
                <Badge variant="warning" size="md" className="cursor-pointer hover:opacity-80">
                  <Shield className="w-3 h-3 mr-1" />
                  Admin Console
                </Badge>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Feature & Architecture Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-cme-border-base bg-cme-bg-surface space-y-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Zap className="w-4 h-4" />
          </div>
          <h3 className="font-semibold text-sm text-cme-text-base">Sub-Millisecond Wire Protocol</h3>
          <p className="text-xs text-cme-text-muted leading-relaxed">
            1-byte opcode framing over WebSockets (`0x00`–`0x04`) delivering 0.04ms round-trip latency
            for real-time keystroke and cursor synchronization.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-cme-border-base bg-cme-bg-surface space-y-2">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
            <Layers className="w-4 h-4" />
          </div>
          <h3 className="font-semibold text-sm text-cme-text-base">Native Yjs CRDT In C++</h3>
          <p className="text-xs text-cme-text-muted leading-relaxed">
            Headless C-FFI reconciliation via `yrs` (`libyrs.so`) with dual-buffer memory and debounced
            date-partitioned POSIX snapshots.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-cme-border-base bg-cme-bg-surface space-y-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <h3 className="font-semibold text-sm text-cme-text-base">Multi-Parent Team DAG</h3>
          <p className="text-xs text-cme-text-muted leading-relaxed">
            Directed Acyclic Graph team inheritance with recursive CTE permissions and cycle prevention
            for fine-grained document access control.
          </p>
        </div>
      </div>

      {/* Quick Navigation Cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-cme-text-subtle">
          Quick Access
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Link
            to="/trash"
            className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover transition-colors flex items-center gap-3"
          >
            <div className="p-2.5 rounded-lg bg-cme-bg-subtle text-cme-text-base">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-xs text-cme-text-base">Trash Bin</div>
              <div className="text-[11px] text-cme-text-muted">Soft-deleted items</div>
            </div>
          </Link>

          <Link
            to="/settings"
            className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover transition-colors flex items-center gap-3"
          >
            <div className="p-2.5 rounded-lg bg-cme-bg-subtle text-cme-text-base">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-xs text-cme-text-base">Settings & Themes</div>
              <div className="text-[11px] text-cme-text-muted">Light, Dark, Sepia</div>
            </div>
          </Link>

          {user?.is_system_admin && (
            <Link
              to="/admin"
              className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover transition-colors flex items-center gap-3"
            >
              <div className="p-2.5 rounded-lg bg-cme-primary/10 text-cme-primary">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <div className="font-semibold text-xs text-cme-text-base">Admin Console</div>
                <div className="text-[11px] text-cme-text-muted">Users & Team DAG</div>
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
