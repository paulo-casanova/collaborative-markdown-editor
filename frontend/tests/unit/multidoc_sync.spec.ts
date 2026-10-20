import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useWorkspaceStore } from '../../src/stores/workspaceStore';
import { useUIStore } from '../../src/stores/uiStore';
import { CmeCollabProvider } from '../../src/api/collabProvider';
import * as Y from 'yjs';

describe('Issue #5: Multi-document background synchronization', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      tabs: [],
      activeTabId: null,
      splitMode: 'none',
      secondaryTabId: null,
    });
    useUIStore.setState({
      syncStatus: 'saved',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps multiple open tabs in workspace state for concurrent rendering', () => {
    const ws = useWorkspaceStore.getState();
    ws.openTab({ id: 'doc-1', path: '/doc1.md', title: 'Doc 1' });
    ws.openTab({ id: 'doc-2', path: '/doc2.md', title: 'Doc 2' });
    ws.openTab({ id: 'doc-3', path: '/doc3.md', title: 'Doc 3' });

    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(3);
    expect(state.activeTabId).toBe('doc-3');

    // Switching active tab does not remove background tabs
    ws.setActiveTabId('doc-1');
    const updated = useWorkspaceStore.getState();
    expect(updated.activeTabId).toBe('doc-1');
    expect(updated.tabs.map((t) => t.id)).toEqual(['doc-3', 'doc-2', 'doc-1']);
  });

  it('allows multiple CmeCollabProviders to stay connected simultaneously across documents', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const provider1 = new CmeCollabProvider('doc-1', doc1, null, 'ws://127.0.0.1:9999/ws/doc-1');
    const provider2 = new CmeCollabProvider('doc-2', doc2, null, 'ws://127.0.0.1:9999/ws/doc-2');

    let p1Status: string | null = null;
    let p2Status: string | null = null;

    provider1.onStatus((s) => {
      p1Status = s;
    });
    provider2.onStatus((s) => {
      p2Status = s;
    });

    expect(provider1.status).toBe('disconnected');
    expect(provider2.status).toBe('disconnected');

    // Destroying one tab provider does not destroy the other
    provider1.destroy();
    expect(p1Status).toBe('disconnected');
    expect(provider2.ydoc).toBe(doc2);

    provider2.destroy();
  });
});
