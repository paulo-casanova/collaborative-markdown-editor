import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Folder,
  FolderPlus,
  FilePlus,
  FileText,
  Package,
  File,
  Shield,
  Trash2,
  RefreshCw,
  Search,
  MessageSquare,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  User,
  ArrowUpDown,
  Home,
  X,
  Edit2,
} from 'lucide-react';
import {
  fetchDirectoryDashboard,
  createDocument,
  createDirectory,
  renameDirectory,
  deleteDirectory,
  deleteDocument,
} from '../../api/documents';
import { DirectoryDashboard, DirectoryDashboardItem } from '../../types/document';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { AccessControlModal } from './AccessControlModal';

interface DirectoryViewProps {
  path: string;
}

type SortField = 'name' | 'type' | 'owner' | 'updated_at' | 'metrics';
type SortOrder = 'asc' | 'desc';

export const DirectoryView: React.FC<DirectoryViewProps> = ({ path }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { openTab, closeTab } = useWorkspaceStore();
  const cleanPath = (path || '').replace(/^\/+/, '').replace(/\/+$/, '');

  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // New Item Modals State
  const [isCreatingDoc, setIsCreatingDoc] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [isCreatingBundle, setIsCreatingBundle] = useState(false);
  const [isCreatingDir, setIsCreatingDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');

  // ACL Modal State
  const [aclTarget, setAclTarget] = useState<{
    targetType: 'DOCUMENT' | 'DIRECTORY';
    targetId?: string;
    directoryPath?: string;
    title: string;
  } | null>(null);

  // Fetch directory dashboard
  const {
    data: dashboard,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<DirectoryDashboard>({
    queryKey: ['directory-details', cleanPath],
    queryFn: () => fetchDirectoryDashboard(cleanPath),
  });

  // Create Document mutation
  const createDocMutation = useMutation({
    mutationFn: async ({ name, isBundle }: { name: string; isBundle: boolean }) => {
      let docPath = cleanPath ? `${cleanPath}/${name}` : name;
      if (isBundle && !docPath.endsWith('.bundle')) {
        docPath += '.bundle';
      } else if (!isBundle && !docPath.endsWith('.md')) {
        docPath += '.md';
      }
      return createDocument({
        path: docPath,
        content: `# ${name}\n\nStart writing here...`,
      });
    },
    onSuccess: (newDoc) => {
      queryClient.invalidateQueries({ queryKey: ['directory-details', cleanPath] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      setIsCreatingDoc(false);
      setIsCreatingBundle(false);
      setNewDocName('');
      openTab({
        id: newDoc.id,
        path: newDoc.path,
        title: newDoc.title || newDoc.path,
        is_bundle: Boolean(newDoc.is_bundle && newDoc.path.endsWith('.bundle')),
      });
      navigate(`/documents/${newDoc.id}`);
    },
    onError: (err: any) => {
      alert(`Failed to create document: ${err?.message || 'Unknown error'}`);
    },
  });

  // Create Directory mutation
  const createDirMutation = useMutation({
    mutationFn: async (dirName: string) => {
      const fullPath = cleanPath ? `${cleanPath}/${dirName}` : dirName;
      return createDirectory(fullPath);
    },
    onSuccess: (createdPath) => {
      queryClient.invalidateQueries({ queryKey: ['directory-details', cleanPath] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      setIsCreatingDir(false);
      setNewDirName('');
      openDirectoryTab(createdPath.path);
    },
    onError: (err: any) => {
      alert(`Failed to create directory: ${err?.message || 'Unknown error'}`);
    },
  });

  // Delete Document mutation
  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      return deleteDocument(docId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['directory-details', cleanPath] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
    },
    onError: (err: any) => {
      alert(`Failed to delete document: ${err?.message || 'Unknown error'}`);
    },
  });

  // Delete Directory mutation
  const deleteDirMutation = useMutation({
    mutationFn: async (dirPath: string) => {
      return deleteDirectory(dirPath);
    },
    onSuccess: (_data, deletedPath) => {
      queryClient.invalidateQueries({ queryKey: ['directory-details'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });

      // If we deleted the current directory we are viewing, close tab & navigate away
      if (cleanPath === deletedPath || cleanPath.startsWith(deletedPath + '/')) {
        closeTab(`dir:${cleanPath}`);
        const parent = deletedPath.substring(0, deletedPath.lastIndexOf('/'));
        openDirectoryTab(parent);
      }
    },
    onError: (err: any) => {
      alert(`Failed to delete folder: ${err?.message || 'Unknown error'}`);
    },
  });

  // Rename Directory mutation
  const renameDirMutation = useMutation({
    mutationFn: async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
      return renameDirectory(oldPath, newPath);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['directory-details'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });

      if (cleanPath === res.old_path) {
        closeTab(`dir:${cleanPath}`);
        openDirectoryTab(res.new_path);
      }
    },
    onError: (err: any) => {
      alert(`Failed to rename directory: ${err?.message || 'Unknown error'}`);
    },
  });

  const openDirectoryTab = (dirPath: string) => {
    const norm = (dirPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
    const tabId = `dir:${norm}`;
    const segments = norm.split('/').filter(Boolean);
    const title = segments.length > 0 ? segments[segments.length - 1] : 'Root';

    openTab({
      id: tabId,
      path: norm,
      title,
      is_directory: true,
    });
    navigate(`/documents/${tabId}`);
  };

  const openDocumentTab = (item: DirectoryDashboardItem) => {
    if (!item.id) return;
    openTab({
      id: item.id,
      path: item.path,
      title: item.title || item.name,
      is_bundle: Boolean(item.is_bundle && item.path.endsWith('.bundle')),
    });
    navigate(`/documents/${item.id}`);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Breadcrumbs calculation
  const pathSegments = useMemo(() => {
    if (!cleanPath) return [];
    const parts = cleanPath.split('/').filter(Boolean);
    return parts.map((part, index) => {
      const subPath = parts.slice(0, index + 1).join('/');
      return { name: part, path: subPath };
    });
  }, [cleanPath]);

  // Filter and sort items
  const filteredAndSortedItems = useMemo(() => {
    const items = dashboard?.items ? [...dashboard.items] : [];
    const filtered = items.filter((item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.owner_name && item.owner_name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return filtered.sort((a, b) => {
      // Directories first if not sorting specifically by field
      if (sortField === 'name') {
        if (a.is_directory !== b.is_directory) {
          return a.is_directory ? -1 : 1;
        }
      }

      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = (a.title || a.name).localeCompare(b.title || b.name);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'owner':
          cmp = (a.owner_name || '').localeCompare(b.owner_name || '');
          break;
        case 'updated_at':
          cmp = (a.updated_at || '').localeCompare(b.updated_at || '');
          break;
        case 'metrics': {
          const aMetrics = a.comments_count + a.suggestions_count + a.open_tasks_count;
          const bMetrics = b.comments_count + b.suggestions_count + b.open_tasks_count;
          cmp = aMetrics - bMetrics;
          break;
        }
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [dashboard, searchQuery, sortField, sortOrder]);

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
      className="flex flex-col h-full bg-cme-bg-base overflow-hidden"
      data-testid="directory-dashboard-view"
    >
      {/* Top Header / Breadcrumb & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-cme-border-base bg-cme-bg-surface">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-1.5 text-xs text-cme-text-muted flex-wrap">
          <button
            onClick={() => openDirectoryTab('')}
            className={`flex items-center gap-1 hover:text-cme-text-base transition-colors ${
              !cleanPath ? 'font-bold text-cme-text-base' : ''
            }`}
          >
            <Home className="w-3.5 h-3.5 text-cme-primary" />
            <span>Root</span>
          </button>

          {pathSegments.map((seg, idx) => {
            const isLast = idx === pathSegments.length - 1;
            return (
              <React.Fragment key={seg.path}>
                <ChevronRight className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
                <button
                  onClick={() => openDirectoryTab(seg.path)}
                  className={`hover:text-cme-text-base transition-colors ${
                    isLast ? 'font-bold text-cme-text-base' : ''
                  }`}
                >
                  {seg.name}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Directory Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsCreatingDoc(true);
              setIsCreatingBundle(false);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors shadow-xs"
            data-testid="dir-new-doc-btn"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span>New Doc</span>
          </button>

          <button
            onClick={() => {
              setIsCreatingDoc(true);
              setIsCreatingBundle(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-xs"
            data-testid="dir-new-bundle-btn"
          >
            <Package className="w-3.5 h-3.5" />
            <span>New Bundle</span>
          </button>

          <button
            onClick={() => setIsCreatingDir(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
            data-testid="dir-new-folder-btn"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>New Folder</span>
          </button>

          {cleanPath && (
            <>
              <button
                onClick={() => {
                  const segments = cleanPath.split('/').filter(Boolean);
                  const currentName = segments[segments.length - 1];
                  const newName = prompt(`Rename folder "${currentName}" to:`, currentName);
                  if (newName && newName.trim() && newName.trim() !== currentName) {
                    const parent = cleanPath.substring(0, cleanPath.lastIndexOf('/'));
                    const newPath = parent ? `${parent}/${newName.trim()}` : newName.trim();
                    renameDirMutation.mutate({ oldPath: cleanPath, newPath });
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
                title="Rename folder"
                data-testid="dir-header-rename-btn"
              >
                <Edit2 className="w-3.5 h-3.5 text-sky-500" />
                <span>Rename</span>
              </button>
              <button
                onClick={() => {
                  if (confirm(`Move folder "${cleanPath}" and all its contents to trash?`)) {
                    deleteDirMutation.mutate(cleanPath);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-rose-500/30 bg-cme-bg-base hover:bg-rose-500/10 text-rose-500 transition-colors"
                title="Delete folder to trash"
                data-testid="dir-header-delete-btn"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </>
          )}

          <button
            onClick={() =>
              setAclTarget({
                targetType: 'DIRECTORY',
                directoryPath: cleanPath,
                title: cleanPath || 'Root Workspace',
              })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
            title="Manage directory access control"
            data-testid="dir-access-btn"
          >
            <Shield className="w-3.5 h-3.5 text-blue-500" />
            <span>Permissions</span>
          </button>

          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="Refresh dashboard"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Inline Creation Popovers */}
      {isCreatingDoc && (
        <div className="px-6 py-3 bg-cme-bg-surface border-b border-cme-border-base flex items-center gap-3">
          <span className="text-xs font-semibold text-cme-text-base">
            {isCreatingBundle ? 'New Bundle Title:' : 'New Document Title:'}
          </span>
          <input
            type="text"
            placeholder={isCreatingBundle ? 'System Architecture' : 'Getting Started'}
            value={newDocName}
            onChange={(e) => setNewDocName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newDocName.trim()) {
                createDocMutation.mutate({ name: newDocName.trim(), isBundle: isCreatingBundle });
              }
            }}
            className="px-3 py-1 text-xs rounded-md bg-cme-bg-base border border-cme-border-base text-cme-text-base w-64"
            autoFocus
          />
          <button
            onClick={() =>
              newDocName.trim() &&
              createDocMutation.mutate({ name: newDocName.trim(), isBundle: isCreatingBundle })
            }
            disabled={!newDocName.trim() || createDocMutation.isPending}
            className="px-3 py-1 text-xs rounded-md bg-cme-primary text-white font-medium hover:bg-cme-primary/90 disabled:opacity-50"
          >
            Create
          </button>
          <button
            onClick={() => setIsCreatingDoc(false)}
            className="p-1 text-cme-text-muted hover:text-cme-text-base"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isCreatingDir && (
        <div className="px-6 py-3 bg-cme-bg-surface border-b border-cme-border-base flex items-center gap-3">
          <span className="text-xs font-semibold text-cme-text-base">New Folder Name:</span>
          <input
            type="text"
            placeholder="e.g. specifications"
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newDirName.trim()) {
                createDirMutation.mutate(newDirName.trim());
              }
            }}
            className="px-3 py-1 text-xs rounded-md bg-cme-bg-base border border-cme-border-base text-cme-text-base w-64"
            autoFocus
          />
          <button
            onClick={() => newDirName.trim() && createDirMutation.mutate(newDirName.trim())}
            disabled={!newDirName.trim() || createDirMutation.isPending}
            className="px-3 py-1 text-xs rounded-md bg-cme-primary text-white font-medium hover:bg-cme-primary/90 disabled:opacity-50"
          >
            Create Folder
          </button>
          <button
            onClick={() => setIsCreatingDir(false)}
            className="p-1 text-cme-text-muted hover:text-cme-text-base"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter and Item Count Bar */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-cme-border-base bg-cme-bg-base">
        <div className="flex items-center gap-2 text-xs text-cme-text-muted">
          <span>{filteredAndSortedItems.length} items</span>
        </div>
        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cme-text-muted" />
          <input
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1 text-xs rounded-lg bg-cme-bg-surface border border-cme-border-base text-cme-text-base focus:outline-none focus:border-cme-primary"
          />
        </div>
      </div>

      {/* Interactive Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 bg-cme-bg-surface border-b border-cme-border-base text-cme-text-muted font-semibold z-10">
            <tr>
              <th
                onClick={() => handleSort('name')}
                className="py-3 px-6 cursor-pointer hover:text-cme-text-base select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Name</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th
                onClick={() => handleSort('type')}
                className="py-3 px-4 cursor-pointer hover:text-cme-text-base select-none w-28"
              >
                <div className="flex items-center gap-1.5">
                  <span>Type</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th
                onClick={() => handleSort('owner')}
                className="py-3 px-4 cursor-pointer hover:text-cme-text-base select-none w-40"
              >
                <div className="flex items-center gap-1.5">
                  <span>Owner</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th
                onClick={() => handleSort('metrics')}
                className="py-3 px-4 cursor-pointer hover:text-cme-text-base select-none w-44"
              >
                <div className="flex items-center gap-1.5">
                  <span>Open Reviews</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th
                onClick={() => handleSort('updated_at')}
                className="py-3 px-4 cursor-pointer hover:text-cme-text-base select-none w-44"
              >
                <div className="flex items-center gap-1.5">
                  <span>Last Modified</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3 px-6 text-right w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cme-border-base/50">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-cme-text-muted">
                  Loading directory contents...
                </td>
              </tr>
            ) : filteredAndSortedItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-cme-text-muted">
                  {searchQuery ? (
                    'No items match your search filter.'
                  ) : (
                    <div className="space-y-1">
                      <Folder className="w-8 h-8 mx-auto text-cme-text-subtle mb-2" />
                      <p className="font-medium text-cme-text-base">This directory is empty</p>
                      <p className="text-xs">Create a new document or subfolder above.</p>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              filteredAndSortedItems.map((item) => {
                const isBundle = Boolean(item.is_bundle && item.path.endsWith('.bundle'));
                const isDir = item.is_directory && !isBundle;
                return (
                  <tr
                    key={item.path}
                    className="hover:bg-cme-bg-hover/60 transition-colors group"
                    data-testid={`dir-row-${item.name}`}
                  >
                    {/* Name */}
                    <td className="py-3 px-6">
                      <div
                        onClick={() => {
                          if (isDir) {
                            openDirectoryTab(item.path);
                          } else {
                            openDocumentTab(item);
                          }
                        }}
                        className="flex items-center gap-2.5 cursor-pointer max-w-md truncate"
                      >
                        {isBundle ? (
                          <Package className="w-4 h-4 text-purple-500 flex-shrink-0" />
                        ) : isDir ? (
                          <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        ) : item.type === 'document' ? (
                          <FileText className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        ) : (
                          <File className="w-4 h-4 text-cme-text-muted flex-shrink-0" />
                        )}
                        <span className="font-medium text-cme-text-base hover:text-cme-primary hover:underline truncate">
                          {item.title || item.name}
                        </span>
                      </div>
                    </td>

                    {/* Type Badge & Size */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-0.5">
                        {isBundle ? (
                          <span className="w-fit px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400">
                            Bundle
                          </span>
                        ) : isDir ? (
                          <span className="w-fit px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            Directory
                          </span>
                        ) : (
                          <span className="w-fit px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            Markdown
                          </span>
                        )}
                        {!isDir && item.size_bytes !== undefined && (
                          <span className="text-[10px] text-cme-text-muted">
                            {formatBytes(item.size_bytes)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Owner */}
                    <td className="py-3 px-4">
                      {item.owner_name ? (
                        <div className="flex items-center gap-1.5 truncate">
                          <User className="w-3.5 h-3.5 text-cme-text-muted flex-shrink-0" />
                          <span className="text-cme-text-base truncate">{item.owner_name}</span>
                        </div>
                      ) : (
                        <span className="text-cme-text-subtle">—</span>
                      )}
                    </td>

                    {/* Open Reviews Metrics */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {item.comments_count > 0 && (
                          <span
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            title={`${item.comments_count} open comments`}
                          >
                            <MessageSquare className="w-3 h-3" />
                            {item.comments_count}
                          </span>
                        )}
                        {item.suggestions_count > 0 && (
                          <span
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400"
                            title={`${item.suggestions_count} pending suggestions`}
                          >
                            <Sparkles className="w-3 h-3" />
                            {item.suggestions_count}
                          </span>
                        )}
                        {item.open_tasks_count > 0 && (
                          <span
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            title={`${item.open_tasks_count} open tasks`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {item.open_tasks_count}
                          </span>
                        )}
                        {item.comments_count === 0 &&
                          item.suggestions_count === 0 &&
                          item.open_tasks_count === 0 && (
                            <span className="text-cme-text-subtle text-[11px]">—</span>
                          )}
                      </div>
                    </td>

                    {/* Last Modified */}
                    <td className="py-3 px-4 text-cme-text-muted text-[11px]">
                      {formatDate(item.updated_at)}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-6 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() =>
                            setAclTarget({
                              targetType: isDir ? 'DIRECTORY' : 'DOCUMENT',
                              targetId: item.id,
                              directoryPath: isDir ? item.path : undefined,
                              title: item.title || item.name,
                            })
                          }
                          className="p-1 rounded hover:bg-cme-bg-surface text-cme-text-muted hover:text-blue-500 transition-colors"
                          title="Manage permissions"
                        >
                          <Shield className="w-3.5 h-3.5" />
                        </button>

                        {isDir ? (
                          <>
                            <button
                              onClick={() => {
                                const newName = prompt(`Rename folder "${item.name}" to:`, item.name);
                                if (newName && newName.trim() && newName.trim() !== item.name) {
                                  const parent = item.path.substring(0, item.path.lastIndexOf('/'));
                                  const newPath = parent ? `${parent}/${newName.trim()}` : newName.trim();
                                  renameDirMutation.mutate({ oldPath: item.path, newPath });
                                }
                              }}
                              className="p-1 rounded hover:bg-cme-bg-surface text-cme-text-muted hover:text-sky-500 transition-colors"
                              title="Rename folder"
                              data-testid={`dir-row-rename-${item.name}`}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Move folder "${item.name}" and all its contents to trash?`)) {
                                  deleteDirMutation.mutate(item.path);
                                }
                              }}
                              className="p-1 rounded hover:bg-rose-500/10 text-cme-text-muted hover:text-rose-500 transition-colors"
                              title="Delete folder"
                              data-testid={`dir-row-delete-${item.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : item.id ? (
                          <button
                            onClick={() => {
                              if (confirm(`Move "${item.name}" to trash?`)) {
                                deleteMutation.mutate(item.id!);
                              }
                            }}
                            className="p-1 rounded hover:bg-rose-500/10 text-cme-text-muted hover:text-rose-500 transition-colors"
                            title="Delete document"
                            data-testid={`dir-row-delete-${item.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Access Control Modal */}
      {aclTarget && (
        <AccessControlModal
          isOpen={Boolean(aclTarget)}
          onClose={() => setAclTarget(null)}
          targetType={aclTarget.targetType}
          targetId={aclTarget.targetId}
          directoryPath={aclTarget.directoryPath}
          title={aclTarget.title}
        />
      )}
    </div>
  );
};
