import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, Users, GitFork, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../api/client';
import { useUIStore } from '../stores/uiStore';
import { Badge } from '../components/common/Badge';

export const AdminPage: React.FC = () => {
  const { setBreadcrumbs } = useUIStore();

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Workspaces', path: '/' },
      { label: 'Admin Console', isCurrent: true },
    ]);
  }, [setBreadcrumbs]);

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiRequest<{ users: any[] } | any[]>('/api/v1/admin/users'),
    retry: false,
  });

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['admin-teams'],
    queryFn: () => apiRequest<{ teams: any[] } | any[]>('/api/v1/admin/teams'),
    retry: false,
  });

  const userList = Array.isArray(users) ? users : users?.users || [];
  const teamList = Array.isArray(teams) ? teams : teams?.teams || [];

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-8">
      <div className="pb-4 border-b border-cme-border-base flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cme-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-cme-text-base">
              System Administration
            </h1>
          </div>
          <p className="text-xs text-cme-text-muted">
            Manage users, teams, and multi-parent Directed Acyclic Graph (DAG) inheritance hierarchies.
          </p>
        </div>

        <Badge variant="warning" size="md">
          Restricted: Admin Only
        </Badge>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface flex items-center gap-3">
          <div className="p-3 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-cme-text-base font-mono">
              {usersLoading ? '...' : userList.length}
            </div>
            <div className="text-xs text-cme-text-muted">Registered Users</div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface flex items-center gap-3">
          <div className="p-3 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <GitFork className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-cme-text-base font-mono">
              {teamsLoading ? '...' : teamList.length}
            </div>
            <div className="text-xs text-cme-text-muted">Teams in DAG</div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface flex items-center gap-3">
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              Active
            </div>
            <div className="text-xs text-cme-text-muted">DAG Cycle Check</div>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-cme-text-subtle">
          Users Directory
        </h2>
        <div className="border border-cme-border-base rounded-xl overflow-hidden bg-cme-bg-surface text-xs">
          {usersLoading ? (
            <div className="p-8 text-center text-cme-text-muted">Loading users...</div>
          ) : userList.length === 0 ? (
            <div className="p-8 text-center text-cme-text-muted">No users found.</div>
          ) : (
            <div className="divide-y divide-cme-border-base">
              {userList.map((u) => (
                <div key={u.id} className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs"
                      style={{ backgroundColor: u.avatar_color || '#3b82f6' }}
                    >
                      {(u.display_name || u.username)[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-cme-text-base">
                        {u.display_name || u.username}
                      </div>
                      <div className="text-[11px] text-cme-text-muted font-mono">@{u.username}</div>
                    </div>
                  </div>
                  <div>
                    {u.is_system_admin ? (
                      <Badge variant="primary" size="sm">
                        Admin
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        User
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Teams Table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-cme-text-subtle">
          Teams & DAG Structures
        </h2>
        <div className="border border-cme-border-base rounded-xl overflow-hidden bg-cme-bg-surface text-xs">
          {teamsLoading ? (
            <div className="p-8 text-center text-cme-text-muted">Loading teams...</div>
          ) : teamList.length === 0 ? (
            <div className="p-8 text-center text-cme-text-muted">No teams found.</div>
          ) : (
            <div className="divide-y divide-cme-border-base">
              {teamList.map((t) => (
                <div key={t.id} className="p-3.5 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-cme-text-base">{t.name}</div>
                    <div className="text-[11px] text-cme-text-muted">{t.description || 'No description'}</div>
                  </div>
                  <div className="font-mono text-cme-text-subtle text-[11px]">
                    ID: {t.id.substring(0, 8)}...
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
