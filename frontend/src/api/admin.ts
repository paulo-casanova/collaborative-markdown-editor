import { apiRequest } from './client';
import {
  AdminUser,
  AdminTeam,
  AdminTeamMember,
  CreateTeamPayload,
  UpdateTeamPayload,
  AddMemberPayload,
} from '../types/admin';

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const result = await apiRequest<AdminUser[] | { users: AdminUser[] }>('/api/v1/admin/users');
  if (Array.isArray(result)) return result;
  return result?.users || [];
}

export async function fetchAdminTeams(): Promise<AdminTeam[]> {
  const result = await apiRequest<AdminTeam[] | { teams: AdminTeam[] }>('/api/v1/admin/teams');
  if (Array.isArray(result)) return result;
  return result?.teams || [];
}

export async function createAdminTeam(payload: CreateTeamPayload): Promise<AdminTeam> {
  return apiRequest<AdminTeam>('/api/v1/admin/teams', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminTeam(teamId: string, payload: UpdateTeamPayload): Promise<AdminTeam> {
  return apiRequest<AdminTeam>(`/api/v1/admin/teams/${encodeURIComponent(teamId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminTeam(teamId: string): Promise<void> {
  await apiRequest(`/api/v1/admin/teams/${encodeURIComponent(teamId)}`, {
    method: 'DELETE',
  });
}

export async function fetchTeamMembers(teamId: string): Promise<AdminTeamMember[]> {
  const result = await apiRequest<AdminTeamMember[] | { members: AdminTeamMember[] }>(
    `/api/v1/admin/teams/${encodeURIComponent(teamId)}/members`
  );
  if (Array.isArray(result)) return result;
  return result?.members || [];
}

export async function addTeamMember(teamId: string, payload: AddMemberPayload): Promise<void> {
  await apiRequest(`/api/v1/admin/teams/${encodeURIComponent(teamId)}/members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await apiRequest(
    `/api/v1/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
    }
  );
}

export async function fetchTeamParents(teamId: string): Promise<AdminTeam[]> {
  const result = await apiRequest<AdminTeam[] | { parents: AdminTeam[] }>(
    `/api/v1/admin/teams/${encodeURIComponent(teamId)}/parents`
  );
  if (Array.isArray(result)) return result;
  return result?.parents || [];
}

export async function linkTeamParent(teamId: string, parentIdOrName: string): Promise<void> {
  await apiRequest(`/api/v1/admin/teams/${encodeURIComponent(teamId)}/parents`, {
    method: 'POST',
    body: JSON.stringify({ parent_id: parentIdOrName }),
  });
}

export async function unlinkTeamParent(teamId: string, parentId: string): Promise<void> {
  await apiRequest(
    `/api/v1/admin/teams/${encodeURIComponent(teamId)}/parents/${encodeURIComponent(parentId)}`,
    {
      method: 'DELETE',
    }
  );
}
