import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Clock,
  BookOpen,
  AlertCircle,
  Package,
  X,
  AlignLeft,
  MessageSquare,
  Edit2,
  Shield,
  RefreshCw,
} from 'lucide-react';
import { fetchDocument, moveDocument, updateDocument, convertDocument } from '../../api/documents';
import { DocumentRecord } from '../../types/document';
import { fetchCurrentUser } from '../../api/auth';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useReviewStore } from '../../stores/reviewStore';
import { Badge } from '../common/Badge';
import { CollaborativeEditor } from '../editor/CollaborativeEditor';
import { EditorView } from '@codemirror/view';
import { CmeCollabProvider, CollabConnectionStatus, ReviewEventPayload } from '../../api/collabProvider';
import { DocumentOutline, findHeadingPosition, findHeadingElement } from '../navigation/DocumentOutline';
import { ReviewSidebar } from '../review/ReviewSidebar';
import { reconcileAnchor } from '../../review/textAnchoring';
import { updateCachedDocumentHeadings } from '../../utils/linkValidator';
import { BundleAssetsSidebar } from './BundleAssetsSidebar';
import { AccessControlModal } from './AccessControlModal';

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
  const { setBreadcrumbs, setSyncStatus, setViewMode, numberHeaders, setNumberHeaders } = useUIStore();
  const { updateTabMetadata, closeTab, outlineWidth, setOutlineWidth } = useWorkspaceStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showOutline, setShowOutline] = useState<boolean>(false);
  const [isResizingOutline, setIsResizingOutline] = useState<boolean>(false);
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const [liveContent, setLiveContent] = useState<string | undefined>(undefined);
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [showAssets, setShowAssets] = useState<boolean>(false);
  const [showAcl, setShowAcl] = useState<boolean>(false);

  useEffect(() => {
    setLiveContent(undefined);
    setCursorLine(1);
  }, [documentId]);

  const handleOutlineResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = outlineWidth || 256;
      setIsResizingOutline(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = startX - moveEvent.clientX;
        setOutlineWidth(startWidth + deltaX);
      };

      const handleMouseUp = () => {
        setIsResizingOutline(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [outlineWidth, setOutlineWidth]
  );

  const handleEditorReady = useCallback((ed: any) => {
    setEditorInstance((prev: any) => prev || ed);
    const view = ed?.getView?.() || ed?.view;
    if (view?.state?.doc) {
      const currentText = view.state.doc.toString();
      if (currentText) {
        setLiveContent(currentText);
      }
    }
  }, []);

  const scrollToHeading = useCallback(
    (headingTarget: string) => {
      if (!headingTarget) return;
      let decoded = headingTarget;
      try {
        decoded = decodeURIComponent(headingTarget);
      } catch {
        // ignore
      }
      const clean = decoded.replace(/^#+/, '').trim();
      if (!clean) return;

      if (editorInstance && !editorInstance.isDestroyed) {
        const view = editorInstance.getView?.() || (editorInstance as any).view;
        if (view?.state?.doc) {
          const pos = findHeadingPosition(view.state.doc, clean);
          if (pos) {
            view.dispatch({
              selection: { anchor: pos.from },
              effects: EditorView.scrollIntoView(pos.from, { y: 'start', yMargin: 40 }),
            });
            view.focus();
            requestAnimationFrame(() => {
              if (!editorInstance.isDestroyed && view?.dom?.isConnected) {
                view.dispatch({
                  effects: EditorView.scrollIntoView(pos.from, { y: 'start', yMargin: 40 }),
                });
              }
            });
            return;
          }
        }
      }

      const domEl = findHeadingElement(clean);
      if (domEl) {
        domEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [editorInstance]
  );

  useEffect(() => {
    if (editorInstance && window.location.hash) {
      const timer = setTimeout(() => {
        scrollToHeading(window.location.hash);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [editorInstance, scrollToHeading]);

  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash) {
        scrollToHeading(window.location.hash);
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [scrollToHeading]);

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

  const handleScrollToAnchor = useCallback(
    (anchor: any) => {
      if (!anchor) return;
      const view = editorInstance?.getView?.() || (editorInstance as any)?.view;
      if (!view || !view.state?.doc) return;

      const doc = view.state.doc;
      const docText = doc.toString();
      const ydoc = provider?.ydoc;

      let targetFrom = -1;
      let targetTo = -1;

      const reconciled = reconcileAnchor(
        anchor,
        ydoc || docText,
        ydoc ? ydoc.getText('content') : undefined
      );

      if (reconciled?.range) {
        targetFrom = Math.max(0, Math.min(reconciled.range.start, doc.length));
        targetTo = Math.max(targetFrom, Math.min(reconciled.range.end, doc.length));
      } else if (anchor.quote?.exact || anchor.exact) {
        const exact = anchor.quote?.exact || anchor.exact;
        const idx = docText.indexOf(exact);
        if (idx !== -1) {
          targetFrom = idx;
          targetTo = idx + exact.length;
        }
      } else if (typeof anchor.offset === 'number') {
        targetFrom = Math.max(0, Math.min(anchor.offset, doc.length));
        targetTo =
          typeof anchor.length === 'number'
            ? Math.min(targetFrom + anchor.length, doc.length)
            : targetFrom;
      } else if (typeof anchor.line === 'number' && anchor.line >= 1 && anchor.line <= doc.lines) {
        const lineInfo = doc.line(anchor.line);
        targetFrom = lineInfo.from;
        targetTo = lineInfo.to;
      }

      if (targetFrom >= 0) {
        view.dispatch({
          selection: { anchor: targetFrom, head: targetTo >= targetFrom ? targetTo : targetFrom },
          effects: EditorView.scrollIntoView(targetFrom, { y: 'center', yMargin: 40 }),
        });
        view.focus();
        requestAnimationFrame(() => {
          if (view?.dom?.isConnected) {
            view.dispatch({
              effects: EditorView.scrollIntoView(targetFrom, { y: 'center', yMargin: 40 }),
            });
          }
        });
      }
    },
    [editorInstance, provider]
  );

  const handleApplyReplacement = useCallback(
    (orig: string, rep: string, anchor?: any) => {
      try {
        const view = editorInstance?.getView?.() || (editorInstance as any)?.view;
        if (!view || !view.state?.doc) return;

        const doc = view.state.doc;
        const docText = doc.toString();
        let from = -1;
        let to = -1;

        if (anchor) {
          const reconciled = reconcileAnchor(
            anchor,
            provider?.ydoc || docText,
            provider?.ydoc ? provider.ydoc.getText('content') : undefined
          );
          if (reconciled?.range) {
            from = Math.max(0, Math.min(reconciled.range.start, doc.length));
            to = Math.max(from, Math.min(reconciled.range.end, doc.length));
          }
        }

        if (from === -1 && orig) {
          const idx = docText.indexOf(orig);
          if (idx !== -1) {
            from = idx;
            to = idx + orig.length;
          }
        }

        if (from !== -1 && to !== -1 && from <= to) {
          view.dispatch({
            changes: { from, to, insert: rep },
            selection: { anchor: from + rep.length },
            effects: EditorView.scrollIntoView(from, { y: 'center' }),
          });
          view.focus();
        }
      } catch (e) {
        console.warn('[EditorPane] handleApplyReplacement error:', e);
      }
    },
    [editorInstance, provider]
  );

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

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');

  const renameMutation = useMutation({
    mutationFn: ({ id, newPath, title }: { id: string; newPath: string; title?: string }) =>
      moveDocument(id, newPath, title),
    onSuccess: (updatedDoc) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['document', updatedDoc.id] });
      queryClient.setQueryData(['document', updatedDoc.id], updatedDoc);
      updateTabMetadata(updatedDoc.id, {
        path: updatedDoc.path,
        title: updatedDoc.title,
        is_bundle: updatedDoc.is_bundle,
      });
      setIsEditingTitle(false);
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => convertDocument(id),
    onSuccess: (updatedDoc) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['document', updatedDoc.id] });
      queryClient.setQueryData(['document', updatedDoc.id], updatedDoc);
      updateTabMetadata(updatedDoc.id, {
        path: updatedDoc.path,
        title: updatedDoc.title,
        is_bundle: updatedDoc.is_bundle,
      });
    },
  });

  const handleTitleSubmit = () => {
    if (!document) return;
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === document.title) {
      setIsEditingTitle(false);
      return;
    }
    const oldPath = document.path;
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const ext = oldPath.endsWith('.bundle') ? '.bundle' : '.md';
    const newName = `${trimmed}${ext}`;
    const newPath = dir ? `${dir}/${newName}` : newName;
    renameMutation.mutate({ id: document.id, newPath, title: trimmed });
  };

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
  }, [document, documentId, isPrimary, updateTabMetadata, setBreadcrumbs]);

  // Synchronize document-level number_headers metadata into active editor state
  useEffect(() => {
    if (document && document.id === documentId) {
      setNumberHeaders(Boolean(document.number_headers));
    }
  }, [document?.id, document?.number_headers, documentId, setNumberHeaders]);

  const handleToggleNumberHeaders = async () => {
    if (!document) return;
    const next = !numberHeaders;
    setNumberHeaders(next);
    try {
      await updateDocument(document.id, { number_headers: next });
      queryClient.setQueryData<DocumentRecord>(['document', document.id], (old) =>
        old ? { ...old, number_headers: next } : old
      );
    } catch (err) {
      console.error('Failed to update document number_headers metadata', err);
    }
  };

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
        <div className="pt-2">
          <button
            onClick={() => {
              closeTab(documentId);
              const nextActive = useWorkspaceStore.getState().activeTabId;
              if (nextActive) {
                navigate(`/documents/${nextActive}`);
              } else {
                navigate('/');
              }
            }}
            className="px-3.5 py-1.5 bg-cme-bg-surface hover:bg-cme-bg-hover border border-cme-border-base rounded-lg text-xs font-medium text-cme-text-base transition-colors shadow-sm"
            data-testid="close-not-found-tab-btn"
          >
            Close Tab & Return
          </button>
        </div>
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
            {isEditingTitle ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleSubmit();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  onBlur={handleTitleSubmit}
                  className="text-xl md:text-2xl font-bold tracking-tight text-cme-text-base bg-cme-bg-subtle border border-cme-primary rounded-lg px-2 py-0.5 focus:outline-none"
                  data-testid="editor-title-rename-input"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 group min-w-0">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-cme-text-base truncate">
                  {document.title || 'Untitled Document'}
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setTitleInput(document.title || '');
                    setIsEditingTitle(true);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-opacity flex-shrink-0"
                  title="Rename document"
                  data-testid="editor-title-rename-btn"
                >
                  <Edit2 className="w-3.5 h-3.5 text-cme-text-subtle hover:text-cme-primary" />
                </button>
              </div>
            )}
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
              title="Toggle Review Panel"
              data-testid="toggle-reviews-btn"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Review Panel</span>
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

            {document.is_bundle && (
              <button
                onClick={() => setShowAssets(!showAssets)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  showAssets
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
                }`}
                title="Toggle Bundle Assets Media Drawer"
                data-testid="editor-assets-toggle"
              >
                <Package className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Assets</span>
              </button>
            )}

            <button
              onClick={() => setShowAcl(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover text-xs font-medium transition-colors"
              title="Manage Document Access Control & Permissions"
              data-testid="editor-access-btn"
            >
              <Shield className="w-3.5 h-3.5 text-blue-500" />
              <span className="hidden sm:inline">Access</span>
            </button>

            <Link
              to={`/docs/${document.id}`}
              onClick={() => setViewMode('read')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
              title="Switch to Reader View"
              data-testid="switch-to-reader-btn"
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
          <button
            type="button"
            data-testid="convert-document-btn"
            disabled={convertMutation.isPending}
            onClick={() => {
              if (document) {
                convertMutation.mutate(document.id);
              }
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-cme-text-muted hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 border border-cme-border-base transition-colors"
            title={document.is_bundle ? 'Convert bundle to document' : 'Convert document to bundle'}
          >
            <RefreshCw className={`w-3 h-3 text-purple-500 ${convertMutation.isPending ? 'animate-spin' : ''}`} />
            <span>{document.is_bundle ? 'Convert to Doc' : 'Convert to Bundle'}</span>
          </button>
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
            onChange={(content) => {
              setLiveContent(content);
              if (document?.path) {
                updateCachedDocumentHeadings(document.path, content);
              }
            }}
            onCursorLineChange={setCursorLine}
            onEditorReady={handleEditorReady}
            autoFocus={isPrimary ? 'end' : false}
            documentPath={document?.path}
            onToggleNumberHeaders={handleToggleNumberHeaders}
          />
        </div>

        {/* Right Docked Table of Contents (TOC) Sidebar */}
        {showOutline && (
          <aside
            style={{ width: `${outlineWidth || 256}px` }}
            className="relative border border-cme-border-base rounded-xl bg-cme-bg-surface flex-shrink-0 overflow-hidden flex flex-col shadow-sm"
            data-testid="editor-outline-sidebar"
          >
            {/* Left-edge Resize Handle */}
            <div
              onMouseDown={handleOutlineResizeStart}
              className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 transition-colors ${
                isResizingOutline ? 'bg-cme-primary' : 'hover:bg-cme-primary/50'
              }`}
              title="Drag to resize outline"
              data-testid="outline-resizer"
            />
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
              <DocumentOutline
                markdown={liveContent !== undefined ? liveContent : document.content}
                cursorLine={cursorLine}
                onSelectHeading={(id) => {
                  scrollToHeading(id);
                }}
              />
            </div>
          </aside>
        )}

        {/* Review Sidebar */}
        {isSidebarOpen && (
          <ReviewSidebar
            onScrollToAnchor={handleScrollToAnchor}
            onApplyReplacement={handleApplyReplacement}
          />
        )}

        {/* Bundle Assets Drawer */}
        {showAssets && (
          <BundleAssetsSidebar
            documentId={document.id}
            onClose={() => setShowAssets(false)}
            onInsert={(markdown) => {
              try {
                let ed = editorInstance;
                if (!ed || ed.isDestroyed) {
                  const domEl =
                    typeof window !== 'undefined'
                      ? window.document.querySelector('.collaborative-editor-root .ProseMirror')
                      : null;
                  ed = (domEl as any)?.__tiptapEditor;
                }
                if (ed && !ed.isDestroyed) {
                  if (typeof ed.commands?.insertContent === 'function') {
                    ed.commands.insertContent(markdown);
                    ed.commands.focus();
                    return;
                  }
                  const view = ed.getView?.() || (ed as any).view;
                  if (view) {
                    const { from } = view.state.selection.main;
                    view.dispatch({
                      changes: { from, insert: markdown },
                      selection: { anchor: from + markdown.length },
                    });
                    view.focus();
                    return;
                  }
                }
              } catch (e) {
                console.warn('[EditorPane] onInsert asset warning:', e);
              }
            }}
          />
        )}
      </div>

      {/* Access Control Modal */}
      {showAcl && (
        <AccessControlModal
          isOpen={showAcl}
          onClose={() => setShowAcl(false)}
          targetType="DOCUMENT"
          targetId={document.id}
          title={document.title || document.path}
        />
      )}
    </div>
  );
};
