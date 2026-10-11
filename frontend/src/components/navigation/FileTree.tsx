import React, { useState, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Package,
  Plus,
  FolderPlus,
  Trash2,
  Edit2,
  RefreshCw,
  MoreVertical,
} from 'lucide-react';
import {
  fetchWorkspaceTree,
  createDocument,
  moveDocument,
  deleteDocument,
} from '../../api/documents';
import { WorkspaceNode } from '../../types/document';

interface TreeNode extends WorkspaceNode {
  children?: TreeNode[];
}

function buildTree(nodes: WorkspaceNode[]): TreeNode[] {
  const rootNodes: TreeNode[] = [];
  const map = new Map<string, TreeNode>();

  for (const node of nodes) {
    const parts = node.path.split('/');
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      if (!map.has(currentPath)) {
        const dirNode: TreeNode = {
          name: parts[i],
          path: currentPath,
          is_directory: true,
          is_bundle: false,
          children: [],
        };
        map.set(currentPath, dirNode);
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
        if (parentPath && map.has(parentPath)) {
          map.get(parentPath)!.children!.push(dirNode);
        } else {
          rootNodes.push(dirNode);
        }
      }
    }

    const isFolder = node.is_directory && !node.is_bundle;
    const treeNode: TreeNode = {
      ...node,
      children: isFolder ? [] : undefined,
    };
    map.set(node.path, treeNode);

    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
    if (parentPath && map.has(parentPath)) {
      const parent = map.get(parentPath)!;
      if (!parent.children) parent.children = [];
      if (!parent.children.some((c) => c.path === treeNode.path)) {
        parent.children.push(treeNode);
      }
    } else {
      if (!rootNodes.some((r) => r.path === treeNode.path)) {
        rootNodes.push(treeNode);
      }
    }
  }

  const sortRecursive = (list: TreeNode[]) => {
    list.sort((a, b) => {
      if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of list) {
      if (item.children) sortRecursive(item.children);
    }
  };

  sortRecursive(rootNodes);
  return rootNodes;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: WorkspaceNode;
}

export const FileTree: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(['guides', 'specs', 'docs'])
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<
    'new-doc' | 'new-folder' | 'rename' | null
  >(null);
  const [activeNode, setActiveNode] = useState<WorkspaceNode | null>(null);
  const [inputValue, setInputValue] = useState('');

  const {
    data: rawNodes,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['workspace-tree'],
    queryFn: fetchWorkspaceTree,
    retry: false,
  });

  const tree = useMemo(() => {
    if (!rawNodes || !Array.isArray(rawNodes)) return [];
    return buildTree(rawNodes);
  }, [rawNodes]);

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const createDocMutation = useMutation({
    mutationFn: (payload: { path: string; title?: string; content?: string }) =>
      createDocument(payload),
    onSuccess: (newDoc) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      setModalMode(null);
      setInputValue('');
      navigate(`/documents/${newDoc.id}`);
    },
    onError: (err: any) => {
      alert(`Failed to create document: ${err.message || 'Unknown error'}`);
    },
  });

  const moveDocMutation = useMutation({
    mutationFn: ({ id, newPath }: { id: string; newPath: string }) =>
      moveDocument(id, newPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      setModalMode(null);
      setInputValue('');
    },
    onError: (err: any) => {
      alert(`Failed to move/rename document: ${err.message || 'Unknown error'}`);
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      setContextMenu(null);
    },
    onError: (err: any) => {
      alert(`Failed to delete document: ${err.message || 'Unknown error'}`);
    },
  });

  // Handle right-click context menu
  const handleContextMenu = (e: React.MouseEvent, node: WorkspaceNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    });
  };

  // Close context menu on outside click
  React.useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, node: WorkspaceNode) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ id: node.id, path: node.path, name: node.name })
    );
  };

  const handleDragOver = (e: React.DragEvent, node: WorkspaceNode) => {
    if (node.is_directory && !node.is_bundle) {
      e.preventDefault();
      setDragOverPath(node.path);
    }
  };

  const handleDragLeave = (_e: React.DragEvent, node: WorkspaceNode) => {
    if (dragOverPath === node.path) {
      setDragOverPath(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetNode: WorkspaceNode) => {
    e.preventDefault();
    setDragOverPath(null);
    if (!targetNode.is_directory || targetNode.is_bundle) return;

    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const draggedNode = JSON.parse(dataStr);
      if (!draggedNode.id || draggedNode.path === targetNode.path) return;

      const targetPath = `${targetNode.path}/${draggedNode.name}`;
      if (draggedNode.path === targetPath) return;

      moveDocMutation.mutate({
        id: draggedNode.id,
        newPath: targetPath,
      });
    } catch {
      // Ignore parse failure
    }
  };

  // Modal Submit Action
  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    if (modalMode === 'new-doc') {
      const parentDir = activeNode
        ? activeNode.is_directory
          ? activeNode.path
          : activeNode.path.substring(0, activeNode.path.lastIndexOf('/'))
        : '';
      let filename = inputValue.trim();
      if (!filename.endsWith('.md') && !filename.endsWith('.bundle')) {
        filename += '.md';
      }
      const fullPath = parentDir ? `${parentDir}/${filename}` : filename;
      createDocMutation.mutate({
        path: fullPath,
        title: filename.replace(/\.(md|bundle)$/, ''),
        content: `# ${filename.replace(/\.(md|bundle)$/, '')}\n\n`,
      });
    } else if (modalMode === 'new-folder') {
      const parentDir = activeNode
        ? activeNode.is_directory
          ? activeNode.path
          : activeNode.path.substring(0, activeNode.path.lastIndexOf('/'))
        : '';
      const folderName = inputValue.trim();
      const fullPath = parentDir
        ? `${parentDir}/${folderName}/README.md`
        : `${folderName}/README.md`;
      createDocMutation.mutate({
        path: fullPath,
        title: 'README',
        content: `# ${folderName}\n\nFolder documentation.\n`,
      });
    } else if (modalMode === 'rename' && activeNode && activeNode.id) {
      const oldPath = activeNode.path;
      const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
      let newName = inputValue.trim();
      if (!newName.includes('.')) {
        newName += oldPath.endsWith('.bundle') ? '.bundle' : '.md';
      }
      const newPath = dir ? `${dir}/${newName}` : newName;
      moveDocMutation.mutate({
        id: activeNode.id,
        newPath,
      });
    }
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isDoc = !node.is_directory || node.is_bundle;
    const isExpanded = expandedPaths.has(node.path);
    const paddingLeft = `${depth * 14 + 8}px`;
    const isDragTarget = dragOverPath === node.path;

    if (isDoc) {
      const docLink = node.id
        ? `/documents/${node.id}`
        : `/documents/by-path?path=${encodeURIComponent(node.path)}`;
      const isActive =
        node.id && location.pathname.includes(node.id) ||
        location.search.includes(encodeURIComponent(node.path));

      return (
        <div
          key={node.path}
          draggable={Boolean(node.id)}
          onDragStart={(e) => handleDragStart(e, node)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          style={{ paddingLeft }}
          className={`group flex items-center justify-between py-1.5 pr-2 text-xs rounded-lg transition-colors cursor-pointer select-none ${
            isActive
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <Link
            to={docLink}
            className="flex items-center gap-2 min-w-0 flex-1 truncate"
            title={node.title || node.name}
          >
            {node.is_bundle ? (
              <Package className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
            )}
            <span className="truncate">{node.title || node.name}</span>
          </Link>

          <button
            onClick={(e) => handleContextMenu(e, node)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted transition-opacity"
            title="Options"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </div>
      );
    }

    return (
      <div key={node.path} className="space-y-0.5">
        <div
          style={{ paddingLeft }}
          onClick={() => toggleExpand(node.path)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          onDragOver={(e) => handleDragOver(e, node)}
          onDragLeave={(e) => handleDragLeave(e, node)}
          onDrop={(e) => handleDrop(e, node)}
          className={`group flex items-center justify-between py-1.5 pr-2 text-xs font-medium rounded-lg cursor-pointer transition-colors select-none ${
            isDragTarget
              ? 'bg-cme-primary/20 border border-cme-primary text-cme-primary'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleContextMenu(e, node);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted transition-opacity"
            title="Folder Options"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </div>

        {isExpanded && node.children && (
          <div className="space-y-0.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* FileTree Header & Quick Actions */}
      <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-cme-border-base/50">
        <span className="text-[11px] font-bold uppercase tracking-wider text-cme-text-subtle">
          Files & Bundles
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setActiveNode(null);
              setInputValue('');
              setModalMode('new-doc');
            }}
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="New Document"
            data-testid="filetree-new-doc-btn"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setActiveNode(null);
              setInputValue('');
              setModalMode('new-folder');
            }}
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="New Folder"
            data-testid="filetree-new-folder-btn"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className={`p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors ${
              isRefetching ? 'animate-spin' : ''
            }`}
            title="Refresh Explorer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Directory Node Tree */}
      <div
        className="flex-1 overflow-y-auto space-y-0.5 pr-1"
        data-testid="file-tree-container"
      >
        {isLoading ? (
          <div className="py-6 text-center text-xs text-cme-text-muted animate-pulse">
            Loading files...
          </div>
        ) : tree.length > 0 ? (
          tree.map((node) => renderNode(node, 0))
        ) : (
          <div className="py-6 text-center text-xs text-cme-text-muted italic">
            Workspace is empty.
          </div>
        )}
      </div>

      {/* Context Menu Popup */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-44 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl py-1 text-xs select-none backdrop-blur-md"
          data-testid="filetree-context-menu"
        >
          {contextMenu.node.is_directory && (
            <>
              <button
                onClick={() => {
                  setActiveNode(contextMenu.node);
                  setInputValue('');
                  setModalMode('new-doc');
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
              >
                <Plus className="w-3.5 h-3.5 text-cme-primary" />
                <span>New Document</span>
              </button>
              <button
                onClick={() => {
                  setActiveNode(contextMenu.node);
                  setInputValue('');
                  setModalMode('new-folder');
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
              >
                <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                <span>New Folder</span>
              </button>
              <div className="my-1 border-t border-cme-border-base" />
            </>
          )}

          {contextMenu.node.id && (
            <>
              <button
                onClick={() => {
                  setActiveNode(contextMenu.node);
                  setInputValue(contextMenu.node.name);
                  setModalMode('rename');
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
              >
                <Edit2 className="w-3.5 h-3.5 text-sky-500" />
                <span>Rename</span>
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Move "${contextMenu.node.name}" to Trash? You can restore it later.`
                    )
                  ) {
                    deleteDocMutation.mutate(contextMenu.node.id!);
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-500/10 text-rose-500 text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete to Trash</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Creation / Rename Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-cme-border-base bg-cme-bg-surface p-5 shadow-2xl space-y-4">
            <h3 className="font-semibold text-sm text-cme-text-base">
              {modalMode === 'new-doc' && 'Create New Document'}
              {modalMode === 'new-folder' && 'Create New Folder'}
              {modalMode === 'rename' && 'Rename Item'}
            </h3>

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-cme-text-muted mb-1.5">
                  {modalMode === 'new-doc' && 'Document Name (.md or .bundle)'}
                  {modalMode === 'new-folder' && 'Folder Name'}
                  {modalMode === 'rename' && 'New Name'}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={
                    modalMode === 'new-doc'
                      ? 'e.g. quickstart.md'
                      : modalMode === 'new-folder'
                      ? 'e.g. engineering'
                      : 'new-name.md'
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                  data-testid="filetree-modal-input"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!inputValue.trim()}
                  className="px-4 py-1.5 text-xs rounded-lg bg-cme-primary hover:bg-cme-primary-hover text-white font-medium transition-colors disabled:opacity-50"
                  data-testid="filetree-modal-submit"
                >
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
