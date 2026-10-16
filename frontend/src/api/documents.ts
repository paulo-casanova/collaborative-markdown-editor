import { apiRequest, TOKEN_STORAGE_KEY } from './client';
import { DocumentRecord, WorkspaceNode, TrashNode, SearchResult } from '../types/document';

export function isMarkdownPath(path: string, isBundle?: boolean): boolean {
  if (isBundle) return true;
  const lower = (path || '').toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.bundle')) {
    return true;
  }
  // If path has no file extension at all, treat as markdown document
  const lastSlash = lower.lastIndexOf('/');
  const filename = lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower;
  return !filename.includes('.');
}

export function getWorkspaceFileUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, '');
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const base = `/api/v1/workspaces/files?path=${encodeURIComponent(cleanPath)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

export async function uploadWorkspaceFile(
  path: string,
  fileData: Blob | ArrayBuffer | Uint8Array | string
): Promise<DocumentRecord> {
  const cleanPath = path.replace(/^\/+/, '');
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'X-File-Path': cleanPath,
  });
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`/api/v1/workspaces/files?path=${encodeURIComponent(cleanPath)}`, {
    method: 'POST',
    headers,
    body: fileData as BodyInit,
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to upload file: HTTP ${response.status}`);
  }
  return (await response.json()) as DocumentRecord;
}

export async function fetchWorkspaceTree(): Promise<WorkspaceNode[]> {
  const data = await apiRequest<{ tree: WorkspaceNode[] }>('/api/v1/workspaces/tree');
  return data.tree || [];
}

export async function fetchDocument(id: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}`);
}

export async function fetchDocumentByPath(path: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/by-path?path=${encodeURIComponent(path)}`);
}

export async function createDocument(payload: { path: string; title?: string; content?: string }): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>('/api/v1/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createDirectory(path: string): Promise<{ path: string; is_directory: boolean }> {
  return apiRequest<{ path: string; is_directory: boolean }>('/api/v1/workspaces/directories', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function updateDocument(id: string, payload: { title?: string; content?: string }): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function moveDocument(id: string, newPath: string, title?: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ new_path: newPath, ...(title ? { title } : {}) }),
  });
}

export async function deleteDocument(id: string): Promise<{ status: string; trash_id: string }> {
  return apiRequest<{ status: string; trash_id: string }>(`/api/v1/documents/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchRecentDocuments(limit: number = 20): Promise<DocumentRecord[]> {
  const data = await apiRequest<{ recents: DocumentRecord[] }>(`/api/v1/users/me/recents?limit=${limit}`);
  return data.recents || [];
}

export async function searchDocuments(q: string, pathPrefix: string = '', limit: number = 20): Promise<SearchResult[]> {
  const data = await apiRequest<{ query: string; results: SearchResult[] }>(
    `/api/v1/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(pathPrefix)}&limit=${limit}`
  );
  return data.results || [];
}

export async function fetchTrash(): Promise<TrashNode[]> {
  const data = await apiRequest<{ trash: TrashNode[] }>('/api/v1/trash');
  return data.trash || [];
}

export async function restoreTrash(id: string, targetPath: string = ''): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/trash/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ target_path: targetPath }),
  });
}

export async function purgeTrash(id: string): Promise<{ status: string; id: string }> {
  return apiRequest<{ status: string; id: string }>(`/api/v1/trash/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchRawMarkdown(id: string): Promise<string> {
  return apiRequest<string>(`/api/v1/documents/${id}/raw`);
}

export interface ReviewComment {
  id: string;
  document_id: string;
  user_id: string;
  username?: string;
  content: string;
  anchor_offset?: number;
  anchor_length?: number;
  quote?: string;
  created_at: string;
}

export interface ReviewSuggestion {
  id: string;
  document_id: string;
  user_id: string;
  username?: string;
  original_text: string;
  suggested_text: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface ReviewTask {
  id: string;
  document_id: string;
  user_id: string;
  description: string;
  is_completed: boolean;
  created_at: string;
}

export async function fetchDocumentHtml(
  target: string,
  isPath: boolean = false,
  includeReviews: boolean = false
): Promise<string> {
  const endpoint = isPath
    ? `/api/v1/documents/by-path/html?path=${encodeURIComponent(target)}&include_reviews=${includeReviews}&standalone=false`
    : `/api/v1/documents/${target}/html?include_reviews=${includeReviews}&standalone=false`;
  return apiRequest<string>(endpoint, {
    headers: { Accept: 'text/html' },
  });
}

export async function fetchDocumentComments(id: string): Promise<ReviewComment[]> {
  try {
    return await apiRequest<ReviewComment[]>(`/api/v1/documents/${id}/comments`);
  } catch {
    return [];
  }
}

export async function fetchDocumentSuggestions(id: string): Promise<ReviewSuggestion[]> {
  try {
    return await apiRequest<ReviewSuggestion[]>(`/api/v1/documents/${id}/suggestions`);
  } catch {
    return [];
  }
}

export async function fetchDocumentTasks(id: string): Promise<ReviewTask[]> {
  try {
    return await apiRequest<ReviewTask[]>(`/api/v1/documents/${id}/tasks`);
  } catch {
    return [];
  }
}

export * from './reviews';
