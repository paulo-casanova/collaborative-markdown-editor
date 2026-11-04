import { apiRequest } from './client';

export interface TagSummary {
  tag: string;
  document_count: number;
  occurrence_count: number;
}

export interface DocumentTagOccurrence {
  heading_anchor: string;
  line_number: number;
}

export interface DocumentTagMatch {
  id: string;
  title: string;
  path: string;
  updated_at: string;
  occurrence_count: number;
  occurrences: DocumentTagOccurrence[];
}

export interface TagDocumentsResponse {
  tag: string;
  total_documents: number;
  documents: DocumentTagMatch[];
}

/**
 * Fetches all distinct tags accessible to the user, with optional search query.
 */
export async function fetchTags(query = ''): Promise<TagSummary[]> {
  const queryStr = query ? `?q=${encodeURIComponent(query)}` : '';
  return apiRequest<TagSummary[]>(`/api/v1/tags${queryStr}`);
}

/**
 * Fetches all documents containing a specific tag.
 */
export async function fetchTagDocuments(tag: string): Promise<TagDocumentsResponse> {
  const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
  return apiRequest<TagDocumentsResponse>(`/api/v1/tags/documents?tag=${encodeURIComponent(cleanTag)}`);
}
