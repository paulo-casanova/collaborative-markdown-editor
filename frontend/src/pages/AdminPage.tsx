import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  Users,
  GitFork,
  CheckCircle2,
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  Edit3,
  X,
  Link2,
  Unlink,
  AlertCircle,
  Search,
  Crown,
  Settings,
} from 'lucide-react';
import { useUIStore } from '../stores/uiStore';
import { Badge } from '../components/common/Badge';
import {
  fetchAdminUsers,
  fetchAdminTeams,
  createAdminTeam,
  updateAdminTeam,
  deleteAdminTeam,
  fetchTeamMembers,
  addTeamMember,
  removeTeamMember,
  fetchTeamParents,
  linkTeamParent,
  unlinkTeamParent,
} from '../api/admin';
import { AdminTeam, AdminTeamMember, AdminUser } from '../types/admin';

export const AdminPage: React.FC = () => {
  const { setBreadcrumbs } = useUIStore();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'teams' | 'users'>('teams');
  const [teamSearch, setTeamSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');

  // Modals state
  const [createTeamModalOpen, setCreateTeamModalOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [createTeamError, setCreateTeamError] = useState<string | null>(null);

  // Selected team for edit / manage
  const [selectedTeam, setSelectedTeam] = useState<AdminTeam | null>(null);
  const [teamManagerTab, setTeamManagerTab] = useState<'details' | 'members' | 'parents'>('members');

  // Edit team form state
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamDesc, setEditTeamDesc] = useState('');
  const [editTeamError, setEditTeamError] = useState<string | null>(null);
  const [editTeamSuccess, setEditTeamSuccess] = useState(false);

  // Add member form state
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'member' | 'lead'>('member');
  const [memberError, setMemberError] = useState<string | null>(null);

  // Link parent form state
  const [selectedParentId, setSelectedParentId] = useState('');
  const [parentError, setParentError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Workspaces', path: '/' },
      { label: 'Admin Console', isCurrent: true },
    ]);
  }, [setBreadcrumbs]);

  // Queries
  const { data: users = [], isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers,
    retry: false,
  });

  const { data: teams = [], isLoading: teamsLoading } = useQuery<AdminTeam[]>({
    queryKey: ['admin-teams'],
    queryFn: fetchAdminTeams,
    retry: false,
  });

  const { data: teamMembers = [], isLoading: membersLoading } = useQuery<AdminTeamMember[]>({
    queryKey: ['admin-team-members', selectedTeam?.id],
    queryFn: () => (selectedTeam ? fetchTeamMembers(selectedTeam.id) : Promise.resolve([])),
    enabled: Boolean(selectedTeam),
  });

  const { data: teamParents = [], isLoading: parentsLoading } = useQuery<AdminTeam[]>({
    queryKey: ['admin-team-parents', selectedTeam?.id],
    queryFn: () => (selectedTeam ? fetchTeamParents(selectedTeam.id) : Promise.resolve([])),
    enabled: Boolean(selectedTeam),
  });

  // When selected team changes, sync edit form
  const selectedTeamId = selectedTeam?.id;
  useEffect(() => {
    if (selectedTeam) {
      setEditTeamName(selectedTeam.name);
      setEditTeamDesc(selectedTeam.description || '');
      setEditTeamError(null);
      setEditTeamSuccess(false);
      setMemberError(null);
      setParentError(null);
    }
  }, [selectedTeamId]);

  // Create Team Mutation
  const createTeamMutation = useMutation({
    mutationFn: () => createAdminTeam({ name: newTeamName.trim(), description: newTeamDesc.trim() }),
    onSuccess: (newTeam) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
      setCreateTeamModalOpen(false);
      setNewTeamName('');
      setNewTeamDesc('');
      setCreateTeamError(null);
      setSelectedTeam(newTeam);
      setTeamManagerTab('members');
    },
    onError: (err: any) => {
      setCreateTeamError(err?.message || err?.error || 'Failed to create team');
    },
  });

  // Update Team Mutation
  const updateTeamMutation = useMutation({
    mutationFn: () => {
      if (!selectedTeam) throw new Error('No team selected');
      return updateAdminTeam(selectedTeam.id, {
        name: editTeamName.trim(),
        description: editTeamDesc.trim(),
      });
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
      setSelectedTeam(updated);
      setEditTeamSuccess(true);
      setEditTeamError(null);
      setTimeout(() => setEditTeamSuccess(false), 3000);
    },
    onError: (err: any) => {
      setEditTeamError(err?.message || err?.error || 'Failed to update team');
    },
  });

  // Delete Team Mutation
  const deleteTeamMutation = useMutation({
    mutationFn: (teamId: string) => deleteAdminTeam(teamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setSelectedTeam(null);
    },
  });

  // Add Member Mutation
  const addMemberMutation = useMutation({
    mutationFn: (payload: { userId: string; role: 'member' | 'lead' }) => {
      if (!selectedTeam) throw new Error('No team selected');
      return addTeamMember(selectedTeam.id, { user_id: payload.userId, role: payload.role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-team-members', selectedTeam?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setSelectedUserId('');
      setMemberError(null);
    },
    onError: (err: any) => {
      setMemberError(err?.message || err?.error || 'Failed to add member');
    },
  });

  // Remove Member Mutation
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => {
      if (!selectedTeam) throw new Error('No team selected');
      return removeTeamMember(selectedTeam.id, userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-team-members', selectedTeam?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setMemberError(null);
    },
    onError: (err: any) => {
      setMemberError(err?.message || err?.error || 'Failed to remove member');
    },
  });

  // Link Parent Mutation
  const linkParentMutation = useMutation({
    mutationFn: (parentId: string) => {
      if (!selectedTeam) throw new Error('No team selected');
      return linkTeamParent(selectedTeam.id, parentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-team-parents', selectedTeam?.id] });
      setSelectedParentId('');
      setParentError(null);
    },
    onError: (err: any) => {
      setParentError(err?.message || err?.error || 'Failed to link parent team');
    },
  });

  // Unlink Parent Mutation
  const unlinkParentMutation = useMutation({
    mutationFn: (parentId: string) => {
      if (!selectedTeam) throw new Error('No team selected');
      return unlinkTeamParent(selectedTeam.id, parentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-team-parents', selectedTeam?.id] });
      setParentError(null);
    },
    onError: (err: any) => {
      setParentError(err?.message || err?.error || 'Failed to unlink parent team');
    },
  });

  // Filtered lists
  const filteredTeams = teams.filter(
    (t) =>
      t.name.toLowerCase().includes(teamSearch.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(teamSearch.toLowerCase()))
  );

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.teams && u.teams.some((t) => t.name.toLowerCase().includes(userSearch.toLowerCase())))
  );

  // Available users to add to selected team (not already members)
  const availableUsers = users.filter(
    (u) => !teamMembers.some((m) => m.user_id === u.id || m.username === u.username)
  );

  // Available parent teams (not self and not already parents)
  const availableParents = teams.filter(
    (t) => t.id !== selectedTeam?.id && !teamParents.some((p) => p.id === t.id)
  );

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 space-y-8">
      {/* Page Header */}
      <div className="pb-4 border-b border-cme-border-base flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cme-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-cme-text-base">
              System Administration
            </h1>
          </div>
          <p className="text-xs text-cme-text-muted">
            Manage users, teams, memberships, and multi-parent Directed Acyclic Graph (DAG) inheritance hierarchies.
          </p>
        </div>

        <Badge variant="warning" size="md">
          Restricted: Admin Only
        </Badge>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface flex items-center gap-3 shadow-sm">
          <div className="p-3 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-cme-text-base font-mono">
              {usersLoading ? '...' : users.length}
            </div>
            <div className="text-xs text-cme-text-muted">Registered Users</div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface flex items-center gap-3 shadow-sm">
          <div className="p-3 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <GitFork className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-cme-text-base font-mono">
              {teamsLoading ? '...' : teams.length}
            </div>
            <div className="text-xs text-cme-text-muted">Teams in DAG</div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface flex items-center gap-3 shadow-sm">
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

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-cme-border-base pb-2">
        <button
          onClick={() => setActiveTab('teams')}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'teams'
              ? 'bg-cme-primary text-white shadow-sm'
              : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <GitFork className="w-3.5 h-3.5" />
          <span>Teams & Access DAG</span>
          <span className="text-[10px] px-1.5 py-0.2 bg-black/20 rounded-full font-mono">
            {teams.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'users'
              ? 'bg-cme-primary text-white shadow-sm'
              : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>User Directory</span>
          <span className="text-[10px] px-1.5 py-0.2 bg-black/20 rounded-full font-mono">
            {users.length}
          </span>
        </button>
      </div>

      {/* TEAMS TAB */}
      {activeTab === 'teams' && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-cme-text-muted" />
              <input
                type="text"
                placeholder="Filter teams by name or description..."
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-cme-bg-surface border border-cme-border-base rounded-lg text-xs text-cme-text-base placeholder-cme-text-muted focus:outline-none focus:ring-1 focus:ring-cme-primary"
              />
            </div>

            <button
              onClick={() => {
                setNewTeamName('');
                setNewTeamDesc('');
                setCreateTeamError(null);
                setCreateTeamModalOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cme-primary hover:bg-cme-primary/90 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Team</span>
            </button>
          </div>

          <div className="border border-cme-border-base rounded-xl overflow-hidden bg-cme-bg-surface text-xs shadow-sm">
            {teamsLoading ? (
              <div className="p-8 text-center text-cme-text-muted">Loading teams...</div>
            ) : filteredTeams.length === 0 ? (
              <div className="p-8 text-center text-cme-text-muted">
                {teamSearch ? 'No matching teams found.' : 'No teams created yet. Click "Create Team" to add one.'}
              </div>
            ) : (
              <div className="divide-y divide-cme-border-base">
                {filteredTeams.map((team) => (
                  <div
                    key={team.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-cme-bg-hover/40 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-cme-text-base text-sm">
                          {team.name}
                        </span>
                        <span className="font-mono text-[10px] text-cme-text-subtle px-1.5 py-0.5 bg-cme-bg-subtle rounded border border-cme-border-base">
                          {team.id.substring(0, 8)}...
                        </span>
                      </div>
                      <p className="text-xs text-cme-text-muted">
                        {team.description || 'No description provided.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        onClick={() => {
                          setSelectedTeam(team);
                          setTeamManagerTab('members');
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-cme-border-base hover:border-cme-primary/50 bg-cme-bg-surface hover:bg-cme-bg-subtle text-cme-text-base rounded-lg transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5 text-cme-primary" />
                        <span>Manage Team</span>
                      </button>

                      <button
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete team "${team.name}"?`)) {
                            deleteTeamMutation.mutate(team.id);
                          }
                        }}
                        disabled={deleteTeamMutation.isPending}
                        className="p-1.5 text-cme-text-muted hover:text-red-600 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete Team"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* USERS TAB */}
      {activeTab === 'users' && (
        <section className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-cme-text-muted" />
            <input
              type="text"
              placeholder="Filter users by username or display name..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-cme-bg-surface border border-cme-border-base rounded-lg text-xs text-cme-text-base placeholder-cme-text-muted focus:outline-none focus:ring-1 focus:ring-cme-primary"
            />
          </div>

          <div className="border border-cme-border-base rounded-xl overflow-hidden bg-cme-bg-surface text-xs shadow-sm">
            {usersLoading ? (
              <div className="p-8 text-center text-cme-text-muted">Loading users...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-8 text-center text-cme-text-muted">
                {userSearch ? 'No matching users found.' : 'No users found.'}
              </div>
            ) : (
              <div className="divide-y divide-cme-border-base">
                {filteredUsers.map((u) => (
                  <div
                    key={u.id}
                    className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-cme-bg-hover/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-[200px]">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs shadow-sm shrink-0"
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

                    {/* Assigned Teams */}
                    <div className="flex-1 md:px-4">
                      {u.teams && u.teams.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {u.teams.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                const teamObj = teams.find((tm) => tm.id === t.id);
                                if (teamObj) {
                                  setSelectedTeam(teamObj);
                                  setActiveTab('teams');
                                  setTeamManagerTab('members');
                                }
                              }}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-cme-bg-subtle hover:bg-cme-bg-surface text-cme-text-base border border-cme-border-base hover:border-cme-primary/50 transition-colors text-[11px] group cursor-pointer"
                              title={`Click to view team "${t.name}"`}
                            >
                              <GitFork className="w-3 h-3 text-cme-primary shrink-0" />
                              <span className="font-medium group-hover:text-cme-primary">{t.name}</span>
                              {t.role === 'lead' ? (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold border border-purple-500/20">
                                  Lead
                                </span>
                              ) : (
                                <span className="text-[9px] text-cme-text-muted">Member</span>
                              )}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-cme-text-subtle italic">
                          No teams assigned
                        </span>
                      )}
                    </div>

                    <div className="self-start md:self-auto shrink-0">
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
      )}

      {/* CREATE TEAM MODAL */}
      {createTeamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl overflow-hidden text-cme-text-base">
            <div className="flex items-center justify-between p-4 border-b border-cme-border-base bg-cme-bg-subtle">
              <div className="flex items-center gap-2">
                <GitFork className="w-4 h-4 text-cme-primary" />
                <h3 className="font-semibold text-sm">Create New Team</h3>
              </div>
              <button
                onClick={() => setCreateTeamModalOpen(false)}
                className="p-1 text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTeamName.trim()) {
                  setCreateTeamError('Team name is required');
                  return;
                }
                createTeamMutation.mutate();
              }}
              className="p-5 space-y-4 text-xs"
            >
              {createTeamError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{createTeamError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-medium text-cme-text-base">Team Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. backend-eng, docs-team"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="w-full px-3 py-2 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-cme-text-base">Description (optional)</label>
                <textarea
                  rows={3}
                  placeholder="Purpose and scope of this team..."
                  value={newTeamDesc}
                  onChange={(e) => setNewTeamDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-cme-border-base">
                <button
                  type="button"
                  onClick={() => setCreateTeamModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createTeamMutation.isPending || !newTeamName.trim()}
                  className="px-3 py-1.5 bg-cme-primary hover:bg-cme-primary/90 text-white text-xs font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {createTeamMutation.isPending ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TEAM MANAGER MODAL / DRAWER */}
      {selectedTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl overflow-hidden text-cme-text-base flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-cme-border-base bg-cme-bg-subtle shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-lg">
                  <GitFork className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">{selectedTeam.name}</h3>
                    <span className="font-mono text-[10px] text-cme-text-subtle px-1.5 py-0.5 bg-cme-bg-surface rounded border border-cme-border-base">
                      {selectedTeam.id.substring(0, 8)}...
                    </span>
                  </div>
                  <p className="text-[11px] text-cme-text-muted">Team Administration & Access Control</p>
                </div>
              </div>

              <button
                onClick={() => setSelectedTeam(null)}
                className="p-1 text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sub-tab Navigation */}
            <div className="flex items-center gap-1 px-4 pt-3 border-b border-cme-border-base bg-cme-bg-surface shrink-0">
              <button
                onClick={() => setTeamManagerTab('members')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  teamManagerTab === 'members'
                    ? 'border-cme-primary text-cme-primary'
                    : 'border-transparent text-cme-text-muted hover:text-cme-text-base'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Members</span>
                <span className="text-[10px] px-1.5 py-0.2 bg-cme-bg-subtle rounded-full font-mono">
                  {teamMembers.length}
                </span>
              </button>

              <button
                onClick={() => setTeamManagerTab('parents')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  teamManagerTab === 'parents'
                    ? 'border-cme-primary text-cme-primary'
                    : 'border-transparent text-cme-text-muted hover:text-cme-text-base'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Parent Teams (DAG)</span>
                <span className="text-[10px] px-1.5 py-0.2 bg-cme-bg-subtle rounded-full font-mono">
                  {teamParents.length}
                </span>
              </button>

              <button
                onClick={() => setTeamManagerTab('details')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  teamManagerTab === 'details'
                    ? 'border-cme-primary text-cme-primary'
                    : 'border-transparent text-cme-text-muted hover:text-cme-text-base'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Details & Settings</span>
              </button>
            </div>

            {/* Tab Body */}
            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* 1. MEMBERS TAB */}
              {teamManagerTab === 'members' && (
                <div className="space-y-4">
                  {/* Add Member Box */}
                  <div className="p-3.5 bg-cme-bg-subtle border border-cme-border-base rounded-xl space-y-3">
                    <div className="font-semibold text-cme-text-base flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-cme-primary" />
                      <span>Assign User to Team</span>
                    </div>

                    {memberError && (
                      <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{memberError}</span>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <select
                        aria-label="Select User to Assign"
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-cme-bg-surface border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                      >
                        <option value="">Select a user...</option>
                        {availableUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.display_name || u.username} (@{u.username})
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Select Team Role"
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value as 'member' | 'lead')}
                        className="px-2.5 py-1.5 bg-cme-bg-surface border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                      >
                        <option value="member">Role: Member</option>
                        <option value="lead">Role: Team Lead</option>
                      </select>

                      <button
                        onClick={() => {
                          if (!selectedUserId) {
                            setMemberError('Please select a user to assign');
                            return;
                          }
                          addMemberMutation.mutate({
                            userId: selectedUserId,
                            role: selectedRole,
                          });
                        }}
                        disabled={!selectedUserId || addMemberMutation.isPending}
                        className="px-3 py-1.5 bg-cme-primary hover:bg-cme-primary/90 text-white text-xs font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 shrink-0"
                      >
                        {addMemberMutation.isPending ? 'Assigning...' : 'Assign User'}
                      </button>
                    </div>
                  </div>

                  {/* Members List */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-cme-text-subtle uppercase tracking-wider">
                      Current Team Members ({teamMembers.length})
                    </h4>

                    <div className="border border-cme-border-base rounded-xl overflow-hidden bg-cme-bg-surface">
                      {membersLoading ? (
                        <div className="p-6 text-center text-cme-text-muted">Loading members...</div>
                      ) : teamMembers.length === 0 ? (
                        <div className="p-6 text-center text-cme-text-muted">
                          No members assigned to this team yet. Use the selector above to assign users.
                        </div>
                      ) : (
                        <div className="divide-y divide-cme-border-base">
                          {teamMembers.map((member) => (
                            <div
                              key={member.user_id}
                              className="p-3 flex items-center justify-between hover:bg-cme-bg-hover/30 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-white text-[11px] shadow-sm shrink-0"
                                  style={{ backgroundColor: member.avatar_color || '#3b82f6' }}
                                >
                                  {(member.display_name || member.username)[0].toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-semibold text-cme-text-base">
                                    {member.display_name || member.username}
                                  </div>
                                  <div className="text-[11px] text-cme-text-muted font-mono">
                                    @{member.username}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {member.role === 'lead' ? (
                                  <Badge variant="primary" size="sm">
                                    <Crown className="w-2.5 h-2.5" />
                                    <span>Team Lead</span>
                                  </Badge>
                                ) : (
                                  <Badge variant="neutral" size="sm">
                                    Member
                                  </Badge>
                                )}

                                <button
                                  onClick={() => {
                                    const newRole = member.role === 'lead' ? 'member' : 'lead';
                                    addMemberMutation.mutate({
                                      userId: member.user_id,
                                      role: newRole,
                                    });
                                  }}
                                  className="px-2 py-0.5 text-[11px] text-cme-text-muted hover:text-cme-text-base border border-cme-border-base rounded hover:bg-cme-bg-subtle transition-colors"
                                  title="Toggle Lead / Member role"
                                >
                                  {member.role === 'lead' ? 'Demote' : 'Promote'}
                                </button>

                                <button
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `Remove "${member.display_name || member.username}" from team?`
                                      )
                                    ) {
                                      removeMemberMutation.mutate(member.user_id);
                                    }
                                  }}
                                  disabled={removeMemberMutation.isPending}
                                  className="p-1 text-cme-text-muted hover:text-red-600 hover:bg-red-500/10 rounded transition-colors"
                                  title="Remove member"
                                >
                                  <UserMinus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 2. PARENTS TAB (DAG) */}
              {teamManagerTab === 'parents' && (
                <div className="space-y-4">
                  <div className="p-3.5 bg-cme-bg-subtle border border-cme-border-base rounded-xl space-y-3">
                    <div>
                      <div className="font-semibold text-cme-text-base flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5 text-cme-primary" />
                        <span>Link Parent Team in DAG</span>
                      </div>
                      <p className="text-[11px] text-cme-text-muted mt-0.5">
                        Parent teams grant inherited access permissions down to this team. Circular inheritance is rejected.
                      </p>
                    </div>

                    {parentError && (
                      <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{parentError}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Select Parent Team"
                        value={selectedParentId}
                        onChange={(e) => setSelectedParentId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-cme-bg-surface border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                      >
                        <option value="">Select a parent team to link...</option>
                        {availableParents.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => {
                          if (!selectedParentId) {
                            setParentError('Please select a parent team');
                            return;
                          }
                          linkParentMutation.mutate(selectedParentId);
                        }}
                        disabled={!selectedParentId || linkParentMutation.isPending}
                        className="px-3 py-1.5 bg-cme-primary hover:bg-cme-primary/90 text-white text-xs font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 shrink-0"
                      >
                        {linkParentMutation.isPending ? 'Linking...' : 'Link Parent'}
                      </button>
                    </div>
                  </div>

                  {/* Parents List */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-cme-text-subtle uppercase tracking-wider">
                      Inherited Parent Teams ({teamParents.length})
                    </h4>

                    <div className="border border-cme-border-base rounded-xl overflow-hidden bg-cme-bg-surface">
                      {parentsLoading ? (
                        <div className="p-6 text-center text-cme-text-muted">Loading parent teams...</div>
                      ) : teamParents.length === 0 ? (
                        <div className="p-6 text-center text-cme-text-muted">
                          Root team: No parent inheritance links configured.
                        </div>
                      ) : (
                        <div className="divide-y divide-cme-border-base">
                          {teamParents.map((p) => (
                            <div
                              key={p.id}
                              className="p-3 flex items-center justify-between hover:bg-cme-bg-hover/30 transition-colors"
                            >
                              <div className="space-y-0.5">
                                <div className="font-semibold text-cme-text-base flex items-center gap-2">
                                  <span>{p.name}</span>
                                  <Badge variant="primary" size="sm">
                                    DAG Parent
                                  </Badge>
                                </div>
                                <div className="text-[11px] text-cme-text-muted">
                                  {p.description || 'No description'}
                                </div>
                              </div>

                              <button
                                onClick={() => {
                                  if (confirm(`Unlink parent team "${p.name}"?`)) {
                                    unlinkParentMutation.mutate(p.id);
                                  }
                                }}
                                disabled={unlinkParentMutation.isPending}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-600 hover:bg-red-500/10 rounded-lg transition-colors"
                                title="Unlink parent"
                              >
                                <Unlink className="w-3.5 h-3.5" />
                                <span>Unlink</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 3. DETAILS & SETTINGS TAB */}
              {teamManagerTab === 'details' && (
                <div className="space-y-4">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!editTeamName.trim()) {
                        setEditTeamError('Team name is required');
                        return;
                      }
                      updateTeamMutation.mutate();
                    }}
                    className="space-y-4"
                  >
                    {editTeamSuccess && (
                      <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Team details updated successfully!</span>
                      </div>
                    )}

                    {editTeamError && (
                      <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{editTeamError}</span>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="font-medium text-cme-text-base">Team Name *</label>
                      <input
                        type="text"
                        required
                        value={editTeamName}
                        onChange={(e) => setEditTeamName(e.target.value)}
                        className="w-full px-3 py-2 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-medium text-cme-text-base">Description</label>
                      <textarea
                        rows={3}
                        value={editTeamDesc}
                        onChange={(e) => setEditTeamDesc(e.target.value)}
                        className="w-full px-3 py-2 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <button
                        type="submit"
                        disabled={updateTeamMutation.isPending || !editTeamName.trim()}
                        className="px-3.5 py-1.5 bg-cme-primary hover:bg-cme-primary/90 text-white text-xs font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
                      >
                        {updateTeamMutation.isPending ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </form>

                  {/* Danger Zone */}
                  <div className="mt-6 pt-4 border-t border-cme-border-base space-y-2">
                    <h4 className="text-xs font-semibold text-red-600 dark:text-red-400">
                      Danger Zone
                    </h4>
                    <p className="text-[11px] text-cme-text-muted">
                      Deleting this team will remove all member associations and team ACLs across documents.
                    </p>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Are you sure you want to permanently delete team "${selectedTeam.name}"?`
                          )
                        ) {
                          deleteTeamMutation.mutate(selectedTeam.id);
                        }
                      }}
                      disabled={deleteTeamMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 text-xs font-medium rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{deleteTeamMutation.isPending ? 'Deleting...' : 'Delete Team'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default AdminPage;
