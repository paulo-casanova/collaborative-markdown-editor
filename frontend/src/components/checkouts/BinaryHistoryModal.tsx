import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, X, Download, User, FileText, AlertCircle } from 'lucide-react';
import { fetchBinaryRevisions, getBinaryRevisionDownloadUrl, BinaryRevision } from '../../api/checkouts';

interface BinaryHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  path: string;
  filename: string;
}

export const BinaryHistoryModal: React.FC<BinaryHistoryModalProps> = ({
  isOpen,
  onClose,
  path,
  filename,
}) => {
  const { data: revisions = [], isLoading, error } = useQuery<BinaryRevision[]>({
    queryKey: ['checkout-history', path],
    queryFn: () => fetchBinaryRevisions(path),
    enabled: isOpen && Boolean(path),
  });

  if (!isOpen) return null;

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="binary-history-modal"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-cme-border-base bg-cme-bg-surface p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-cme-border-base flex-shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-500" />
            <div>
              <h3 className="font-semibold text-sm text-cme-text-base">Revision History</h3>
              <p className="text-xs text-cme-text-muted truncate max-w-md">{path}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-cme-text-muted">
              Loading revision history...
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 text-rose-500 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>Failed to load revision history.</span>
            </div>
          ) : revisions.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <FileText className="w-10 h-10 text-cme-text-subtle mx-auto opacity-40" />
              <p className="text-xs font-medium text-cme-text-muted">No historical revisions found</p>
              <p className="text-[11px] text-cme-text-subtle max-w-sm mx-auto">
                Historical revisions are archived automatically each time a checked-out document is checked in.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-cme-bg-surface border-b border-cme-border-base text-cme-text-muted font-semibold">
                <tr>
                  <th className="py-2.5 px-3 w-16">Rev</th>
                  <th className="py-2.5 px-3">Summary</th>
                  <th className="py-2.5 px-3 w-32">Author</th>
                  <th className="py-2.5 px-3 w-24">Size</th>
                  <th className="py-2.5 px-3 w-36">Saved At</th>
                  <th className="py-2.5 px-3 text-right w-20">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cme-border-base/50">
                {revisions.map((rev) => (
                  <tr
                    key={rev.id}
                    className="hover:bg-cme-bg-hover/50 transition-colors"
                    data-testid={`revision-row-${rev.revision_number}`}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-cme-primary">
                      #{rev.revision_number}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-cme-text-base">
                        {rev.summary || <span className="text-cme-text-subtle italic">No summary provided</span>}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-cme-text-muted truncate">
                      <div className="flex items-center gap-1.5 truncate">
                        <User className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{rev.display_name || rev.username}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-cme-text-muted">
                      {formatBytes(rev.byte_size)}
                    </td>
                    <td className="py-2.5 px-3 text-cme-text-muted text-[11px]">
                      {formatDate(rev.created_at)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <a
                        href={getBinaryRevisionDownloadUrl(path, rev.revision_number)}
                        download={`${filename}.rev${rev.revision_number}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-cme-bg-subtle hover:bg-cme-bg-hover text-cme-text-base transition-colors"
                        title={`Download Revision #${rev.revision_number}`}
                        data-testid={`download-rev-${rev.revision_number}`}
                      >
                        <Download className="w-3 h-3 text-blue-500" />
                        <span>Get</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-3 border-t border-cme-border-base flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-lg border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
