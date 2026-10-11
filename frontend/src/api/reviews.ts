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

export async function deleteComment(commentId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/comments/${commentId}`, {
    method: 'DELETE',
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

export async function updateTask(taskId: string, isCompleted: boolean): Promise<TaskRecord> {
  return await apiRequest<TaskRecord>(`/api/v1/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_completed: isCompleted }),
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

