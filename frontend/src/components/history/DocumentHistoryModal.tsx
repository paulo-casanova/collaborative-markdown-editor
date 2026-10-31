import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History,
  X,
  Check,
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  Search,
  RotateCcw,
} from 'lucide-react';
import { DocumentRevisionSummary } from '../../api/documents';

interface DocumentHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle: string;
  revisions: DocumentRevisionSummary[];
  selectedRevisionNumber: number | null;
  onSelectRevision: (revisionNumber: number) => void;
  onReturnToLatest: () => void;
  isLoading?: boolean;
}

const STORAGE_WIDTH_KEY = 'cme_history_modal_width';
const STORAGE_HEIGHT_KEY = 'cme_history_modal_height';
const DEFAULT_WIDTH = 980;
const DEFAULT_HEIGHT = 650;
const MIN_WIDTH = 540;
const MIN_HEIGHT = 380;

const getStoredDimensions = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedW = parseInt(window.localStorage.getItem(STORAGE_WIDTH_KEY) || '', 10);
      const savedH = parseInt(window.localStorage.getItem(STORAGE_HEIGHT_KEY) || '', 10);
      const maxW = window.innerWidth ? Math.max(MIN_WIDTH, window.innerWidth - 32) : 1600;
      const maxH = window.innerHeight ? Math.max(MIN_HEIGHT, window.innerHeight - 32) : 1000;

      return {
        width: !isNaN(savedW) && savedW >= MIN_WIDTH ? Math.min(savedW, maxW) : DEFAULT_WIDTH,
        height: !isNaN(savedH) && savedH >= MIN_HEIGHT ? Math.min(savedH, maxH) : DEFAULT_HEIGHT,
      };
    }
  } catch {
    // Ignore storage errors
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
};

export const DocumentHistoryModal: React.FC<DocumentHistoryModalProps> = ({
  isOpen,
  onClose,
  documentTitle,
  revisions,
  selectedRevisionNumber,
  onSelectRevision,
  onReturnToLatest,
  isLoading = false,
}) => {
  const [dimensions, setDimensions] = useState(getStoredDimensions);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Synchronize initial dimensions on open
  useEffect(() => {
    if (isOpen) {
      setDimensions(getStoredDimensions());
      setIsMaximized(false);
      setSearchQuery('');
    }
  }, [isOpen]);

  // Keyboard shortcut: Escape to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Resize Drag Handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: 'right' | 'left' | 'bottom' | 'corner-br' | 'corner-bl') => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = dimensions.width;
      const startH = dimensions.height;
      setIsResizing(direction);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let nextW = startW;
        let nextH = startH;

        if (direction === 'right' || direction === 'corner-br') {
          nextW = startW + deltaX * 2;
        } else if (direction === 'left' || direction === 'corner-bl') {
          nextW = startW - deltaX * 2;
        }

        if (direction === 'bottom' || direction === 'corner-br' || direction === 'corner-bl') {
          nextH = startH + deltaY * 2;
        }

        const maxW = typeof window !== 'undefined' ? Math.max(MIN_WIDTH, window.innerWidth - 32) : 1800;
        const maxH = typeof window !== 'undefined' ? Math.max(MIN_HEIGHT, window.innerHeight - 32) : 1200;

        const clampedW = Math.max(MIN_WIDTH, Math.min(maxW, Math.round(nextW)));
        const clampedH = Math.max(MIN_HEIGHT, Math.min(maxH, Math.round(nextH)));

        setDimensions({ width: clampedW, height: clampedH });
        setIsMaximized(false);
      };

      const handleMouseUp = () => {
        setIsResizing(null);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        // Persist user's preferred dimensions
        setDimensions((current) => {
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem(STORAGE_WIDTH_KEY, String(current.width));
              window.localStorage.setItem(STORAGE_HEIGHT_KEY, String(current.height));
            }
          } catch {
            // Ignore storage errors
          }
          return current;
        });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [dimensions]
  );

  const resetSize = () => {
    setDimensions({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    setIsMaximized(false);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_WIDTH_KEY);
        window.localStorage.removeItem(STORAGE_HEIGHT_KEY);
      }
    } catch {}
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const now = Date.now();
      const diffSec = Math.floor((now - d.getTime()) / 1000);
      if (diffSec < 60) return 'just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}h ago`;
      const diffDay = Math.floor(diffHour / 24);
      if (diffDay < 30) return `${diffDay}d ago`;
      const diffMonth = Math.floor(diffDay / 30);
      if (diffMonth < 12) return `${diffMonth}mo ago`;
      return `${Math.floor(diffMonth / 12)}y ago`;
    } catch {
      return '';
    }
  };

  // Filtered Revisions based on search input
  const filteredRevisions = useMemo(() => {
    if (!searchQuery.trim()) return revisions;
    const q = searchQuery.toLowerCase().trim();
    return revisions.filter((rev) => {
      const revStr = `v${rev.revision_number}`;
      const author = (rev.author_name || '').toLowerCase();
      const date = formatDate(rev.created_at).toLowerCase();
      return revStr.includes(q) || author.includes(q) || date.includes(q);
    });
  }, [revisions, searchQuery]);

  if (!isOpen) return null;

  const isCustomSize =
    dimensions.width !== DEFAULT_WIDTH || dimensions.height !== DEFAULT_HEIGHT;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150 ${
        isResizing ? 'select-none' : ''
      }`}
      data-testid="reader-history-modal"
      onClick={onClose}
    >
      <div
        style={
          isMaximized
            ? { width: '96vw', height: '92vh', maxWidth: '98vw', maxHeight: '96vh' }
            : {
                width: `${dimensions.width}px`,
                height: `${dimensions.height}px`,
                maxWidth: '96vw',
                maxHeight: '94vh',
              }
        }
        className="relative bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 text-cme-text-base transition-all"
        onClick={(e) => e.stopPropagation()}
        data-testid="history-modal-container"
      >
        {/* Resize Edge Handles */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'right')}
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-indigo-500/30 transition-colors z-20"
          title="Drag to resize width"
          data-testid="history-modal-resize-right"
        />
        <div
          onMouseDown={(e) => handleResizeStart(e, 'left')}
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-indigo-500/30 transition-colors z-20"
          title="Drag to resize width"
          data-testid="history-modal-resize-left"
        />
        <div
          onMouseDown={(e) => handleResizeStart(e, 'bottom')}
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-indigo-500/30 transition-colors z-20"
          title="Drag to resize height"
          data-testid="history-modal-resize-bottom"
        />

        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-cme-border-base bg-cme-bg-subtle/50 select-none cursor-default shrink-0"
          onDoubleClick={() => setIsMaximized((prev) => !prev)}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-cme-text-base flex items-center gap-2 truncate">
                Document Revision History
              </h2>
              <p className="text-xs text-cme-text-muted truncate max-w-lg">
                {documentTitle} • {revisions.length} revision{revisions.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-3">
            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="p-1.5 rounded-lg text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors cursor-pointer"
              title={isMaximized ? 'Restore window size' : 'Maximize window'}
              data-testid="history-modal-maximize-btn"
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors cursor-pointer"
              title="Close"
              data-testid="close-history-modal-btn"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 min-h-0">
          {/* Optional Search filter if document has multiple revisions */}
          {revisions.length > 2 && (
            <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="w-3.5 h-3.5 text-cme-text-muted absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by author or revision..."
                  className="w-full pl-9 pr-3 py-1.5 bg-cme-bg-base border border-cme-border-base rounded-lg text-xs text-cme-text-base placeholder-cme-text-muted focus:outline-none focus:border-indigo-500 transition-colors"
                  data-testid="history-search-input"
                />
              </div>
              <div className="text-[11px] text-cme-text-muted">
                Showing {filteredRevisions.length} of {revisions.length} revision
                {revisions.length === 1 ? '' : 's'}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-cme-text-muted">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <span className="text-xs">Loading revision history...</span>
            </div>
          ) : revisions.length === 0 ? (
            <div className="py-16 text-center text-xs text-cme-text-muted">
              No historical revisions recorded yet.
            </div>
          ) : filteredRevisions.length === 0 ? (
            <div className="py-16 text-center text-xs text-cme-text-muted">
              No revisions match your filter &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div className="border border-cme-border-base rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[620px]" data-testid="revisions-table">
                  <thead className="bg-cme-bg-subtle/80 text-cme-text-muted font-medium border-b border-cme-border-base select-none">
                    <tr>
                      <th className="py-2.5 px-4">Revision</th>
                      <th className="py-2.5 px-4">Author</th>
                      <th className="py-2.5 px-4">Date & Time</th>
                      <th className="py-2.5 px-4">Size</th>
                      <th className="py-2.5 px-4">Change</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cme-border-base/50 bg-cme-bg-surface">
                    {filteredRevisions.map((rev) => {
                      const isViewing =
                        selectedRevisionNumber === rev.revision_number ||
                        (selectedRevisionNumber === null && rev.is_latest);
                      const authorInitials = (rev.author_name || 'Author')
                        .slice(0, 2)
                        .toUpperCase();

                      // Compute size change compared to preceding chronological revision (revision_number - 1)
                      const prevRev = revisions.find(
                        (r) => r.revision_number === rev.revision_number - 1
                      );
                      const diffBytes = prevRev ? rev.byte_size - prevRev.byte_size : null;

                      return (
                        <tr
                          key={rev.id || rev.revision_number}
                          className={`transition-colors ${
                            isViewing
                              ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
                              : 'hover:bg-cme-bg-hover/50'
                          }`}
                          data-testid="revision-row"
                          data-revision-number={rev.revision_number}
                        >
                          {/* Revision Number & Status Badges */}
                          <td className="py-3 px-4 font-mono font-medium text-cme-text-base">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold">v{rev.revision_number}</span>
                              {rev.is_latest && (
                                <span
                                  className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                  data-testid="latest-badge"
                                >
                                  Latest
                                </span>
                              )}
                              {isViewing && (
                                <span
                                  className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                                  data-testid="viewing-badge"
                                >
                                  Viewing
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Author */}
                          <td className="py-3 px-4 text-cme-text-base">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-[9px] shrink-0">
                                {authorInitials}
                              </span>
                              <span className="truncate max-w-[180px] font-medium" title={rev.author_name || 'Author'}>
                                {rev.author_name || 'Author'}
                              </span>
                            </div>
                          </td>

                          {/* Date & Time */}
                          <td className="py-3 px-4 text-cme-text-muted whitespace-nowrap">
                            <div className="flex flex-col">
                              <span>{formatDate(rev.created_at)}</span>
                              <span className="text-[10px] text-cme-text-subtle">
                                {formatRelativeTime(rev.created_at)}
                              </span>
                            </div>
                          </td>

                          {/* Size */}
                          <td className="py-3 px-4 font-mono text-[11px] text-cme-text-muted whitespace-nowrap">
                            {formatBytes(rev.byte_size)}
                          </td>

                          {/* Byte Difference vs Previous Revision */}
                          <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                            {diffBytes === null ? (
                              <span className="text-cme-text-muted text-[10px]">Initial</span>
                            ) : diffBytes > 0 ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                +{formatBytes(diffBytes)}
                              </span>
                            ) : diffBytes < 0 ? (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">
                                -{formatBytes(Math.abs(diffBytes))}
                              </span>
                            ) : (
                              <span className="text-cme-text-muted">0 B</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {isViewing ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                                <Check className="w-3.5 h-3.5" /> Active
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectRevision(rev.revision_number);
                                  onClose();
                                }}
                                className="px-2.5 py-1 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover hover:border-indigo-500/40 text-xs font-medium text-cme-text-base transition-colors flex items-center gap-1 ml-auto cursor-pointer shadow-xs"
                                data-testid="view-revision-btn"
                              >
                                <Eye className="w-3 h-3 text-cme-text-muted" />
                                <span>View</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-cme-border-base bg-cme-bg-subtle/50 text-xs shrink-0 select-none">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-cme-text-muted hidden sm:inline">
              ℹ️ Editing is always performed on the latest live version.
            </span>
            {isCustomSize && (
              <button
                type="button"
                onClick={resetSize}
                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                title="Reset window to default size"
                data-testid="history-modal-reset-size-btn"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Size</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectedRevisionNumber !== null && (
              <button
                type="button"
                onClick={() => {
                  onReturnToLatest();
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium text-xs transition-colors cursor-pointer"
                data-testid="history-return-latest-btn"
              >
                Back to Latest Version
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-cme-text-base font-medium text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

        {/* Bottom-Right Corner Resize Grip Handle */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'corner-br')}
          className="absolute bottom-1 right-1 w-5 h-5 cursor-nwse-resize text-cme-text-muted hover:text-indigo-500 flex items-center justify-center transition-colors z-30 select-none group"
          title="Drag to resize window"
          data-testid="history-modal-resizer"
        >
          <svg
            className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <circle cx="13" cy="13" r="1.2" />
            <circle cx="9" cy="13" r="1.2" />
            <circle cx="13" cy="9" r="1.2" />
            <circle cx="5" cy="13" r="1.2" />
            <circle cx="9" cy="9" r="1.2" />
            <circle cx="13" cy="5" r="1.2" />
          </svg>
        </div>

        {/* Bottom-Left Corner Resize Grip Handle */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'corner-bl')}
          className="absolute bottom-1 left-1 w-5 h-5 cursor-nesw-resize text-cme-text-muted hover:text-indigo-500 flex items-center justify-center transition-colors z-30 select-none group"
          title="Drag to resize window"
          data-testid="history-modal-resizer-bl"
        >
          <svg
            className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 -scale-x-100"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <circle cx="13" cy="13" r="1.2" />
            <circle cx="9" cy="13" r="1.2" />
            <circle cx="13" cy="9" r="1.2" />
            <circle cx="5" cy="13" r="1.2" />
            <circle cx="9" cy="9" r="1.2" />
            <circle cx="13" cy="5" r="1.2" />
          </svg>
        </div>
      </div>
    </div>
  );
};
