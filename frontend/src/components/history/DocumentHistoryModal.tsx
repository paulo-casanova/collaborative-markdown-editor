import React from 'react';
import { History, X, Check, Eye, Loader2 } from 'lucide-react';
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
  if (!isOpen) return null;

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
      data-testid="reader-history-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cme-border-base bg-cme-bg-subtle/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-cme-text-base flex items-center gap-2">
                Document Revision History
              </h2>
              <p className="text-xs text-cme-text-muted truncate max-w-md">
                {documentTitle} • {revisions.length} revision{revisions.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors cursor-pointer"
            title="Close"
            data-testid="close-history-modal-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Table */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-cme-text-muted">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <span className="text-xs">Loading revision history...</span>
            </div>
          ) : revisions.length === 0 ? (
            <div className="py-12 text-center text-xs text-cme-text-muted">
              No historical revisions recorded yet.
            </div>
          ) : (
            <div className="border border-cme-border-base rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs" data-testid="revisions-table">
                <thead className="bg-cme-bg-subtle/80 text-cme-text-muted font-medium border-b border-cme-border-base">
                  <tr>
                    <th className="py-2.5 px-4">Revision</th>
                    <th className="py-2.5 px-4">Author</th>
                    <th className="py-2.5 px-4">Date & Time</th>
                    <th className="py-2.5 px-4">Size</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cme-border-base/50 bg-cme-bg-surface">
                  {revisions.map((rev) => {
                    const isViewing =
                      selectedRevisionNumber === rev.revision_number ||
                      (selectedRevisionNumber === null && rev.is_latest);
                    const authorInitials = (rev.author_name || 'Author')
                      .slice(0, 2)
                      .toUpperCase();

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
                        {/* Revision Number & Badges */}
                        <td className="py-3 px-4 font-mono font-medium text-cme-text-base">
                          <div className="flex items-center gap-1.5">
                            <span>v{rev.revision_number}</span>
                            {rev.is_latest && (
                              <span
                                className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                data-testid="latest-badge"
                              >
                                Latest
                              </span>
                            )}
                            {isViewing && (
                              <span
                                className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
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
                            <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-[9px]">
                              {authorInitials}
                            </span>
                            <span className="truncate max-w-[150px] font-medium">
                              {rev.author_name || 'Author'}
                            </span>
                          </div>
                        </td>

                        {/* Date */}
                        <td className="py-3 px-4 text-cme-text-muted whitespace-nowrap">
                          {formatDate(rev.created_at)}
                        </td>

                        {/* Size */}
                        <td className="py-3 px-4 font-mono text-[11px] text-cme-text-muted whitespace-nowrap">
                          {formatBytes(rev.byte_size)}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          {isViewing ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                              <Check className="w-3 h-3" /> Active
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectRevision(rev.revision_number);
                                onClose();
                              }}
                              className="px-2.5 py-1 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover hover:border-indigo-500/40 text-xs font-medium text-cme-text-base transition-colors flex items-center gap-1 ml-auto cursor-pointer"
                              data-testid="view-revision-btn"
                            >
                              <Eye className="w-3 h-3 text-cme-text-muted" />
                              View
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-cme-border-base bg-cme-bg-subtle/50 text-xs">
          <span className="text-[11px] text-cme-text-muted">
            ℹ️ Editing is always performed on the latest live version.
          </span>
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
              className="px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-cme-text-base font-medium text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
