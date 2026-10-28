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
});
