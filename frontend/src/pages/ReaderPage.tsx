import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Edit3,
  MessageSquare,
  AlertCircle,
  Maximize2,
  Minimize2,
  CheckCircle2,
  Copy,
  Check,
  Link2,
  Trash2,
  Pencil,
  GitPullRequest,
  RotateCw,
} from 'lucide-react';
import katex from 'katex';
import hljs from 'highlight.js';
import * as Y from 'yjs';
import { fetchCurrentUser } from '../api/auth';
import { fetchNodePermissions } from '../api/permissions';
import { useReviewStore } from '../stores/reviewStore';
import { createDualAnchor, reconcileAnchor } from '../review/textAnchoring';
import { NewCommentModal } from '../components/review/NewCommentModal';
import { NewSuggestionModal } from '../components/review/NewSuggestionModal';
import {
  fetchDocument,
  fetchDocumentByPath,
  fetchDocumentTasks,
  findWorkspacePath,
  getWorkspaceFileUrl,
  isMarkdownPath,
} from '../api/documents';
import {
  acceptSuggestion,
  rejectSuggestion,
  replyComment,
  updateComment,
  updateCommentStatus,
  deleteComment,
  fetchDocumentComments,
  fetchDocumentSuggestions,
} from '../api/reviews';
import type { CommentRecord } from '../review/types';
import { parseMarkdownToHtml } from '../utils/markdownToHtml';
import { useUIStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import {
  DocumentOutline,
  extractHeadingsFromMarkdown,
  slugify,
  findHeadingElement,
} from '../components/navigation/DocumentOutline';
import { renderMermaidSvg } from '../components/editor/utils/mermaidRenderer';
import {
  validateLinkTarget,
  isExternalUrl,
  stripHeadingNumberPrefix,
  subscribeLinkValidation,
  extractDocumentHeadings,
  matchesHeadingTarget,
} from '../utils/linkValidator';
import { parsePillSyntax, resolvePillStyle } from '../utils/pillUtils';
import { parseImageDimensionAndAlt, getImageStyles, parseImageTarget } from '../utils/imageDimensions';
import { splitTableRow, parseTableAlignments } from '../utils/tableUtils';

type FontMode = 'sans' | 'serif' | 'mono';
type WidthMode = 'standard' | 'full';

export const ReaderPage: React.FC = () => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const wildcard = params['*'];
  const idParam = params.id;
  const pathParam = searchParams.get('path');
  const rawTarget = pathParam || wildcard || (idParam !== 'by-path' ? idParam : '') || '';

  const { setBreadcrumbs, setViewMode } = useUIStore();
  const { openTab } = useWorkspaceStore();
  const [showReviews, setShowReviews] = useState(false);
  const [fontMode, setFontMode] = useState<FontMode>('serif');
  const [widthMode, setWidthMode] = useState<WidthMode>('standard');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [linkValVer, setLinkValVer] = useState(0);
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    return subscribeLinkValidation(() => {
      setLinkValVer((v) => v + 1);
    });
  }, []);

  // Document query supporting both UUID and relative path (manual refresh via toolbar)
  const {
    data: document,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['doc-reader', rawTarget],
    queryFn: async () => {
      if (!rawTarget) throw new Error('No document path or ID provided');
      const targetPath = rawTarget.split('#')[0].trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetPath);
      if (isUuid) {
        return await fetchDocument(targetPath);
      }
      try {
        return await fetchDocumentByPath(targetPath);
      } catch (err) {
        if (!targetPath.startsWith('workspace/')) {
          try {
            return await fetchDocumentByPath(`workspace/${targetPath}`);
          } catch {
            throw err;
          }
        }
        throw err;
      }
    },
    enabled: Boolean(rawTarget),
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  // Query reviews for the overlay
  const docId = document?.id || '';
  const { data: comments = [] } = useQuery({
    queryKey: ['reader-comments', docId],
    queryFn: () => (docId ? fetchDocumentComments(docId) : Promise.resolve([])),
    enabled: Boolean(docId) && showReviews,
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ['reader-suggestions', docId],
    queryFn: () => (docId ? fetchDocumentSuggestions(docId) : Promise.resolve([])),
    enabled: Boolean(docId) && showReviews,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['reader-tasks', docId],
    queryFn: () => (docId ? fetchDocumentTasks(docId) : Promise.resolve([])),
    enabled: Boolean(docId) && showReviews,
  });

  const queryClient = useQueryClient();

  // Poll server every 5 seconds to check if a new version exists (Issue #19)
  useEffect(() => {
    if (!document?.id) return;

    let isMounted = true;
    const currentId = document.id;
    const currentContent = document.content ?? '';

    setHasNewVersion(false);

    const checkServerVersion = async () => {
      try {
        const latest = await fetchDocument(currentId);
        if (!isMounted) return;
        const latestContent = latest.content ?? '';
        if (latestContent !== currentContent) {
          setHasNewVersion(true);
        } else {
          setHasNewVersion(false);
        }
      } catch {
        // Silently ignore background polling errors
      }
    };

    const intervalId = setInterval(checkServerVersion, 5000);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [document?.id, document?.content]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      setHasNewVersion(false);
      if (showReviews && document?.id) {
        queryClient.invalidateQueries({ queryKey: ['reader-comments', document.id] });
        queryClient.invalidateQueries({ queryKey: ['reader-suggestions', document.id] });
        queryClient.invalidateQueries({ queryKey: ['reader-tasks', document.id] });
      }
    } finally {
      setIsRefreshing(false);
    }
  };
  const {
    setPendingCommentSelection,
    setPendingSuggestionSelection,
    pendingCommentSelection,
    pendingSuggestionSelection,
    initDocument,
  } = useReviewStore();

  const { data: currentUser } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const { data: nodePerms } = useQuery({
    queryKey: ['node-permissions', 'DOCUMENT', docId],
    queryFn: () => fetchNodePermissions({ target_type: 'DOCUMENT', target_id: docId }),
    enabled: Boolean(docId),
    retry: false,
  });

  const canComment = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.is_system_admin || currentUser.is_admin) return true;
    if (document?.owner_user_id && document.owner_user_id === currentUser.id) return true;
    if (nodePerms) {
      if (nodePerms.can_manage) return true;
      const eff = (nodePerms.effective_permission || '').toLowerCase();
      return eff === 'comment' || eff === 'edit' || eff === 'admin';
    }
    return true;
  }, [currentUser, document?.owner_user_id, nodePerms]);

  useEffect(() => {
    if (docId) {
      initDocument(docId);
    }
  }, [docId, initDocument]);

  const prevPendingComment = useRef(pendingCommentSelection);
  const prevPendingSuggestion = useRef(pendingSuggestionSelection);

  useEffect(() => {
    if (prevPendingComment.current && !pendingCommentSelection) {
      queryClient.invalidateQueries({ queryKey: ['reader-comments', docId] });
      setShowReviews(true);
    }
    prevPendingComment.current = pendingCommentSelection;
  }, [pendingCommentSelection, docId, queryClient]);

  useEffect(() => {
    if (prevPendingSuggestion.current && !pendingSuggestionSelection) {
      queryClient.invalidateQueries({ queryKey: ['reader-suggestions', docId] });
      setShowReviews(true);
    }
    prevPendingSuggestion.current = pendingSuggestionSelection;
  }, [pendingSuggestionSelection, docId, queryClient]);

  const articleRef = useRef<HTMLElement>(null);
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const [floatingMenuPos, setFloatingMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [readerSelectedText, setReaderSelectedText] = useState('');

  const updateSelection = useCallback(() => {
    if (!canComment) {
      setFloatingMenuPos(null);
      setReaderSelectedText('');
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setFloatingMenuPos(null);
      setReaderSelectedText('');
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      setFloatingMenuPos(null);
      setReaderSelectedText('');
      return;
    }

    if (!articleRef.current) return;
    const range = sel.getRangeAt(0);
    if (!articleRef.current.contains(range.commonAncestorContainer)) {
      setFloatingMenuPos(null);
      setReaderSelectedText('');
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      setFloatingMenuPos({
        top: Math.max(10, rect.top - 46),
        left: Math.max(10, rect.left + rect.width / 2),
      });
      setReaderSelectedText(sel.toString());
    }
  }, [canComment]);

  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(updateSelection, 10);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.key === 'Shift' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        setTimeout(updateSelection, 10);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (
        floatingMenuRef.current &&
        floatingMenuRef.current.contains(e.target as Node)
      ) {
        return;
      }
    };

    window.document.addEventListener('mouseup', handleMouseUp);
    window.document.addEventListener('keyup', handleKeyUp);
    window.document.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.document.removeEventListener('mouseup', handleMouseUp);
      window.document.removeEventListener('keyup', handleKeyUp);
      window.document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [updateSelection]);

  const handleOpenComment = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!document?.content || !readerSelectedText) return;

    const fullText = document.content;
    const trimmed = readerSelectedText.trim();
    let start = fullText.indexOf(trimmed);
    if (start === -1) {
      start = fullText.indexOf(readerSelectedText);
    }
    if (start === -1) {
      start = 0;
    }
    const end = Math.min(fullText.length, start + (trimmed.length || readerSelectedText.length));

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    ytext.insert(0, fullText);
    const anchor = createDualAnchor(ytext, start, end, fullText);

    setPendingCommentSelection({
      start,
      end,
      text: trimmed || readerSelectedText,
      anchor,
    });
    setFloatingMenuPos(null);
  };

  const handleOpenSuggestion = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!document?.content || !readerSelectedText) return;

    const fullText = document.content;
    const trimmed = readerSelectedText.trim();
    let start = fullText.indexOf(trimmed);
    if (start === -1) {
      start = fullText.indexOf(readerSelectedText);
    }
    if (start === -1) {
      start = 0;
    }
    const end = Math.min(fullText.length, start + (trimmed.length || readerSelectedText.length));

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    ytext.insert(0, fullText);
    const anchor = createDualAnchor(ytext, start, end, fullText);

    setPendingSuggestionSelection({
      start,
      end,
      text: trimmed || readerSelectedText,
      anchor,
    });
    setFloatingMenuPos(null);
  };

  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [isSubmittingReply, setIsSubmittingReply] = useState<Record<string, boolean>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [copiedPermalink, setCopiedPermalink] = useState<boolean>(false);

  const handleCopyPermalink = useCallback(() => {
    if (document?.id) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      navigator.clipboard?.writeText(`${origin}/documents/${document.id}`);
      setCopiedPermalink(true);
      setTimeout(() => setCopiedPermalink(false), 2000);
    }
  }, [document?.id]);

  const handleEditComment = async (commentId: string) => {
    const text = editingCommentText.trim();
    if (!text) return;
    try {
      await updateComment(commentId, text);
      setEditingCommentId(null);
      setEditingCommentText('');
      queryClient.invalidateQueries({ queryKey: ['reader-comments', docId] });
    } catch (err) {
      console.error('Failed to update comment in reader mode:', err);
    }
  };

  const handleAcceptSuggestion = async (suggId: string) => {
    try {
      await acceptSuggestion(suggId);
      queryClient.invalidateQueries({ queryKey: ['reader-suggestions', docId] });
      queryClient.invalidateQueries({ queryKey: ['document', docId] });
      queryClient.invalidateQueries({ queryKey: ['document-by-path'] });
    } catch (err) {
      console.error('Failed to accept suggestion in reader mode:', err);
    }
  };

  const handleRejectSuggestion = async (suggId: string) => {
    try {
      await rejectSuggestion(suggId);
      queryClient.invalidateQueries({ queryKey: ['reader-suggestions', docId] });
    } catch (err) {
      console.error('Failed to reject suggestion in reader mode:', err);
    }
  };

  const handleReplyComment = async (commentId: string) => {
    const text = (replyInputs[commentId] || '').trim();
    if (!text) return;
    setIsSubmittingReply((prev) => ({ ...prev, [commentId]: true }));
    try {
      await replyComment(commentId, text);
      setReplyInputs((prev) => ({ ...prev, [commentId]: '' }));
      queryClient.invalidateQueries({ queryKey: ['reader-comments', docId] });
    } catch (err) {
      console.error('Failed to post reply in reader mode:', err);
    } finally {
      setIsSubmittingReply((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  const handleToggleCommentStatus = async (commentId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'OPEN' ? 'RESOLVED' : 'OPEN';
    try {
      await updateCommentStatus(commentId, nextStatus);
      queryClient.invalidateQueries({ queryKey: ['reader-comments', docId] });
    } catch (err) {
      console.error('Failed to toggle comment status in reader mode:', err);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm('Delete this comment thread?')) return;
    try {
      await deleteComment(commentId);
      queryClient.invalidateQueries({ queryKey: ['reader-comments', docId] });
    } catch (err) {
      console.error('Failed to delete comment in reader mode:', err);
    }
  };

  // Keep breadcrumbs and workspace tabs in sync
  useEffect(() => {
    if (document) {
      openTab({
        id: document.id,
        path: document.path,
        title: document.title || document.path.split('/').pop() || 'Document',
        is_bundle: document.is_bundle,
      });

      const parts = document.path.split('/');
      const breadcrumbs = [
        { label: 'Workspaces', path: '/' },
        ...parts.slice(0, -1).map((part, idx) => ({
          label: part,
          path: `/?dir=${parts.slice(0, idx + 1).join('/')}`,
        })),
        { label: document.title || parts[parts.length - 1], isCurrent: true },
      ];
      setBreadcrumbs(breadcrumbs);
    }
  }, [document, openTab, setBreadcrumbs]);

  const scrollTarget = useCallback((target: string) => {
    if (!target) return;
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      // ignore
    }
    const clean = decoded.replace(/^#+/, '').trim();
    if (!clean) return;

    const tryScroll = () => {
      const el = findHeadingElement(clean);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    };

    if (!tryScroll()) {
      const delays = [60, 120, 240, 480];
      delays.forEach((delay) => {
        setTimeout(() => {
          tryScroll();
        }, delay);
      });
    }
  }, []);

  // Auto-scroll to heading anchor if present in URL on load
  useEffect(() => {
    if (!document?.content || isLoading) return;
    if (window.location.hash) {
      scrollTarget(window.location.hash);
    }
  }, [document?.id, document?.content, isLoading, scrollTarget]);

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash) {
        scrollTarget(window.location.hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [scrollTarget]);

  // Document-level header numbering setting
  const numberHeaders = Boolean(document?.number_headers);

  // Headings extracted for Table of Contents
  const headings = useMemo(() => {
    if (!document?.content) return [];
    return extractHeadingsFromMarkdown(document.content, numberHeaders);
  }, [document?.content, numberHeaders]);

  const renderCommentCard = useCallback(
    (comment: CommentRecord) => {
      const isResolved = comment.status === 'RESOLVED';
      const replies = comment.replies || [];
      const author = comment.author || {
        id: '',
        username: 'Collaborator',
        display_name: 'Collaborator',
        avatar_color: '#3b82f6',
      };
      const authorName = author.display_name || author.username || 'Collaborator';
      const authorColor = author.avatar_color || '#3b82f6';
      const initials = authorName.slice(0, 2).toUpperCase();
      const quoteText =
        comment.anchor?.quote?.exact ||
        (typeof comment.anchor?.quote === 'string' ? comment.anchor.quote : null);

      return (
        <div
          key={comment.id}
          className={`rounded-lg border-y border-r border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm border-l-4 my-2.5 not-prose ${
            isResolved ? 'border-l-zinc-400' : 'border-l-blue-500'
          }`}
          data-testid="comment-item"
          data-comment-id={comment.id}
        >
          {/* Thread Header */}
          <div className="flex items-center justify-between px-2.5 py-1 bg-cme-bg-subtle/80 border-b border-cme-border-base text-xs min-h-[26px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white font-bold text-[8px] flex-shrink-0"
                style={{ backgroundColor: authorColor }}
              >
                {initials}
              </span>
              <span className="font-medium text-cme-text-base text-[11px] truncate max-w-[120px]">{authorName}</span>
              <span className="text-cme-text-muted text-[10px] whitespace-nowrap">
                • {new Date(comment.created_at).toLocaleDateString()}
              </span>
              <span
                className={`px-1 py-0.2 rounded text-[9px] font-medium whitespace-nowrap ${
                  isResolved
                    ? 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
                    : 'bg-cme-primary/10 text-cme-primary border border-cme-primary/20'
                }`}
              >
                {isResolved ? 'Resolved' : 'Open'}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (editingCommentId === comment.id) {
                    setEditingCommentId(null);
                  } else {
                    setEditingCommentId(comment.id);
                    setEditingCommentText(comment.content);
                  }
                }}
                className="p-0.5 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors cursor-pointer"
                data-testid="edit-comment-btn"
                title="Edit comment"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => handleToggleCommentStatus(comment.id, comment.status)}
                className="px-1.5 py-0.5 rounded border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base text-[10px] leading-tight font-medium transition-colors cursor-pointer"
                data-testid="resolve-comment-btn"
                title="Toggle resolved status"
              >
                {isResolved ? 'Reopen' : '✓ Resolve'}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteComment(comment.id)}
                className="p-0.5 rounded hover:bg-rose-500/10 text-cme-text-muted hover:text-rose-500 transition-colors cursor-pointer"
                data-testid="delete-comment-btn"
                title="Delete comment"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Anchored Quote if present */}
          {quoteText && (
            <div className="mx-3 mt-2 text-xs italic text-cme-text-muted border-l-2 border-cme-primary pl-2 py-0.5 bg-cme-primary/5 rounded-r">
              "{quoteText}"
            </div>
          )}

          {/* Root Comment Content / Edit Form */}
          {editingCommentId === comment.id ? (
            <div className="p-2 space-y-1.5 bg-cme-bg-subtle/30 border-b border-cme-border-base">
              <textarea
                value={editingCommentText}
                onChange={(e) => setEditingCommentText(e.target.value)}
                className="w-full p-1.5 text-xs bg-cme-bg-surface border border-cme-border-base rounded text-cme-text-base focus:outline-hidden focus:border-cme-primary resize-y min-h-[48px]"
                autoFocus
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingCommentId(null)}
                  className="px-2 py-0.5 text-[11px] rounded border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleEditComment(comment.id)}
                  className="px-2.5 py-0.5 text-[11px] rounded bg-cme-primary hover:bg-cme-primary/90 text-white font-medium cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div
              className="px-3 py-1.5 text-xs text-cme-text-base prose prose-xs dark:prose-invert max-w-none leading-relaxed"
              dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(comment.content || '') }}
            />
          )}

          {/* Nested Replies */}
          {replies.length > 0 && (
            <div className="border-t border-cme-border-base/40 divide-y divide-cme-border-base/30 bg-cme-bg-subtle/30">
              {replies.map((reply: CommentRecord) => {
                const rAuthor = reply.author || {
                  id: '',
                  username: 'Collaborator',
                  display_name: 'Collaborator',
                  avatar_color: '#6366f1',
                };
                const rName = rAuthor.display_name || rAuthor.username || 'Collaborator';
                const rColor = rAuthor.avatar_color || '#6366f1';
                const rInitials = rName.slice(0, 2).toUpperCase();
                return (
                  <div key={reply.id} className="px-3 py-1.5 flex items-start gap-2 text-xs">
                    <span
                      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white font-bold text-[8px] flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: rColor }}
                    >
                      {rInitials}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5 mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-cme-text-base text-[11px]">{rName}</span>
                          <span className="text-cme-text-muted text-[10px]">
                            {new Date(reply.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (editingCommentId === reply.id) {
                              setEditingCommentId(null);
                            } else {
                              setEditingCommentId(reply.id);
                              setEditingCommentText(reply.content);
                            }
                          }}
                          className="p-0.5 text-cme-text-muted hover:text-cme-text-base rounded cursor-pointer"
                          title="Edit reply"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      {editingCommentId === reply.id ? (
                        <div className="pt-1 space-y-1.5">
                          <textarea
                            value={editingCommentText}
                            onChange={(e) => setEditingCommentText(e.target.value)}
                            className="w-full p-1.5 text-xs bg-cme-bg-surface border border-cme-border-base rounded text-cme-text-base focus:outline-hidden focus:border-cme-primary resize-y min-h-[40px]"
                            autoFocus
                          />
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingCommentId(null)}
                              className="px-2 py-0.5 text-[10px] rounded border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-muted cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditComment(reply.id)}
                              className="px-2 py-0.5 text-[10px] rounded bg-cme-primary hover:bg-cme-primary/90 text-white font-medium cursor-pointer"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="text-cme-text-base prose prose-xs dark:prose-invert max-w-none leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(reply.content || '') }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Inline Reply Form */}
          <div className="px-2.5 py-1 bg-cme-bg-surface border-t border-cme-border-base flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Write a reply..."
              value={replyInputs[comment.id] || ''}
              onChange={(e) =>
                setReplyInputs((prev) => ({ ...prev, [comment.id]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleReplyComment(comment.id);
                }
              }}
              className="reply-input flex-1 px-2 py-0.5 rounded-md border border-cme-border-base bg-cme-bg-surface text-xs text-cme-text-base focus:outline-none focus:border-cme-primary"
              data-testid="inline-reply-input"
            />
            <button
              type="button"
              onClick={() => handleReplyComment(comment.id)}
              disabled={isSubmittingReply[comment.id]}
              className="reply-submit-btn px-2.5 py-0.5 rounded-md bg-cme-primary hover:bg-cme-primary/90 text-white font-medium text-xs transition-colors cursor-pointer disabled:opacity-50"
              data-testid="inline-reply-submit-btn"
            >
              {isSubmittingReply[comment.id] ? '...' : 'Reply'}
            </button>
          </div>
        </div>
      );
    },
    [
      editingCommentId,
      editingCommentText,
      replyInputs,
      isSubmittingReply,
      handleDeleteComment,
      handleEditComment,
      handleReplyComment,
      handleToggleCommentStatus,
    ]
  );

  // Render markdown content into rich blocks with IDs on headings
  const renderedContent = useMemo(() => {
    if (!document?.content) return null;
    return renderMarkdown(
      document.content,
      (code, id) => {
        navigator.clipboard.writeText(code);
        setCopiedCodeId(id);
        setTimeout(() => setCopiedCodeId(null), 2000);
      },
      copiedCodeId,
      document.id || document.path || '',
      document.content || '',
      document.path || '',
      numberHeaders,
      showReviews ? comments : [],
      renderCommentCard
    );
  }, [
    document?.id,
    document?.path,
    document?.content,
    copiedCodeId,
    numberHeaders,
    linkValVer,
    showReviews,
    comments,
    renderCommentCard,
  ]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-4 animate-pulse">
        <div className="h-10 bg-cme-bg-subtle rounded w-1/3" />
        <div className="h-4 bg-cme-bg-subtle rounded w-1/4" />
        <div className="h-96 bg-cme-bg-subtle rounded-2xl mt-8" />
      </div>
    );
  }

  if (isError || !document) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-base font-semibold text-rose-600 dark:text-rose-400">
          Documentation Not Found
        </h2>
        <p className="text-xs text-cme-text-muted">
          {(error as any)?.message || `Could not find document at "${rawTarget}".`}
        </p>
        <div className="pt-2">
          <Link
            to="/"
            className="px-4 py-2 bg-cme-primary text-white rounded-lg text-xs font-medium hover:bg-cme-primary-hover inline-block"
          >
            Back to Workspace
          </Link>
        </div>
      </div>
    );
  }

  const fontClass =
    fontMode === 'serif'
      ? 'font-serif'
      : fontMode === 'mono'
      ? 'font-mono'
      : 'font-sans';

  const containerWidthClass = widthMode === 'full' ? 'max-w-none w-full' : 'max-w-7xl mx-auto';
  const widthClass = widthMode === 'full' ? 'max-w-none w-full' : 'max-w-4xl mx-auto';

  return (
    <div className="min-h-full bg-cme-bg-base text-cme-text-base pb-24">
      {/* Top Reader Controls Header */}
      <header className="sticky top-0 z-20 bg-cme-bg-base/95 backdrop-blur-md border-b border-cme-border-base px-4 md:px-8 py-3 shadow-xs">
        <div className={`${containerWidthClass} flex items-center justify-between gap-4`}>
          {/* Left Metadata */}
          <div className="flex items-center gap-3 truncate">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cme-primary/10 text-cme-primary text-[11px] font-semibold tracking-wide uppercase flex-shrink-0">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Reader Mode</span>
            </span>
            <span className="truncate text-xs font-mono text-cme-text-muted hidden sm:inline">
              {document.path}
            </span>
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2">
            {/* Font Style Switcher */}
            <div className="hidden md:flex items-center border border-cme-border-base rounded-lg p-0.5 bg-cme-bg-surface text-xs">
              <button
                onClick={() => setFontMode('sans')}
                className={`px-2 py-1 rounded font-sans transition-colors ${
                  fontMode === 'sans'
                    ? 'bg-cme-primary text-white font-medium'
                    : 'text-cme-text-muted hover:text-cme-text-base'
                }`}
                title="Sans-serif typography"
              >
                Sans
              </button>
              <button
                onClick={() => setFontMode('serif')}
                className={`px-2 py-1 rounded font-serif transition-colors ${
                  fontMode === 'serif'
                    ? 'bg-cme-primary text-white font-medium'
                    : 'text-cme-text-muted hover:text-cme-text-base'
                }`}
                title="Serif typography"
              >
                Serif
              </button>
              <button
                onClick={() => setFontMode('mono')}
                className={`px-2 py-1 rounded font-mono transition-colors ${
                  fontMode === 'mono'
                    ? 'bg-cme-primary text-white font-medium'
                    : 'text-cme-text-muted hover:text-cme-text-base'
                }`}
                title="Monospace typography"
              >
                Mono
              </button>
            </div>

            {/* Width Toggle */}
            <button
              onClick={() => setWidthMode(widthMode === 'standard' ? 'full' : 'standard')}
              className={`p-1.5 rounded-lg border transition-colors hidden sm:flex ${
                widthMode === 'full'
                  ? 'bg-cme-primary text-white border-cme-primary shadow-sm'
                  : 'border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
              }`}
              title={widthMode === 'full' ? 'Restore column width' : 'Expand to full pane width'}
              data-testid="reader-width-toggle"
            >
              {widthMode === 'full' ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Review Overlay Toggle */}
            <button
              onClick={() => setShowReviews(!showReviews)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                showReviews
                  ? 'bg-cme-primary text-white border-cme-primary shadow-sm'
                  : 'border-cme-border-base bg-cme-bg-surface text-cme-text-base hover:bg-cme-bg-hover'
              }`}
              data-testid="review-overlay-toggle"
              title="Toggle inline comments and review annotations"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Reviews: {showReviews ? 'ON' : 'OFF'}</span>
            </button>

            {/* Refresh Document Button (Issue #19) */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                hasNewVersion
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 shadow-xs'
                  : 'border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base'
              }`}
              title={
                hasNewVersion
                  ? 'New version available on server — click to reload'
                  : 'Reload document content'
              }
              data-testid="reader-refresh-btn"
              data-has-update={hasNewVersion ? 'true' : 'false'}
            >
              <RotateCw
                className={`w-3.5 h-3.5 ${
                  isRefreshing
                    ? 'animate-spin text-cme-primary'
                    : hasNewVersion
                    ? 'text-amber-600 dark:text-amber-400'
                    : ''
                }`}
              />
              <span>Refresh</span>
              {hasNewVersion && (
                <span
                  className="flex h-2 w-2 relative"
                  data-testid="reader-refresh-badge"
                  title="Update available"
                >
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
              )}
            </button>

            {/* Copy Permalink */}
            <button
              onClick={handleCopyPermalink}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-muted hover:text-cme-text-base transition-colors"
              title="Copy Permalink to Document"
              data-testid="reader-copy-permalink-btn"
            >
              {copiedPermalink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Permalink</span>
                </>
              )}
            </button>

            {/* Switch to Edit Mode */}
            <Link
              to={`/documents/${document.id}`}
              onClick={() => setViewMode('edit')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
              title="Open in Collaborative Editor"
              data-testid="switch-to-editor-btn"
            >
              <Edit3 className="w-3.5 h-3.5 text-cme-text-muted" />
              <span>Edit</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Reading Area with Right Sticky Table of Contents */}
      <div className={`${containerWidthClass} px-4 md:px-8 pt-8 flex gap-8 items-start`}>
        {/* Document Article Body */}
        <main className={`flex-1 min-w-0 ${widthClass} transition-all`}>
          <article
            ref={articleRef}
            className={`prose dark:prose-invert max-w-none text-cme-text-base ${fontClass} leading-relaxed`}
            data-testid="reader-article"
          >
            {renderedContent}
          </article>

          {/* Review Overlay Section (when enabled) */}
          {showReviews && (
            <section
              className="mt-12 p-6 bg-cme-bg-surface border border-cme-border-base rounded-2xl space-y-6 shadow-sm"
              data-testid="review-overlay-panel"
            >
              <div className="flex items-center justify-between pb-3 border-b border-cme-border-base">
                <div className="flex items-center gap-2 font-semibold text-sm text-cme-text-base">
                  <MessageSquare className="w-4 h-4 text-cme-primary" />
                  <span>Review & Feedback Overlay</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-cme-text-muted">
                  <span className="px-2 py-0.5 rounded bg-cme-bg-subtle font-mono">
                    {comments.length} comments
                  </span>
                  <span className="px-2 py-0.5 rounded bg-cme-bg-subtle font-mono">
                    {suggestions.length} suggestions
                  </span>
                </div>
              </div>

              {/* Review Comments Summary */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                  Inline Discussions ({comments.length})
                </h4>
                <p className="text-xs text-cme-text-muted italic bg-cme-bg-subtle/50 p-3 rounded-xl border border-dashed border-cme-border-base">
                  {comments.length === 0
                    ? 'No open comments on this document.'
                    : `${comments.length} comment thread${comments.length === 1 ? '' : 's'} displayed inline with the text above.`}
                </p>
              </div>

              {/* Review Suggestions with Unified Diff Blocks & Accept/Reject */}
              <div className="space-y-4 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                  Suggested Edits ({suggestions.length})
                </h4>
                {suggestions.length === 0 ? (
                  <p className="text-xs text-cme-text-muted italic bg-cme-bg-subtle/50 p-3 rounded-xl border border-dashed border-cme-border-base">
                    No pending suggestions on this document.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {suggestions.map((sugg) => {
                      const isPending = (sugg.status || '').toLowerCase() === 'pending';
                      const isAccepted = (sugg.status || '').toLowerCase() === 'accepted';
                      const author = sugg.author || {
                        id: '',
                        username: 'Reviewer',
                        display_name: 'Reviewer',
                        avatar_color: '#10b981',
                      };
                      const authorName = author.display_name || author.username || 'Reviewer';
                      const authorColor = author.avatar_color || '#10b981';
                      const initials = authorName.slice(0, 2).toUpperCase();

                      return (
                        <div
                          key={sugg.id}
                          className={`rounded-lg border-y border-r border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm border-l-4 ${
                            isAccepted
                              ? 'border-l-emerald-500'
                              : isPending
                              ? 'border-l-amber-500'
                              : 'border-l-rose-500'
                          }`}
                          data-testid="suggestion-item"
                          data-suggestion-id={sugg.id}
                        >
                          {/* Diff Header */}
                          <div className="flex items-center justify-between px-2.5 py-1 bg-cme-bg-subtle/80 border-b border-cme-border-base text-xs min-h-[26px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white font-bold text-[8px] flex-shrink-0"
                                style={{ backgroundColor: authorColor }}
                              >
                                {initials}
                              </span>
                              <span className="font-medium text-cme-text-base text-[11px] truncate max-w-[120px]">{authorName}</span>
                              <span className="text-[10px] text-cme-text-muted whitespace-nowrap">
                                • {new Date(sugg.created_at).toLocaleDateString()}
                              </span>
                              <span
                                className={`px-1 py-0.2 rounded text-[9px] font-medium whitespace-nowrap ${
                                  isAccepted
                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                    : isPending
                                    ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                    : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                }`}
                              >
                                {sugg.status}
                              </span>
                            </div>
                            {isPending && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleAcceptSuggestion(sugg.id)}
                                  className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-medium text-[11px] leading-tight flex items-center gap-1 transition-all shadow-xs cursor-pointer"
                                  data-testid="accept-suggestion-btn"
                                >
                                  ✓ Accept
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRejectSuggestion(sugg.id)}
                                  className="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 active:scale-95 text-rose-600 dark:text-rose-400 font-medium text-[11px] leading-tight flex items-center gap-1 border border-rose-500/30 transition-all cursor-pointer"
                                  data-testid="reject-suggestion-btn"
                                >
                                  ✕ Reject
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Unified Diff Block */}
                          <div className="font-mono text-xs divide-y divide-cme-border-base/30 bg-cme-bg-surface">
                            <div className="diff-deletion flex items-start gap-2 px-2.5 py-1 bg-rose-500/10 text-rose-700 dark:text-rose-300 border-l-4 border-rose-500">
                              <span className="select-none font-bold text-rose-500 flex-shrink-0">-</span>
                              <span className="line-through whitespace-pre-wrap break-all leading-relaxed">
                                {sugg.original_text}
                              </span>
                            </div>
                            <div className="diff-addition flex items-start gap-2 px-2.5 py-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-l-4 border-emerald-500">
                              <span className="select-none font-bold text-emerald-500 flex-shrink-0">+</span>
                              <span className="whitespace-pre-wrap break-all leading-relaxed">
                                {sugg.suggested_text}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Action Tasks */}
              {tasks.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                    Assigned Tasks ({tasks.length})
                  </h4>
                  <div className="space-y-1.5">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 p-2 rounded-lg border border-cme-border-base bg-cme-bg-base text-xs"
                      >
                        <CheckCircle2
                          className={`w-4 h-4 ${
                            task.is_completed ? 'text-emerald-500' : 'text-cme-text-muted'
                          }`}
                        />
                        <span className={task.is_completed ? 'line-through text-cme-text-muted' : ''}>
                          {task.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>

        {/* Right Sticky Column: Document Outline (Table of Contents) */}
        <aside className="w-64 lg:w-72 hidden md:block sticky top-20 flex-shrink-0 self-start">
          <div className="border border-cme-border-base rounded-2xl bg-cme-bg-surface overflow-hidden shadow-sm">
            <DocumentOutline
              headings={headings}
              markdown={document.content}
              onSelectHeading={(id) => scrollTarget(id)}
            />
          </div>
        </aside>
      </div>

      {/* Floating Suggest / Comment Review Popup */}
      {canComment && floatingMenuPos && (
        <div
          ref={floatingMenuRef}
          style={{
            top: `${floatingMenuPos.top}px`,
            left: `${floatingMenuPos.left}px`,
            transform: 'translateX(-50%)',
          }}
          className="fixed z-40 flex items-center gap-1 p-1 rounded-xl bg-cme-bg-surface border border-cme-border-base shadow-xl animate-in fade-in zoom-in-95 duration-100 select-none backdrop-blur-xs"
          data-testid="reader-floating-review-menu"
        >
          <button
            type="button"
            data-testid="suggest-edit-btn"
            onClick={handleOpenSuggestion}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition-colors cursor-pointer"
            title="Suggest an edit to selected text"
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            Suggest Edit
          </button>

          <div className="w-[1px] h-3.5 bg-cme-border-base mx-0.5" />

          <button
            type="button"
            data-testid="add-comment-btn"
            onClick={handleOpenComment}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-cme-primary hover:bg-cme-primary/10 rounded-lg transition-colors cursor-pointer"
            title="Add a comment on selected text"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Comment
          </button>
        </div>
      )}

      {/* Review Modals */}
      <NewSuggestionModal />
      <NewCommentModal />
    </div>
  );
};

// Markdown block renderer helper with heading slug anchors, KaTeX math, and Mermaid support
export function renderMarkdown(
  content: string,
  onCopyCode: (code: string, id: string) => void = () => {},
  copiedCodeId: string | null = null,
  currentDocTarget: string = '',
  currentDocMarkdown: string = '',
  currentDocPath: string = '',
  numberHeaders: boolean = false,
  comments: CommentRecord[] = [],
  renderCommentCard?: (comment: CommentRecord) => React.ReactNode
): React.ReactNode[] {
  const lines = content.split('\n');
  const lineStarts: number[] = new Array(lines.length);
  let curOffset = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    lineStarts[idx] = curOffset;
    curOffset += lines[idx].length + 1;
  }

  const rootComments = comments
    .filter((c) => !c.parent_id && c.status !== 'ARCHIVED')
    .map((c) => {
      let targetPos = -1;
      const reconciled = reconcileAnchor(c.anchor, content);
      if (reconciled?.range) {
        targetPos = reconciled.range.end;
      } else if (c.anchor?.quote?.exact) {
        const q = c.anchor.quote.exact;
        const idx = content.indexOf(q);
        if (idx !== -1) {
          targetPos = idx + q.length;
        }
      } else if (typeof c.anchor?.offset === 'number') {
        targetPos = c.anchor.offset + (c.anchor?.quote?.exact?.length || 0);
      }
      const quote =
        c.anchor?.quote?.exact || (typeof c.anchor?.quote === 'string' ? c.anchor.quote : '');
      return { comment: c, targetPos, quote };
    });

  const commentQuotes = rootComments
    .map((rc) => rc.quote)
    .filter((q): q is string => Boolean(q && q.trim().length >= 2));

  const blockList: { element: React.ReactNode; start: number; end: number }[] = [];
  const addBlock = (el: React.ReactNode, startL: number, endL: number) => {
    const s = lineStarts[startL] ?? 0;
    const e = (lineStarts[endL] ?? s) + (lines[endL]?.length ?? 0);
    blockList.push({ element: el, start: s, end: e });
  };

  let i = 0;
  const slugCounts: Record<string, number> = {};
  const counters: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

  let activeListIndents: number[] = [0];
  const olCounters = new Map<number, number>();

  const getListLevel = (indentStr: string): number => {
    const spaces = indentStr.replace(/\t/g, '  ').length;
    if (spaces === 0) {
      activeListIndents = [0];
      for (const k of Array.from(olCounters.keys())) {
        if (k > 0) olCounters.delete(k);
      }
      return 0;
    }
    if (spaces > activeListIndents[activeListIndents.length - 1]) {
      activeListIndents.push(spaces);
      return activeListIndents.length - 1;
    }
    while (
      activeListIndents.length > 1 &&
      activeListIndents[activeListIndents.length - 1] > spaces
    ) {
      activeListIndents.pop();
    }
    if (spaces > activeListIndents[activeListIndents.length - 1]) {
      activeListIndents.push(spaces);
    }
    const level = activeListIndents.length - 1;
    for (const k of Array.from(olCounters.keys())) {
      if (k > level) olCounters.delete(k);
    }
    return level;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Block or Mermaid block (``` or ~~~)
    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      activeListIndents = [0];
      olCounters.clear();
      const fenceMarker = fenceMatch[1];
      const fenceChar = fenceMarker[0];
      const fenceLen = fenceMarker.length;
      const rawInfo = fenceMatch[2].trim();

      // For backticks, info string cannot contain backticks
      if (!(fenceChar === '`' && rawInfo.includes('`'))) {
        const startBlockLine = i;
        const codeLines: string[] = [];
        i++;
        while (i < lines.length) {
          const closeMatch = lines[i].match(/^[ \t]{0,3}(`{3,}|~{3,})\s*$/);
          if (
            closeMatch &&
            closeMatch[1][0] === fenceChar &&
            closeMatch[1].length >= fenceLen
          ) {
            break;
          }
          codeLines.push(lines[i]);
          i++;
        }
        const endBlockLine = i;
        i++; // skip closing fence
        const code = codeLines.join('\n');
        const codeBlockId = `code-block-${startBlockLine}`;

        if (rawInfo === 'mermaid') {
          addBlock(
            <MermaidBlock key={`mermaid-${startBlockLine}`} source={code} />,
            startBlockLine,
            endBlockLine
          );
        } else {
          const langLower = (rawInfo || '').toLowerCase().trim();
          const effectiveLang = (langLower === 'none' || langLower === 'text') ? '' : langLower;

          let highlighted = '';
          if (code.length > 0) {
            try {
              if (effectiveLang && hljs.getLanguage(effectiveLang)) {
                highlighted = hljs.highlight(code, { language: effectiveLang, ignoreIllegals: true }).value;
              } else if (effectiveLang) {
                highlighted = hljs.highlightAuto(code).value;
              } else {
                const autoRes = hljs.highlightAuto(code);
                highlighted = autoRes.value || escapeHtml(code);
              }
            } catch {
              highlighted = escapeHtml(code);
            }
          }

          const linesInBlock = code.split('\n');
          const lineCount = code.length === 0 ? 1 : linesInBlock.length;

          addBlock(
            <div
              key={`code-${startBlockLine}`}
              className="my-4 rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden group shadow-sm"
            >
              <div className="flex items-center justify-between px-3.5 py-1.5 bg-cme-bg-subtle text-xs font-mono text-cme-text-muted border-b border-cme-border-base">
                <span>{effectiveLang || 'none'}</span>
                <button
                  onClick={() => onCopyCode(code, codeBlockId)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
                  title="Copy code"
                >
                  {copiedCodeId === codeBlockId ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span className="text-[10px] text-emerald-500">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span className="text-[10px]">Copy</span>
                    </>
                  )}
                </button>
              </div>
              <div className="flex p-4 overflow-x-auto font-mono text-xs leading-6 bg-cme-bg-base/50">
                <div
                  className="line-numbers-gutter select-none text-right pr-3 pl-1 text-cme-text-subtle/50 font-mono text-xs leading-6 border-r border-cme-border-base/40 mr-3 flex-shrink-0"
                  aria-hidden="true"
                >
                  {Array.from({ length: lineCount }, (_, idx) => (
                    <div key={idx}>{idx + 1}</div>
                  ))}
                </div>
                <pre className="font-mono text-xs text-cme-text-base leading-6 flex-1 overflow-x-auto whitespace-pre">
                  <code
                    className={effectiveLang ? `hljs language-${effectiveLang}` : 'hljs'}
                    dangerouslySetInnerHTML={{ __html: highlighted || '\n' }}
                  />
                </pre>
              </div>
            </div>,
            startBlockLine,
            endBlockLine
          );
        }
        continue;
      }
    }

    // Display Math Block $$...$$
    if (line.trim().startsWith('$$')) {
      const startBlockLine = i;
      const mathLines: string[] = [];
      if (line.trim() === '$$') {
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
        i++; // skip ending $$
      } else {
        mathLines.push(line.replace(/^\$\$/, '').replace(/\$\$$/, ''));
        i++;
      }
      const endBlockLine = i - 1;
      const formula = mathLines.join('\n');
      let renderedHtml = formula;
      try {
        renderedHtml = katex.renderToString(formula, { displayMode: true, throwOnError: false });
      } catch {
        // fallback
      }
      addBlock(
        <div
          key={`math-${startBlockLine}`}
          className="my-4 p-4 rounded-xl bg-cme-bg-subtle border border-cme-border-base text-center overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />,
        startBlockLine,
        endBlockLine
      );
      continue;
    }

    // Headings #, ##, ###, ####, #####, ######
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      activeListIndents = [0];
      olCounters.clear();
      const level = headingMatch[1].length;
      const rawText = headingMatch[2].trim();
      const strippedText = stripHeadingNumberPrefix(rawText) || rawText;
      const baseSlug = slugify(strippedText.replace(/[*_`]/g, ''));
      const count = slugCounts[baseSlug] || 0;
      slugCounts[baseSlug] = count + 1;
      const id = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      counters[level - 1] += 1;
      for (let k = level; k < 6; k++) {
        counters[k] = 0;
      }
      let startIdx = 0;
      while (startIdx < level - 1 && counters[startIdx] === 0) {
        startIdx++;
      }
      const numParts: number[] = [];
      for (let k = startIdx; k < level; k++) {
        numParts.push(counters[k] || 1);
      }
      const numberPrefix =
        numParts.length === 1 ? `${numParts[0]}.` : `${numParts.join('.')}.`;

      const displayText = numberHeaders ? strippedText : rawText;
      const headingContent = renderInlineFormatted(
        displayText,
        currentDocTarget,
        currentDocMarkdown,
        currentDocPath,
        false,
        commentQuotes
      );

      const numberBadge = numberHeaders ? (
        <span
          className="cme-heading-number select-none mr-2 text-cme-primary/70 font-mono text-[0.88em]"
          data-testid="reader-heading-number"
        >
          {numberPrefix}
        </span>
      ) : null;

      let headingElement: React.ReactNode;
      if (level === 1) {
        headingElement = (
          <h1
            key={`h-${i}`}
            id={id}
            className="text-2xl md:text-3xl font-bold tracking-tight mt-8 mb-4 pt-4 border-b border-cme-border-base pb-2 scroll-mt-20 flex items-center"
          >
            {numberBadge}
            <span>{headingContent}</span>
          </h1>
        );
      } else if (level === 2) {
        headingElement = (
          <h2
            key={`h-${i}`}
            id={id}
            className="text-xl md:text-2xl font-bold tracking-tight mt-6 mb-3 scroll-mt-20 flex items-center"
          >
            {numberBadge}
            <span>{headingContent}</span>
          </h2>
        );
      } else if (level === 3) {
        headingElement = (
          <h3
            key={`h-${i}`}
            id={id}
            className="text-lg md:text-xl font-semibold mt-5 mb-2 scroll-mt-20 flex items-center"
          >
            {numberBadge}
            <span>{headingContent}</span>
          </h3>
        );
      } else {
        headingElement = (
          <h4
            key={`h-${i}`}
            id={id}
            className="text-base font-semibold mt-4 mb-2 scroll-mt-20 text-cme-text-muted flex items-center"
          >
            {numberBadge}
            <span>{headingContent}</span>
          </h4>
        );
      }

      addBlock(headingElement, i, i);
      i++;
      continue;
    }

    // Blockquote >
    if (line.startsWith('>')) {
      activeListIndents = [0];
      olCounters.clear();
      const startBlockLine = i;
      const quoteLines: string[] = [];
      while (i < lines.length) {
        if (lines[i].startsWith('>')) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        } else if (lines[i].trim() === '' && i + 1 < lines.length && lines[i + 1].startsWith('>')) {
          quoteLines.push('');
          i++;
        } else {
          break;
        }
      }
      const endBlockLine = i - 1;

      const paragraphs: string[] = [];
      let currentPara: string[] = [];
      for (const qLine of quoteLines) {
        if (qLine.trim() === '') {
          if (currentPara.length > 0) {
            paragraphs.push(currentPara.join(' '));
            currentPara = [];
          }
        } else {
          currentPara.push(qLine);
        }
      }
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '));
      }

      addBlock(
        <blockquote
          key={`quote-${startBlockLine}`}
          className="my-3 pl-4 border-l-4 border-cme-primary italic text-cme-text-muted bg-cme-primary/5 py-2 rounded-r-lg space-y-2"
        >
          {paragraphs.length > 0 ? (
            paragraphs.map((para, pIdx) => (
              <p key={pIdx} className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">
                {renderInlineFormatted(
                  para,
                  currentDocTarget,
                  currentDocMarkdown,
                  currentDocPath,
                  true,
                  commentQuotes
                )}
              </p>
            ))
          ) : (
            <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">&nbsp;</p>
          )}
        </blockquote>,
        startBlockLine,
        endBlockLine
      );
      continue;
    }

    // GFM Table: | Header 1 | Header 2 | followed by delimiter row | --- | --- |
    const curTrimmed = line.trim();
    if (curTrimmed.includes('|') && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trim();
      const isDelimiter = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(nextTrimmed);
      if (isDelimiter) {
        activeListIndents = [0];
        olCounters.clear();
        const startBlockLine = i;
        const tableLines: string[] = [curTrimmed, nextTrimmed];
        let curIdx = i + 2;
        while (curIdx < lines.length) {
          const rowTrimmed = lines[curIdx].trim();
          if (!rowTrimmed.includes('|') || rowTrimmed.length === 0) {
            break;
          }
          tableLines.push(rowTrimmed);
          curIdx++;
        }

        const headerCells = splitTableRow(tableLines[0]);
        const alignments = parseTableAlignments(tableLines[1]);
        const dataRows = tableLines.slice(2).map((row) => splitTableRow(row));

        addBlock(
          <div
            key={`table-${startBlockLine}`}
            className="cme-table-block-node my-4 overflow-x-auto rounded-xl border border-cme-border-base bg-cme-bg-surface shadow-sm"
          >
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-cme-bg-subtle/80 text-cme-text-base border-b border-cme-border-base font-semibold">
                <tr>
                  {headerCells.map((header, colIdx) => (
                    <th
                      key={colIdx}
                      className="px-4 py-2.5 text-xs font-semibold tracking-wider border-r border-cme-border-base/40 last:border-r-0"
                      style={{ textAlign: alignments[colIdx] || 'left' }}
                    >
                      {renderInlineFormatted(header, currentDocTarget, currentDocMarkdown, currentDocPath, false, commentQuotes)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-cme-border-base/40 text-cme-text-base">
                {dataRows.map((rowCells, rIdx) => (
                  <tr
                    key={rIdx}
                    className={
                      rIdx % 2 === 1
                        ? 'bg-cme-bg-subtle/20 hover:bg-cme-bg-hover/40'
                        : 'hover:bg-cme-bg-hover/40'
                    }
                  >
                    {headerCells.map((_, colIdx) => (
                      <td
                        key={colIdx}
                        className="px-4 py-2 text-xs border-r border-cme-border-base/40 last:border-r-0"
                        style={{ textAlign: alignments[colIdx] || 'left' }}
                      >
                        {renderInlineFormatted(rowCells[colIdx] || '', currentDocTarget, currentDocMarkdown, currentDocPath, false, commentQuotes)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
          startBlockLine,
          curIdx - 1
        );

        i = curIdx;
        continue;
      }
    }

    // Horizontal Rule / Divider (---, ***, ___, - - -, * * *, etc.)
    if (/^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line.trim())) {
      activeListIndents = [0];
      olCounters.clear();
      addBlock(
        <hr
          key={`hr-${i}`}
          className="my-6 border-0 border-t border-cme-border-base"
          data-testid="markdown-hr"
        />,
        i,
        i
      );
      i++;
      continue;
    }

    // Task list / Checkbox (- [ ], * [ ], + [ ], 1. [ ], etc. with optional indentation)
    const taskMatch = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      const level = getListLevel(taskMatch[1]);
      const checked = taskMatch[2].toLowerCase() === 'x';
      addBlock(
        <div
          key={`task-${i}`}
          className="flex items-center gap-2 my-1 text-sm"
          style={{ marginLeft: `${level * 1.5}rem` }}
          data-testid="reader-task-item"
          data-level={level}
        >
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="rounded text-cme-primary border-cme-border-base focus:ring-0"
          />
          <span className={checked ? 'line-through text-cme-text-muted' : ''}>
            {renderInlineFormatted(taskMatch[3], currentDocTarget, currentDocMarkdown, currentDocPath, false, commentQuotes)}
          </span>
        </div>,
        i,
        i
      );
      i++;
      continue;
    }

    // Ordered List (\d+\. or \d+\) with optional indentation)
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      const level = getListLevel(olMatch[1]);
      const parsedNum = parseInt(olMatch[2], 10);
      const prevCount = olCounters.get(level) || 0;
      let effectiveNum: number;
      if (prevCount === 0) {
        effectiveNum = isNaN(parsedNum) ? 1 : parsedNum;
      } else {
        if (!isNaN(parsedNum) && parsedNum > 1 && parsedNum !== prevCount) {
          effectiveNum = parsedNum;
        } else {
          effectiveNum = prevCount + 1;
        }
      }
      olCounters.set(level, effectiveNum);

      const olStyleType =
        level % 3 === 1 ? 'lower-alpha' : level % 3 === 2 ? 'lower-roman' : 'decimal';
      const marginRem = 1.25 + level * 1.5;

      addBlock(
        <li
          key={`ol-${i}`}
          className={`text-sm my-0.5 ${level === 0 ? 'ml-5 list-decimal' : ''}`}
          style={{
            marginLeft: `${marginRem}rem`,
            listStyleType: olStyleType,
          }}
          value={effectiveNum}
          data-testid="reader-list-item"
          data-list-type="ordered"
          data-level={level}
        >
          {renderInlineFormatted(olMatch[3], currentDocTarget, currentDocMarkdown, currentDocPath, false, commentQuotes)}
        </li>,
        i,
        i
      );
      i++;
      continue;
    }

    // Unordered List (- or * or + with optional indentation)
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
    if (ulMatch) {
      const level = getListLevel(ulMatch[1]);
      const ulStyleType =
        level % 3 === 1 ? 'circle' : level % 3 === 2 ? 'square' : 'disc';
      const marginRem = 1.0 + level * 1.5;

      addBlock(
        <li
          key={`li-${i}`}
          className={`text-sm my-0.5 ${level === 0 ? 'ml-4 list-disc' : ''}`}
          style={{
            marginLeft: `${marginRem}rem`,
            listStyleType: ulStyleType,
          }}
          data-testid="reader-list-item"
          data-list-type="unordered"
          data-level={level}
        >
          {renderInlineFormatted(ulMatch[3], currentDocTarget, currentDocMarkdown, currentDocPath, false, commentQuotes)}
        </li>,
        i,
        i
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Normal Paragraph
    activeListIndents = [0];
    olCounters.clear();
    addBlock(
      <p key={`p-${i}`} className="my-2 text-sm leading-relaxed">
        {renderInlineFormatted(line, currentDocTarget, currentDocMarkdown, currentDocPath, false, commentQuotes)}
      </p>,
      i,
      i
    );
    i++;
  }

  if (comments.length === 0 || !renderCommentCard) {
    return blockList.map((b) => b.element);
  }

  if (blockList.length === 0) {
    if (rootComments.length === 0) return [];
    return [
      <div
        key="inline-comments-empty-doc"
        className="cme-inline-comments-container my-3 space-y-2 select-text"
        data-testid="inline-comments-container"
      >
        {rootComments.map((rc) => renderCommentCard(rc.comment))}
      </div>,
    ];
  }

  const commentsByBlock: Record<number, CommentRecord[]> = {};

  for (const rc of rootComments) {
    let assignedBlock = blockList.length - 1;
    if (rc.targetPos >= 0) {
      if (rc.targetPos <= blockList[0].end) {
        assignedBlock = 0;
      } else {
        for (let b = 0; b < blockList.length - 1; b++) {
          if (rc.targetPos >= blockList[b].start && rc.targetPos < blockList[b + 1].start) {
            assignedBlock = b;
            break;
          }
        }
      }
    }
    if (!commentsByBlock[assignedBlock]) {
      commentsByBlock[assignedBlock] = [];
    }
    commentsByBlock[assignedBlock].push(rc.comment);
  }

  const finalElements: React.ReactNode[] = [];
  for (let b = 0; b < blockList.length; b++) {
    finalElements.push(blockList[b].element);
    const blockComments = commentsByBlock[b];
    if (blockComments && blockComments.length > 0) {
      finalElements.push(
        <div
          key={`inline-comments-${b}`}
          className="cme-inline-comments-container my-3 space-y-2 select-text"
          data-testid="inline-comments-container"
        >
          {blockComments.map((c) => renderCommentCard(c))}
        </div>
      );
    }
  }

  return finalElements;
}

// Inline formatting helper: Bold, Italic, Strikethrough, Inline Code, Inline Math ($...$), Display Math ($$...$$), WikiLinks ([[target]]), Standard Markdown Links ([label](target)), and Embedded Images (![alt](src))
function renderInlineFormatted(
  text: string,
  currentDocTarget: string = '',
  currentDocMarkdown: string = '',
  currentDocPath: string = '',
  inQuote: boolean = false,
  commentQuotes: string[] = []
): React.ReactNode {
  if (!text) return null;

  // Split on:
  // 1. Inline code: `...`
  // 2. Embedded images: ![alt](url)
  // 3. WikiLinks: [[target]] or [[target|label]]
  // 4. Custom Pills: [pill:color|label], [pill:label], [status:...], [priority:...]
  // 5. Standard Markdown Links: [label](target)
  // 6. Display Math: $$...$$
  // 7. Inline Math: $...$
  // 8. Strikethrough: ~~...~~
  // 9. Bold Italic: ***...*** or ___...___
  // 10. Bold: **...** or __...__
  // 11. Italic: *...* or _..._
  const parts = text.split(
    /((?<!`)(?:`+).*?(?:`+)(?!`)|!\[[^\]]*\]\([^)\n]+\)|!\[\[[^\]]+\]\]|(?<!\!)\[\[[^\]]+\]\]|(?<!!)\[(?:pill|status|priority):(?:[a-zA-Z0-9#_-]+\|)?[^\]\n]+\]|(?<!!)\[[^\]]+\]\([^)\n]+\)|\$\$[^\$\n]+\$\$|\$(?!\s)[^$\n]+(?<!\s)\$|~~[^~\n]+~~|\*\*\*+[^*\n]+\*\*\*+|___+[^_\n]+___+|\*\*(?!\s)(?:[^\*\n]|\*[^\*\n]+?\*)+?\*\*(?!\*)|(?<![a-zA-Z0-9_])__(?!\s)(?:[^_\n]|_[^_\n]+?_)+?__(?![a-zA-Z0-9_])|(?<!\*)\*(?!\s)(?:[^\*\n]|\*\*[^\*\n]+?\*\*)+?(?<!\s)\*(?!\*)|(?<![a-zA-Z0-9_])_(?!\s)(?:[^_\n]|__[^\n]+?__|\*\*[^\n]+?\*\*)+?(?<!\s)_(?![a-zA-Z0-9_]))/g
  );

  let currentOffset = 0;

  return parts.map((part, idx) => {
    const matchOffset = text.indexOf(part, currentOffset);
    if (matchOffset !== -1) {
      currentOffset = matchOffset + part.length;
    }

    // Helper to check if match at matchOffset is enclosed by quotes on this line
    const isMathInQuote = (): boolean => {
      if (inQuote) return true;
      if (matchOffset === -1) return false;
      const beforeChar = matchOffset > 0 ? text[matchOffset - 1] : '';
      const afterChar = matchOffset + part.length < text.length ? text[matchOffset + part.length] : '';
      if ((beforeChar === '"' && afterChar === '"') || (beforeChar === "'" && afterChar === "'")) {
        return true;
      }
      const prefix = text.slice(0, matchOffset);
      const suffix = text.slice(matchOffset + part.length);
      const doubleQuotesBefore = (prefix.match(/"/g) || []).length;
      const doubleQuotesAfter = (suffix.match(/"/g) || []).length;
      if (doubleQuotesBefore % 2 === 1 && doubleQuotesAfter >= 1) {
        return true;
      }
      const singleQuotesBefore = (prefix.match(/'/g) || []).length;
      const singleQuotesAfter = (suffix.match(/'/g) || []).length;
      if (singleQuotesBefore % 2 === 1 && singleQuotesAfter >= 1) {
        return true;
      }
      return false;
    };

    // 1. Inline Code `...` or ``...`` - check first so pills/math inside code are never parsed
    const codeMatch = part.match(/^(?<!`)(`+)(.*?)\1(?!`)$/);
    if (codeMatch) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-cme-bg-subtle font-mono text-[0.88em] text-pink-600 dark:text-pink-400 border border-cme-border-base"
        >
          {codeMatch[2]}
        </code>
      );
    }

    // 2a. Obsidian Embeds: ![[target]] or ![[target|alt]] or ![[target|alt|size]]
    if (part.startsWith('![[') && part.endsWith(']]')) {
      const inner = part.slice(3, -2);
      const pipeIdx = inner.indexOf('|');
      const rawTarget = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
      const altOrSize = (pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : '').trim();
      const parsed = parseImageDimensionAndAlt(altOrSize);
      const targetInfo = parseImageTarget(rawTarget);
      const cleanSrc = targetInfo.cleanSrc;
      const displayAlt = parsed.altText || targetInfo.title || cleanSrc;
      const resolvedSrc = isExternalUrl(cleanSrc)
        ? (cleanSrc.includes(' ') ? encodeURI(cleanSrc) : cleanSrc)
        : getWorkspaceFileUrl(cleanSrc, currentDocPath);
      const { linkStyle, imgStyle } = getImageStyles(parsed);

      return (
        <a
          key={idx}
          href={resolvedSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block my-1 rounded border border-cme-border-base bg-cme-bg-surface overflow-hidden align-middle hover:border-cme-primary transition-colors max-w-full"
          title={`${displayAlt} (Click to open)`}
          style={linkStyle}
        >
          <img
            src={resolvedSrc}
            alt={displayAlt}
            className="block align-middle"
            style={imgStyle}
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = 'none';
              const parent = el.parentElement;
              if (parent && !parent.querySelector('.broken-image-fallback')) {
                const fallback = document.createElement('span');
                fallback.className = 'broken-image-fallback inline-flex items-center gap-1.5 px-2 py-1 text-xs font-mono rounded border border-rose-500/40 bg-rose-500/10 text-rose-500';
                fallback.innerHTML = `🖼⚠ Image not found: <span class="underline font-semibold">${cleanSrc}</span>`;
                parent.appendChild(fallback);
              }
            }}
          />
        </a>
      );
    }

    // 2b. Standard Embedded images: ![alt](src)
    if (part.startsWith('![') && part.includes('](') && part.endsWith(')')) {
      const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)\n]+)\)$/);
      if (imgMatch) {
        const rawAlt = imgMatch[1].trim();
        const rawSrc = imgMatch[2].trim();
        const parsed = parseImageDimensionAndAlt(rawAlt, rawSrc);
        const targetInfo = parseImageTarget(rawSrc);
        const cleanSrc = targetInfo.cleanSrc;
        const displayAlt = parsed.altText || targetInfo.title || cleanSrc;
        const resolvedSrc = isExternalUrl(cleanSrc)
          ? (cleanSrc.includes(' ') ? encodeURI(cleanSrc) : cleanSrc)
          : getWorkspaceFileUrl(cleanSrc, currentDocPath);
        const { linkStyle, imgStyle } = getImageStyles(parsed);

        return (
          <a
            key={idx}
            href={resolvedSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block my-1 rounded border border-cme-border-base bg-cme-bg-surface overflow-hidden align-middle hover:border-cme-primary transition-colors max-w-full"
            title={`${displayAlt} (Click to open)`}
            style={linkStyle}
          >
            <img
              src={resolvedSrc}
              alt={displayAlt}
              className="block align-middle"
              style={imgStyle}
              onError={(e) => {
                const el = e.currentTarget;
                el.style.display = 'none';
                const parent = el.parentElement;
                if (parent && !parent.querySelector('.broken-image-fallback')) {
                  const fallback = document.createElement('span');
                  fallback.className = 'broken-image-fallback inline-flex items-center gap-1.5 px-2 py-1 text-xs font-mono rounded border border-rose-500/40 bg-rose-500/10 text-rose-500';
                  fallback.innerHTML = `🖼⚠ Image not found: <span class="underline font-semibold">${cleanSrc}</span>`;
                  parent.appendChild(fallback);
                }
              }}
            />
          </a>
        );
      }
    }

    // 2c. Custom Pills & Badges: [pill:color|label], [pill:label], [status:...], [priority:...]
    const parsedPill = parsePillSyntax(part);
    if (parsedPill) {
      const style = resolvePillStyle(parsedPill.color);
      const isHex = parsedPill.isCustomHex;
      const customStyle = isHex
        ? {
            backgroundColor: `${parsedPill.color}20`,
            borderColor: `${parsedPill.color}40`,
            color: parsedPill.color,
          }
        : undefined;
      const dotBg = isHex ? parsedPill.color : style.dotColor;

      return (
        <span
          key={idx}
          className={`cme-pill inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border align-baseline select-none my-0.5 mx-0.5 ${style.bgClass} ${style.textClass} ${style.borderClass}`}
          style={customStyle}
          data-testid="cme-pill"
          data-color={parsedPill.color}
          title={part}
        >
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotBg }} />
          <span>{parsedPill.label}</span>
        </span>
      );
    }

    // 3. WikiLinks [[target]] or [[target|label]]
    // 4. Standard Markdown Links [label](target)
    const isWiki = part.startsWith('[[') && part.endsWith(']]');
    const mdMatch = !isWiki ? part.match(/^\[([^\]]+)\]\(([^)\n]+)\)$/) : null;

    if (isWiki || mdMatch) {
      let cleanTarget = '';
      let label = '';
      if (isWiki) {
        const inner = part.slice(2, -2);
        const [target, alias] = inner.split('|');
        cleanTarget = (target || '').trim();
        label = (alias || '').trim();
      } else if (mdMatch) {
        label = mdMatch[1].trim();
        cleanTarget = parseImageTarget(mdMatch[2]).cleanSrc;
      }

      const external = isExternalUrl(cleanTarget);
      const hashIndex = cleanTarget.indexOf('#');
      const targetDoc = !external && hashIndex >= 0 ? cleanTarget.slice(0, hashIndex).trim() : cleanTarget;
      const rawAnchor = !external && hashIndex >= 0 ? cleanTarget.slice(hashIndex + 1).trim() : '';
      let isSameDoc = !external && (cleanTarget.startsWith('#') || targetDoc === '');
      let effectiveAnchor = rawAnchor;
      if (!external && !isSameDoc && targetDoc && currentDocMarkdown) {
        const headings = extractDocumentHeadings(currentDocMarkdown);
        if (headings.some((h) => matchesHeadingTarget(h.rawText, targetDoc))) {
          isSameDoc = true;
          effectiveAnchor = rawAnchor || targetDoc;
        }
      }
      const resolvedWorkspaceDoc = !external && !isSameDoc && targetDoc ? findWorkspacePath(targetDoc, currentDocPath) : '';
      const effectiveTargetDoc = resolvedWorkspaceDoc || targetDoc;
      const strippedAnchor = stripHeadingNumberPrefix(effectiveAnchor);
      const anchorSlug = effectiveAnchor ? slugify(strippedAnchor || effectiveAnchor) : '';
      const isNonMarkdownAsset = !external && !isSameDoc && !isMarkdownPath(effectiveTargetDoc);

      const displayLabel = label || (isSameDoc ? (effectiveAnchor ? `#${effectiveAnchor}` : cleanTarget) : cleanTarget);

      // Validate link target
      const validation = validateLinkTarget(cleanTarget, currentDocMarkdown, currentDocPath);
      const isValid = validation.valid;
      const invalidReason = validation.reason || 'Target file or heading does not exist';

      if (!isValid) {
        return (
          <span
            key={idx}
            className="broken-link-span inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded-md border border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400"
            data-testid="broken-link-item"
            title={`Broken link: ${invalidReason}`}
          >
            <span
              className="broken-link-sign text-rose-600 dark:text-rose-400 font-bold"
              data-testid="broken-link-indicator"
              title={invalidReason}
            >
              ⚠
            </span>
            <span className="font-medium underline decoration-rose-500/60 underline-offset-2">
              {displayLabel}
            </span>
          </span>
        );
      }

      if (external) {
        return (
          <a
            key={idx}
            href={cleanTarget}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cme-primary hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer"
            title={`External link: ${cleanTarget} (Click to open)`}
          >
            <span>{displayLabel}</span>
            <span className="text-[10px] opacity-70">↗</span>
          </a>
        );
      }

      if (isSameDoc) {
        const hashHref = `#${anchorSlug}`;
        return (
          <a
            key={idx}
            href={hashHref}
            className="text-cme-primary hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer"
            title={`Heading link: ${cleanTarget} (Click to jump to heading, Ctrl+Click to edit)`}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                window.dispatchEvent(
                  new CustomEvent('cme-open-wikilink', {
                    detail: { target: currentDocTarget, anchor: anchorSlug },
                  })
                );
                return;
              }
              e.preventDefault();
              const targetCandidate = effectiveAnchor || anchorSlug;
              const tryScroll = () => {
                const el = findHeadingElement(targetCandidate);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  return true;
                }
                return false;
              };
              if (!tryScroll()) {
                [60, 120, 240].forEach((delay) => setTimeout(tryScroll, delay));
              }
              try {
                window.history.pushState(null, '', hashHref);
              } catch {
                // ignore
              }
            }}
          >
            <span>{displayLabel}</span>
            <span className="text-[10px] opacity-70">↓</span>
          </a>
        );
      }

      if (isNonMarkdownAsset) {
        const assetUrl = getWorkspaceFileUrl(effectiveTargetDoc, currentDocPath);
        return (
          <a
            key={idx}
            href={assetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cme-primary hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer"
            title={`Open file: ${cleanTarget} in new tab`}
          >
            <span>{displayLabel}</span>
            <span className="text-[10px] opacity-70">↗</span>
          </a>
        );
      }

      const docLink = `/docs/${encodeURIComponent(effectiveTargetDoc)}${anchorSlug ? `#${anchorSlug}` : ''}`;
      return (
        <Link
          key={idx}
          to={docLink}
          className="text-cme-primary hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer"
          title={`Link: ${cleanTarget} (Click to view, Ctrl+Click to edit)`}
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              window.dispatchEvent(
                new CustomEvent('cme-open-wikilink', {
                  detail: { target: effectiveTargetDoc, anchor: anchorSlug },
                })
              );
            }
          }}
        >
          <span>{displayLabel}</span>
          <span className="text-[10px] opacity-70">↗</span>
        </Link>
      );
    }

    // 5. Display Math $$...$$ on a line
    if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
      if (isMathInQuote()) {
        return (
          <code
            key={idx}
            className="cme-live-code font-mono text-xs px-1.5 py-0.5 rounded bg-cme-bg-subtle border border-cme-border-base font-normal not-italic text-cme-text-base"
          >
            {part}
          </code>
        );
      }
      const latex = part.slice(2, -2);
      try {
        const html = katex.renderToString(latex, { displayMode: true, throwOnError: false });
        return (
          <span
            key={idx}
            className="katex-display-inline"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } catch {
        return <code key={idx} className="font-mono text-xs">{part}</code>;
      }
    }

    // 6. Inline Math $...$
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const latex = part.slice(1, -1);
      if (/^\d+(?:\.\d+)?$/.test(latex)) {
        return <span key={idx}>{part}</span>;
      }
      if (isMathInQuote()) {
        return (
          <code
            key={idx}
            className="cme-live-code font-mono text-xs px-1.5 py-0.5 rounded bg-cme-bg-subtle border border-cme-border-base font-normal not-italic text-cme-text-base"
          >
            {part}
          </code>
        );
      }
      try {
        const html = katex.renderToString(latex, { displayMode: false, throwOnError: false });
        return (
          <span
            key={idx}
            className="katex-inline"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } catch {
        return <code key={idx} className="font-mono text-xs">{part}</code>;
      }
    }

    // 7. Strikethrough ~~...~~
    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
      return (
        <del key={idx} className="line-through text-cme-text-muted">
          {renderInlineFormatted(
            part.slice(2, -2),
            currentDocTarget,
            currentDocMarkdown,
            currentDocPath,
            inQuote
          )}
        </del>
      );
    }

    // 8. Bold Italic: ***...*** or ___...___
    if (
      (((part.startsWith('***') && part.endsWith('***')) ||
        (part.startsWith('___') && part.endsWith('___'))) &&
        part.length > 6)
    ) {
      return (
        <strong key={idx} className="font-bold font-black">
          <em className="italic">
            {renderInlineFormatted(
              part.slice(3, -3),
              currentDocTarget,
              currentDocMarkdown,
              currentDocPath,
              inQuote
            )}
          </em>
        </strong>
      );
    }

    // 9. Bold: **...** or __...__
    if (
      (((part.startsWith('**') && part.endsWith('**')) ||
        (part.startsWith('__') && part.endsWith('__'))) &&
        part.length > 4)
    ) {
      return (
        <strong key={idx} className="font-bold font-black">
          {renderInlineFormatted(
            part.slice(2, -2),
            currentDocTarget,
            currentDocMarkdown,
            currentDocPath,
            inQuote
          )}
        </strong>
      );
    }

    // 10. Italic: *...* or _..._
    if (
      (((part.startsWith('*') && part.endsWith('*')) ||
        (part.startsWith('_') && part.endsWith('_'))) &&
        part.length > 2)
    ) {
      return (
        <em key={idx} className="italic">
          {renderInlineFormatted(
            part.slice(1, -1),
            currentDocTarget,
            currentDocMarkdown,
            currentDocPath,
            inQuote
          )}
        </em>
      );
    }

    if (commentQuotes && commentQuotes.length > 0) {
      for (const q of commentQuotes) {
        if (q && q.length >= 2 && part.includes(q)) {
          const subparts = part.split(q);
          return (
            <React.Fragment key={idx}>
              {subparts.map((sp, sidx) => (
                <React.Fragment key={sidx}>
                  {sp}
                  {sidx < subparts.length - 1 && (
                    <mark
                      className="cme-review-comment-anchor bg-yellow-400/25 border-b-2 border-yellow-500 rounded-xs text-inherit"
                      data-testid="reader-comment-anchor"
                    >
                      {q}
                    </mark>
                  )}
                </React.Fragment>
              ))}
            </React.Fragment>
          );
        }
      }
    }

    return part;
  });
}

// Mermaid diagram interactive container
const MermaidBlock: React.FC<{ source: string }> = ({ source }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    renderMermaidSvg(source)
      .then((res) => {
        setSvg(res);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || 'Mermaid syntax error');
      });
  }, [source]);

  if (error) {
    return (
      <div className="my-4 p-4 border border-rose-500/20 bg-rose-500/10 rounded-xl text-xs text-rose-500 font-mono">
        Failed to render diagram: {error}
      </div>
    );
  }

  return (
    <div
      className="my-6 p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-x-auto flex justify-center"
      data-testid="mermaid-viewer"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

