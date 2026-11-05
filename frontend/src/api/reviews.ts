/**
 * REST API client for the Collaborative Review System:
 * - Threaded Comments
 * - Inline Suggestions
 * - Task Checklist items
 */

import { apiRequest } from './client';
import { CommentRecord, SuggestionRecord, TaskRecord, DualAnchor } from '../review/types';

// =============================================================================
// Comments API
// =============================================================================

export async function fetchDocumentComments(documentId: string): Promise<CommentRecord[]> {
  try {
    return await apiRequest<CommentRecord[]>(`/api/v1/documents/${documentId}/comments`);
  } catch (err) {
    console.warn(`[ReviewAPI] fetchDocumentComments failed for ${documentId}:`, err);
    return [];
  }
}

export async function createComment(
  documentId: string,
  content: string,
  anchor: DualAnchor | any = {}
): Promise<CommentRecord> {
  return await apiRequest<CommentRecord>(`/api/v1/documents/${documentId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, anchor }),
  });
}

export async function replyComment(commentId: string, content: string): Promise<CommentRecord> {
  return await apiRequest<CommentRecord>(`/api/v1/comments/${commentId}/replies`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function updateCommentStatus(
  commentId: string,
  status: 'OPEN' | 'RESOLVED'
): Promise<CommentRecord> {
  return await apiRequest<CommentRecord>(`/api/v1/comments/${commentId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateComment(commentId: string, content: string): Promise<CommentRecord> {
  return await apiRequest<CommentRecord>(`/api/v1/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export async function deleteComment(commentId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/comments/${commentId}`, {
    method: 'DELETE',
  });
}

export async function archiveComment(commentId: string): Promise<CommentRecord> {
  return await apiRequest<CommentRecord>(`/api/v1/comments/${commentId}/archive`, {
    method: 'POST',
  });
}

export async function fetchParticipatedComments(statusFilter = 'active'): Promise<CommentRecord[]> {
  try {
    const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return await apiRequest<CommentRecord[]>(`/api/v1/comments${q}`);
  } catch (err) {
    console.warn('[ReviewAPI] fetchParticipatedComments failed:', err);
    return [];
  }
}

export async function fetchUnacknowledgedCommentsCount(): Promise<{ unacknowledged_count: number }> {
  try {
    return await apiRequest<{ unacknowledged_count: number }>('/api/v1/comments/count');
  } catch (err) {
    console.warn('[ReviewAPI] fetchUnacknowledgedCommentsCount failed:', err);
    return { unacknowledged_count: 0 };
  }
}

export async function acknowledgeComment(commentId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/comments/${commentId}/ack`, {
    method: 'POST',
  });
}

export async function acknowledgeAllComments(): Promise<{ status: string; count: number }> {
  return await apiRequest<{ status: string; count: number }>('/api/v1/comments/ack-all', {
    method: 'POST',
  });
}

// =============================================================================
// Suggestions API
// =============================================================================

export async function fetchDocumentSuggestions(
  documentId: string,
  statusFilter?: string
): Promise<SuggestionRecord[]> {
  try {
    const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return await apiRequest<SuggestionRecord[]>(`/api/v1/documents/${documentId}/suggestions${q}`);
  } catch (err) {
    console.warn(`[ReviewAPI] fetchDocumentSuggestions failed for ${documentId}:`, err);
    return [];
  }
}

export async function createSuggestion(
  documentId: string,
  originalText: string,
  suggestedText: string,
  anchor: DualAnchor | any = {}
): Promise<SuggestionRecord> {
  return await apiRequest<SuggestionRecord>(`/api/v1/documents/${documentId}/suggestions`, {
    method: 'POST',
    body: JSON.stringify({
      original_text: originalText,
      suggested_text: suggestedText,
      anchor,
    }),
  });
}

export async function acceptSuggestion(suggestionId: string): Promise<SuggestionRecord> {
  return await apiRequest<SuggestionRecord>(`/api/v1/suggestions/${suggestionId}/accept`, {
    method: 'POST',
  });
}

export async function rejectSuggestion(suggestionId: string): Promise<SuggestionRecord> {
  return await apiRequest<SuggestionRecord>(`/api/v1/suggestions/${suggestionId}/reject`, {
    method: 'POST',
  });
}

export async function archiveSuggestion(suggestionId: string): Promise<SuggestionRecord> {
  return await apiRequest<SuggestionRecord>(`/api/v1/suggestions/${suggestionId}/archive`, {
    method: 'POST',
  });
}

export async function fetchAllSuggestions(statusFilter = 'active'): Promise<SuggestionRecord[]> {
  try {
    const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return await apiRequest<SuggestionRecord[]>(`/api/v1/suggestions${q}`);
  } catch (err) {
    console.warn('[ReviewAPI] fetchAllSuggestions failed:', err);
    return [];
  }
}

export async function fetchUnacknowledgedSuggestionsCount(): Promise<{ unacknowledged_count: number }> {
  try {
    return await apiRequest<{ unacknowledged_count: number }>('/api/v1/suggestions/count');
  } catch (err) {
    console.warn('[ReviewAPI] fetchUnacknowledgedSuggestionsCount failed:', err);
    return { unacknowledged_count: 0 };
  }
}

export async function acknowledgeSuggestion(suggestionId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/suggestions/${suggestionId}/ack`, {
    method: 'POST',
  });
}

export async function acknowledgeAllSuggestions(): Promise<{ status: string; count: number }> {
  return await apiRequest<{ status: string; count: number }>('/api/v1/suggestions/ack-all', {
    method: 'POST',
  });
}

// =============================================================================
// Tasks API
// =============================================================================

export async function fetchDocumentTasks(documentId: string): Promise<TaskRecord[]> {
  try {
    return await apiRequest<TaskRecord[]>(`/api/v1/documents/${documentId}/tasks`);
  } catch (err) {
    console.warn(`[ReviewAPI] fetchDocumentTasks failed for ${documentId}:`, err);
    return [];
  }
}

export async function createTask(
  documentId: string,
  description: string,
  commentId?: string,
  assigneeId?: string,
  dueDate?: string
): Promise<TaskRecord> {
  return await apiRequest<TaskRecord>(`/api/v1/documents/${documentId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      description,
      comment_id: commentId || null,
      assignee_id: assigneeId || null,
      due_date: dueDate || null,
    }),
  });
}

export interface UpdateTaskPayload {
  is_completed?: boolean;
  description?: string;
  assignee_id?: string | null;
  due_date?: string | null;
}

export async function updateTask(
  taskId: string,
  payload: boolean | UpdateTaskPayload
): Promise<TaskRecord> {
  const body = typeof payload === 'boolean' ? { is_completed: payload } : payload;
  return await apiRequest<TaskRecord>(`/api/v1/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

export async function fetchAllTasks(
  completedFilter?: boolean,
  assignedToMe?: boolean
): Promise<TaskRecord[]> {
  try {
    const params = new URLSearchParams();
    if (completedFilter !== undefined) {
      params.set('completed', String(completedFilter));
    }
    if (assignedToMe) {
      params.set('assigned_to_me', 'true');
    }
    const qs = params.toString();
    const endpoint = `/api/v1/tasks${qs ? `?${qs}` : ''}`;
    return await apiRequest<TaskRecord[]>(endpoint);
  } catch (err) {
    console.warn('[ReviewAPI] fetchAllTasks failed:', err);
    return [];
  }
}

