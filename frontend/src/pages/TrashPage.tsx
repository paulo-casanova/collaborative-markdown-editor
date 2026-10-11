import React, { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trash2,
  ArrowLeft,
  RotateCcw,
  FileText,
  Package,
  Folder,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useUIStore } from '../stores/uiStore';
import { fetchTrash, restoreTrash, purgeTrash } from '../api/documents';
import { TrashNode } from '../types/document';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const TrashPage: React.FC = () => {
  const { setBreadcrumbs } = useUIStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Workspaces', path: '/' },
      { label: 'Trash Bin', isCurrent: true },
    ]);
  }, [setBreadcrumbs]);

  const {
    data: trashItems,
    isLoading,
  } = useQuery({
    queryKey: ['trash-items'],
    queryFn: fetchTrash,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreTrash(id),
    onSuccess: (restoredDoc) => {
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      if (confirm(`Document "${restoredDoc.title || restoredDoc.path}" restored successfully! Open now?`)) {
        navigate(`/documents/${restoredDoc.id}`);
      }
    },
    onError: (err: any) => {
      alert(`Failed to restore item: ${err.message || 'Unknown error'}`);
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => purgeTrash(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
    },
    onError: (err: any) => {
      alert(`Failed to purge item: ${err.message || 'Unknown error'}`);
    },
  });

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-cme-border-base">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-cme-text-base">Trash Explorer</h1>
            <p className="text-xs text-cme-text-muted">
              Recover soft-deleted documents or permanently purge them from disk storage.
            </p>
          </div>
        </div>
        <Link
          to="/"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-cme-text-base transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Workspaces</span>
        </Link>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-cme-text-muted animate-pulse">
          Loading trash items...
        </div>
      ) : trashItems && trashItems.length > 0 ? (
        <div className="border border-cme-border-base rounded-2xl overflow-hidden bg-cme-bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="trash-table">
              <thead className="bg-cme-bg-subtle/50 text-cme-text-muted uppercase text-[10px] tracking-wider border-b border-cme-border-base">
                <tr>
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-4">Original Path</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Deleted At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cme-border-base/50">
                {trashItems.map((item: TrashNode) => (
                  <tr
                    key={item.id}
                    className="hover:bg-cme-bg-hover/50 transition-colors"
                    data-testid="trash-item-row"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {item.is_bundle ? (
                          <Package className="w-4 h-4 text-purple-500 flex-shrink-0" />
                        ) : item.is_directory ? (
                          <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-cme-text-muted flex-shrink-0" />
                        )}
                        <span className="font-medium text-cme-text-base truncate max-w-xs">
                          {item.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-cme-text-muted font-mono text-[11px] truncate max-w-xs">
                      {item.path}
                    </td>
                    <td className="py-3 px-4 text-cme-text-muted font-mono text-[11px]">
                      {formatBytes(item.size_bytes)}
                    </td>
                    <td className="py-3 px-4 text-cme-text-muted text-[11px]">
                      {item.deleted_at ? new Date(item.deleted_at).toLocaleString() : 'Recently'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => restoreMutation.mutate(item.id)}
                          disabled={restoreMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-emerald-500/10 hover:text-emerald-500 text-cme-text-base transition-colors"
                          title="Restore back to workspace"
                          data-testid="restore-trash-btn"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restore</span>
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Permanently purge "${item.name}" from disk? This cannot be undone.`)) {
                              purgeMutation.mutate(item.id);
                            }
                          }}
                          disabled={purgeMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors"
                          title="Permanently Purge"
                          data-testid="purge-trash-btn"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Purge</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center border-2 border-dashed border-cme-border-base rounded-2xl space-y-3 bg-cme-bg-surface">
          <Trash2 className="w-10 h-10 text-cme-text-subtle mx-auto" />
          <h3 className="font-semibold text-sm text-cme-text-base">Trash bin is clean</h3>
          <p className="text-xs text-cme-text-muted max-w-sm mx-auto">
            Documents soft-deleted are safely preserved in the POSIX <code className="font-mono">trash/</code> directory
            and can be restored at any time.
          </p>
        </div>
      )}
    </div>
  );
};
