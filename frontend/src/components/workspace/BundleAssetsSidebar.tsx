import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Upload,
  Trash2,
  Copy,
  Plus,
  X,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  Check,
  Search,
} from 'lucide-react';
import {
  fetchDocumentAssets,
  uploadDocumentAsset,
  deleteDocumentAsset,
  getWorkspaceFileUrl,
  importWorkspaceFileToBundleAsset,
} from '../../api/documents';
import { DocumentAsset } from '../../types/document';

interface BundleAssetsSidebarProps {
  documentId: string;
  onInsert: (markdown: string) => void;
  onClose: () => void;
}

export const BundleAssetsSidebar: React.FC<BundleAssetsSidebarProps> = ({
  documentId,
  onInsert,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch bundle assets
  const {
    data: assets = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['bundle-assets', documentId],
    queryFn: () => fetchDocumentAssets(documentId),
    enabled: Boolean(documentId),
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return uploadDocumentAsset(documentId, file.name, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bundle-assets', documentId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
    },
    onError: (err: any) => {
      alert(`Failed to upload asset: ${err?.message || 'Unknown error'}`);
    },
  });

  // Import from workspace mutation (for dragging files from tree)
  const importWorkspaceMutation = useMutation({
    mutationFn: async ({ sourcePath, filename }: { sourcePath: string; filename?: string }) => {
      return importWorkspaceFileToBundleAsset(documentId, sourcePath, filename);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bundle-assets', documentId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
    },
    onError: (err: any) => {
      alert(`Failed to import workspace file into bundle: ${err?.message || 'Unknown error'}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      return deleteDocumentAsset(documentId, filename);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bundle-assets', documentId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
    },
    onError: (err: any) => {
      alert(`Failed to delete asset: ${err?.message || 'Unknown error'}`);
    },
  });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      uploadMutation.mutate(files[i]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // 1. Files dropped directly from OS
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
      return;
    }

    // 2. Node dragged from CME file tree
    try {
      const dataStr =
        e.dataTransfer.getData('application/x-cme-node') ||
        e.dataTransfer.getData('application/json');
      if (dataStr) {
        const node = JSON.parse(dataStr);
        if (node?.path) {
          if (node.is_directory && !node.is_bundle) {
            alert('Cannot import an entire directory into bundle assets. Please drag individual files.');
            return;
          }
          importWorkspaceMutation.mutate({ sourcePath: node.path, filename: node.name });
        }
      }
    } catch (err) {
      console.error('Failed to parse dropped workspace node:', err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const getInsertMarkdown = (asset: DocumentAsset) => {
    const refPath = asset.bundle_relative_path || asset.name;
    if (asset.is_image) {
      return `![${asset.name}](${refPath})`;
    }
    return `[${asset.name}](${refPath})`;
  };

  const handleCopyMarkdown = (asset: DocumentAsset) => {
    const md = getInsertMarkdown(asset);
    navigator.clipboard.writeText(md);
    setCopiedName(asset.name);
    setTimeout(() => setCopiedName(null), 2000);
  };

  const handleDelete = (asset: DocumentAsset) => {
    if (confirm(`Delete asset "${asset.name}" from bundle?`)) {
      deleteMutation.mutate(asset.bundle_relative_path || asset.name);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filteredAssets = assets.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="w-80 h-full border-l border-cme-border-base bg-cme-bg-surface flex flex-col flex-shrink-0 select-none z-10"
      data-testid="bundle-assets-sidebar"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cme-border-base bg-cme-bg-surface">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="w-4 h-4 text-purple-500 flex-shrink-0" />
          <h2 className="text-sm font-semibold text-cme-text-base truncate">Bundle Assets</h2>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400">
            {assets.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="Refresh assets"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Upload Dropzone */}
      <div className="p-3 border-b border-cme-border-base">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-cme-border-base hover:border-purple-500/50 hover:bg-cme-bg-hover/50'
          }`}
          data-testid="bundle-assets-dropzone"
        >
          <Upload className="w-5 h-5 mx-auto mb-1 text-purple-500" />
          <p className="text-xs font-medium text-cme-text-base">
            {uploadMutation.isPending
              ? 'Uploading asset...'
              : importWorkspaceMutation.isPending
              ? 'Importing from workspace...'
              : 'Drop files here or click to browse'}
          </p>
          <p className="text-[10px] text-cme-text-muted mt-0.5">Images, PDFs, media & documents</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Search Filter */}
      {assets.length > 3 && (
        <div className="px-3 py-2 border-b border-cme-border-base">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cme-text-muted" />
            <input
              type="text"
              placeholder="Filter assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 text-xs rounded-md bg-cme-bg-base border border-cme-border-base text-cme-text-base focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>
      )}

      {/* Assets List */}
      <div
        className={`flex-1 overflow-y-auto p-3 space-y-2.5 transition-colors ${
          isDragging ? 'ring-2 ring-purple-500/40 ring-inset bg-purple-500/5' : ''
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        data-testid="bundle-assets-list"
      >
        {isLoading ? (
          <div className="text-center py-8 text-xs text-cme-text-muted">Loading bundle assets...</div>
        ) : filteredAssets.length === 0 ? (
          <div className="text-center py-8 px-4 text-xs text-cme-text-muted">
            {searchQuery ? (
              'No assets match your search.'
            ) : (
              <div>
                <ImageIcon className="w-8 h-8 mx-auto mb-2 text-cme-text-subtle/50" />
                <p className="font-medium text-cme-text-base">No assets yet</p>
                <p className="text-[11px] mt-1 text-cme-text-muted">
                  Assets stored inside this bundle will appear here for 1-click editor insertion.
                </p>
              </div>
            )}
          </div>
        ) : (
          filteredAssets.map((asset) => {
            const previewUrl = getWorkspaceFileUrl(asset.relative_path);
            return (
              <div
                key={asset.name}
                className="group p-2 rounded-lg border border-cme-border-base bg-cme-bg-base hover:border-purple-500/40 hover:shadow-sm transition-all"
                data-testid={`bundle-asset-card-${asset.name}`}
              >
                <div className="flex gap-2.5 items-start">
                  {/* Thumbnail / Icon */}
                  <div className="w-12 h-12 rounded bg-cme-bg-subtle flex-shrink-0 flex items-center justify-center overflow-hidden border border-cme-border-base/50">
                    {asset.is_image ? (
                      <img
                        src={previewUrl}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback to icon if preview fails
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <FileText className="w-6 h-6 text-cme-text-muted" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-cme-text-base truncate" title={asset.name}>
                      {asset.name}
                    </p>
                    <p className="text-[10px] text-cme-text-muted mt-0.5">
                      {formatBytes(asset.size_bytes)}
                    </p>
                    <p className="text-[9px] text-cme-text-subtle font-mono truncate mt-0.5">
                      {asset.bundle_relative_path || asset.name}
                    </p>
                  </div>
                </div>

                {/* Actions Bar */}
                <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-cme-border-base/40">
                  <button
                    onClick={() => onInsert(getInsertMarkdown(asset))}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors shadow-xs"
                    title="Insert markdown snippet at cursor position"
                    data-testid={`insert-asset-${asset.name}`}
                  >
                    <Plus className="w-3 h-3" />
                    <span>Insert</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopyMarkdown(asset)}
                      className="p-1 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
                      title="Copy markdown reference"
                    >
                      {copiedName === asset.name ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(asset)}
                      className="p-1 rounded text-cme-text-muted hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                      title="Delete asset"
                      data-testid={`delete-asset-${asset.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
