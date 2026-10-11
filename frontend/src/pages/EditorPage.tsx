import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { TabBar } from '../components/workspace/TabBar';
import { EditorPane } from '../components/workspace/EditorPane';

export const EditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const {
    tabs,
    activeTabId,
    splitMode,
    secondaryTabId,
    splitRatio,
    openTab,
    setSplitRatio,
    closeSplit,
  } = useWorkspaceStore();

  const isDraggingSplitter = useRef(false);

  // If a document ID is provided in the route, ensure it's registered in the open tabs
  useEffect(() => {
    if (id) {
      openTab({
        id,
        path: id,
        title: 'Document',
      });
    }
  }, [id, openTab]);

  // Primary pane uses route id or fallback to activeTabId
  const primaryDocId = id || activeTabId || (tabs.length > 0 ? tabs[0].id : null);
  // Secondary pane uses secondaryTabId or fallback to another open tab or primaryDocId
  const secondaryDocId =
    secondaryTabId && secondaryTabId !== primaryDocId
      ? secondaryTabId
      : tabs.find((t) => t.id !== primaryDocId)?.id || primaryDocId;

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
        {!primaryDocId ? (
          <div className="h-full flex items-center justify-center p-8 text-center text-xs text-cme-text-muted">
            No document selected. Open a file from the workspace explorer.
          </div>
        ) : !isSplitActive ? (
          // Single-Pane View
          <div className="h-full overflow-y-auto">
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
              className="h-full overflow-y-auto border-r border-cme-border-base"
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
              className="flex-1 h-full overflow-y-auto"
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
