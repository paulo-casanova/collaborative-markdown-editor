import { apiRequest } from './client';
import { NodePermissions, AssignablePrincipals, TestPermissionResult } from '../types/document';

export interface FetchPermissionsParams {
  target_type?: 'DOCUMENT' | 'DIRECTORY';
  target_id?: string;
  directory_path?: string;
}

export interface SetPermissionPayload {
  target_type?: 'DOCUMENT' | 'DIRECTORY';
  target_id?: string;
  directory_path?: string;
  grantee_type: 'USER' | 'TEAM' | 'EVERYONE';
  grantee_id?: string;
  access_level: 'READ' | 'COMMENT' | 'EDIT' | 'ADMIN';
  is_inheritable?: boolean;
}

export interface TestPermissionParams {
  target_type?: 'DOCUMENT' | 'DIRECTORY';
  target_id?: string;
  directory_path?: string;
  subject_type: 'USER' | 'TEAM';
  subject_id: string;
}

export interface TransferOwnershipPayload {
  target_type?: 'DOCUMENT' | 'DIRECTORY';
  target_id?: string;
  directory_path?: string;
  new_owner_user_id?: string;
  new_owner_team_id?: string;
}

export async function fetchNodePermissions(params: FetchPermissionsParams): Promise<NodePermissions> {
  const query = new URLSearchParams();
  if (params.target_type) query.set('target_type', params.target_type);
  if (params.target_id) query.set('target_id', params.target_id);
  if (params.directory_path !== undefined) query.set('directory_path', params.directory_path);

  return apiRequest<NodePermissions>(`/api/v1/workspaces/permissions?${query.toString()}`);
}

export async function setNodePermission(payload: SetPermissionPayload): Promise<NodePermissions> {
  return apiRequest<NodePermissions>('/api/v1/workspaces/permissions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteNodePermission(permissionId: number): Promise<void> {
  await apiRequest(`/api/v1/workspaces/permissions/${permissionId}`, {
    method: 'DELETE',
  });
}

export async function transferNodeOwnership(payload: TransferOwnershipPayload): Promise<void> {
  await apiRequest('/api/v1/workspaces/permissions/owner', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function fetchAssignablePrincipals(): Promise<AssignablePrincipals> {
  return apiRequest<AssignablePrincipals>('/api/v1/workspaces/principals');
}

export async function testNodePermissions(payload: TestPermissionParams): Promise<TestPermissionResult> {
  return apiRequest<TestPermissionResult>('/api/v1/workspaces/permissions/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
