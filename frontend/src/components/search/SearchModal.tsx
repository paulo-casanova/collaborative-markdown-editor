import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, FileText, CornerDownLeft, X, Loader2 } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { searchDocuments } from '../../api/documents';
import { SearchResult } from '../../types/document';

export const SearchModal: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    searchModalOpen,
    setSearchModalOpen,
    searchTitleOnly,
    setSearchTitleOnly,
    viewMode,
  } = useUIStore();
  const { openTab } = useWorkspaceStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd+K / Ctrl+K and Cmd+Shift+K / Ctrl+Shift+K keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const wantsTitleOnly = e.shiftKey;
        if (!searchModalOpen) {
          setSearchModalOpen(true, wantsTitleOnly);
        } else {
          // If modal is open and user presses the other shortcut, switch mode
          if (wantsTitleOnly !== searchTitleOnly) {
            setSearchTitleOnly(wantsTitleOnly);
          } else {
            setSearchModalOpen(false);
          }
        }
      } else if (e.key === 'Escape' && searchModalOpen) {
        setSearchModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchModalOpen, searchTitleOnly, setSearchModalOpen, setSearchTitleOnly]);

  // Focus input whenever modal opens
  useEffect(() => {
    if (searchModalOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [searchModalOpen]);

  // Debounced search query
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await searchDocuments(query.trim(), '', 20, searchTitleOnly);
        setResults(data);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, searchTitleOnly]);

  // Keyboard navigation within results
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  const handleSelect = (item: SearchResult) => {
    setSearchModalOpen(false);
    openTab({
      id: item.id,
      path: item.path,
      title: item.title || item.path,
    });
    const isReadMode = viewMode === 'read' || location.pathname.startsWith('/docs/');
    navigate(`${isReadMode ? '/docs' : '/documents'}/${item.id}`);
  };

  // Helper to highlight search query terms in text
  const highlightMatch = (text: string, term: string) => {
    if (!term.trim()) return text;
    const parts = text.split(new RegExp(`(${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === term.toLowerCase() ? (
        <mark key={i} className="bg-amber-500/20 text-amber-500 font-medium px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  if (!searchModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 md:pt-24 bg-black/60 backdrop-blur-sm p-4"
      onClick={() => setSearchModalOpen(false)}
      data-testid="search-modal"
    >
      <div
        className="w-full max-w-2xl bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-cme-border-base bg-cme-bg-surface">
          <Search className="w-5 h-5 text-cme-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={
              searchTitleOnly
                ? 'Search documents by title...'
                : 'Search documents by title, path, or content...'
            }
            className="flex-1 bg-transparent text-sm text-cme-text-base placeholder-cme-text-muted focus:outline-none"
            data-testid="search-modal-input"
          />
          {loading && <Loader2 className="w-4 h-4 text-cme-primary animate-spin" />}
          {query && !loading && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded hover:bg-cme-bg-subtle text-cme-text-muted"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-cme-text-muted bg-cme-bg-subtle px-2 py-0.5 rounded border border-cme-border-base">
            <kbd className="font-mono">ESC</kbd> to close
          </div>
        </div>

        {/* Search Mode Toggle Tabs */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-cme-border-base bg-cme-bg-subtle/50 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchTitleOnly(false)}
              data-testid="search-mode-all"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                !searchTitleOnly
                  ? 'bg-cme-bg-surface text-cme-primary shadow-sm border border-cme-border-base font-semibold'
                  : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-subtle'
              }`}
            >
              <span>All Content</span>
              <kbd className="text-[10px] font-mono px-1 py-0.2 rounded bg-cme-bg-subtle border border-cme-border-base text-cme-text-subtle">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setSearchTitleOnly(true)}
              data-testid="search-mode-title-only"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                searchTitleOnly
                  ? 'bg-cme-bg-surface text-cme-primary shadow-sm border border-cme-border-base font-semibold'
                  : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-subtle'
              }`}
            >
              <span>Title Only</span>
              <kbd className="text-[10px] font-mono px-1 py-0.2 rounded bg-cme-bg-subtle border border-cme-border-base text-cme-text-subtle">
                ⌘⇧K
              </kbd>
            </button>
          </div>
          <span className="text-[11px] text-cme-text-muted hidden sm:inline">
            {searchTitleOnly ? 'Searching document titles' : 'Searching full text index'}
          </span>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {results.length > 0 ? (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`p-3 rounded-xl cursor-pointer transition-colors flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-cme-primary/10 border border-cme-primary/30'
                      : 'hover:bg-cme-bg-hover border border-transparent'
                  }`}
                  data-testid="search-result-item"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-cme-primary flex-shrink-0" />
                      <span className="font-semibold text-xs text-cme-text-base truncate">
                        {highlightMatch(item.title, query)}
                      </span>
                      <span className="text-[11px] text-cme-text-muted truncate max-w-[200px]">
                        {item.path}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[10px] text-cme-primary font-medium flex-shrink-0">
                        <span>Open</span>
                        <CornerDownLeft className="w-3 h-3" />
                      </span>
                    )}
                  </div>

                  {item.snippet && (
                    <p className="text-xs text-cme-text-muted line-clamp-2 leading-relaxed bg-cme-bg-subtle/50 p-2 rounded-lg font-mono text-[11px]">
                      {highlightMatch(item.snippet, query)}
                    </p>
                  )}
                </div>
              );
            })
          ) : query && !loading ? (
            <div className="py-12 text-center text-xs text-cme-text-muted">
              No matching documents found for &quot;<span className="font-semibold">{query}</span>&quot;.
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-cme-text-muted space-y-2">
              <p>
                {searchTitleOnly
                  ? 'Type to search documents by title.'
                  : 'Type to search across all workspace markdown files and bundles.'}
              </p>
              <div className="flex justify-center gap-3 text-[11px] text-cme-text-subtle">
                <span>Navigate: <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd></span>
                <span>Select: <kbd className="font-mono">↵</kbd></span>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-cme-border-base bg-cme-bg-subtle text-[11px] text-cme-text-muted flex items-center justify-between">
          <span>{results.length} results</span>
          <span className="font-mono">{searchTitleOnly ? 'CME Title Search' : 'CME Full-Text Index'}</span>
        </div>
      </div>
    </div>
  );
};
