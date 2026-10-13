import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Clock,
  BookOpen,
  AlertCircle,
  Package,
  X,
  AlignLeft,
  MessageSquare,
} from 'lucide-react';
import { fetchDocument } from '../../api/documents';
import { fetchCurrentUser } from '../../api/auth';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useReviewStore } from '../../stores/reviewStore';
import { Badge } from '../common/Badge';
import { CollaborativeEditor } from '../editor/CollaborativeEditor';
import { CmeCollabProvider, CollabConnectionStatus, ReviewEventPayload } from '../../api/collabProvider';
import { DocumentOutline } from '../navigation/DocumentOutline';
import { ReviewSidebar } from '../review/ReviewSidebar';
import { reconcileAnchor } from '../../review/textAnchoring';

interface EditorPaneProps {
  documentId: string;
  paneLabel?: string;
  onClosePane?: () => void;
  isPrimary?: boolean;
}

export const EditorPane: React.FC<EditorPaneProps> = ({
  documentId,
  paneLabel,
  onClosePane,
  isPrimary = true,
}) => {
  const { setBreadcrumbs, setSyncStatus } = useUIStore();
  const { updateTabMetadata } = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [showOutline, setShowOutline] = useState<boolean>(false);
  const [editorInstance, setEditorInstance] = useState<any>(null);

  const handleEditorReady = useCallback((ed: any) => {
    setEditorInstance((prev: any) => prev || ed);
  }, []);

  const provider = useMemo(() => {
    if (!documentId || documentId === 'by-path') return null;
    return new CmeCollabProvider(documentId);
  }, [documentId]);

  const {
    initDocument,
    handleWebSocketReviewEvent,
    isSidebarOpen,
    setSidebarOpen,
    comments,
    suggestions,
    tasks,
  } = useReviewStore();

  useEffect(() => {
    if (documentId && documentId !== 'by-path') {
      initDocument(documentId);
    }
  }, [documentId, initDocument]);

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const {
    data: document,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => {
      if (!documentId || documentId === 'by-path') {
        return Promise.reject(new Error('Invalid document identifier'));
      }
      return fetchDocument(documentId);
    },
    enabled: Boolean(documentId && documentId !== 'by-path'),
  });

  // Keep workspace tabs updated with document metadata
  useEffect(() => {
    if (document) {
      updateTabMetadata(document.id, {
        path: document.path,
        title: document.title,
        is_bundle: document.is_bundle,
      });

      if (isPrimary) {
        const parts = document.path.split('/');
        const breadcrumbList = [
          { label: 'Workspaces', path: '/' },
          ...parts.slice(0, -1).map((part, idx) => ({
            label: part,
            path: `/?dir=${parts.slice(0, idx + 1).join('/')}`,
          })),
          { label: document.title || parts[parts.length - 1], isCurrent: true },
        ];
        setBreadcrumbs(breadcrumbList);
      }
    }
  }, [document, isPrimary, updateTabMetadata, setBreadcrumbs]);

  // Manage Collaborative WebSocket Provider
  useEffect(() => {
    if (!provider) return;

    const unsubStatus = provider.onStatus((status: CollabConnectionStatus) => {
      if (isPrimary) {
        if (status === 'connected') {
          setSyncStatus('live');
        } else if (status === 'connecting') {
          setSyncStatus('syncing');
        } else {
          setSyncStatus('offline');
        }
      }
    });

    const unsubReview = provider.onReviewEvent((event: ReviewEventPayload) => {
      handleWebSocketReviewEvent(event);
      queryClient.invalidateQueries({ queryKey: ['reviews', documentId] });
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
    });

    provider.connect();

    return () => {
      unsubStatus();
      unsubReview();
      provider.destroy();
      if (isPrimary) {
        setSyncStatus('saved');
      }
    };
  }, [provider, documentId, isPrimary, setSyncStatus, queryClient, handleWebSocketReviewEvent]);

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 space-y-4 animate-pulse">
        <div className="h-8 bg-cme-bg-subtle rounded-lg w-1/3" />
        <div className="h-4 bg-cme-bg-subtle rounded w-1/4" />
        <div className="h-64 bg-cme-bg-subtle rounded-xl mt-6" />
      </div>
    );
  }

  if (isError || !document) {
    return (
      <div className="m-8 p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-base font-semibold text-rose-600 dark:text-rose-400">
          Document Not Found
        </h2>
        <p className="text-xs text-cme-text-muted">
          {(error as any)?.message || 'The requested document does not exist or you lack read access.'}
        </p>
      </div>
    );
  }

  return (
    <div
      className="p-3 md:p-4 space-y-3 w-full h-full flex flex-col min-w-0"
      data-testid={isPrimary ? 'primary-editor-pane' : 'secondary-editor-pane'}
    >
      {/* Pane Header & Metadata Bar */}
      <div className="space-y-2 pb-3 border-b border-cme-border-base flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {paneLabel && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cme-primary/10 text-cme-primary flex-shrink-0">
                {paneLabel}
              </span>
            )}
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-cme-text-base truncate">
              {document.title || 'Untitled Document'}
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowOutline(!showOutline)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                showOutline
                  ? 'bg-cme-primary text-white border-cme-primary'
                  : 'border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
              }`}
              title="Toggle Document Outline"
              data-testid="editor-outline-toggle"
            >
              <AlignLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Outline</span>
            </button>

            <button
              onClick={() => setSidebarOpen(!isSidebarOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                isSidebarOpen
                  ? 'bg-cme-primary text-white border-cme-primary'
                  : 'border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
              }`}
              title="Toggle Review Discussions Panel"
              data-testid="editor-reviews-toggle"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reviews</span>
              {comments.filter((c) => c.status === 'OPEN').length +
                suggestions.filter((s) => s.status === 'PENDING').length +
                tasks.filter((t) => !t.is_completed).length > 0 && (
                <span
                  data-testid="editor-reviews-count"
                  className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white ml-0.5"
                >
                  {comments.filter((c) => c.status === 'OPEN').length +
                    suggestions.filter((s) => s.status === 'PENDING').length +
                    tasks.filter((t) => !t.is_completed).length}
                </span>
              )}
            </button>

            <Link
              to={`/docs/${document.id}`}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
              title="Switch to Reader View"
            >
              <BookOpen className="w-3.5 h-3.5 text-cme-text-muted" />
              <span className="hidden sm:inline">Reader</span>
            </Link>

            {onClosePane && (
              <button
                onClick={onClosePane}
                className="p-1 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-cme-text-muted hover:text-rose-500 transition-colors"
                title="Close Split Pane"
                data-testid="close-secondary-pane-btn"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-cme-text-muted font-mono">
          <span className="flex items-center gap-1 truncate max-w-xs">
            {document.is_bundle ? (
              <Package className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
            )}
            <span className="truncate">{document.path}</span>
          </span>
          {document.is_bundle && (
            <Badge variant="primary" size="sm">
              Bundle
            </Badge>
          )}
          <span className="flex items-center gap-1 text-[11px]">
            <Clock className="w-3 h-3" />
            <span>{new Date(document.updated_at).toLocaleTimeString()}</span>
          </span>
        </div>
      </div>

      {/* Main Workspace Body: Full-Width Collaborative Editor & Right Docked Sidebars */}
      <div className="flex-1 flex overflow-hidden min-h-0 gap-3">
        <div className="flex-1 overflow-y-auto min-w-0 flex flex-col h-full">
          <CollaborativeEditor
            key={provider?.ydoc.guid || 'editor'}
            provider={provider}
            user={
              user
                ? {
                    name: user.display_name || user.username,
                    color: user.avatar_color || (isPrimary ? '#3b82f6' : '#8b5cf6'),
                  }
                : undefined
            }
            initialContent={
              document.content || `# ${document.title || 'Document'}\n\nStart writing markdown here...`
            }
            onEditorReady={handleEditorReady}
            autoFocus={isPrimary ? 'end' : false}
          />
        </div>

        {/* Right Docked Table of Contents (TOC) Sidebar */}
        {showOutline && (
          <aside
            className="w-64 border border-cme-border-base rounded-xl bg-cme-bg-surface flex-shrink-0 overflow-hidden flex flex-col shadow-sm"
            data-testid="editor-outline-sidebar"
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-cme-border-base text-xs font-semibold text-cme-text-base bg-cme-bg-subtle/50 flex-shrink-0">
              <span className="flex items-center gap-1.5">
                <AlignLeft className="w-3.5 h-3.5 text-cme-primary" />
                Table of Contents
              </span>
              <button
                onClick={() => setShowOutline(false)}
                className="p-1 rounded-md hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
                title="Close Table of Contents"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              <DocumentOutline markdown={document.content} />
            </div>
          </aside>
        )}

        {/* Review Sidebar */}
        {isSidebarOpen && (
          <ReviewSidebar
            onApplyReplacement={(orig, rep, anchor) => {
              try {
                let ed = editorInstance;
                if (!ed || ed.isDestroyed) {
                  const domEl = typeof window !== 'undefined' ? window.document.querySelector('.collaborative-editor-root .ProseMirror') : null;
                  ed = (domEl as any)?.__tiptapEditor;
                }
                if (ed && !ed.isDestroyed) {
                  let replaced = false;
                  // First try exact node search in ProseMirror doc tree
                  if (orig) {
                    ed.state.doc.descendants((node: any, pos: number) => {
                      if (!replaced && node.isText && node.text && node.text.includes(orig)) {
                        const from = pos + node.text.indexOf(orig);
                        const to = from + orig.length;
                        ed
                          .chain()
                          .focus()
                          .deleteRange({ from, to })
                          .insertContentAt(from, rep)
                          .run();
                        replaced = true;
                        return false;
                      }
                    });
                  }

                  // Fallback: use reconcileAnchor if not found via direct text search
                  if (!replaced && anchor) {
                    const currentText = ed.getText();
                    const reconciled = reconcileAnchor(anchor, currentText);
                    if (reconciled.range) {
                      const from = reconciled.range.start + 1;
                      const to = reconciled.range.end + 1;
                      ed
                        .chain()
                        .focus()
                        .deleteRange({ from, to })
                        .insertContentAt(from, rep)
                        .run();
                      replaced = true;
                    }
                  }
                }
              } catch (e) {
                console.warn('[EditorPane] onApplyReplacement warning:', e);
              }
            }}
          />
        )}
      </div>
    </div>
  );
};
