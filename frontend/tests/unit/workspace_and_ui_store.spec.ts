import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useWorkspaceStore } from '../../src/stores/workspaceStore';
import { useUIStore } from '../../src/stores/uiStore';
import { useReviewStore } from '../../src/stores/reviewStore';
import { searchDocuments } from '../../src/api/documents';

describe('WorkspaceStore & UIStore behavior', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      tabs: [],
      activeTabId: null,
      splitMode: 'none',
      secondaryTabId: null,
      splitRatio: 0.5,
      outlineWidth: 256,
      maxOpenTabs: 2,
      userTabLimits: {},
    });
    useUIStore.setState({
      viewMode: 'edit',
    });
  });

  it('preserves existing real tab title and path when openTab is called with placeholder "Document"', () => {
    const docId = 'c2c9dc14-c950-48cc-80be-be90c20743f7';
    useWorkspaceStore.getState().openTab({
      id: docId,
      path: 'specs/Test File Modified.md',
      title: 'Test File Modified',
    });

    expect(useWorkspaceStore.getState().tabs[0].title).toBe('Test File Modified');
    expect(useWorkspaceStore.getState().tabs[0].path).toBe('specs/Test File Modified.md');

    // Simulate EditorPage route effect calling openTab with placeholder metadata
    useWorkspaceStore.getState().openTab({
      id: docId,
      path: docId,
      title: 'Document',
    });

    const tab = useWorkspaceStore.getState().tabs[0];
    expect(tab.title).toBe('Test File Modified');
    expect(tab.path).toBe('specs/Test File Modified.md');
  });

  it('updates tab title when openTab is called with a new real title', () => {
    const docId = 'c2c9dc14-c950-48cc-80be-be90c20743f7';
    useWorkspaceStore.getState().openTab({
      id: docId,
      path: docId,
      title: 'Document',
    });
    expect(useWorkspaceStore.getState().tabs[0].title).toBe('Document');

    useWorkspaceStore.getState().openTab({
      id: docId,
      path: 'specs/Test File Modified.md',
      title: 'Test File Modified',
    });
    expect(useWorkspaceStore.getState().tabs[0].title).toBe('Test File Modified');
    expect(useWorkspaceStore.getState().tabs[0].path).toBe('specs/Test File Modified.md');
  });

  it('updates and clamps outlineWidth between 180 and 600', () => {
    expect(useWorkspaceStore.getState().outlineWidth).toBe(256);

    useWorkspaceStore.getState().setOutlineWidth(340);
    expect(useWorkspaceStore.getState().outlineWidth).toBe(340);

    useWorkspaceStore.getState().setOutlineWidth(100);
    expect(useWorkspaceStore.getState().outlineWidth).toBe(180);

    useWorkspaceStore.getState().setOutlineWidth(900);
    expect(useWorkspaceStore.getState().outlineWidth).toBe(600);
  });

  it('stores universal viewMode and clamps sidebarWidth in UIStore', () => {
    expect(useUIStore.getState().viewMode).toBe('edit');
    useUIStore.getState().setViewMode('read');
    expect(useUIStore.getState().viewMode).toBe('read');
    useUIStore.getState().setViewMode('edit');
    expect(useUIStore.getState().viewMode).toBe('edit');

    useUIStore.getState().setSidebarWidth(320);
    expect(useUIStore.getState().sidebarWidth).toBe(320);
    useUIStore.getState().setSidebarWidth(120);
    expect(useUIStore.getState().sidebarWidth).toBe(180);
    useUIStore.getState().setSidebarWidth(800);
    expect(useUIStore.getState().sidebarWidth).toBe(600);
  });

  it('supports opening and persisting directory tabs with is_directory flag', () => {
    useWorkspaceStore.getState().openTab({
      id: 'dir:engineering/specs',
      path: 'engineering/specs',
      title: 'specs',
      is_directory: true,
    });

    const tabs = useWorkspaceStore.getState().tabs;
    expect(tabs.length).toBe(1);
    expect(tabs[0].id).toBe('dir:engineering/specs');
    expect(tabs[0].path).toBe('engineering/specs');
    expect(tabs[0].title).toBe('specs');
    expect(tabs[0].is_directory).toBe(true);

    // Re-opening the directory tab preserves is_directory
    useWorkspaceStore.getState().openTab({
      id: 'dir:engineering/specs',
      path: 'engineering/specs',
      title: 'specs',
    });
    expect(useWorkspaceStore.getState().tabs[0].is_directory).toBe(true);
  });

  it('supports bundle documents with is_bundle flag', () => {
    useWorkspaceStore.getState().openTab({
      id: 'bundle-uuid-1234',
      path: 'docs/architecture.bundle',
      title: 'Architecture',
      is_bundle: true,
    });

    const tabs = useWorkspaceStore.getState().tabs;
    expect(tabs[0].is_bundle).toBe(true);
  });

  it('manages document-level numberHeaders in UIStore', () => {
    expect(useUIStore.getState().numberHeaders).toBe(false);

    useUIStore.getState().setNumberHeaders(true);
    expect(useUIStore.getState().numberHeaders).toBe(true);

    useUIStore.getState().toggleNumberHeaders();
    expect(useUIStore.getState().numberHeaders).toBe(false);
  });

  it('updates and clamps review sidebarWidth in ReviewStore between 260 and 700', () => {
    expect(useReviewStore.getState().sidebarWidth).toBe(384);

    useReviewStore.getState().setSidebarWidth(450);
    expect(useReviewStore.getState().sidebarWidth).toBe(450);

    useReviewStore.getState().setSidebarWidth(150);
    expect(useReviewStore.getState().sidebarWidth).toBe(260);

    useReviewStore.getState().setSidebarWidth(950);
    expect(useReviewStore.getState().sidebarWidth).toBe(700);
  });

  it('manages lineNumbers in UIStore and persists to localStorage', () => {
    expect(useUIStore.getState().lineNumbers).toBe(false);

    useUIStore.getState().setLineNumbers(true);
    expect(useUIStore.getState().lineNumbers).toBe(true);

    useUIStore.getState().toggleLineNumbers();
    expect(useUIStore.getState().lineNumbers).toBe(false);
  });

  it('manages searchTitleOnly and searchModalOpen in UIStore', () => {
    expect(useUIStore.getState().searchModalOpen).toBe(false);
    expect(useUIStore.getState().searchTitleOnly).toBe(false);

    // Open search modal with titleOnly = true
    useUIStore.getState().setSearchModalOpen(true, true);
    expect(useUIStore.getState().searchModalOpen).toBe(true);
    expect(useUIStore.getState().searchTitleOnly).toBe(true);

    // Close search modal, titleOnly should remain unchanged unless overridden
    useUIStore.getState().setSearchModalOpen(false);
    expect(useUIStore.getState().searchModalOpen).toBe(false);
    expect(useUIStore.getState().searchTitleOnly).toBe(true);

    // Open search modal with titleOnly = false (All content mode)
    useUIStore.getState().setSearchModalOpen(true, false);
    expect(useUIStore.getState().searchModalOpen).toBe(true);
    expect(useUIStore.getState().searchTitleOnly).toBe(false);

    // Toggle titleOnly directly
    useUIStore.getState().setSearchTitleOnly(true);
    expect(useUIStore.getState().searchTitleOnly).toBe(true);

    // Toggle search modal with titleOnly argument
    useUIStore.getState().toggleSearchModal(false);
    expect(useUIStore.getState().searchModalOpen).toBe(false);
    expect(useUIStore.getState().searchTitleOnly).toBe(false);
  });

  it('searchDocuments API client appends title_only=true query parameter when titleOnly is specified', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ query: 'test', title_only: true, results: [] }),
      text: async () => JSON.stringify({ query: 'test', title_only: true, results: [] }),
    });
    global.fetch = fetchMock as any;

    try {
      // 1. Standard full-text search
      await searchDocuments('quantum', 'specs', 15, false);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/search?q=quantum&path=specs&limit=15',
        expect.anything()
      );

      // 2. Title-only search
      await searchDocuments('quantum', 'specs', 15, true);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/search?q=quantum&path=specs&limit=15&title_only=true',
        expect.anything()
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('supports nested directory tabs with multi-segment paths and retains them in store', () => {
    const ws = useWorkspaceStore.getState();
    const nestedDirTabId = 'dir:docs/crdt/specs';

    ws.openTab({
      id: nestedDirTabId,
      path: 'docs/crdt/specs',
      title: 'specs',
      is_directory: true,
    });

    const current = useWorkspaceStore.getState();
    expect(current.tabs).toHaveLength(1);
    expect(current.tabs[0].id).toBe(nestedDirTabId);
    expect(current.tabs[0].is_directory).toBe(true);
    expect(current.activeTabId).toBe(nestedDirTabId);
  });

  it('resolves active parent directory for creation actions from active folder or document tab', () => {
    // Helper replicating resolveActiveParentDir
    const resolveActiveParentDir = (activeNode: any): string => {
      if (activeNode) {
        if (activeNode.is_directory) return activeNode.path;
        const lastSlash = activeNode.path.lastIndexOf('/');
        return lastSlash !== -1 ? activeNode.path.substring(0, lastSlash) : '';
      }
      const { tabs, activeTabId } = useWorkspaceStore.getState();
      if (activeTabId) {
        if (activeTabId.startsWith('dir:')) {
          return activeTabId.replace(/^dir:/, '');
        }
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab?.is_directory) {
          return activeTab.path;
        }
        if (activeTab?.path) {
          const lastSlash = activeTab.path.lastIndexOf('/');
          return lastSlash !== -1 ? activeTab.path.substring(0, lastSlash) : '';
        }
      }
      return '';
    };

    const ws = useWorkspaceStore.getState();

    // 1. When a directory tab is active in workspace
    ws.openTab({
      id: 'dir:my-team-notes',
      path: 'my-team-notes',
      title: 'my-team-notes',
      is_directory: true,
    });
    expect(resolveActiveParentDir(null)).toBe('my-team-notes');

    // 2. When a nested subfolder tab is active
    ws.openTab({
      id: 'dir:engineering/specs',
      path: 'engineering/specs',
      title: 'specs',
      is_directory: true,
    });
    expect(resolveActiveParentDir(null)).toBe('engineering/specs');

    // 3. When a document tab inside a folder is active
    ws.openTab({
      id: 'doc-123',
      path: 'engineering/specs/architecture.md',
      title: 'Architecture',
    });
    expect(resolveActiveParentDir(null)).toBe('engineering/specs');

    // 4. When an explicit folder node was selected or right-clicked
    const folderNode = { name: 'guides', path: 'docs/guides', is_directory: true };
    expect(resolveActiveParentDir(folderNode)).toBe('docs/guides');

    // 5. When active tab is a root document or no folder is active
    ws.openTab({
      id: 'doc-root',
      path: 'README.md',
      title: 'README',
    });
    expect(resolveActiveParentDir(null)).toBe('');
  });

  it('directory dashboard items without id trigger by-path fallback URL resolution', () => {
    // Test the unindexed on-disk file opening URL construction logic in DirectoryView
    const itemWithoutId = {
      name: 'Unindexed.md',
      path: 'docs/crdt/Unindexed.md',
      is_directory: false,
      is_bundle: false,
      type: 'document' as const,
      comments_count: 0,
      suggestions_count: 0,
      open_tasks_count: 0,
    };

    let navigatedUrl = '';
    const mockNavigate = (url: string) => {
      navigatedUrl = url;
    };

    const handleOpenDocument = (item: typeof itemWithoutId) => {
      if (!(item as any).id) {
        mockNavigate(`/documents/by-path?path=${encodeURIComponent(item.path)}`);
        return;
      }
    };

    handleOpenDocument(itemWithoutId);
    expect(navigatedUrl).toBe('/documents/by-path?path=docs%2Fcrdt%2FUnindexed.md');
  });

  describe('Tab limit enforcement & reader mode transitions', () => {
    it('defaults maxOpenTabs to 2', () => {
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(2);
    });

    it('enforces default limit of 2 tabs when opening new documents (LRU eviction)', () => {
      const ws = useWorkspaceStore.getState();

      // Open tab 1
      ws.openTab({ id: 'doc-1', path: 'doc-1.md', title: 'Doc 1' });
      expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
      expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(['doc-1']);
      expect(useWorkspaceStore.getState().activeTabId).toBe('doc-1');

      // Open tab 2
      ws.openTab({ id: 'doc-2', path: 'doc-2.md', title: 'Doc 2' });
      expect(useWorkspaceStore.getState().tabs).toHaveLength(2);
      expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(['doc-2', 'doc-1']);
      expect(useWorkspaceStore.getState().activeTabId).toBe('doc-2');

      // Open tab 3 -> should evict the oldest unpinned tab (doc-1)
      ws.openTab({ id: 'doc-3', path: 'doc-3.md', title: 'Doc 3' });
      expect(useWorkspaceStore.getState().tabs).toHaveLength(2);
      expect(useWorkspaceStore.getState().tabs.map((t) => t.id)).toEqual(['doc-3', 'doc-2']);
      expect(useWorkspaceStore.getState().activeTabId).toBe('doc-3');

      // Re-opening an already open tab does not evict anything
      ws.openTab({ id: 'doc-2', path: 'doc-2.md', title: 'Doc 2' });
      expect(useWorkspaceStore.getState().tabs).toHaveLength(2);
      expect(useWorkspaceStore.getState().activeTabId).toBe('doc-2');
    });

    it('preserves pinned tabs over unpinned tabs when evicting at the limit', () => {
      const ws = useWorkspaceStore.getState();

      ws.openTab({ id: 'doc-1', path: 'doc-1.md', title: 'Doc 1' });
      ws.openTab({ id: 'doc-2', path: 'doc-2.md', title: 'Doc 2' });

      // Pin doc-1
      ws.togglePinTab('doc-1');
      expect(useWorkspaceStore.getState().tabs.find((t) => t.id === 'doc-1')?.isPinned).toBe(true);

      // Open doc-3: unpinned doc-2 should be evicted, pinned doc-1 is preserved
      ws.openTab({ id: 'doc-3', path: 'doc-3.md', title: 'Doc 3' });
      const currentTabs = useWorkspaceStore.getState().tabs;
      expect(currentTabs).toHaveLength(2);
      expect(currentTabs.map((t) => t.id)).toEqual(['doc-1', 'doc-3']);
      expect(currentTabs.find((t) => t.id === 'doc-1')?.isPinned).toBe(true);
    });

    it('supports user settings preference per user and prunes excess tabs when limit is decreased', () => {
      const ws = useWorkspaceStore.getState();

      // Alice sets her limit to 3
      ws.setMaxOpenTabs(3, 'alice');
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(3);

      ws.openTab({ id: 'doc-1', path: 'doc-1.md', title: 'Doc 1' });
      ws.openTab({ id: 'doc-2', path: 'doc-2.md', title: 'Doc 2' });
      ws.openTab({ id: 'doc-3', path: 'doc-3.md', title: 'Doc 3' });
      expect(useWorkspaceStore.getState().tabs).toHaveLength(3);

      // Bob logs in (has no stored preference yet) -> defaults to 2 and prunes excess
      ws.loadUserTabLimit('bob');
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(2);
      expect(useWorkspaceStore.getState().tabs).toHaveLength(2);

      // Bob sets his limit to 1 -> prunes down to 1 tab (active tab)
      ws.setMaxOpenTabs(1, 'bob');
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(1);
      expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
      expect(useWorkspaceStore.getState().activeTabId).toBe(useWorkspaceStore.getState().tabs[0].id);

      // Switching back to Alice restores her preference of 3
      ws.loadUserTabLimit('alice');
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(3);
    });

    it('clamps invalid or extreme tab limit values', () => {
      const ws = useWorkspaceStore.getState();

      ws.setMaxOpenTabs(0);
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(1);

      ws.setMaxOpenTabs(-10);
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(1);

      ws.setMaxOpenTabs(150);
      expect(useWorkspaceStore.getState().maxOpenTabs).toBe(100);
    });

    it('closes all editing tabs when closeAllTabs is called (reader mode switch)', () => {
      const ws = useWorkspaceStore.getState();

      ws.openTab({ id: 'doc-1', path: 'doc-1.md', title: 'Doc 1' });
      ws.openTab({ id: 'doc-2', path: 'doc-2.md', title: 'Doc 2' });
      ws.setSplitMode('vertical', 'doc-2');

      expect(useWorkspaceStore.getState().tabs).toHaveLength(2);
      expect(useWorkspaceStore.getState().splitMode).toBe('vertical');

      // Switch to reader mode triggers closeAllTabs
      ws.closeAllTabs();

      const state = useWorkspaceStore.getState();
      expect(state.tabs).toHaveLength(0);
      expect(state.activeTabId).toBeNull();
      expect(state.secondaryTabId).toBeNull();
      expect(state.splitMode).toBe('none');
    });
  });
});
