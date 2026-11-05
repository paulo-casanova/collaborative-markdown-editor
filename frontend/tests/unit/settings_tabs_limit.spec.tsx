import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../../src/pages/SettingsPage';
import { useWorkspaceStore } from '../../src/stores/workspaceStore';
import { useUIStore } from '../../src/stores/uiStore';

describe('SettingsPage Tab Limit & Reader Mode transitions', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    useWorkspaceStore.setState({
      tabs: [],
      activeTabId: null,
      splitMode: 'none',
      secondaryTabId: null,
      maxOpenTabs: 2,
      userTabLimits: {},
    });
    useUIStore.setState({
      breadcrumbs: [],
      viewMode: 'edit',
    });
  });

  it('renders Editor Preferences with Max Open Tabs input and Save Limit button', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('Editor Preferences');
    expect(html).toContain('Max Open Tabs');
    expect(html).toContain('data-testid="max-tabs-input"');
    expect(html).toContain('data-testid="save-tab-limit-btn"');
    expect(html).toContain('value="2"');
  });

  it('renders updated maxOpenTabs value when set to 4', () => {
    useWorkspaceStore.setState({ maxOpenTabs: 4 });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('value="4"');
  });

  it('handles per-user preference and pruning when setMaxOpenTabs is called', () => {
    const ws = useWorkspaceStore.getState();

    // Open two tabs
    ws.openTab({ id: 'doc-1', path: 'doc-1.md', title: 'Doc 1' });
    ws.openTab({ id: 'doc-2', path: 'doc-2.md', title: 'Doc 2' });
    expect(useWorkspaceStore.getState().tabs).toHaveLength(2);

    // Save preference as 1 for current user
    ws.setMaxOpenTabs(1, 'test-user');
    expect(useWorkspaceStore.getState().maxOpenTabs).toBe(1);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().userTabLimits['test-user']).toBe(1);

    // Switching to reader mode closes all tabs
    ws.closeAllTabs();
    expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
    expect(useWorkspaceStore.getState().activeTabId).toBeNull();
  });
});
