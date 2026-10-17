import { create } from 'zustand';
import {
  CommentRecord,
  SuggestionRecord,
  TaskRecord,
  DualAnchor,
} from '../review/types';
import * as reviewApi from '../api/reviews';

export interface PendingSelection {
  start: number;
  end: number;
  text: string;
  anchor: DualAnchor | any;
}

export interface ReviewState {
  documentId: string | null;
  comments: CommentRecord[];
  suggestions: SuggestionRecord[];
  tasks: TaskRecord[];
  activeItemId: string | null;
  filter: 'all' | 'comments' | 'suggestions' | 'tasks';
  showResolved: boolean;
  showInTextReviews: boolean;
  isSidebarOpen: boolean;
  sidebarWidth: number;
  suggestingMode: boolean;
  isLoading: boolean;

  pendingCommentSelection: PendingSelection | null;
  pendingSuggestionSelection: PendingSelection | null;

  // Actions
  initDocument: (documentId: string) => Promise<void>;
  handleWebSocketReviewEvent: (event: any) => void;
  setActiveItemId: (id: string | null) => void;
  setFilter: (filter: 'all' | 'comments' | 'suggestions' | 'tasks') => void;
  setShowResolved: (show: boolean) => void;
  setShowInTextReviews: (show: boolean) => void;
  toggleInTextReviews: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleSuggestingMode: () => void;
  setSuggestingMode: (mode: boolean) => void;
  setPendingCommentSelection: (sel: PendingSelection | null) => void;
  setPendingSuggestionSelection: (sel: PendingSelection | null) => void;

  // Mutations
  postComment: (content: string) => Promise<CommentRecord | null>;
  postReply: (commentId: string, content: string) => Promise<CommentRecord | null>;
  editComment: (commentId: string, content: string) => Promise<CommentRecord | null>;
  toggleCommentStatus: (commentId: string) => Promise<CommentRecord | null>;
  deleteComment: (commentId: string) => Promise<void>;

  postSuggestion: (suggestedText: string) => Promise<SuggestionRecord | null>;
  acceptSuggestion: (suggestionId: string, onLocalApply?: () => void) => Promise<SuggestionRecord | null>;
  rejectSuggestion: (suggestionId: string) => Promise<SuggestionRecord | null>;

  toggleTask: (taskId: string, isCompleted: boolean) => Promise<TaskRecord | null>;
  editTask: (taskId: string, payload: reviewApi.UpdateTaskPayload) => Promise<TaskRecord | null>;
  postTask: (description: string, commentId?: string, assigneeId?: string, dueDate?: string) => Promise<TaskRecord | null>;
  deleteTask: (taskId: string) => Promise<void>;
}

const getInitialReviewSidebarWidth = (): number => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = Number(window.localStorage.getItem('cme_review_sidebar_width'));
      if (!Number.isNaN(saved) && saved >= 260 && saved <= 700) {
        return saved;
      }
    }
  } catch {
    // ignore
  }
  return 384;
};

export const useReviewStore = create<ReviewState>((set, get) => ({
  documentId: null,
  comments: [],
  suggestions: [],
  tasks: [],
  activeItemId: null,
  filter: 'all',
  showResolved: true,
  showInTextReviews: true,
  isSidebarOpen: false,
  sidebarWidth: getInitialReviewSidebarWidth(),
  suggestingMode: false,
  isLoading: false,

  setSidebarWidth: (width: number) => {
    const clamped = Math.min(700, Math.max(260, Math.round(width)));
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('cme_review_sidebar_width', String(clamped));
      }
    } catch {
      // ignore
    }
    set({ sidebarWidth: clamped });
  },

  pendingCommentSelection: null,
  pendingSuggestionSelection: null,

  initDocument: async (documentId: string) => {
    if (!documentId || documentId === 'by-path') {
      set({ documentId: null, comments: [], suggestions: [], tasks: [], isLoading: false });
      return;
    }
    set({ documentId, isLoading: true });
    try {
      const [comments, suggestions, tasks] = await Promise.all([
        reviewApi.fetchDocumentComments(documentId),
        reviewApi.fetchDocumentSuggestions(documentId),
        reviewApi.fetchDocumentTasks(documentId),
      ]);
      set({ comments, suggestions, tasks, isLoading: false });
    } catch (err) {
      console.error('[useReviewStore] Failed to fetch reviews:', err);
      set({ isLoading: false });
    }
  },

  handleWebSocketReviewEvent: (payload: any) => {
    if (!payload || !payload.event) return;
    const { event, comment, suggestion, task, document_id } = payload;
    const currentDocId = get().documentId;
    if (document_id && currentDocId && document_id !== currentDocId) return;

    switch (event) {
      case 'COMMENT_CREATED': {
        if (!comment) return;
        set((state) => {
          if (state.comments.some((c) => c.id === comment.id)) return state;
          return { comments: [comment, ...state.comments] };
        });
        break;
      }
      case 'COMMENT_REPLIED': {
        if (!comment) return;
        set((state) => ({
          comments: state.comments.map((c) => {
            if (c.id === comment.parent_id || c.id === comment.id) {
              const replies = c.replies || [];
              if (replies.some((r) => r.id === comment.id)) return c;
              return { ...c, replies: [...replies, comment] };
            }
            return c;
          }),
        }));
        break;
      }
      case 'COMMENT_UPDATED': {
        if (!comment) return;
        set((state) => ({
          comments: state.comments.map((c) => {
            if (c.id === comment.id) {
              return { ...c, ...comment, replies: c.replies };
            }
            if (c.replies && c.replies.some((r) => r.id === comment.id)) {
              return {
                ...c,
                replies: c.replies.map((r) => (r.id === comment.id ? { ...r, ...comment } : r)),
              };
            }
            return c;
          }),
        }));
        break;
      }
      case 'COMMENT_STATUS_CHANGED':
      case 'COMMENT_RESOLVED':
      case 'COMMENT_STATUS_UPDATED': {
        const commentId = payload.comment_id || comment?.id;
        const status = payload.status || comment?.status;
        if (!commentId) return;
        set((state) => ({
          comments: state.comments.map((c) => (c.id === commentId ? { ...c, status: status || 'RESOLVED' } : c)),
        }));
        break;
      }
      case 'COMMENT_DELETED': {
        const deletedId = payload.comment_id || comment?.id;
        if (!deletedId) return;
        set((state) => ({
          comments: state.comments.filter((c) => c.id !== deletedId),
        }));
        break;
      }
      case 'SUGGESTION_CREATED': {
        if (!suggestion) return;
        set((state) => {
          if (state.suggestions.some((s) => s.id === suggestion.id)) return state;
          return { suggestions: [suggestion, ...state.suggestions] };
        });
        break;
      }
      case 'SUGGESTION_ACCEPTED': {
        const sugg = suggestion || payload.suggestion;
        const suggId = sugg?.id || payload.suggestion_id;
        if (!suggId) return;
        set((state) => ({
          suggestions: state.suggestions.map((s) =>
            s.id === suggId
              ? { ...s, status: 'ACCEPTED', resolved_at: sugg?.resolved_at || new Date().toISOString() }
              : s
          ),
        }));
        break;
      }
      case 'SUGGESTION_REJECTED': {
        const sugg = suggestion || payload.suggestion;
        const suggId = sugg?.id || payload.suggestion_id;
        if (!suggId) return;
        set((state) => ({
          suggestions: state.suggestions.map((s) =>
            s.id === suggId
              ? { ...s, status: 'REJECTED', resolved_at: sugg?.resolved_at || new Date().toISOString() }
              : s
          ),
        }));
        break;
      }
      case 'TASK_CREATED': {
        if (!task) return;
        set((state) => {
          if (state.tasks.some((t) => t.id === task.id)) return state;
          return { tasks: [task, ...state.tasks] };
        });
        break;
      }
      case 'TASK_TOGGLED':
      case 'TASK_UPDATED': {
        if (!task) return;
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)),
        }));
        break;
      }
      case 'TASK_DELETED': {
        const deletedTaskId = payload.task_id || task?.id;
        if (!deletedTaskId) return;
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== deletedTaskId),
        }));
        break;
      }
      default:
        break;
    }
  },

  setActiveItemId: (id: string | null) => set({ activeItemId: id }),
  setFilter: (filter) => set({ filter }),
  setShowResolved: (show) => set({ showResolved: show }),
  setShowInTextReviews: (show) => set({ showInTextReviews: show }),
  toggleInTextReviews: () => set((state) => ({ showInTextReviews: !state.showInTextReviews })),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  toggleSuggestingMode: () => set((state) => ({ suggestingMode: !state.suggestingMode })),
  setSuggestingMode: (mode) => set({ suggestingMode: mode }),
  setPendingCommentSelection: (sel) => set({ pendingCommentSelection: sel }),
  setPendingSuggestionSelection: (sel) => set({ pendingSuggestionSelection: sel }),

  postComment: async (content: string) => {
    const { documentId, pendingCommentSelection } = get();
    if (!documentId || !content.trim()) return null;
    const anchor = pendingCommentSelection?.anchor || {};
    try {
      const created = await reviewApi.createComment(documentId, content.trim(), anchor);
      set((state) => ({
        comments: [created, ...state.comments.filter((c) => c.id !== created.id)],
        pendingCommentSelection: null,
        isSidebarOpen: true,
        activeItemId: created.id,
      }));
      return created;
    } catch (err) {
      console.error('[useReviewStore] Failed to post comment:', err);
      return null;
    }
  },

  postReply: async (commentId: string, content: string) => {
    if (!commentId || !content.trim()) return null;
    try {
      const reply = await reviewApi.replyComment(commentId, content.trim());
      set((state) => ({
        comments: state.comments.map((c) => {
          if (c.id === commentId) {
            const replies = c.replies || [];
            return { ...c, replies: [...replies.filter((r) => r.id !== reply.id), reply] };
          }
          return c;
        }),
      }));
      return reply;
    } catch (err) {
      console.error('[useReviewStore] Failed to post reply:', err);
      return null;
    }
  },

  editComment: async (commentId: string, content: string) => {
    try {
      const updated = await reviewApi.updateComment(commentId, content);
      set((state) => ({
        comments: state.comments.map((c) => {
          if (c.id === commentId) {
            return { ...c, ...updated, replies: c.replies };
          }
          if (c.replies && c.replies.some((r) => r.id === commentId)) {
            return {
              ...c,
              replies: c.replies.map((r) => (r.id === commentId ? { ...r, ...updated } : r)),
            };
          }
          return c;
        }),
      }));
      return updated;
    } catch (err) {
      console.error('[useReviewStore] Failed to edit comment:', err);
      return null;
    }
  },

  toggleCommentStatus: async (commentId: string) => {
    const comment = get().comments.find((c) => c.id === commentId);
    if (!comment) return null;
    const newStatus = comment.status === 'OPEN' ? 'RESOLVED' : 'OPEN';
    try {
      const updated = await reviewApi.updateCommentStatus(commentId, newStatus);
      set((state) => ({
        comments: state.comments.map((c) => (c.id === commentId ? { ...c, status: updated.status } : c)),
      }));
      return updated;
    } catch (err) {
      console.error('[useReviewStore] Failed to toggle comment status:', err);
      return null;
    }
  },

  deleteComment: async (commentId: string) => {
    try {
      await reviewApi.deleteComment(commentId);
      set((state) => ({
        comments: state.comments.filter((c) => c.id !== commentId),
      }));
    } catch (err) {
      console.error('[useReviewStore] Failed to delete comment:', err);
    }
  },

  postSuggestion: async (suggestedText: string) => {
    const { documentId, pendingSuggestionSelection } = get();
    if (!documentId || !pendingSuggestionSelection) return null;
    const { text: originalText, anchor } = pendingSuggestionSelection;
    try {
      const created = await reviewApi.createSuggestion(documentId, originalText, suggestedText, anchor);
      set((state) => ({
        suggestions: [created, ...state.suggestions.filter((s) => s.id !== created.id)],
        pendingSuggestionSelection: null,
        isSidebarOpen: true,
        activeItemId: created.id,
      }));
      return created;
    } catch (err) {
      console.error('[useReviewStore] Failed to post suggestion:', err);
      return null;
    }
  },

  acceptSuggestion: async (suggestionId: string, onLocalApply?: () => void) => {
    try {
      if (onLocalApply) {
        try {
          onLocalApply();
        } catch (e) {
          console.warn('[useReviewStore] onLocalApply non-fatal error:', e);
        }
      }
      const updated = await reviewApi.acceptSuggestion(suggestionId);
      set((state) => ({
        suggestions: state.suggestions.map((s) =>
          s.id === suggestionId ? { ...s, status: 'ACCEPTED', resolved_at: updated.resolved_at } : s
        ),
      }));
      return updated;
    } catch (err) {
      console.error('[useReviewStore] Failed to accept suggestion:', err);
      return null;
    }
  },

  rejectSuggestion: async (suggestionId: string) => {
    try {
      const updated = await reviewApi.rejectSuggestion(suggestionId);
      set((state) => ({
        suggestions: state.suggestions.map((s) =>
          s.id === suggestionId ? { ...s, status: 'REJECTED', resolved_at: updated.resolved_at } : s
        ),
      }));
      return updated;
    } catch (err) {
      console.error('[useReviewStore] Failed to reject suggestion:', err);
      return null;
    }
  },

  toggleTask: async (taskId: string, isCompleted: boolean) => {
    try {
      const updated = await reviewApi.updateTask(taskId, isCompleted);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, is_completed: updated.is_completed } : t)),
      }));
      return updated;
    } catch (err) {
      console.error('[useReviewStore] Failed to toggle task:', err);
      return null;
    }
  },

  editTask: async (taskId: string, payload: reviewApi.UpdateTaskPayload) => {
    try {
      const updated = await reviewApi.updateTask(taskId, payload);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...updated } : t)),
      }));
      return updated;
    } catch (err) {
      console.error('[useReviewStore] Failed to edit task:', err);
      return null;
    }
  },

  postTask: async (description: string, commentId?: string, assigneeId?: string, dueDate?: string) => {
    const { documentId } = get();
    if (!documentId || !description.trim()) return null;
    try {
      const created = await reviewApi.createTask(documentId, description.trim(), commentId, assigneeId, dueDate);
      set((state) => ({
        tasks: [created, ...state.tasks.filter((t) => t.id !== created.id)],
        activeItemId: created.id,
      }));
      return created;
    } catch (err) {
      console.error('[useReviewStore] Failed to post task:', err);
      return null;
    }
  },

  deleteTask: async (taskId: string) => {
    try {
      await reviewApi.deleteTask(taskId);
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
      }));
    } catch (err) {
      console.error('[useReviewStore] Failed to delete task:', err);
    }
  },
}));
