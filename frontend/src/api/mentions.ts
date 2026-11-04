import { apiRequest } from './client';

export interface DocumentMention {
  id: string;
  document_id: string;
  document_title: string;
  document_path: string;
  recipient_id: string;
  author_id: string | null;
  author_username: string;
  heading_anchor: string;
  context_snippet: string;
  fingerprint: string;
  status: 'UNREAD' | 'ACKNOWLEDGED';
  is_active: boolean;
  created_at: string;
  acknowledged_at: string | null;
}

export interface MentionsListResponse {
  mentions: DocumentMention[];
  unread_count: number;
}

export interface MentionCandidate {
  id: string;
  username: string;
  display_name: string;
}

/**
 * Fetches document mentions for the current user with optional status filter and pagination.
 */
export async function fetchMentions(
  status: 'UNREAD' | 'ACKNOWLEDGED' | 'ALL' = 'UNREAD',
  limit = 50,
  offset = 0
): Promise<MentionsListResponse> {
  const params = new URLSearchParams({
    status,
    limit: String(limit),
    offset: String(offset),
  });
  return apiRequest<MentionsListResponse>(`/api/v1/mentions?${params.toString()}`);
}

/**
 * Fetches total count of unread active mentions for the current user.
 */
export async function fetchUnreadMentionsCount(): Promise<{ unread_count: number }> {
  return apiRequest<{ unread_count: number }>('/api/v1/mentions/count');
}

/**
 * Acknowledges a specific active mention for the current user.
 */
export async function acknowledgeMention(mentionId: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/v1/mentions/${encodeURIComponent(mentionId)}/ack`, {
    method: 'PATCH',
  });
}

/**
 * Batch-acknowledges all unread mentions for the current user.
 */
export async function acknowledgeAllMentions(): Promise<{ status: string; count: number }> {
  return apiRequest<{ status: string; count: number }>('/api/v1/mentions/ack-all', {
    method: 'POST',
  });
}

/**
 * Searches candidate users for mention autocomplete dropdown.
 */
export async function fetchMentionCandidates(query = ''): Promise<MentionCandidate[]> {
  const params = new URLSearchParams();
  if (query) {
    params.set('q', query);
  }
  const queryStr = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<MentionCandidate[]>(`/api/v1/users/mention-candidates${queryStr}`);
}
