import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  GoToPermalinkModal,
  parsePermalinkInput,
} from '../../src/components/navigation/GoToPermalinkModal';
import { useUIStore } from '../../src/stores/uiStore';
import { useWorkspaceStore } from '../../src/stores/workspaceStore';

describe('GoToPermalinkModal & parsePermalinkInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({
      goToPermalinkModalOpen: false,
      viewMode: 'edit',
    });
    useWorkspaceStore.setState({
      tabs: [
        { id: 'doc-1', path: 'notes/first.md', title: 'First Doc', isPinned: false, isDirty: false },
      ],
      activeTabId: 'doc-1',
    });
  });

  describe('parsePermalinkInput URL & identifier parsing', () => {
    it('parses full HTTP/HTTPS document URL with anchor', () => {
      const res = parsePermalinkInput(
        'http://localhost:8080/documents/7027d704-5d9c-4835-ab35-3b999cf3a568#overview'
      );
      expect(res).toEqual({
        documentId: '7027d704-5d9c-4835-ab35-3b999cf3a568',
        mode: 'documents',
        hash: '#overview',
      });
    });

    it('parses reader mode URL correctly', () => {
      const res = parsePermalinkInput(
        'https://cme.example.com/docs/7027d704-5d9c-4835-ab35-3b999cf3a568'
      );
      expect(res).toEqual({
        documentId: '7027d704-5d9c-4835-ab35-3b999cf3a568',
        mode: 'docs',
        hash: '',
      });
    });

    it('parses plain UUID string', () => {
      const res = parsePermalinkInput('7027d704-5d9c-4835-ab35-3b999cf3a568');
      expect(res).toEqual({
        documentId: '7027d704-5d9c-4835-ab35-3b999cf3a568',
        mode: undefined,
        hash: '',
      });
    });

    it('parses by-path query permalinks', () => {
      const res = parsePermalinkInput('/documents/by-path?path=specs/architecture.md');
      expect(res).toEqual({
        path: 'specs/architecture.md',
        mode: 'documents',
        hash: '',
      });
    });

    it('parses relative path string', () => {
      const res = parsePermalinkInput('guides/intro.md');
      expect(res).toEqual({
        path: 'guides/intro.md',
        mode: undefined,
        hash: '',
      });
    });

    it('parses directory dashboard permalink', () => {
      const res = parsePermalinkInput('http://localhost:8080/documents/dir:guides');
      expect(res).toEqual({
        documentId: 'dir:guides',
        mode: 'documents',
        hash: '',
      });
    });

    it('returns null for empty or invalid input', () => {
      expect(parsePermalinkInput('')).toBeNull();
      expect(parsePermalinkInput('   ')).toBeNull();
    });
  });

  describe('GoToPermalinkModal rendering & workspace tab management', () => {
    it('returns null when modal is closed', () => {
      useUIStore.setState({ goToPermalinkModalOpen: false });

      const html = renderToStaticMarkup(
        <MemoryRouter>
          <GoToPermalinkModal />
        </MemoryRouter>
      );

      expect(html).toBe('');
    });

    it('renders modal dialog when open with input and current tab checkbox', () => {
      useUIStore.setState({ goToPermalinkModalOpen: true });

      const html = renderToStaticMarkup(
        <MemoryRouter>
          <GoToPermalinkModal />
        </MemoryRouter>
      );

      expect(html).toContain('data-testid="goto-permalink-modal"');
      expect(html).toContain('data-testid="goto-permalink-input"');
      expect(html).toContain('data-testid="goto-permalink-use-current-tab-checkbox"');
      expect(html).toContain('Go to Permalink');
      expect(html).toContain('Open in current workspace tab');
    });

    it('supports replaceActiveTab to use the current workspace tab in place', () => {
      const { replaceActiveTab } = useWorkspaceStore.getState();

      expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
      expect(useWorkspaceStore.getState().activeTabId).toBe('doc-1');

      // Replace current unpinned tab with new document
      replaceActiveTab({
        id: 'doc-2',
        path: 'notes/second.md',
        title: 'Second Doc',
        is_bundle: false,
      });

      const updatedTabs = useWorkspaceStore.getState().tabs;
      expect(updatedTabs).toHaveLength(1);
      expect(updatedTabs[0].id).toBe('doc-2');
      expect(updatedTabs[0].title).toBe('Second Doc');
      expect(useWorkspaceStore.getState().activeTabId).toBe('doc-2');
    });

    it('opens in a new tab if current tab is pinned or openTab is chosen', () => {
      const { openTab, togglePinTab, replaceActiveTab } = useWorkspaceStore.getState();

      // Pin the active tab
      togglePinTab('doc-1');
      expect(useWorkspaceStore.getState().tabs[0].isPinned).toBe(true);

      // replaceActiveTab on a pinned tab preserves the pinned tab and opens a new one
      replaceActiveTab({
        id: 'doc-3',
        path: 'notes/third.md',
        title: 'Third Doc',
        is_bundle: false,
      });

      const tabs = useWorkspaceStore.getState().tabs;
      expect(tabs).toHaveLength(2);
      expect(tabs[0].id).toBe('doc-1');
      expect(tabs[1].id).toBe('doc-3');
      expect(useWorkspaceStore.getState().activeTabId).toBe('doc-3');
    });
  });
});
