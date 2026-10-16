import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/stores/workspaceStore';
import { useUIStore } from '../../src/stores/uiStore';

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
});
