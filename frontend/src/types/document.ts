export interface DocumentRecord {
  id: string;
  path: string;
  title: string;
  content?: string;
  owner_user_id?: string;
  owner_team_id?: string;
  is_bundle: boolean;
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
