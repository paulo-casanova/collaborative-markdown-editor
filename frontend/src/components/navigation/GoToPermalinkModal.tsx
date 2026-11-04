import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Link2, X, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { fetchDocument, fetchDocumentByPath } from '../../api/documents';

export interface ParsedPermalink {
  documentId?: string;
  path?: string;
  mode?: 'documents' | 'docs';
  hash?: string;
}

export function parsePermalinkInput(rawInput: string): ParsedPermalink | null {
  const input = rawInput.trim();
  if (!input) return null;

  let pathname = input;
  let hash = '';
  let search = '';

  try {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const url = new URL(input);
      pathname = url.pathname;
      hash = url.hash;
      search = url.search;
    }
  } catch {
    // Continue with string parsing
  }

  // Extract hash if present
  if (!hash && pathname.includes('#')) {
    const hashIdx = pathname.indexOf('#');
    hash = pathname.slice(hashIdx);
    pathname = pathname.slice(0, hashIdx);
  }

  // Extract query if present
  if (!search && pathname.includes('?')) {
    const qIdx = pathname.indexOf('?');
    search = pathname.slice(qIdx);
    pathname = pathname.slice(0, qIdx);
  }

  // Determine mode (/docs/ vs /documents/)
  let mode: 'documents' | 'docs' | undefined;
  if (pathname.includes('/docs/') || pathname.startsWith('/docs')) {
    mode = 'docs';
  } else if (pathname.includes('/documents/') || pathname.startsWith('/documents')) {
    mode = 'documents';
  }

  // Handle by-path query: ?path=...
  if (search) {
    const params = new URLSearchParams(search);
    const byPath = params.get('path');
    if (byPath) {
      return { path: byPath, mode, hash };
    }
  }

  // Check UUID regex
  const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const match = uuidRegex.exec(pathname);
  if (match) {
    return { documentId: match[1], mode, hash };
  }

  // Check directory dashboard id
  if (pathname.includes('dir:')) {
    const dirIdx = pathname.indexOf('dir:');
    return { documentId: pathname.slice(dirIdx), mode: 'documents', hash };
  }

  // Clean relative path
  const cleanPath = pathname.replace(/^\/?(documents|docs)\//, '').trim();
  if (cleanPath && !cleanPath.startsWith('http')) {
    return { path: cleanPath, mode, hash };
  }

  return null;
}

export const GoToPermalinkModal: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { goToPermalinkModalOpen, setGoToPermalinkModalOpen, viewMode } = useUIStore();
  const { activeTabId, replaceActiveTab, openTab } = useWorkspaceStore();

  const [inputVal, setInputVal] = useState('');
  const [useCurrentTab, setUseCurrentTab] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (goToPermalinkModalOpen) {
      setInputVal('');
      setError(null);
      setLoading(false);
      setUseCurrentTab(Boolean(activeTabId));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [goToPermalinkModalOpen, activeTabId]);

  if (!goToPermalinkModalOpen) return null;

  const handleClose = () => {
    setGoToPermalinkModalOpen(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parsePermalinkInput(inputVal);

    if (!parsed || (!parsed.documentId && !parsed.path)) {
      setError('Please enter a valid document permalink URL, path, or document UUID.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let targetId = parsed.documentId;
      let targetPath = parsed.path || '';
      let targetTitle = 'Document';
      let isBundle = false;
      let isDirectory = false;

      if (targetId && targetId.startsWith('dir:')) {
        isDirectory = true;
        targetPath = targetId.replace(/^dir:/, '');
        targetTitle = targetPath.split('/').pop() || 'Directory';
      } else if (targetId) {
        // Resolve document metadata
        try {
          const doc = await fetchDocument(targetId);
          targetPath = doc.path;
          targetTitle = doc.title || doc.path.replace(/\.(md|bundle)$/, '');
          isBundle = doc.is_bundle;
        } catch {
          // If fetch fails (e.g. mock or network), keep targetId
          targetTitle = 'Document';
        }
      } else if (targetPath) {
        // Resolve by path
        const doc = await fetchDocumentByPath(targetPath);
        targetId = doc.id;
        targetTitle = doc.title || doc.path.replace(/\.(md|bundle)$/, '');
        isBundle = doc.is_bundle;
      }

      if (!targetId) {
        throw new Error('Document could not be resolved from the provided permalink.');
      }

      const defaultMode = viewMode === 'read' || location.pathname.startsWith('/docs/') ? 'docs' : 'documents';
      const effectiveMode = isDirectory ? 'documents' : parsed.mode || defaultMode;
      const hashPart = parsed.hash || '';

      const tabPayload = {
        id: targetId,
        path: targetPath || targetId,
        title: targetTitle,
        is_bundle: isBundle,
        is_directory: isDirectory,
      };

      if (useCurrentTab && activeTabId) {
        replaceActiveTab(tabPayload);
      } else {
        openTab(tabPayload, true);
      }

      handleClose();
      navigate(`/${effectiveMode}/${targetId}${hashPart}`);
    } catch (err: any) {
      setError(err?.message || 'Document not found or invalid permalink.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 select-none"
      onClick={handleClose}
      data-testid="goto-permalink-modal"
    >
      <div
        className="w-full max-w-md bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cme-border-base bg-cme-bg-subtle/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <Link2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-cme-text-base text-sm">Go to Permalink</h3>
              <p className="text-[11px] text-cme-text-muted">
                Navigate directly without opening a separate browser tab
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-lg text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
            data-testid="goto-permalink-cancel-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-cme-text-base mb-1.5">
              Permalink URL or Document ID
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="e.g. http://localhost:8080/documents/... or UUID"
                className="w-full px-3.5 py-2.5 text-xs bg-cme-bg-base border border-cme-border-base rounded-xl text-cme-text-base placeholder-cme-text-muted focus:outline-none focus:border-cme-primary focus:ring-1 focus:ring-cme-primary font-mono transition-all"
                data-testid="goto-permalink-input"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <p className="text-[11px] text-cme-text-muted mt-1.5">
              Accepts full links (<code>http://...</code>), relative paths (<code>/documents/...</code>, <code>/docs/...</code>), or document UUIDs.
            </p>
          </div>

          {/* Tab Placement Preference */}
          <div className="pt-2 border-t border-cme-border-base">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-cme-text-base select-none">
              <input
                type="checkbox"
                checked={useCurrentTab}
                onChange={(e) => setUseCurrentTab(e.target.checked)}
                className="rounded border-cme-border-base text-cme-primary focus:ring-0 w-4 h-4 cursor-pointer"
                data-testid="goto-permalink-use-current-tab-checkbox"
              />
              <span>Open in current workspace tab</span>
            </label>
            <p className="text-[11px] text-cme-text-muted ml-6 mt-0.5">
              {useCurrentTab
                ? 'Replaces the currently active tab instead of creating a new one.'
                : 'Opens the document in a new workspace tab.'}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover border border-cme-border-base transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !inputVal.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
              data-testid="goto-permalink-submit-btn"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Resolving...</span>
                </>
              ) : (
                <>
                  <span>Open Document</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
