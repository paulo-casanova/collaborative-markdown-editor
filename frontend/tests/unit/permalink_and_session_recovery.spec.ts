import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useUIStore } from '../../src/stores/uiStore';
import { CmeCollabProvider } from '../../src/api/collabProvider';
import * as Y from 'yjs';

describe('Issue #6: Document Permalinks & Issue #7: Session Recovery', () => {
  let mockStorage: Record<string, string> = {};
  let visibilityListeners: Array<() => void> = [];

  beforeEach(() => {
    useUIStore.setState({
      syncStatus: 'saved',
    });
    mockStorage = {};
    visibilityListeners = [];

    const sessionStorageMock = {
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
    (global as any).sessionStorage = sessionStorageMock;

    if (typeof (global as any).window === 'undefined') {
      (global as any).window = {};
    }
    (global as any).window.sessionStorage = sessionStorageMock;
    (global as any).window.location = {
      protocol: 'https:',
      host: 'cme.internal:8080',
      reload: vi.fn(),
    };

    (global as any).document = {
      hidden: false,
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'visibilitychange') {
          visibilityListeners.push(cb);
        }
      }),
      removeEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'visibilitychange') {
          visibilityListeners = visibilityListeners.filter((l) => l !== cb);
        }
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supports "expired" in SyncStatus and allows updating syncStatus in UI store', () => {
    const store = useUIStore.getState();
    expect(store.syncStatus).toBe('saved');

    store.setSyncStatus('expired');
    expect(useUIStore.getState().syncStatus).toBe('expired');

    store.setSyncStatus('live');
    expect(useUIStore.getState().syncStatus).toBe('live');
  });

  it('constructs correct permalink format for documents with GUIDs', () => {
    const docId = '12345678-abcd-ef01-2345-6789abcdef01';
    const origin = 'https://cme.internal:8080';
    const permalink = `${origin}/documents/${docId}`;

    expect(permalink).toBe('https://cme.internal:8080/documents/12345678-abcd-ef01-2345-6789abcdef01');
    expect(permalink).toContain(`/documents/${docId}`);
  });

  it('detects expired session when auth probe returns redirected response', async () => {
    const ydoc = new Y.Doc();
    const docId = 'test-doc-sso-probe';
    const provider = new CmeCollabProvider(docId, ydoc, null, 'ws://127.0.0.1:9999/ws');

    let reportedStatus: string | null = null;
    provider.onStatus((status) => {
      reportedStatus = status;
    });

    // Mock fetch to simulate SSO proxy redirect to an HTML login screen (e.g. 302 -> /login)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      redirected: true,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      json: async () => ({}),
    } as any);

    // Call probeAuthSession via private access
    const isValid = await (provider as any).probeAuthSession();
    expect(isValid).toBe(false);

    // Trigger handleSessionExpired
    (provider as any).handleSessionExpired();
    expect(provider.status).toBe('session-expired');
    expect(reportedStatus).toBe('session-expired');

    provider.destroy();
  });

  it('detects expired session when auth probe returns 401 Unauthorized', async () => {
    const ydoc = new Y.Doc();
    const docId = 'test-doc-401-probe';
    const provider = new CmeCollabProvider(docId, ydoc, null, 'ws://127.0.0.1:9999/ws');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      redirected: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Unauthorized' }),
    } as any);

    const isValid = await (provider as any).probeAuthSession();
    expect(isValid).toBe(false);

    provider.destroy();
  });

  it('validates active session when auth probe returns 200 OK with user profile', async () => {
    const ydoc = new Y.Doc();
    const docId = 'test-doc-valid-probe';
    const provider = new CmeCollabProvider(docId, ydoc, null, 'ws://127.0.0.1:9999/ws');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      redirected: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ user: { id: 'u1', username: 'alice' } }),
    } as any);

    const isValid = await (provider as any).probeAuthSession();
    expect(isValid).toBe(true);

    provider.destroy();
  });

  it('enforces rate limiting on page reload when session expires', () => {
    const ydoc = new Y.Doc();
    const docId = 'test-doc-rate-limit';
    const provider = new CmeCollabProvider(docId, ydoc, null, 'ws://127.0.0.1:9999/ws');

    const reloadMock = vi.fn();
    (global as any).window.location = { reload: reloadMock } as any;

    // First trigger sets timestamp and reloads
    (provider as any).handleSessionExpired();
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // Immediate second trigger is rate-limited (should not call reload again)
    (provider as any).handleSessionExpired();
    expect(reloadMock).toHaveBeenCalledTimes(1);

    provider.destroy();
  });

  it('defers reload when document is hidden until tab becomes visible', () => {
    const ydoc = new Y.Doc();
    const docId = 'test-doc-hidden-reload';
    const provider = new CmeCollabProvider(docId, ydoc, null, 'ws://127.0.0.1:9999/ws');

    const reloadMock = vi.fn();
    (global as any).window.location = { reload: reloadMock } as any;
    (global as any).document.hidden = true;

    (provider as any).handleSessionExpired();
    // Should not reload while document is hidden
    expect(reloadMock).not.toHaveBeenCalled();

    // Tab becomes visible and visibilitychange fires
    (global as any).document.hidden = false;
    visibilityListeners.forEach((fn) => fn());
    expect(reloadMock).toHaveBeenCalledTimes(1);

    provider.destroy();
  });
});
