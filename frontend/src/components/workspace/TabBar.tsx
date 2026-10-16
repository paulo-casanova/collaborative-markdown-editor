import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Package,
  X,
  Pin,
  Columns2,
  Rows2,
  Maximize2,
  Copy,
  ChevronRight,
} from 'lucide-react';
import { useWorkspaceStore, WorkspaceTab } from '../../stores/workspaceStore';
import { useUIStore } from '../../stores/uiStore';

interface TabContextMenuState {
  x: number;
  y: number;
  tab: WorkspaceTab;
}

export const TabBar: React.FC = () => {
  const navigate = useNavigate();
  const { viewMode } = useUIStore();
  const baseDocRoute = viewMode === 'read' ? '/docs' : '/documents';
  const {
    tabs,
    activeTabId,
    splitMode,
    secondaryTabId,
    setActiveTabId,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    reorderTabs,
    togglePinTab,
    setSplitMode,
    closeSplit,
  } = useWorkspaceStore();

  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null);
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Keyboard shortcuts: Ctrl+W to close active tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeTabId) {
          handleClose(activeTabId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId]);

  const handleTabClick = (tab: WorkspaceTab) => {
    setActiveTabId(tab.id);
    navigate(`${baseDocRoute}/${tab.id}`);
  };

  const handleClose = (tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const tabToClose = tabs.find((t) => t.id === tabId);
    if (tabToClose?.isDirty) {
      if (!confirm(`Document "${tabToClose.title}" has unsaved edits. Close anyway?`)) {
        return;
      }
    }

    closeTab(tabId);

    // If closing active tab, navigate to the newly activated tab if exists
    if (activeTabId === tabId) {
      const nextActive = useWorkspaceStore.getState().activeTabId;
      if (nextActive) {
        navigate(`${baseDocRoute}/${nextActive}`);
      } else {
        navigate('/');
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, tab: WorkspaceTab) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tab,
    });
  };

  // Drag and Drop reordering
  const handleDragStart = (e: React.DragEvent, index: number, tab: WorkspaceTab) => {
    setDraggedTabIndex(index);
    e.dataTransfer.setData('text/plain', tab.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedTabIndex !== null && draggedTabIndex !== targetIndex) {
      reorderTabs(draggedTabIndex, targetIndex);
    }
    setDraggedTabIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedTabIndex(null);
    setDragOverIndex(null);
  };

  const displayTabs = tabs.filter((t) => t.id && t.id !== 'by-path');
  if (displayTabs.length === 0) return null;

  return (
    <div
      className="h-10 border-b border-cme-border-base bg-cme-bg-surface flex items-center justify-between px-2 select-none z-30"
      data-testid="workspace-tabbar"
    >
      {/* Scrollable Tab Strip */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 h-full py-1 pr-2">
        {displayTabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const isSecondary = splitMode !== 'none' && tab.id === secondaryTabId;
          const isDraggingOver = dragOverIndex === idx;

          return (
            <div
              key={tab.id}
              draggable={!tab.isPinned}
              onDragStart={(e) => handleDragStart(e, idx, tab)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              onClick={() => handleTabClick(tab)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
              className={`group flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg cursor-pointer transition-all border max-w-[200px] truncate ${
                isDraggingOver ? 'border-cme-primary border-dashed' : ''
              } ${
                isActive
                  ? 'bg-cme-bg-base border-cme-border-base text-cme-text-base font-medium shadow-sm'
                  : isSecondary
                  ? 'bg-cme-primary/10 border-cme-primary/30 text-cme-primary'
                  : 'bg-transparent border-transparent text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
              }`}
              title={`${tab.title} (${tab.path})`}
              data-testid={`workspace-tab-${tab.id}`}
            >
              {/* Tab Icon */}
              {tab.isPinned ? (
                <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />
              ) : tab.is_bundle ? (
                <Package className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
              )}

              {/* Title */}
              <span className="truncate flex-1 text-xs">{tab.title || tab.path}</span>

              {/* Dirty Indicator */}
              {tab.isDirty && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"
                  title="Unsaved changes"
                />
              )}

              {/* Close Button */}
              {!tab.isPinned && (
                <button
                  onClick={(e) => handleClose(tab.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted hover:text-cme-text-base transition-opacity ml-1"
                  title="Close tab (Ctrl+W)"
                  data-testid={`close-tab-${tab.id}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Right Controls: Split Layout Toggles */}
      <div className="flex items-center gap-1 border-l border-cme-border-base pl-2 flex-shrink-0">
        <button
          onClick={() => setSplitMode(splitMode === 'vertical' ? 'none' : 'vertical')}
          className={`p-1.5 rounded-lg border transition-colors ${
            splitMode === 'vertical'
              ? 'bg-cme-primary text-white border-cme-primary shadow-sm'
              : 'border-transparent text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          title={splitMode === 'vertical' ? 'Close Vertical Split' : 'Split Right (Vertical)'}
          data-testid="split-vertical-btn"
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setSplitMode(splitMode === 'horizontal' ? 'none' : 'horizontal')}
          className={`p-1.5 rounded-lg border transition-colors ${
            splitMode === 'horizontal'
              ? 'bg-cme-primary text-white border-cme-primary shadow-sm'
              : 'border-transparent text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          title={splitMode === 'horizontal' ? 'Close Horizontal Split' : 'Split Down (Horizontal)'}
          data-testid="split-horizontal-btn"
        >
          <Rows2 className="w-3.5 h-3.5" />
        </button>

        {splitMode !== 'none' && (
          <button
            onClick={closeSplit}
            className="p-1.5 rounded-lg border border-transparent text-cme-text-muted hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            title="Close Split View"
            data-testid="close-split-btn"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Tab Context Menu */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-48 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl py-1 text-xs select-none backdrop-blur-md"
          data-testid="tab-context-menu"
        >
          <button
            onClick={() => {
              handleClose(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
          >
            <X className="w-3.5 h-3.5 text-rose-500" />
            <span>Close Tab</span>
          </button>
          <button
            onClick={() => {
              closeOtherTabs(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
          >
            <Maximize2 className="w-3.5 h-3.5 text-cme-text-muted" />
            <span>Close Other Tabs</span>
          </button>
          <button
            onClick={() => {
              closeTabsToRight(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
          >
            <ChevronRight className="w-3.5 h-3.5 text-cme-text-muted" />
            <span>Close Tabs to Right</span>
          </button>

          <div className="my-1 border-t border-cme-border-base" />

          <button
            onClick={() => {
              setSplitMode('vertical', contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
            data-testid="context-split-right"
          >
            <Columns2 className="w-3.5 h-3.5 text-cme-primary" />
            <span>Split Right</span>
          </button>

          <button
            onClick={() => {
              togglePinTab(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
          >
            <Pin className="w-3.5 h-3.5 text-amber-500" />
            <span>{contextMenu.tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}</span>
          </button>

          <button
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.tab.path);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
          >
            <Copy className="w-3.5 h-3.5 text-sky-500" />
            <span>Copy Document Path</span>
          </button>
        </div>
      )}
    </div>
  );
};
