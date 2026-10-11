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
  id?: string;
  title?: string;
  children?: WorkspaceNode[];
}

export interface BreadcrumbItem {
  label: string;
  path?: string;
  isCurrent?: boolean;
}
