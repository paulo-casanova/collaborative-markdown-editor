import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  User,
  Users,
  Globe,
  Trash2,
  Plus,
  X,
  Info,
  Search,
  ArrowDown,
} from 'lucide-react';
import {
  fetchNodePermissions,
  setNodePermission,
  deleteNodePermission,
  transferNodeOwnership,
  fetchAssignablePrincipals,
  testNodePermissions,
} from '../../api/permissions';
import { NodePermissions, TestPermissionResult } from '../../types/document';

interface AccessControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'DOCUMENT' | 'DIRECTORY';
  targetId?: string;
  directoryPath?: string;
  title: string;
}

export const AccessControlModal: React.FC<AccessControlModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  directoryPath,
  title,
}) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'manage' | 'test'>('manage');

  // Management Form State
  const [selectedGranteeType, setSelectedGranteeType] = useState<'USER' | 'TEAM' | 'EVERYONE'>('USER');
  const [selectedGranteeId, setSelectedGranteeId] = useState<string>('');
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<'READ' | 'COMMENT' | 'EDIT' | 'ADMIN'>('READ');
  const [isInheritable, setIsInheritable] = useState<boolean>(true);
  const [transferOwnerId, setTransferOwnerId] = useState<string>('');
  const [transferIsTeam, setTransferIsTeam] = useState<boolean>(false);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);

  // Test Permissions State
  const [testSubjectType, setTestSubjectType] = useState<'USER' | 'TEAM'>('USER');
  const [testSubjectId, setTestSubjectId] = useState<string>('');

  // Fetch permissions
  const {
    data: permissions,
    isLoading,
  } = useQuery<NodePermissions>({
    queryKey: ['node-permissions', targetType, targetId, directoryPath],
    queryFn: () =>
      fetchNodePermissions({
        target_type: targetType,
        target_id: targetId,
        directory_path: directoryPath,
      }),
    enabled: isOpen,
  });

  // Fetch assignable users and teams
  const { data: principals } = useQuery({
    queryKey: ['assignable-principals'],
    queryFn: fetchAssignablePrincipals,
    enabled: isOpen,
  });

  // Test Permissions Query
  const {
    data: testResult,
    isFetching: isTesting,
    refetch: runTestPermission,
  } = useQuery<TestPermissionResult>({
    queryKey: ['test-permission', targetType, targetId, directoryPath, testSubjectType, testSubjectId],
    queryFn: () =>
      testNodePermissions({
        target_type: targetType,
        target_id: targetId,
        directory_path: directoryPath,
        subject_type: testSubjectType,
        subject_id: testSubjectId,
      }),
    enabled: isOpen && activeTab === 'test' && !!testSubjectId,
  });

  // Set permission mutation
  const setPermMutation = useMutation({
    mutationFn: async () => {
      if (selectedGranteeType !== 'EVERYONE' && !selectedGranteeId) return;
      return setNodePermission({
        target_type: targetType,
        target_id: targetId,
        directory_path: directoryPath,
        grantee_type: selectedGranteeType,
        grantee_id: selectedGranteeType === 'EVERYONE' ? '' : selectedGranteeId,
        access_level: selectedAccessLevel,
        is_inheritable: targetType === 'DIRECTORY' ? isInheritable : true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-permissions', targetType, targetId, directoryPath] });
      queryClient.invalidateQueries({ queryKey: ['test-permission'] });
      setSelectedGranteeId('');
    },
    onError: (err: any) => {
      alert(`Failed to set permission: ${err?.message || 'Permission denied'}`);
    },
  });

  // Delete permission mutation
  const deletePermMutation = useMutation({
    mutationFn: async (grantId: number) => {
      return deleteNodePermission(grantId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-permissions', targetType, targetId, directoryPath] });
      queryClient.invalidateQueries({ queryKey: ['test-permission'] });
    },
    onError: (err: any) => {
      alert(`Failed to delete permission: ${err?.message || 'Permission denied'}`);
    },
  });

  // Transfer ownership mutation
  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!transferOwnerId) return;
      return transferNodeOwnership({
        target_type: targetType,
        target_id: targetId,
        directory_path: directoryPath,
        new_owner_user_id: transferIsTeam ? undefined : transferOwnerId,
        new_owner_team_id: transferIsTeam ? transferOwnerId : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-permissions', targetType, targetId, directoryPath] });
      queryClient.invalidateQueries({ queryKey: ['directory-details'] });
      queryClient.invalidateQueries({ queryKey: ['test-permission'] });
      setIsTransferring(false);
      setTransferOwnerId('');
    },
    onError: (err: any) => {
      alert(`Failed to transfer ownership: ${err?.message || 'Permission denied'}`);
    },
  });

  if (!isOpen) return null;

  const canManage = permissions?.can_manage ?? false;

  const getLevelBadgeColor = (level?: string) => {
    switch (level?.toUpperCase()) {
      case 'ADMIN':
        return 'bg-purple-500 text-white border-purple-600';
      case 'EDIT':
        return 'bg-emerald-500 text-white border-emerald-600';
      case 'COMMENT':
        return 'bg-blue-500 text-white border-blue-600';
      case 'READ':
        return 'bg-amber-500 text-white border-amber-600';
      default:
        return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      data-testid="access-control-modal"
    >
      <div className="bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cme-border-base bg-cme-bg-surface">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 flex-shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-cme-text-base truncate">
                Access Control & Permissions
              </h2>
              <p className="text-xs text-cme-text-muted truncate">
                {targetType}: <span className="font-mono text-cme-text-base">{title}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-cme-border-base bg-cme-bg-subtle/50 px-6 pt-2 gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('manage')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'manage'
                ? 'border-cme-primary text-cme-primary font-semibold'
                : 'border-transparent text-cme-text-muted hover:text-cme-text-base'
            }`}
            data-testid="tab-manage-permissions"
          >
            Manage Permissions
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={`pb-2.5 px-1 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'test'
                ? 'border-cme-primary text-cme-primary font-semibold'
                : 'border-transparent text-cme-text-muted hover:text-cme-text-base'
            }`}
            data-testid="tab-test-permissions"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Test Permissions</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {isLoading ? (
            <div className="text-center py-12 text-sm text-cme-text-muted">Loading permissions...</div>
          ) : activeTab === 'manage' ? (
            <>
              {/* Effective Permission & Owner Banner */}
              <div className="p-4 rounded-lg bg-cme-bg-base border border-cme-border-base flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-cme-text-muted">Your Effective Access:</span>
                    <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-blue-500 text-white">
                      {permissions?.effective_permission || 'READ'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-cme-text-base">
                    <span className="text-cme-text-muted">Owner:</span>
                    {permissions?.owner?.is_team ? (
                      <Users className="w-3.5 h-3.5 text-indigo-500" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span className="font-medium">
                      {permissions?.owner?.display_name || permissions?.owner?.name || 'Unassigned (Workspace Admin)'}
                    </span>
                    {permissions?.owner?.is_team && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/10 text-indigo-500 font-semibold">
                        Team
                      </span>
                    )}
                  </div>
                </div>

                {canManage && (
                  <div>
                    {!isTransferring ? (
                      <button
                        onClick={() => setIsTransferring(true)}
                        className="px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
                        data-testid="transfer-ownership-btn"
                      >
                        Transfer Ownership
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={transferOwnerId}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val.startsWith('team:')) {
                              setTransferOwnerId(val.replace('team:', ''));
                              setTransferIsTeam(true);
                            } else {
                              setTransferOwnerId(val);
                              setTransferIsTeam(false);
                            }
                          }}
                          className="px-2 py-1 text-xs rounded-md bg-cme-bg-surface border border-cme-border-base text-cme-text-base"
                        >
                          <option value="">Select new owner...</option>
                          <optgroup label="Users">
                            {principals?.users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.display_name} (@{u.username})
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Teams">
                            {principals?.teams.map((t) => (
                              <option key={t.id} value={`team:${t.id}`}>
                                Team: {t.name}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        <button
                          onClick={() => transferMutation.mutate()}
                          disabled={!transferOwnerId || transferMutation.isPending}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setIsTransferring(false)}
                          className="p-1 rounded text-cme-text-muted hover:text-cme-text-base"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Add Permission Grant Form */}
              {canManage && (
                <div className="p-4 rounded-lg border border-cme-border-base bg-cme-bg-base/50 space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                    Add Explicit Access
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg border border-cme-border-base overflow-hidden bg-cme-bg-surface text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGranteeType('USER');
                          setSelectedGranteeId('');
                        }}
                        className={`px-3 py-1.5 transition-colors ${
                          selectedGranteeType === 'USER'
                            ? 'bg-blue-500 text-white'
                            : 'text-cme-text-muted hover:text-cme-text-base'
                        }`}
                        data-testid="grantee-type-user-btn"
                      >
                        User
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGranteeType('TEAM');
                          setSelectedGranteeId('');
                        }}
                        className={`px-3 py-1.5 transition-colors ${
                          selectedGranteeType === 'TEAM'
                            ? 'bg-blue-500 text-white'
                            : 'text-cme-text-muted hover:text-cme-text-base'
                        }`}
                        data-testid="grantee-type-team-btn"
                      >
                        Team
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGranteeType('EVERYONE');
                          setSelectedGranteeId('');
                        }}
                        className={`px-3 py-1.5 transition-colors ${
                          selectedGranteeType === 'EVERYONE'
                            ? 'bg-blue-500 text-white'
                            : 'text-cme-text-muted hover:text-cme-text-base'
                        }`}
                        data-testid="grantee-type-everyone-btn"
                      >
                        Everyone
                      </button>
                    </div>

                    {selectedGranteeType === 'EVERYONE' ? (
                      <div
                        className="flex-1 min-w-[160px] px-3 py-1.5 text-xs rounded-lg bg-cme-bg-surface border border-cme-border-base text-cme-text-muted flex items-center gap-1.5"
                        data-testid="grantee-everyone-badge"
                      >
                        <Globe className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        <span className="font-medium text-cme-text-base">All Authenticated Users</span>
                      </div>
                    ) : (
                      <select
                        value={selectedGranteeId}
                        onChange={(e) => setSelectedGranteeId(e.target.value)}
                        className="flex-1 min-w-[160px] px-3 py-1.5 text-xs rounded-lg bg-cme-bg-surface border border-cme-border-base text-cme-text-base"
                        data-testid="grantee-select"
                      >
                        <option value="">Select {selectedGranteeType === 'USER' ? 'User' : 'Team'}...</option>
                        {selectedGranteeType === 'USER'
                          ? principals?.users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.display_name} (@{u.username})
                              </option>
                            ))
                          : principals?.teams.map((t) => (
                              <option key={t.id} value={t.id}>
                                Team: {t.name}
                              </option>
                            ))}
                      </select>
                    )}

                    <select
                      value={selectedAccessLevel}
                      onChange={(e: any) => setSelectedAccessLevel(e.target.value)}
                      className="px-3 py-1.5 text-xs rounded-lg bg-cme-bg-surface border border-cme-border-base text-cme-text-base font-medium"
                      data-testid="access-level-select"
                    >
                      <option value="READ">Read Only</option>
                      <option value="COMMENT">Comment</option>
                      <option value="EDIT">Edit / Write</option>
                      <option value="ADMIN">Admin / Manage</option>
                    </select>

                    <button
                      onClick={() => setPermMutation.mutate()}
                      disabled={(selectedGranteeType !== 'EVERYONE' && !selectedGranteeId) || setPermMutation.isPending}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors shadow-xs"
                      data-testid="add-permission-btn"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Grant</span>
                    </button>
                  </div>

                  {/* Directory Inheritance Option */}
                  {targetType === 'DIRECTORY' && (
                    <div className="pt-1">
                      <label className="inline-flex items-center gap-2 text-xs text-cme-text-base cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isInheritable}
                          onChange={(e) => setIsInheritable(e.target.checked)}
                          className="rounded border-cme-border-base text-cme-primary focus:ring-cme-primary cursor-pointer w-3.5 h-3.5"
                          data-testid="inheritable-checkbox"
                        />
                        <span className="font-medium">Apply to subdirectories & child files (Inheritable)</span>
                      </label>
                      <p className="text-[11px] text-cme-text-muted ml-5.5">
                        When unchecked, this grant applies exclusively to this directory and will not propagate downward.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Explicit Grants List */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                  Direct Explicit Grants ({permissions?.explicit_grants?.length ?? 0})
                </h3>
                {permissions?.explicit_grants?.length === 0 ? (
                  <p className="text-xs text-cme-text-muted italic py-2">
                    No explicit direct grants on this item.
                  </p>
                ) : (
                  <div className="divide-y divide-cme-border-base/60 border border-cme-border-base rounded-lg bg-cme-bg-surface overflow-hidden">
                    {permissions?.explicit_grants?.map((grant) => (
                      <div
                        key={grant.id}
                        className="flex items-center justify-between px-4 py-2.5 text-xs"
                        data-testid={`explicit-grant-${grant.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {grant.grantee_type === 'EVERYONE' ? (
                            <Globe className="w-4 h-4 text-purple-500 shrink-0" />
                          ) : grant.grantee_type === 'TEAM' ? (
                            <Users className="w-4 h-4 text-indigo-500 shrink-0" />
                          ) : (
                            <User className="w-4 h-4 text-emerald-500 shrink-0" />
                          )}
                          <span className="font-medium text-cme-text-base truncate">{grant.grantee_name}</span>
                          <span className="text-[10px] uppercase font-bold text-cme-text-muted shrink-0">
                            ({grant.grantee_type})
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          {targetType === 'DIRECTORY' && (
                            grant.is_inheritable !== false ? (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-0.5"
                                title="Inherited by subdirectories and child documents"
                                data-testid={`grant-inheritable-${grant.id}`}
                              >
                                <ArrowDown className="w-2.5 h-2.5" />
                                <span>Inheritable</span>
                              </span>
                            ) : (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                title="Applies to this directory only (non-inheriting)"
                                data-testid={`grant-non-inheriting-${grant.id}`}
                              >
                                Non-inheriting
                              </span>
                            )
                          )}

                          <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-cme-bg-subtle text-cme-text-base border border-cme-border-base">
                            {grant.access_level}
                          </span>

                          {canManage && (
                            <button
                              onClick={() => deletePermMutation.mutate(grant.id)}
                              className="p-1 rounded text-cme-text-muted hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                              title="Revoke grant"
                              data-testid={`delete-grant-${grant.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Inherited Grants & Provenance */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                    Inherited Permissions ({permissions?.inherited_grants?.length ?? 0})
                  </h3>
                  <div className="flex items-center gap-1 text-[11px] text-cme-text-muted">
                    <Info className="w-3.5 h-3.5 text-blue-500" />
                    <span>Additive & Non-Destructive</span>
                  </div>
                </div>

                {permissions?.inherited_grants?.length === 0 ? (
                  <p className="text-xs text-cme-text-muted italic py-2">
                    No permissions inherited from parent directories.
                  </p>
                ) : (
                  <div className="divide-y divide-cme-border-base/60 border border-cme-border-base rounded-lg bg-cme-bg-surface overflow-hidden">
                    {permissions?.inherited_grants?.map((grant) => (
                      <div
                        key={grant.id}
                        className="flex items-center justify-between px-4 py-2.5 text-xs opacity-85"
                        data-testid={`inherited-grant-${grant.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {grant.grantee_type === 'EVERYONE' ? (
                            <Globe className="w-4 h-4 text-purple-400 shrink-0" />
                          ) : grant.grantee_type === 'TEAM' ? (
                            <Users className="w-4 h-4 text-indigo-400 shrink-0" />
                          ) : (
                            <User className="w-4 h-4 text-emerald-400 shrink-0" />
                          )}
                          <span className="font-medium text-cme-text-base truncate">{grant.grantee_name}</span>
                          <span className="text-[10px] uppercase font-bold text-cme-text-muted shrink-0">
                            ({grant.grantee_type})
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-cme-bg-subtle text-cme-text-base border border-cme-border-base">
                            {grant.access_level}
                          </span>
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-[10px]">
                            <span>from:</span>
                            <span className="font-semibold">{grant.inherited_from || 'Root'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-cme-text-muted leading-relaxed">
                  Permissions in CME are additive: inheritable grants at parent directories propagate downward to children and cannot be revoked locally.
                </p>
              </div>
            </>
          ) : (
            /* Test Permissions Tab */
            <div className="space-y-5" data-testid="test-permissions-panel">
              <div className="p-4 rounded-lg border border-cme-border-base bg-cme-bg-base/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                    Permission Simulator & Verification
                  </h3>
                  <span className="text-[11px] text-cme-text-muted">
                    Test what ACLs and effective permissions apply to any user or team
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg border border-cme-border-base overflow-hidden bg-cme-bg-surface text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => {
                        setTestSubjectType('USER');
                        setTestSubjectId('');
                      }}
                      className={`px-3 py-1.5 transition-colors ${
                        testSubjectType === 'USER'
                          ? 'bg-blue-500 text-white'
                          : 'text-cme-text-muted hover:text-cme-text-base'
                      }`}
                      data-testid="test-subject-type-user"
                    >
                      User
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTestSubjectType('TEAM');
                        setTestSubjectId('');
                      }}
                      className={`px-3 py-1.5 transition-colors ${
                        testSubjectType === 'TEAM'
                          ? 'bg-blue-500 text-white'
                          : 'text-cme-text-muted hover:text-cme-text-base'
                      }`}
                      data-testid="test-subject-type-team"
                    >
                      Team
                    </button>
                  </div>

                  <select
                    value={testSubjectId}
                    onChange={(e) => setTestSubjectId(e.target.value)}
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-xs rounded-lg bg-cme-bg-surface border border-cme-border-base text-cme-text-base font-medium"
                    data-testid="test-subject-select"
                  >
                    <option value="">Select {testSubjectType === 'USER' ? 'User' : 'Team'} to inspect...</option>
                    {testSubjectType === 'USER'
                      ? principals?.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.display_name} (@{u.username})
                          </option>
                        ))
                      : principals?.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            Team: {t.name}
                          </option>
                        ))}
                  </select>

                  <button
                    onClick={() => runTestPermission()}
                    disabled={!testSubjectId || isTesting}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors shadow-xs"
                    data-testid="run-test-permissions-btn"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{isTesting ? 'Evaluating...' : 'Test'}</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="space-y-4" data-testid="test-permissions-result">
                  {/* Effective Summary Card */}
                  <div className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface shadow-xs space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        {testResult.subject_type === 'TEAM' ? (
                          <Users className="w-5 h-5 text-indigo-500" />
                        ) : (
                          <User className="w-5 h-5 text-emerald-500" />
                        )}
                        <div>
                          <h4 className="text-sm font-semibold text-cme-text-base">
                            {testResult.subject_name}
                          </h4>
                          <span className="text-[10px] uppercase font-bold text-cme-text-muted">
                            {testResult.subject_type}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-cme-text-muted">Effective Permission:</span>
                        <span
                          className={`px-3 py-1 rounded-md text-xs font-extrabold uppercase tracking-wider ${getLevelBadgeColor(
                            testResult.effective_level
                          )}`}
                          data-testid="test-effective-level"
                        >
                          {testResult.effective_level}
                        </span>
                      </div>
                    </div>

                    {/* Transitive Effective Teams */}
                    {testResult.subject_type === 'USER' && testResult.effective_teams && testResult.effective_teams.length > 0 && (
                      <div className="pt-2 border-t border-cme-border-base/50 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-cme-text-muted">Resolved Teams (DAG):</span>
                        {testResult.effective_teams.map((teamName, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium text-[11px]"
                          >
                            {teamName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Matched Rules Breakdown */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                      Matched Permission Rules ({testResult.matched_rules?.length ?? 0})
                    </h4>

                    {testResult.matched_rules?.length === 0 ? (
                      <div className="p-4 rounded-lg border border-cme-border-base bg-cme-bg-base text-xs text-cme-text-muted italic">
                        Default Deny: No explicit direct grants, inherited directory permissions, or ownership rules match this {testResult.subject_type.toLowerCase()}. Access is denied (NONE).
                      </div>
                    ) : (
                      <div className="divide-y divide-cme-border-base/60 border border-cme-border-base rounded-lg bg-cme-bg-surface overflow-hidden">
                        {testResult.matched_rules.map((rule, idx) => (
                          <div key={idx} className="p-3 text-xs space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cme-bg-subtle text-cme-text-base border border-cme-border-base">
                                  {rule.source}
                                </span>
                                <span className="font-medium text-cme-text-base">
                                  {rule.description}
                                </span>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${getLevelBadgeColor(
                                  rule.level
                                )}`}
                              >
                                {rule.level}
                              </span>
                            </div>

                            {rule.inherited_from && (
                              <div className="flex items-center gap-1 text-[11px] text-cme-text-muted pl-1">
                                <Info className="w-3 h-3 text-blue-500" />
                                <span>Propagated from ancestor directory:</span>
                                <span className="font-mono font-medium text-cme-text-base">
                                  {rule.inherited_from}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-cme-border-base bg-cme-bg-surface flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
