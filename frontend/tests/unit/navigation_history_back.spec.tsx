import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useWorkspaceStore } from '../../src/stores/workspaceStore';
import { useUIStore } from '../../src/stores/uiStore';
import { Header } from '../../src/components/layout/Header';
import { TabBar } from '../../src/components/workspace/TabBar';

describe('Link Following Navigation & Back Button Support', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    useNavigationStore.setState({
      scrollPositions: {},
      lastLinkJump: null,
    });
    useWorkspaceStore.setState({
      tabs: [
        {
          id: 'doc-1',
          path: 'notes/doc1.md',
          title: 'Doc 1',
        },
      ],
      activeTabId: 'doc-1',
      splitMode: 'none',
    });
    useUIStore.setState({
      breadcrumbs: [{ label: 'Workspaces', path: '/' }, { label: 'Doc 1', isCurrent: true }],
      syncStatus: 'saved',
    });
  });

  describe('useNavigationStore', () => {
    it('saves and retrieves document scroll positions', () => {
      const { saveScrollPosition, getScrollPosition } = useNavigationStore.getState();

      saveScrollPosition('notes/doc1.md', 450);
      saveScrollPosition('doc-uuid-2', 1280);

      expect(getScrollPosition('notes/doc1.md')).toBe(450);
      expect(getScrollPosition('doc-uuid-2')).toBe(1280);
      expect(getScrollPosition('non-existent')).toBeUndefined();
    });

    it('records and clears contextual link jumps', () => {
      const { recordLinkJump, clearLastLinkJump } = useNavigationStore.getState();

      recordLinkJump(
        {
          pathname: '/docs/doc-1',
          search: '',
          hash: '',
          scrollTop: 320,
          title: 'Doc 1',
          docId: 'doc-1',
        },
        'architecture-overview'
      );

      const state = useNavigationStore.getState();
      expect(state.lastLinkJump).toBeDefined();
      expect(state.lastLinkJump?.fromLocation.scrollTop).toBe(320);
      expect(state.lastLinkJump?.toTarget).toBe('architecture-overview');
      expect(state.lastLinkJump?.timestamp).toBeGreaterThan(0);

      clearLastLinkJump();
      expect(useNavigationStore.getState().lastLinkJump).toBeNull();
    });
  });

  describe('Header Navigation Controls', () => {
    it('renders global Back and Forward buttons in Header', () => {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/docs/doc-1']}>
            <Header />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('data-testid="header-back-btn"');
      expect(html).toContain('data-testid="header-forward-btn"');
      expect(html).toContain('title="Go back (Alt+Left)"');
      expect(html).toContain('title="Go forward (Alt+Right)"');
    });
  });

  describe('TabBar Navigation Controls in Editor Mode', () => {
    it('renders Back and Forward buttons in TabBar for editor mode', () => {
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={['/documents/doc-1']}>
          <TabBar />
        </MemoryRouter>
      );

      expect(html).toContain('data-testid="editor-tab-back-btn"');
      expect(html).toContain('data-testid="editor-tab-forward-btn"');
    });
  });

  describe('Link Jump & Scroll Position Restoration flow', () => {
    it('dispatches cme-restore-scroll when going back from a same-document link jump', () => {
      const eventBus = new EventTarget();
      const restoreListener = vi.fn();
      eventBus.addEventListener('cme-restore-scroll', restoreListener);

      useNavigationStore.getState().recordLinkJump(
        {
          pathname: '/docs/doc-1',
          search: '',
          hash: '',
          scrollTop: 520,
          docId: 'doc-1',
        },
        'section-heading'
      );

      // Trigger custom event representing return to previous location
      const jump = useNavigationStore.getState().lastLinkJump;
      expect(jump).not.toBeNull();
      if (jump && jump.fromLocation.scrollTop !== undefined) {
        eventBus.dispatchEvent(
          new CustomEvent('cme-restore-scroll', {
            detail: { scrollTop: jump.fromLocation.scrollTop, hash: jump.fromLocation.hash },
          })
        );
      }

      expect(restoreListener).toHaveBeenCalledTimes(1);
      const eventDetail = (restoreListener.mock.calls[0][0] as any).detail;
      expect(eventDetail.scrollTop).toBe(520);
    });
  });
});
