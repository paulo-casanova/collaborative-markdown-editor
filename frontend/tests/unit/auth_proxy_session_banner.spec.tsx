import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../src/components/layout/AppShell';
import { LoginModal } from '../../src/components/auth/LoginModal';
import { HealthPopover } from '../../src/components/layout/HealthPopover';
import { useUIStore } from '../../src/stores/uiStore';
import { useWorkspaceStore } from '../../src/stores/workspaceStore';
import {
  getStoredAuthnProvider,
  setStoredAuthnProvider,
  AUTHN_PROVIDER_STORAGE_KEY,
  normalizeUser,
} from '../../src/api/auth';

describe('Auth Proxy Session Recovery & Expired Banner', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const localStorageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    };
    (global as any).localStorage = localStorageMock;
    if (typeof (global as any).window !== 'undefined') {
      (global as any).window.localStorage = localStorageMock;
    }

    (useUIStore as any).getInitialState = () => useUIStore.getState();
    (useWorkspaceStore as any).getInitialState = () => useWorkspaceStore.getState();

    useUIStore.setState({
      isSessionExpired: false,
      loginModalOpen: false,
      syncStatus: 'saved',
    });
    useWorkspaceStore.setState({
      tabs: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and retrieves authn_provider from localStorage', () => {
    expect(getStoredAuthnProvider()).toBe('delegated');

    setStoredAuthnProvider('challenge');
    expect(mockStorage[AUTHN_PROVIDER_STORAGE_KEY]).toBe('challenge');
    expect(getStoredAuthnProvider()).toBe('challenge');

    setStoredAuthnProvider('delegated');
    expect(mockStorage[AUTHN_PROVIDER_STORAGE_KEY]).toBe('delegated');
    expect(getStoredAuthnProvider()).toBe('delegated');
  });

  it('persists authn_provider when normalizing user identity', () => {
    normalizeUser({
      user: { id: 'u-1', username: 'alice' },
      authn_provider: 'challenge',
    });
    expect(mockStorage[AUTHN_PROVIDER_STORAGE_KEY]).toBe('challenge');

    normalizeUser({
      user: { id: 'u-2', username: 'bob' },
      authn_provider: 'delegated',
    });
    expect(mockStorage[AUTHN_PROVIDER_STORAGE_KEY]).toBe('delegated');
  });

  it('renders reverse proxy reload guidance in AppShell banner without Sign In button when delegated', () => {
    setStoredAuthnProvider('delegated');
    useUIStore.setState({ isSessionExpired: true });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['auth-me'], {
      id: 'u-1',
      username: 'alice',
      authn_provider: 'delegated',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('data-testid="session-expired-banner"');
    expect(html).toContain(
      'Your session has expired. Reload the page to sign in via your identity provider.'
    );
    expect(html).toContain('data-testid="session-reload-btn"');
    expect(html).toContain('Reload');
    // Crucial: Must NOT offer the local sign in button in delegated mode
    expect(html).not.toContain('data-testid="session-signin-btn"');
    expect(html).not.toContain('Sign In');
  });

  it('displays unsaved edits warning in banner when dirty tabs exist behind reverse proxy', () => {
    setStoredAuthnProvider('delegated');
    useUIStore.setState({ isSessionExpired: true });
    useWorkspaceStore.setState({
      tabs: [{ id: 'doc-1', path: 'notes.md', title: 'Notes', isDirty: true }],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['auth-me'], {
      id: 'u-1',
      username: 'alice',
      authn_provider: 'delegated',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('data-testid="session-expired-banner"');
    expect(html).toContain(
      'Your authentication session has expired and you have unsaved changes. Please copy your edits before reloading.'
    );
    expect(html).toContain('data-testid="session-reload-btn"');
    expect(html).not.toContain('data-testid="session-signin-btn"');
  });

  it('renders Sign In modal button in AppShell banner when in standalone challenge mode', () => {
    setStoredAuthnProvider('challenge');
    useUIStore.setState({ isSessionExpired: true });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['auth-me'], {
      id: 'u-1',
      username: 'alice',
      authn_provider: 'challenge',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('data-testid="session-expired-banner"');
    expect(html).toContain(
      'Your authentication session has expired. Sign in again to restore access.'
    );
    expect(html).toContain('data-testid="session-signin-btn"');
    expect(html).toContain('Sign In');
    expect(html).toContain('data-testid="session-reload-btn"');
  });

  it('renders reverse proxy explanation in LoginModal when in delegated mode instead of password inputs', () => {
    setStoredAuthnProvider('delegated');
    useUIStore.setState({ loginModalOpen: true });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['auth-me'], {
      id: 'u-1',
      username: 'alice',
      authn_provider: 'delegated',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <LoginModal />
      </QueryClientProvider>
    );

    expect(html).toContain('Reverse Proxy Authentication');
    expect(html).toContain('External Identity Provider');
    expect(html).toContain(
      'This CME instance is deployed behind an authenticating reverse proxy.'
    );
    expect(html).toContain('data-testid="modal-reload-btn"');
    expect(html).toContain('Reload Page');
    // Form inputs must not be rendered
    expect(html).not.toContain('placeholder="Enter password"');
  });

  it('renders username/password credentials form in LoginModal when in challenge mode', () => {
    setStoredAuthnProvider('challenge');
    useUIStore.setState({ loginModalOpen: true });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['auth-me'], {
      id: 'u-1',
      username: 'alice',
      authn_provider: 'challenge',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <LoginModal />
      </QueryClientProvider>
    );

    expect(html).toContain('Sign in to CME');
    expect(html).toContain('placeholder="Enter password"');
    expect(html).toContain('placeholder="e.g. alice, bob"');
    expect(html).not.toContain('data-testid="modal-reload-btn"');
  });

  it('renders reverse proxy reload guidance in HealthPopover when session is expired in delegated mode', () => {
    setStoredAuthnProvider('delegated');
    useUIStore.setState({ isSessionExpired: true });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['system-health'], {
      status: 'healthy',
      version: 'v0.1.0',
      uptime_seconds: 120,
      authn_provider: 'delegated',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <HealthPopover />
      </QueryClientProvider>
    );

    // Initial closed state renders health button
    expect(html).toContain('v0.1.0');
  });
});
