/**
 * Dynamic External Code Snippet Synchronization (Step 8.4)
 *
 * Supports extended code fence syntax:
 *   ```lang|url_or_filepath|marker
 *   // synchronized code content
 *   ```
 *
 * Features:
 * - Parses code fence headers: lang, source URL or workspace file path, marker name.
 * - Marker boundary extractor:
 *     - Finds lines containing [marker] anywhere on the line for start and end boundaries.
 *     - Requires exactly 2 lines matching [marker]; any other number reports an error.
 * - In editor mode: fetches source in background, extracts code, updates code block.
 * - Non-destructive warning badge when offline or marker missing, preserving existing code.
 */

export interface SnippetHeaderInfo {
  isSnippet: boolean;
  language: string;
  source: string;
  marker: string;
  raw: string;
}

export interface SnippetSyncState {
  status: 'idle' | 'syncing' | 'synced' | 'failed';
  code?: string;
  error?: string;
  lastAttempt?: number;
}

// Global in-memory cache and listener registry for synchronized snippets
const snippetStateCache = new Map<string, SnippetSyncState>();
const snippetListeners = new Set<() => void>();

export function getSnippetCacheKey(source: string, marker: string): string {
  return `${source.trim()}|${marker.trim()}`;
}

export function getSnippetState(source: string, marker: string): SnippetSyncState | undefined {
  return snippetStateCache.get(getSnippetCacheKey(source, marker));
}

export function setSnippetState(source: string, marker: string, state: SnippetSyncState): void {
  snippetStateCache.set(getSnippetCacheKey(source, marker), state);
  notifySnippetListeners();
}

export function subscribeSnippetUpdates(listener: () => void): () => void {
  snippetListeners.add(listener);
  return () => {
    snippetListeners.delete(listener);
  };
}

function notifySnippetListeners(): void {
  snippetListeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[snippetSync] Listener error:', e);
    }
  });
}

/**
 * Parses code fence language string, extracting optional source and marker.
 * Example: "cpp|https://example.com/sample.cpp|main_loop" ->
 *   { isSnippet: true, language: "cpp", source: "https://example.com/sample.cpp", marker: "main_loop" }
 */
export function parseCodeFenceHeader(rawHeader: string): SnippetHeaderInfo {
  const trimmed = (rawHeader || '').trim();
  if (!trimmed.includes('|')) {
    return {
      isSnippet: false,
      language: trimmed.toLowerCase(),
      source: '',
      marker: '',
      raw: trimmed,
    };
  }

  const parts = trimmed.split('|').map((p) => p.trim());
  const language = (parts[0] || '').toLowerCase();
  const source = parts[1] || '';
  const marker = parts[2] || '';

  return {
    isSnippet: Boolean(source && marker),
    language: language || 'plaintext',
    source,
    marker,
    raw: trimmed,
  };
}

/**
 * Extracts lines enclosed by marker boundaries from the source text.
 */
export function extractSnippetFromText(
  sourceText: string,
  marker: string
): { code: string; error?: string } {
  if (!sourceText || typeof sourceText !== 'string') {
    return { code: '', error: 'Source text is empty' };
  }
  const cleanMarker = (marker || '').trim();
  if (!cleanMarker) {
    return { code: '', error: 'Marker name is empty' };
  }

  const lines = sourceText.split(/\r?\n/);
  const escaped = cleanMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markerRegex = new RegExp(`\\[\\s*${escaped}\\s*\\]`, 'i');

  const matchingLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (markerRegex.test(lines[i])) {
      matchingLineIndices.push(i);
    }
  }

  if (matchingLineIndices.length !== 2) {
    if (matchingLineIndices.length === 0) {
      return {
        code: '',
        error: `Marker '${cleanMarker}' not found in source`,
      };
    }
    return {
      code: '',
      error: `Expected exactly 2 lines matching '[${cleanMarker}]', found ${matchingLineIndices.length}`,
    };
  }

  const startIndex = matchingLineIndices[0];
  const endIndex = matchingLineIndices[1];
  const snippetLines = lines.slice(startIndex + 1, endIndex);

  // Strip minimum common indentation for clean display
  const nonBlankLines = snippetLines.filter((l) => l.trim().length > 0);
  let minIndent = Infinity;
  for (const l of nonBlankLines) {
    const match = l.match(/^(\s*)/);
    const indent = match ? match[1].length : 0;
    if (indent < minIndent) minIndent = indent;
  }

  const dedented =
    minIndent > 0 && minIndent !== Infinity
      ? snippetLines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l))
      : snippetLines;

  return {
    code: dedented.join('\n'),
  };
}

// Global cache for configured snippet endpoint names (e.g. ['mg', 'gh'])
let cachedEndpoints: Set<string> | null = null;
let endpointFetchPromise: Promise<Set<string>> | null = null;

export async function fetchSnippetEndpoints(): Promise<Set<string>> {
  if (cachedEndpoints) return cachedEndpoints;
  if (endpointFetchPromise) return endpointFetchPromise;

  endpointFetchPromise = (async () => {
    try {
      const res = await fetch('/api/v1/workspaces/snippet-endpoints', {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
        cachedEndpoints = new Set<string>(eps.map((e: string) => e.trim().toLowerCase()));
      } else {
        cachedEndpoints = new Set<string>();
      }
    } catch {
      cachedEndpoints = new Set<string>();
    } finally {
      endpointFetchPromise = null;
    }
    return cachedEndpoints;
  })();

  return endpointFetchPromise;
}

export function clearSnippetEndpointsCache(): void {
  cachedEndpoints = null;
  endpointFetchPromise = null;
}

export function setSnippetEndpointsForTesting(endpoints: string[]): void {
  cachedEndpoints = new Set<string>(endpoints.map((e) => e.trim().toLowerCase()));
}

/**
 * Fetches the source text for a snippet from a remote URL, named endpoint, or workspace file.
 */
export async function fetchSnippetSource(
  source: string,
  documentPath?: string
): Promise<string> {
  const cleanSource = source.trim();
  if (!cleanSource) throw new Error('Snippet source is empty');

  // Check if source matches a configured named endpoint prefix (e.g. "mg/foo/bar")
  const endpoints = await fetchSnippetEndpoints();
  const firstSlash = cleanSource.indexOf('/');
  const prefix = (firstSlash !== -1 ? cleanSource.substring(0, firstSlash) : cleanSource).trim().toLowerCase();
  const isNamedEndpoint = endpoints.has(prefix);

  if (cleanSource.startsWith('http://') || cleanSource.startsWith('https://')) {
    // Attempt direct fetch first (for CORS-enabled endpoints)
    try {
      const res = await fetch(cleanSource, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        return await res.text();
      }
    } catch {
      // Fall through to backend proxy endpoint to bypass CORS / network restrictions
    }

    // Proxy through CME server
    const proxyUrl = `/api/v1/workspaces/snippet-proxy?url=${encodeURIComponent(cleanSource)}`;
    const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
    if (!proxyRes.ok) {
      let errDetail = '';
      try {
        const jsonErr = await proxyRes.json();
        errDetail = jsonErr?.error || '';
      } catch {
        errDetail = await proxyRes.text().catch(() => '');
      }
      throw new Error(`Failed to fetch remote snippet: ${cleanSource} (${proxyRes.status}${errDetail ? `: ${errDetail}` : ''})`);
    }
    return await proxyRes.text();
  }

  if (isNamedEndpoint) {
    // Directly proxy named endpoints through CME server
    const proxyUrl = `/api/v1/workspaces/snippet-proxy?url=${encodeURIComponent(cleanSource)}`;
    const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
    if (!proxyRes.ok) {
      let errDetail = '';
      try {
        const jsonErr = await proxyRes.json();
        errDetail = jsonErr?.error || '';
      } catch {
        errDetail = await proxyRes.text().catch(() => '');
      }
      throw new Error(`Failed to fetch snippet from endpoint '${prefix}': ${cleanSource} (${proxyRes.status}${errDetail ? `: ${errDetail}` : ''})`);
    }
    return await proxyRes.text();
  }

  // Local / workspace file path
  let resolvedPath = cleanSource.replace(/^\/+/, '');
  if (cleanSource.startsWith('./') || (!cleanSource.startsWith('/') && documentPath)) {
    if (documentPath) {
      const lastSlash = documentPath.lastIndexOf('/');
      const dir = lastSlash >= 0 ? documentPath.slice(0, lastSlash) : '';
      const cleanRel = cleanSource.replace(/^\.\//, '');
      resolvedPath = dir ? `${dir}/${cleanRel}` : cleanRel;
    }
  }

  const fileUrl = `/api/v1/workspaces/files?path=${encodeURIComponent(resolvedPath)}`;
  const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(4000) });
  if (!fileRes.ok) {
    throw new Error(`Workspace file not found: ${resolvedPath}`);
  }
  return await fileRes.text();
}
