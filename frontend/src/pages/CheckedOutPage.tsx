import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lock,
  Unlock,
  Upload,
  Download,
  FolderCheck,
  FolderOpen,
  History,
  Clock,
  RefreshCw,
} from 'lucide-react';
import {
  fetchMyCheckouts,
  cancelCheckout,
  DocumentCheckout,
} from '../api/checkouts';
import { downloadWorkspaceFile } from '../api/documents';
import {
  isFileSystemAccessSupported,
  getStoredDirectoryHandle,
  promptChooseDirectory,
  clearStoredDirectoryHandle,
} from '../utils/localCheckoutStorage';
import { CheckinModal } from '../components/checkouts/CheckinModal';
import { BinaryHistoryModal } from '../components/checkouts/BinaryHistoryModal';

export const CheckedOutPage: React.FC = () => {
  const queryClient = useQueryClient();

  const [activeCheckinTarget, setActiveCheckinTarget] = useState<{
    path: string;
    filename: string;
  } | null>(null);

  const [activeHistoryTarget, setActiveHistoryTarget] = useState<{
    path: string;
    filename: string;
  } | null>(null);

  const [localDirName, setLocalDirName] = useState<string | null>(null);
  const isFsSupported = isFileSystemAccessSupported();

  useEffect(() => {
    if (isFsSupported) {
      void getStoredDirectoryHandle().then((handle) => {
        setLocalDirName(handle?.name || null);
      });
    }
  }, [isFsSupported]);

  const handlePickDirectory = async () => {
    try {
      const handle = await promptChooseDirectory();
      if (handle) {
        setLocalDirName(handle.name);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        alert(`Failed to choose directory: ${e?.message || 'Unknown error'}`);
      }
    }
  };

  const handleClearDirectory = async () => {
    await clearStoredDirectoryHandle();
    setLocalDirName(null);
  };

  const {
    data: rawCheckouts = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<DocumentCheckout[]>({
    queryKey: ['my-checkouts'],
    queryFn: fetchMyCheckouts,
    refetchInterval: 15000,
  });

  const checkouts: DocumentCheckout[] = Array.isArray(rawCheckouts)
    ? rawCheckouts
    : (rawCheckouts as any)?.checkouts || [];

  const cancelMutation = useMutation({
    mutationFn: (path: string) => cancelCheckout(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-checkouts'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['directory-details'] });
    },
    onError: (err: any) => {
      alert(`Failed to cancel checkout: ${err?.message || 'Unknown error'}`);
    },
  });

  const handleCancelClick = (item: DocumentCheckout) => {
    if (
      confirm(
        `Are you sure you want to cancel the checkout for "${item.fs_path}"? Any unsaved local edits will not be checked into CME.`
      )
    ) {
      cancelMutation.mutate(item.fs_path);
    }
  };

  const handleDownloadCopy = async (item: DocumentCheckout) => {
    const filename = item.fs_path.split('/').pop() || item.fs_path;
    await downloadWorkspaceFile(item.fs_path, filename);
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
      className="flex flex-col h-full bg-cme-bg-base overflow-hidden"
      data-testid="checked-out-page"
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-cme-border-base bg-cme-bg-surface">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-cme-text-base">Checked Out Documents</h1>
            <p className="text-xs text-cme-text-muted">
              Documents locked exclusively by you for editing. Check them in when finished to create new versions.
            </p>
          </div>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
          title="Refresh Checkouts"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Directory Setting Banner */}
      <div className="px-6 py-3 border-b border-cme-border-base bg-cme-bg-subtle/40 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-cme-text-muted">
          <FolderCheck className="w-4 h-4 text-cme-primary" />
          <span>
            {isFsSupported ? (
              localDirName ? (
                <>
                  Local checkout directory:{' '}
                  <span className="font-mono font-medium text-cme-text-base bg-cme-bg-surface px-1.5 py-0.5 rounded border border-cme-border-base">
                    {localDirName}
                  </span>
                </>
              ) : (
                'No local checkout folder selected. Checkouts will download using standard browser downloads.'
              )
            ) : (
              'Browser download mode active. (Direct folder sync requires a Chromium browser).'
            )}
          </span>
        </div>

        {isFsSupported && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePickDirectory}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cme-bg-surface hover:bg-cme-bg-hover border border-cme-border-base text-cme-text-base font-medium transition-colors"
              data-testid="choose-checkout-folder-btn"
            >
              <FolderOpen className="w-3.5 h-3.5 text-cme-primary" />
              <span>{localDirName ? 'Change Folder...' : 'Set Checkout Folder...'}</span>
            </button>
            {localDirName && (
              <button
                onClick={handleClearDirectory}
                className="text-cme-text-subtle hover:text-rose-500 transition-colors underline"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table / List */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="py-16 text-center text-xs text-cme-text-muted">
            Loading checked out documents...
          </div>
        ) : checkouts.length === 0 ? (
          <div className="py-20 text-center max-w-sm mx-auto space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
              <Unlock className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-cme-text-base">No Checked Out Documents</h3>
            <p className="text-xs text-cme-text-muted leading-relaxed">
              When you check out a non-markdown file (such as Word documents, spreadsheets, or presentations) from the file tree or directory view, it will appear here while locked for editing.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-cme-bg-subtle/50 border-b border-cme-border-base text-cme-text-muted font-semibold">
                <tr>
                  <th className="py-3 px-4">Document / Path</th>
                  <th className="py-3 px-4 w-44">Checked Out At</th>
                  <th className="py-3 px-4 text-right w-80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cme-border-base/50">
                {checkouts.map((item) => {
                  const filename = item.fs_path.split('/').pop() || item.fs_path;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-cme-bg-hover/40 transition-colors"
                      data-testid={`checkout-row-${filename}`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-cme-text-base truncate">
                              {filename}
                            </div>
                            <div className="text-[11px] text-cme-text-muted font-mono truncate max-w-md">
                              {item.fs_path}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-cme-text-muted">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-cme-text-subtle" />
                          <span>{formatDate(item.checked_out_at)}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Check In Action */}
                          <button
                            onClick={() =>
                              setActiveCheckinTarget({
                                path: item.fs_path,
                                filename,
                              })
                            }
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-cme-primary text-white font-medium hover:bg-cme-primary-hover transition-colors shadow-2xs"
                            title="Upload modified file and release lock"
                            data-testid={`checkin-btn-${filename}`}
                          >
                            <Upload className="w-3 h-3" />
                            <span>Check In</span>
                          </button>

                          {/* Download Copy */}
                          <button
                            onClick={() => void handleDownloadCopy(item)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
                            title="Download current copy again"
                            data-testid={`download-btn-${filename}`}
                          >
                            <Download className="w-3 h-3 text-blue-500" />
                            <span>Download</span>
                          </button>

                          {/* Revisions History */}
                          <button
                            onClick={() =>
                              setActiveHistoryTarget({
                                path: item.fs_path,
                                filename,
                              })
                            }
                            className="flex items-center gap-1 px-2.5 py-1 rounded border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
                            title="View historical revisions"
                            data-testid={`history-btn-${filename}`}
                          >
                            <History className="w-3 h-3 text-indigo-500" />
                            <span>History</span>
                          </button>

                          {/* Cancel Checkout */}
                          <button
                            onClick={() => handleCancelClick(item)}
                            disabled={cancelMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 rounded hover:bg-rose-500/10 text-rose-500 font-medium transition-colors"
                            title="Release lock without replacing file"
                            data-testid={`cancel-checkout-btn-${filename}`}
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {activeCheckinTarget && (
        <CheckinModal
          isOpen={Boolean(activeCheckinTarget)}
          onClose={() => setActiveCheckinTarget(null)}
          path={activeCheckinTarget.path}
          filename={activeCheckinTarget.filename}
          onSuccess={() => refetch()}
        />
      )}

      {activeHistoryTarget && (
        <BinaryHistoryModal
          isOpen={Boolean(activeHistoryTarget)}
          onClose={() => setActiveHistoryTarget(null)}
          path={activeHistoryTarget.path}
          filename={activeHistoryTarget.filename}
        />
      )}
    </div>
  );
};
