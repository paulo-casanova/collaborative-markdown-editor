import { apiRequest, TOKEN_STORAGE_KEY } from './client';
import { DocumentRecord, WorkspaceNode, TrashNode, SearchResult, DocumentAsset, DirectoryDashboard } from '../types/document';

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

const workspacePathLookup = new Map<string, string>();

export function updateWorkspaceNodesCache(nodes: WorkspaceNode[]) {
  workspacePathLookup.clear();
  for (const n of nodes) {
    const isBundle = Boolean(n.is_bundle && n.path.endsWith('.bundle'));
    if (!n.is_directory || isBundle) {
      const norm = (n.path || '').replace(/^\/+/, '').replace(/\/+$/, '');
      if (!norm) continue;
      workspacePathLookup.set(norm.toLowerCase(), norm);
      const lastSlash = norm.lastIndexOf('/');
      const basename = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm;
      workspacePathLookup.set(basename.toLowerCase(), norm);
      if (basename.toLowerCase().endsWith('.md')) {
        const stem = basename.slice(0, -3);
        workspacePathLookup.set(stem.toLowerCase(), norm);
      }
      if (norm.toLowerCase().endsWith('.md')) {
        const normWithoutMd = norm.slice(0, -3);
        workspacePathLookup.set(normWithoutMd.toLowerCase(), norm);
      }
    }
  }
}

export function resolveWorkspaceRelativePath(target: string, currentDocPath?: string): string {
  let clean = (target || '').trim();
  if (clean.startsWith('/')) {
    return clean.replace(/^\/+/, '');
  }
  if (!currentDocPath) {
    return clean;
  }
  const lastSlash = currentDocPath.lastIndexOf('/');
  const docDir = lastSlash >= 0 ? currentDocPath.slice(0, lastSlash) : '';
  if (!docDir) {
    return clean;
  }
  const parts = `${docDir}/${clean}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

export function findWorkspacePath(target: string, currentDocPath?: string): string {
  let clean = (target || '').trim().replace(/^\/+/, '');
  if (!clean) return '';
  if (clean.startsWith('<') && clean.endsWith('>')) {
    clean = clean.slice(1, -1).trim();
  }
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // ignore
  }

  // 1. If relative to currentDocPath exists in cache
  if (currentDocPath) {
    const relClean = resolveWorkspaceRelativePath(clean, currentDocPath);
    if (workspacePathLookup.has(relClean.toLowerCase())) {
      return workspacePathLookup.get(relClean.toLowerCase())!;
    }
    if (workspacePathLookup.has(`${relClean.toLowerCase()}.md`)) {
      return workspacePathLookup.get(`${relClean.toLowerCase()}.md`)!;
    }
    const relDecoded = resolveWorkspaceRelativePath(decoded, currentDocPath);
    if (workspacePathLookup.has(relDecoded.toLowerCase())) {
      return workspacePathLookup.get(relDecoded.toLowerCase())!;
    }
    if (workspacePathLookup.has(`${relDecoded.toLowerCase()}.md`)) {
      return workspacePathLookup.get(`${relDecoded.toLowerCase()}.md`)!;
    }
  }

  // 2. Direct match in lookup (clean or decoded)
  if (workspacePathLookup.has(clean.toLowerCase())) {
    return workspacePathLookup.get(clean.toLowerCase())!;
  }
  if (workspacePathLookup.has(`${clean.toLowerCase()}.md`)) {
    return workspacePathLookup.get(`${clean.toLowerCase()}.md`)!;
  }
  if (workspacePathLookup.has(decoded.toLowerCase())) {
    return workspacePathLookup.get(decoded.toLowerCase())!;
  }
  if (workspacePathLookup.has(`${decoded.toLowerCase()}.md`)) {
    return workspacePathLookup.get(`${decoded.toLowerCase()}.md`)!;
  }

  // 3. Basename or stem match in lookup
  const lastSlash = decoded.lastIndexOf('/');
  const basename = lastSlash >= 0 ? decoded.slice(lastSlash + 1) : decoded;
  if (workspacePathLookup.has(basename.toLowerCase())) {
    return workspacePathLookup.get(basename.toLowerCase())!;
  }
  if (workspacePathLookup.has(`${basename.toLowerCase()}.md`)) {
    return workspacePathLookup.get(`${basename.toLowerCase()}.md`)!;
  }

  // 4. Default to resolved relative path if currentDocPath provided, else decoded/clean
  return currentDocPath ? resolveWorkspaceRelativePath(decoded, currentDocPath) : decoded;
}

export function getWorkspaceFileUrl(path: string, currentDocPath?: string): string {
  if (!path) return '';
  let trimmed = path.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (/^(https?:\/\/|data:|blob:)/i.test(trimmed)) {
    try {
      return encodeURI(decodeURI(trimmed));
    } catch {
      return encodeURI(trimmed);
    }
  }
  const resolved = findWorkspacePath(trimmed, currentDocPath);
  let cleanPath = (resolved || trimmed).replace(/^\/+/, '');
  try {
    cleanPath = decodeURIComponent(cleanPath);
  } catch {
    // ignore
  }
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
  const nodes = data.tree || [];
  updateWorkspaceNodesCache(nodes);
  return nodes;
}

export async function fetchDocument(id: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}`);
}

export async function fetchDocumentByPath(path: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/by-path?path=${encodeURIComponent(path)}`);
}

export async function createDocument(payload: { path: string; title?: string; content?: string; number_headers?: boolean }): Promise<DocumentRecord> {
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

export async function renameDirectory(
  oldPath: string,
  newPath: string
): Promise<{ status: string; old_path: string; new_path: string }> {
  return apiRequest<{ status: string; old_path: string; new_path: string }>(
    '/api/v1/workspaces/directories',
    {
      method: 'PATCH',
      body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
    }
  );
}

export async function deleteDirectory(
  path: string
): Promise<{ status: string; path: string; trash_id: string }> {
  return apiRequest<{ status: string; path: string; trash_id: string }>(
    `/api/v1/workspaces/directories?path=${encodeURIComponent(path)}`,
    {
      method: 'DELETE',
    }
  );
}

export async function updateDocument(id: string, payload: { title?: string; content?: string; number_headers?: boolean }): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function moveDocument(id: string, newPath: string, title?: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ new_path: newPath, ...(title ? { title } : {}) }),
  });
}

export async function convertDocument(id: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}/convert`, {
    method: 'POST',
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

export async function fetchDocumentAssets(docId: string): Promise<DocumentAsset[]> {
  const resp = await apiRequest<{ doc_id: string; is_bundle: boolean; assets: DocumentAsset[] }>(
    `/api/v1/documents/${docId}/assets`
  );
  return resp.assets || [];
}

export async function uploadDocumentAsset(
  docId: string,
  filename: string,
  fileData: Blob | ArrayBuffer | Uint8Array | string
): Promise<{ filename: string; path: string }> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'X-Asset-Filename': filename,
  });
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`/api/v1/documents/${docId}/assets?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers,
    body: fileData as BodyInit,
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to upload asset: HTTP ${response.status}`);
  }
  return (await response.json()) as { filename: string; path: string };
}

export async function deleteDocumentAsset(docId: string, filename: string): Promise<void> {
  await apiRequest(`/api/v1/documents/${docId}/assets/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
}

export async function downloadWorkspaceFile(path: string, filename?: string): Promise<void> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers: HeadersInit = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const url = `/api/v1/workspaces/files?path=${encodeURIComponent(path)}`;
  const response = await fetch(url, { headers, credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to download file: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename || path.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export async function downloadBundleZip(path: string, docId?: string, filename?: string): Promise<void> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers: HeadersInit = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const url = docId
    ? `/api/v1/documents/${encodeURIComponent(docId)}/bundle.zip`
    : `/api/v1/workspaces/bundles/zip?path=${encodeURIComponent(path)}`;
  const response = await fetch(url, { headers, credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to download bundle zip: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  const defaultName = path.split('/').pop() || 'bundle';
  const finalName = filename || (defaultName.endsWith('.zip') ? defaultName : `${defaultName}.zip`);
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export async function importWorkspaceFileToBundleAsset(
  docId: string,
  sourcePath: string,
  targetFilename?: string
): Promise<{ filename: string; path: string }> {
  return apiRequest<{ filename: string; path: string }>(`/api/v1/documents/${docId}/assets/import`, {
    method: 'POST',
    body: JSON.stringify({
      source_path: sourcePath,
      target_filename: targetFilename,
    }),
  });
}

export async function fetchDirectoryDashboard(path: string): Promise<DirectoryDashboard> {
  return apiRequest<DirectoryDashboard>(`/api/v1/workspaces/directory-details?path=${encodeURIComponent(path || '')}`);
}

export * from './reviews';

