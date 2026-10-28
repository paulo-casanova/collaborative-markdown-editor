import { useUIStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export class ApiError extends Error {
  constructor(
    public status: number,
    public error: string,
    message: string,
    public timestamp?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const TOKEN_STORAGE_KEY = 'cme_auth_token';
export const RELOAD_KEY = 'cme_last_session_reload';

let activeProbePromise: Promise<boolean> | null = null;
let lastProbeTime = 0;
const PROBE_COOLDOWN_MS = 2000;

/**
 * Probes the authentication endpoint /api/v1/auth/me to verify whether the session
 * is still valid or if an authenticating reverse proxy has expired the session.
 */
export async function probeAuthSession(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return true;

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch('/api/v1/auth/me', {
      headers,
      credentials: 'include',
      redirect: 'manual',
    });

    if (
      res.type === 'opaqueredirect' ||
      res.status === 0 ||
      res.redirected ||
      res.status === 401 ||
      !res.ok
    ) {
      return false;
    }

    const cType = res.headers?.get ? res.headers.get('content-type') || '' : '';
    if (!cType.includes('application/json')) {
      return false;
    }

    const json = await res.json();
    return Boolean(json && (json.user || json.user_id || json.username));
  } catch {
    return false;
  }
}

/**
 * Triggers a debounced probe to check if the authentication session has expired.
 * Deduplicates concurrent probe calls across multiple failing REST requests.
 */
export async function triggerSessionExpiryCheck(): Promise<boolean> {
  if (activeProbePromise) {
    return activeProbePromise;
  }

  const now = Date.now();
  if (now - lastProbeTime < PROBE_COOLDOWN_MS) {
    return !useUIStore.getState().isSessionExpired;
  }

  lastProbeTime = now;
  activeProbePromise = (async () => {
    try {
      const isValid = await probeAuthSession();
      if (!isValid) {
        handleGlobalSessionExpired();
      }
      return isValid;
    } finally {
      activeProbePromise = null;
    }
  })();

  return activeProbePromise;
}

/**
 * Handles the session expired state: updates global state, avoids auto-reloading
 * if the editor has unsynced changes, and schedules rate-limited page reload when safe.
 */
export function handleGlobalSessionExpired() {
  if (typeof window === 'undefined') return;

  useUIStore.getState().setSessionExpired(true);

  // Avoid reloading while the editor has unsynced changes; resync first or prompt user
  const hasDirtyTabs = useWorkspaceStore.getState().tabs.some((t) => t.isDirty);
  if (hasDirtyTabs) {
    return;
  }

  const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  const lastReload = parseInt(storage?.getItem(RELOAD_KEY) || '0', 10);
  const now = Date.now();
  // Rate limit: at most once per 30 seconds
  if (now - lastReload < 30000) {
    return;
  }

  const triggerReload = () => {
    storage?.setItem(RELOAD_KEY, Date.now().toString());
    if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
      window.location.reload();
    }
  };

  if (typeof document !== 'undefined' && document.hidden) {
    const onVisibilityChange = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        const stillDirty = useWorkspaceStore.getState().tabs.some((t) => t.isDirty);
        if (!stillDirty) {
          triggerReload();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  } else {
    triggerReload();
  }
}

/**
 * Clears the session expired state when a subsequent request succeeds.
 */
export function clearSessionExpired() {
  lastProbeTime = 0;
  activeProbePromise = null;
  const uiStore = useUIStore.getState();
  if (uiStore.isSessionExpired) {
    uiStore.setSessionExpired(false);
  }
}

/**
 * Core HTTP fetch wrapper that detects proxy session redirects, 401s, HTML-on-JSON,
 * and network errors, coordinating with global session recovery.
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const redirectMode = options.redirect ?? 'manual';

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
      credentials: options.credentials ?? 'include',
      redirect: redirectMode,
    });
  } catch (err) {
    if (!endpoint.includes('/api/v1/auth/me')) {
      void triggerSessionExpiryCheck();
    }
    throw err;
  }

  // 1. Opaque redirect (auth proxy 303/302 redirect captured under manual redirect)
  if (response.type === 'opaqueredirect' || (redirectMode === 'manual' && response.status === 0)) {
    if (!endpoint.includes('/api/v1/auth/me')) {
      void triggerSessionExpiryCheck();
    }
    throw new ApiError(401, 'SessionExpired', 'Auth proxy session expired (redirected)');
  }

  // 2. Redirected response (if redirect: 'follow' was explicitly used)
  if (response.redirected) {
    if (!endpoint.includes('/api/v1/auth/me')) {
      void triggerSessionExpiryCheck();
    }
    throw new ApiError(401, 'SessionExpired', 'Auth proxy session expired (redirected)');
  }

  // 3. 401 Unauthorized
  if (response.status === 401) {
    if (!endpoint.includes('/api/v1/auth/me')) {
      void triggerSessionExpiryCheck();
    }
  }

  // 4. HTML response received for an API endpoint
  const contentType = response.headers?.get ? response.headers.get('content-type') || '' : '';
  if (contentType.includes('text/html') && endpoint.includes('/api/v1/')) {
    if (!endpoint.includes('/api/v1/auth/me')) {
      void triggerSessionExpiryCheck();
    }
    throw new ApiError(401, 'SessionExpired', 'Received HTML login screen for API request (suspected session expiry)');
  }

  // On successful response, auto-clear session expired state if previously set
  if (response.ok && useUIStore.getState().isSessionExpired) {
    clearSessionExpired();
  }

  return response;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const response = await apiFetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorJson: { error?: string; message?: string; timestamp?: string } = {};
    try {
      errorJson = await response.json();
    } catch {
      // Body is not JSON
    }
    throw new ApiError(
      response.status,
      errorJson.error || 'RequestFailed',
      errorJson.message || errorJson.error || `HTTP ${response.status}: ${response.statusText}`,
      errorJson.timestamp
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers?.get ? response.headers.get('content-type') || '' : '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}
