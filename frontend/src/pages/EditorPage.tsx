import React, { useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { fetchDocumentByPath } from '../api/documents';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { TabBar } from '../components/workspace/TabBar';
import { EditorPane } from '../components/workspace/EditorPane';

export const EditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    tabs,
    activeTabId,
    splitMode,
    secondaryTabId,
    splitRatio,
    openTab,
    closeTab,
    setSplitRatio,
    closeSplit,
  } = useWorkspaceStore();

  const isDraggingSplitter = useRef(false);

  const pathParam = searchParams.get('path');
  const isByPath =
    location.pathname === '/documents/by-path' ||
    location.pathname.startsWith('/documents/by-path/') ||
    id === 'by-path';

  // If accessed via /documents/by-path?path=..., resolve document from backend
  const {
    data: docByPath,
    isLoading: isLoadingByPath,
    isError: isErrorByPath,
    error: errorByPath,
  } = useQuery({
    queryKey: ['doc-by-path', pathParam],
    queryFn: () => {
      if (!pathParam) {
        return Promise.reject(new Error("Query parameter 'path' is required"));
      }
      return fetchDocumentByPath(pathParam);
    },
    enabled: isByPath && Boolean(pathParam),
    retry: 1,
  });

  // When document is resolved by path, register tab and replace URL with real UUID
  useEffect(() => {
    if (isByPath && docByPath?.id) {
      openTab({
        id: docByPath.id,
        path: docByPath.path,
        title: docByPath.title || 'Document',
        is_bundle: docByPath.is_bundle,
      });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      navigate(`/documents/${docByPath.id}${location.hash || ''}`, { replace: true });
    }
  }, [isByPath, docByPath, openTab, queryClient, navigate]);

  // Clean up any stale 'by-path' tab in workspaceStore
  useEffect(() => {
    if (tabs.some((t) => t.id === 'by-path')) {
      closeTab('by-path');
    }
  }, [tabs, closeTab]);

  // If a document ID is provided in the route (and not 'by-path'), ensure it's registered in open tabs
  useEffect(() => {
    if (id && id !== 'by-path') {
      openTab({
        id,
        path: id,
        title: 'Document',
      });
    }
  }, [id, openTab]);

  // Primary pane uses route id or fallback to activeTabId (filtering out 'by-path')
  const validTabs = tabs.filter((t) => t.id && t.id !== 'by-path');
  const routeDocId = id && id !== 'by-path' ? id : null;
  const storeActiveId = activeTabId && activeTabId !== 'by-path' ? activeTabId : null;
  const primaryDocId = routeDocId || storeActiveId || (validTabs.length > 0 ? validTabs[0].id : null);

  // Secondary pane uses secondaryTabId or fallback to another open tab or primaryDocId
  const secondaryDocId =
    secondaryTabId && secondaryTabId !== primaryDocId && secondaryTabId !== 'by-path'
      ? secondaryTabId
      : validTabs.find((t) => t.id !== primaryDocId)?.id || primaryDocId;

  // Splitter drag resize logic
  const handleMouseDown = () => {
    isDraggingSplitter.current = true;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSplitter.current) return;
      if (splitMode === 'vertical') {
        const ratio = e.clientX / window.innerWidth;
        setSplitRatio(ratio);
      } else if (splitMode === 'horizontal') {
        const ratio = (e.clientY - 56 - 40) / (window.innerHeight - 56 - 40);
        setSplitRatio(ratio);
      }
    };
    const handleMouseUp = () => {
      isDraggingSplitter.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const isSplitActive = splitMode !== 'none' && Boolean(secondaryDocId);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden bg-cme-bg-base">
      {/* Multi-Document Tab Bar */}
      <TabBar />

      {/* Main Editor Work Area */}
      <div className="flex-1 overflow-hidden relative">
        {isByPath ? (
          !pathParam ? (
            <div className="m-8 p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <h2 className="text-base font-semibold text-rose-600 dark:text-rose-400">
                Document Not Found
              </h2>
              <p className="text-xs text-cme-text-muted">
                Query parameter 'path' is required
              </p>
            </div>
          ) : isErrorByPath ? (
            <div className="m-8 p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <h2 className="text-base font-semibold text-rose-600 dark:text-rose-400">
                Document Not Found
              </h2>
              <p className="text-xs text-cme-text-muted">
                {(errorByPath as any)?.message || `Could not find document at path: ${pathParam}`}
              </p>
            </div>
          ) : isLoadingByPath ? (
            <div className="p-6 md:p-8 space-y-4 animate-pulse">
              <div className="h-8 bg-cme-bg-subtle rounded-lg w-1/3" />
              <div className="h-4 bg-cme-bg-subtle rounded w-1/4" />
              <div className="h-64 bg-cme-bg-subtle rounded-xl mt-6" />
            </div>
          ) : (
            <div className="p-6 md:p-8 space-y-4 animate-pulse">
              <div className="h-8 bg-cme-bg-subtle rounded-lg w-1/3" />
              <div className="h-4 bg-cme-bg-subtle rounded w-1/4" />
              <div className="h-64 bg-cme-bg-subtle rounded-xl mt-6" />
            </div>
          )
        ) : !primaryDocId ? (
          <div className="h-full flex items-center justify-center p-8 text-center text-xs text-cme-text-muted">
            No document selected. Open a file from the workspace explorer.
          </div>
        ) : !isSplitActive ? (
          // Single-Pane View
          <div className="h-full overflow-hidden">
            <EditorPane documentId={primaryDocId} isPrimary={true} />
          </div>
        ) : splitMode === 'vertical' ? (
          // Dual-Pane Vertical Split (Side-by-Side)
          <div
            className="h-full flex flex-row overflow-hidden"
            data-testid="split-view-container"
          >
            {/* Primary Left Pane */}
            <div
              style={{ width: `${splitRatio * 100}%` }}
              className="h-full overflow-hidden border-r border-cme-border-base"
              data-testid="primary-pane-wrapper"
            >
              <EditorPane
                documentId={primaryDocId}
                paneLabel="Left Pane"
                isPrimary={true}
              />
            </div>

            {/* Splitter Resizer */}
            <div
              onMouseDown={handleMouseDown}
              className="w-1.5 hover:w-2 bg-cme-border-base/60 hover:bg-cme-primary cursor-col-resize transition-all flex-shrink-0 z-20"
              title="Drag to resize split panes"
              data-testid="vertical-splitter"
            />

            {/* Secondary Right Pane */}
            <div
              className="flex-1 h-full overflow-hidden"
              data-testid="secondary-pane-wrapper"
            >
              <EditorPane
                documentId={secondaryDocId!}
                paneLabel="Right Pane"
                onClosePane={closeSplit}
                isPrimary={false}
              />
            </div>
          </div>
        ) : (
          // Dual-Pane Horizontal Split (Top-and-Bottom)
          <div
            className="h-full flex flex-col overflow-hidden"
            data-testid="split-view-container"
          >
            {/* Primary Top Pane */}
            <div
              style={{ height: `${splitRatio * 100}%` }}
              className="w-full overflow-y-auto border-b border-cme-border-base"
              data-testid="primary-pane-wrapper"
            >
              <EditorPane
                documentId={primaryDocId}
                paneLabel="Top Pane"
                isPrimary={true}
              />
            </div>

            {/* Splitter Resizer */}
            <div
              onMouseDown={handleMouseDown}
              className="h-1.5 hover:h-2 bg-cme-border-base/60 hover:bg-cme-primary cursor-row-resize transition-all flex-shrink-0 z-20"
              title="Drag to resize split panes"
              data-testid="horizontal-splitter"
            />

            {/* Secondary Bottom Pane */}
            <div
              className="flex-1 w-full overflow-y-auto"
              data-testid="secondary-pane-wrapper"
            >
              <EditorPane
                documentId={secondaryDocId!}
                paneLabel="Bottom Pane"
                onClosePane={closeSplit}
                isPrimary={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
