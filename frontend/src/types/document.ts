export interface DocumentRecord {
  id: string;
  path: string;
  title: string;
  content?: string;
  owner_user_id?: string;
  owner_team_id?: string;
  is_bundle: boolean;
  number_headers?: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceNode {
  name: string;
  path: string;
  is_directory: boolean;
  is_bundle: boolean;
  size_bytes?: number;
  id?: string;
  title?: string;
  owner_user_id?: string;
  updated_at?: string;
  children?: WorkspaceNode[];
}

export interface TrashNode {
  id: string;
  path: string;
  name: string;
  size_bytes: number;
  is_directory: boolean;
  is_bundle: boolean;
  deleted_at: string;
}

export interface SearchResult {
  id: string;
  path: string;
  title: string;
  snippet: string;
  updated_at: string;
}

export interface BreadcrumbItem {
  label: string;
  path?: string;
  isCurrent?: boolean;
}

export interface DocumentAsset {
  name: string;
  relative_path: string;
  bundle_relative_path: string;
  size_bytes: number;
  is_image: boolean;
  last_modified: string;
  url: string;
}

export interface DirectoryDashboardItem {
  name: string;
  path: string;
  is_directory: boolean;
  is_bundle: boolean;
  type: 'directory' | 'bundle' | 'document' | 'file';
  size_bytes?: number;
  id?: string;
  title?: string;
  owner_user_id?: string;
  owner_name?: string;
  updated_at?: string;
  comments_count: number;
  suggestions_count: number;
  open_tasks_count: number;
}

export interface DirectoryDashboard {
  path: string;
  items: DirectoryDashboardItem[];
}

export interface PrincipalInfo {
  id: string;
  name: string;
  display_name: string;
  is_team: boolean;
}

export interface ExplicitGrant {
  id: number;
  grantee_type: 'USER' | 'TEAM';
  grantee_id: string;
  grantee_name: string;
  access_level: 'READ' | 'COMMENT' | 'EDIT' | 'ADMIN';
}

export interface InheritedGrant {
  id: number;
  grantee_type: 'USER' | 'TEAM';
  grantee_id: string;
  grantee_name: string;
  access_level: 'READ' | 'COMMENT' | 'EDIT' | 'ADMIN';
  inherited_from: string;
}

export interface NodePermissions {
  target_type: 'DOCUMENT' | 'DIRECTORY';
  target_id: string;
  target_path: string;
  effective_permission: 'read' | 'comment' | 'edit' | 'admin' | 'none';
  can_manage: boolean;
  owner: PrincipalInfo;
  explicit_grants: ExplicitGrant[];
  inherited_grants: InheritedGrant[];
}

export interface AssignablePrincipals {
  users: Array<{ id: string; username: string; display_name: string }>;
  teams: Array<{ id: string; name: string; description: string }>;
}
