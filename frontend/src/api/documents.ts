import { apiRequest } from './client';
import { DocumentRecord, WorkspaceNode } from '../types/document';

export async function fetchWorkspaceTree(): Promise<WorkspaceNode> {
  return apiRequest<WorkspaceNode>('/api/v1/workspaces/tree');
}

export async function fetchDocument(id: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/${id}`);
}

export async function fetchDocumentByPath(path: string): Promise<DocumentRecord> {
  return apiRequest<DocumentRecord>(`/api/v1/documents/by-path?path=${encodeURIComponent(path)}`);
}

export async function fetchRawMarkdown(id: string): Promise<string> {
  return apiRequest<string>(`/api/v1/documents/${id}/raw`);
}
