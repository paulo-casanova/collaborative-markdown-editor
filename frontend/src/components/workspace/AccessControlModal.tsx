import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  User,
  Users,
  Trash2,
  Plus,
  X,
  Info,
} from 'lucide-react';
import {
  fetchNodePermissions,
  setNodePermission,
  deleteNodePermission,
  transferNodeOwnership,
  fetchAssignablePrincipals,
} from '../../api/permissions';
import { NodePermissions } from '../../types/document';

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
  const [selectedGranteeType, setSelectedGranteeType] = useState<'USER' | 'TEAM'>('USER');
  const [selectedGranteeId, setSelectedGranteeId] = useState<string>('');
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<'READ' | 'COMMENT' | 'EDIT' | 'ADMIN'>('READ');
  const [transferOwnerId, setTransferOwnerId] = useState<string>('');
  const [transferIsTeam, setTransferIsTeam] = useState<boolean>(false);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);

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

  // Set permission mutation
  const setPermMutation = useMutation({
    mutationFn: async () => {
      if (!selectedGranteeId) return;
      return setNodePermission({
        target_type: targetType,
        target_id: targetId,
        directory_path: directoryPath,
        grantee_type: selectedGranteeType,
        grantee_id: selectedGranteeId,
        access_level: selectedAccessLevel,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['node-permissions', targetType, targetId, directoryPath] });
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
      setIsTransferring(false);
      setTransferOwnerId('');
    },
    onError: (err: any) => {
      alert(`Failed to transfer ownership: ${err?.message || 'Permission denied'}`);
    },
  });

  if (!isOpen) return null;

  const canManage = permissions?.can_manage ?? false;

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

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {isLoading ? (
            <div className="text-center py-12 text-sm text-cme-text-muted">Loading permissions...</div>
          ) : (
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
                      >
                        Team
                      </button>
                    </div>

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
                      disabled={!selectedGranteeId || setPermMutation.isPending}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors shadow-xs"
                      data-testid="add-permission-btn"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Grant</span>
                    </button>
                  </div>
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
                        <div className="flex items-center gap-2">
                          {grant.grantee_type === 'TEAM' ? (
                            <Users className="w-4 h-4 text-indigo-500" />
                          ) : (
                            <User className="w-4 h-4 text-emerald-500" />
                          )}
                          <span className="font-medium text-cme-text-base">{grant.grantee_name}</span>
                          <span className="text-[10px] uppercase font-bold text-cme-text-muted">
                            ({grant.grantee_type})
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
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
                        <div className="flex items-center gap-2">
                          {grant.grantee_type === 'TEAM' ? (
                            <Users className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <User className="w-4 h-4 text-emerald-400" />
                          )}
                          <span className="font-medium text-cme-text-base">{grant.grantee_name}</span>
                          <span className="text-[10px] uppercase font-bold text-cme-text-muted">
                            ({grant.grantee_type})
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
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
                  Permissions in CME are additive: grants at parent directories propagate to all children and cannot be revoked locally.
                </p>
              </div>
            </>
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
