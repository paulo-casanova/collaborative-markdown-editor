import React, { useState, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  File as FileIcon,
  Image as ImageIcon,
  Package,
  Plus,
  FolderPlus,
  Upload,
  Trash2,
  Edit2,
  RefreshCw,
  MoreVertical,
  Shield,
  Download,
  Link2,
} from 'lucide-react';
import {
  fetchWorkspaceTree,
  createDocument,
  createDirectory,
  renameDirectory,
  deleteDirectory,
  moveDocument,
  convertDocument,
  deleteDocument,
  uploadWorkspaceFile,
  getWorkspaceFileUrl,
  isMarkdownPath,
  downloadWorkspaceFile,
  downloadBundleZip,
} from '../../api/documents';
import { fetchCurrentUser } from '../../api/auth';
import { WorkspaceNode } from '../../types/document';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUIStore } from '../../stores/uiStore';
import { updateKnownWorkspaceNodes } from '../../utils/linkValidator';
import { AccessControlModal } from '../workspace/AccessControlModal';

function isImagePath(path: string): boolean {
  const lower = (path || '').toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.ico')
  );
}

export interface TreeNode extends WorkspaceNode {
  children?: TreeNode[];
}

export function buildTree(nodes: WorkspaceNode[]): TreeNode[] {
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

    const isBundle = Boolean(node.is_bundle && node.path.endsWith('.bundle'));
    const isFolder = node.is_directory && !isBundle;

    const existing = map.get(node.path);
    if (existing) {
      Object.assign(existing, node, {
        is_bundle: isBundle,
        children: isFolder ? (existing.children || []) : undefined,
      });
    } else {
      const treeNode: TreeNode = {
        ...node,
        is_bundle: isBundle,
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
  const { viewMode } = useUIStore();
  const { openTab, updateTabMetadata, closeTab } = useWorkspaceStore();

  const isReadMode = viewMode === 'read' || location.pathname.startsWith('/docs/');
  const baseDocRoute = isReadMode ? '/docs' : '/documents';

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
  const [uploadTargetDir, setUploadTargetDir] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [aclTarget, setAclTarget] = useState<{
    targetType: 'DOCUMENT' | 'DIRECTORY';
    targetId?: string;
    directoryPath?: string;
    title: string;
  } | null>(null);

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

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const {
    data: rawNodes,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['workspace-tree', user?.id ?? 'anon'],
    queryFn: fetchWorkspaceTree,
    retry: 1,
  });

  // Synchronize open tab titles & paths and link validator index whenever workspace tree nodes load
  React.useEffect(() => {
    if (!rawNodes || !Array.isArray(rawNodes)) return;
    updateKnownWorkspaceNodes(rawNodes);
    const currentTabs = useWorkspaceStore.getState().tabs;
    for (const tab of currentTabs) {
      const matchingNode = rawNodes.find((n) => n.id === tab.id);
      if (matchingNode) {
        const realTitle = matchingNode.title || matchingNode.name.replace(/\.(md|bundle)$/, '');
        if (
          !tab.title ||
          tab.title.toLowerCase() === 'document' ||
          tab.title === tab.id ||
          tab.path === tab.id
        ) {
          updateTabMetadata(tab.id, {
            path: matchingNode.path,
            title: realTitle,
            is_bundle: matchingNode.is_bundle,
          });
        }
      }
    }
  }, [rawNodes, updateTabMetadata]);

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

  const uploadFilesToDir = async (files: FileList | File[], targetDir: string) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    try {
      for (const file of fileArray) {
        const relPath = targetDir ? `${targetDir}/${file.name}` : file.name;
        const buf = await file.arrayBuffer();
        await uploadWorkspaceFile(relPath, buf);
      }
      if (targetDir) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(targetDir);
          return next;
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
    } catch (err: any) {
      alert(`Failed to upload file: ${err.message || 'Unknown error'}`);
    }
  };

  const handleFileUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFilesToDir(files, uploadTargetDir);
    }
    e.target.value = '';
  };

  const triggerFileUpload = (targetDir: string = '') => {
    setUploadTargetDir(targetDir);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const createDocMutation = useMutation({
    mutationFn: (payload: { path: string; title?: string; content?: string }) =>
      createDocument(payload),
    onSuccess: (newDoc) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      setModalMode(null);
      setInputValue('');
      navigate(`${baseDocRoute}/${newDoc.id}`);
    },
    onError: (err: any) => {
      alert(`Failed to create document: ${err.message || 'Unknown error'}`);
    },
  });

  const createDirMutation = useMutation({
    mutationFn: (path: string) => createDirectory(path),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (res?.path) {
          next.add(res.path);
          const parent = res.path.substring(0, res.path.lastIndexOf('/'));
          if (parent) next.add(parent);
        }
        return next;
      });
      setModalMode(null);
      setInputValue('');
    },
    onError: (err: any) => {
      alert(`Failed to create folder: ${err.message || 'Unknown error'}`);
    },
  });

  const moveDocMutation = useMutation({
    mutationFn: ({ id, newPath, title }: { id: string; newPath: string; title?: string }) =>
      moveDocument(id, newPath, title),
    onSuccess: (updatedDoc) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['document', updatedDoc.id] });
      queryClient.setQueryData(['document', updatedDoc.id], updatedDoc);
      updateTabMetadata(updatedDoc.id, {
        path: updatedDoc.path,
        title: updatedDoc.title,
        is_bundle: updatedDoc.is_bundle,
      });
      setModalMode(null);
      setInputValue('');
    },
    onError: (err: any) => {
      alert(`Failed to move/rename document: ${err.message || 'Unknown error'}`);
    },
  });

  const convertDocMutation = useMutation({
    mutationFn: (id: string) => convertDocument(id),
    onSuccess: (updatedDoc) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['document', updatedDoc.id] });
      queryClient.setQueryData(['document', updatedDoc.id], updatedDoc);
      updateTabMetadata(updatedDoc.id, {
        path: updatedDoc.path,
        title: updatedDoc.title,
        is_bundle: updatedDoc.is_bundle,
      });
      setContextMenu(null);
    },
    onError: (err: any) => {
      alert(`Failed to convert document: ${err.message || 'Unknown error'}`);
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: ({ id }: { id: string; path?: string }) => deleteDocument(id),
    onSuccess: (_data, { id: deletedId, path: deletedPath }) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.removeQueries({ queryKey: ['document', deletedId] });
      queryClient.removeQueries({ queryKey: ['doc-reader', deletedId] });
      setContextMenu(null);

      // Close open tab(s) associated with the deleted document or its path
      const currentTabs = useWorkspaceStore.getState().tabs;
      const matchingTabs = currentTabs.filter(
        (t) =>
          t.id === deletedId ||
          (deletedPath && (t.path === deletedPath || t.path.startsWith(deletedPath + '/')))
      );

      for (const t of matchingTabs) {
        closeTab(t.id);
      }

      // If the current route is viewing the deleted document, navigate away
      const isViewingDeleted =
        location.pathname === `/documents/${deletedId}` ||
        location.pathname === `/docs/${deletedId}` ||
        matchingTabs.some(
          (t) =>
            location.pathname === `/documents/${t.id}` ||
            location.pathname === `/docs/${t.id}`
        );

      if (isViewingDeleted) {
        const nextActive = useWorkspaceStore.getState().activeTabId;
        if (nextActive) {
          navigate(`${baseDocRoute}/${nextActive}`);
        } else {
          navigate('/');
        }
      }
    },
    onError: (err: any) => {
      alert(`Failed to delete document: ${err.message || 'Unknown error'}`);
    },
  });

  const renameDirMutation = useMutation({
    mutationFn: ({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
      renameDirectory(oldPath, newPath),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['directory-details'] });

      const oldPath = res.old_path;
      const newPath = res.new_path;

      const currentTabs = useWorkspaceStore.getState().tabs;
      for (const t of currentTabs) {
        if (t.id === `dir:${oldPath}`) {
          const segments = newPath.split('/').filter(Boolean);
          const title = segments.length > 0 ? segments[segments.length - 1] : 'Root';
          updateTabMetadata(t.id, {
            path: newPath,
            title,
          });
        } else if (t.path === oldPath || t.path.startsWith(oldPath + '/')) {
          const suffix = t.path.substring(oldPath.length);
          updateTabMetadata(t.id, {
            path: newPath + suffix,
          });
        }
      }

      setExpandedPaths((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          if (p === oldPath) {
            next.add(newPath);
          } else if (p.startsWith(oldPath + '/')) {
            next.add(newPath + p.substring(oldPath.length));
          } else {
            next.add(p);
          }
        }
        return next;
      });

      setModalMode(null);
      setInputValue('');
    },
    onError: (err: any) => {
      alert(`Failed to rename directory: ${err.message || 'Unknown error'}`);
    },
  });

  const deleteDirMutation = useMutation({
    mutationFn: (path: string) => deleteDirectory(path),
    onSuccess: (_data, deletedPath) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.invalidateQueries({ queryKey: ['directory-details'] });
      setContextMenu(null);

      const currentTabs = useWorkspaceStore.getState().tabs;
      const matchingTabs = currentTabs.filter(
        (t) =>
          t.id === `dir:${deletedPath}` ||
          t.path === deletedPath ||
          t.path.startsWith(deletedPath + '/')
      );

      for (const t of matchingTabs) {
        closeTab(t.id);
      }

      const isViewingDeleted = matchingTabs.some(
        (t) =>
          location.pathname === `/documents/${t.id}` ||
          location.pathname === `/docs/${t.id}`
      );

      if (isViewingDeleted) {
        const nextActive = useWorkspaceStore.getState().activeTabId;
        if (nextActive) {
          navigate(`${baseDocRoute}/${nextActive}`);
        } else {
          navigate('/');
        }
      }
    },
    onError: (err: any) => {
      alert(`Failed to delete directory: ${err.message || 'Unknown error'}`);
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

  // Download file, bundle, or directory
  const handleDownloadNode = async (node: WorkspaceNode) => {
    try {
      if (node.is_bundle) {
        await downloadBundleZip(node.path, node.id, `${node.name}.zip`);
      } else if (node.is_directory) {
        await downloadBundleZip(node.path, undefined, `${node.name}.zip`);
      } else {
        await downloadWorkspaceFile(node.path, node.name);
      }
    } catch (err: any) {
      alert(`Failed to download: ${err?.message || 'Unknown error'}`);
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, node: WorkspaceNode) => {
    const payload = JSON.stringify({
      id: node.id,
      path: node.path,
      name: node.name,
      is_directory: node.is_directory,
      is_bundle: node.is_bundle,
    });
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.setData('application/x-cme-node', payload);
    e.dataTransfer.effectAllowed = 'copyMove';
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
    e.stopPropagation();
    setDragOverPath(null);
    if (!targetNode.is_directory || targetNode.is_bundle) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void uploadFilesToDir(e.dataTransfer.files, targetNode.path);
      return;
    }

    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const draggedNode = JSON.parse(dataStr);
      if (draggedNode.path === targetNode.path) return;

      const targetPath = `${targetNode.path}/${draggedNode.name}`;
      if (draggedNode.path === targetPath) return;

      if (draggedNode.is_directory && !draggedNode.is_bundle) {
        renameDirMutation.mutate({
          oldPath: draggedNode.path,
          newPath: targetPath,
        });
      } else if (draggedNode.id) {
        moveDocMutation.mutate({
          id: draggedNode.id,
          newPath: targetPath,
        });
      }
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
      const folderName = inputValue.trim().replace(/^\/+|\/+$/g, '');
      const fullPath = parentDir ? `${parentDir}/${folderName}` : folderName;
      createDirMutation.mutate(fullPath);
    } else if (modalMode === 'rename' && activeNode) {
      if (activeNode.is_directory && !activeNode.is_bundle) {
        const oldPath = activeNode.path;
        const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        const newName = inputValue.trim().replace(/^\/+|\/+$/g, '');
        const newPath = dir ? `${dir}/${newName}` : newName;
        renameDirMutation.mutate({ oldPath, newPath });
      } else if (activeNode.id) {
        const oldPath = activeNode.path;
        const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        let newName = inputValue.trim();
        if (!newName.includes('.')) {
          newName += oldPath.endsWith('.bundle') ? '.bundle' : '.md';
        }
        const newPath = dir ? `${dir}/${newName}` : newName;
        const dotIndex = newName.lastIndexOf('.');
        const titleCandidate =
          isMarkdownPath(newPath, activeNode.is_bundle) && dotIndex > 0
            ? newName.substring(0, dotIndex)
            : newName;
        moveDocMutation.mutate({
          id: activeNode.id,
          newPath,
          title: titleCandidate,
        });
      }
    }
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isBundle = Boolean(node.is_bundle && node.path.endsWith('.bundle'));
    const isDoc = !node.is_directory || isBundle;
    const isExpanded = expandedPaths.has(node.path);
    // Folders have a 14px chevron + 6px gap (20px) before their folder icon.
    // Offset documents by +20px (28px at depth 0, 48px at depth 1, etc.) so child file icons
    // sit 20px to the right of their parent directory's folder icon.
    const paddingLeft = isDoc ? `${depth * 20 + 28}px` : `${depth * 20 + 8}px`;
    const isDragTarget = dragOverPath === node.path;

    if (isDoc) {
      const isMarkdown = isMarkdownPath(node.path, isBundle);
      const isImage = !isMarkdown && isImagePath(node.path);

      if (!isMarkdown) {
        const fileUrl = getWorkspaceFileUrl(node.path);
        return (
          <div
            key={node.path}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, node)}
            onContextMenu={(e) => handleContextMenu(e, node)}
            style={{ paddingLeft }}
            data-testid={`filetree-item-${node.name}`}
            className="group flex items-center justify-between py-1.5 pr-2 text-xs rounded-lg transition-colors cursor-pointer select-none text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover"
          >
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 min-w-0 flex-1 truncate"
              title={`${node.name} (Opens in new tab)`}
            >
              {isImage ? (
                <ImageIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : (
                <FileIcon className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
            </a>

            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                data-testid={`filetree-item-download-${node.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDownloadNode(node);
                }}
                className="p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted hover:text-cme-text-base transition-colors"
                title={`Download ${node.name}`}
              >
                <Download className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => handleContextMenu(e, node)}
                className="p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted transition-opacity"
                title="Options"
              >
                <MoreVertical className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      }

      const docLink = node.id
        ? `${baseDocRoute}/${node.id}`
        : `${baseDocRoute}/by-path?path=${encodeURIComponent(node.path)}`;
      const isActive =
        (node.id && location.pathname.includes(node.id)) ||
        location.search.includes(encodeURIComponent(node.path));

      return (
        <div
          key={node.path}
          draggable={true}
          onDragStart={(e) => handleDragStart(e, node)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          style={{ paddingLeft }}
          data-testid={`filetree-item-${node.name}`}
          className={`group flex items-center justify-between py-1.5 pr-2 text-xs rounded-lg transition-colors cursor-pointer select-none ${
            isActive
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <Link
            to={docLink}
            onClick={() => {
              if (node.id) {
                openTab({
                  id: node.id,
                  path: node.path,
                  title: node.title || node.name.replace(/\.(md|bundle)$/, ''),
                  is_bundle: isBundle,
                });
              }
            }}
            className="flex items-center gap-2 min-w-0 flex-1 truncate"
            title={node.title || node.name}
          >
            {isBundle ? (
              <Package className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
            )}
            <span className="truncate">{node.title || node.name}</span>
          </Link>

          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              data-testid={`filetree-item-download-${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void handleDownloadNode(node);
              }}
              className="p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted hover:text-cme-text-base transition-colors"
              title={isBundle ? `Download ${node.name} as ZIP` : `Download ${node.name}`}
            >
              <Download className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => handleContextMenu(e, node)}
              className="p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted transition-opacity"
              title="Options"
            >
              <MoreVertical className="w-3 h-3" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={node.path} className="space-y-0.5">
        <div
          style={{ paddingLeft }}
          draggable={true}
          onDragStart={(e) => handleDragStart(e, node)}
          data-testid={`filetree-folder-${node.name}`}
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
            {/* Split: chevron toggles expand/collapse only */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.path);
              }}
              className="p-0.5 -ml-1 rounded hover:bg-cme-bg-subtle text-cme-text-subtle hover:text-cme-text-base transition-colors flex-shrink-0"
              title={isExpanded ? 'Collapse folder' : 'Expand folder'}
              data-testid={`filetree-chevron-${node.name}`}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Clicking folder icon + name opens directory dashboard tab */}
            <div
              onClick={() => openDirectoryTab(node.path)}
              className="flex items-center gap-1.5 min-w-0 flex-1 truncate hover:text-cme-primary"
              title={`Open ${node.name} dashboard`}
              data-testid={`filetree-folder-name-${node.name}`}
            >
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
            </div>
          </div>

          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              data-testid={`filetree-item-download-${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void handleDownloadNode(node);
              }}
              className="p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted hover:text-cme-text-base transition-colors"
              title={`Download ${node.name} as ZIP`}
            >
              <Download className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleContextMenu(e, node);
              }}
              className="p-0.5 rounded hover:bg-cme-bg-subtle text-cme-text-muted transition-opacity"
              title="Folder Options"
            >
              <MoreVertical className="w-3 h-3" />
            </button>
          </div>
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
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileUploadChange}
        data-testid="filetree-upload-input"
      />
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
            onClick={() => triggerFileUpload('')}
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="Upload File / Image"
            data-testid="filetree-upload-btn"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() =>
              setAclTarget({
                targetType: 'DIRECTORY',
                directoryPath: '',
                title: 'Workspace Root',
              })
            }
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="Workspace Permissions"
            data-testid="filetree-root-permissions-btn"
          >
            <Shield className="w-3.5 h-3.5 text-blue-500" />
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
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            void uploadFilesToDir(e.dataTransfer.files, '');
          }
        }}
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
              <button
                data-testid="filetree-context-upload-btn"
                onClick={() => {
                  const target = contextMenu.node.path;
                  setContextMenu(null);
                  triggerFileUpload(target);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-500" />
                <span>Upload File / Image</span>
              </button>
              <div className="my-1 border-t border-cme-border-base" />
            </>
          )}

          {(contextMenu.node.id || (contextMenu.node.is_directory && !contextMenu.node.is_bundle)) && (
            <>
              <button
                data-testid="filetree-rename-btn"
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
              {contextMenu.node.id && (
                <button
                  data-testid="filetree-copy-permalink-btn"
                  onClick={() => {
                    const origin = typeof window !== 'undefined' ? window.location.origin : '';
                    navigator.clipboard?.writeText(`${origin}/documents/${contextMenu.node.id}`);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
                >
                  <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Copy Permalink</span>
                </button>
              )}
              {contextMenu.node.id && (
                <button
                  data-testid="filetree-convert-btn"
                  onClick={() => {
                    const node = contextMenu.node;
                    setContextMenu(null);
                    convertDocMutation.mutate(node.id!);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-purple-500" />
                  <span>{contextMenu.node.is_bundle ? 'Convert to Document' : 'Convert to Bundle'}</span>
                </button>
              )}
              <button
                data-testid="filetree-delete-btn"
                onClick={() => {
                  if (contextMenu.node.is_directory && !contextMenu.node.is_bundle) {
                    if (
                      confirm(
                        `Move folder "${contextMenu.node.name}" and all its contents to Trash? You can restore it later.`
                      )
                    ) {
                      deleteDirMutation.mutate(contextMenu.node.path);
                    }
                  } else if (contextMenu.node.id) {
                    if (
                      confirm(
                        `Move "${contextMenu.node.name}" to Trash? You can restore it later.`
                      )
                    ) {
                      deleteDocMutation.mutate({
                        id: contextMenu.node.id,
                        path: contextMenu.node.path,
                      });
                    }
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-500/10 text-rose-500 text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete to Trash</span>
              </button>
            </>
          )}

          <div className="my-1 border-t border-cme-border-base" />
          <button
            data-testid="filetree-download-btn"
            onClick={() => {
              const node = contextMenu.node;
              setContextMenu(null);
              void handleDownloadNode(node);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
          >
            <Download className="w-3.5 h-3.5 text-blue-500" />
            <span>
              {contextMenu.node.is_bundle
                ? 'Download as ZIP'
                : contextMenu.node.is_directory
                ? 'Download as ZIP'
                : 'Download File'}
            </span>
          </button>
          <button
            data-testid="filetree-permissions-btn"
            onClick={() => {
              const isDir = contextMenu.node.is_directory;
              setAclTarget({
                targetType: isDir ? 'DIRECTORY' : 'DOCUMENT',
                targetId: contextMenu.node.id,
                directoryPath: isDir ? contextMenu.node.path : undefined,
                title: contextMenu.node.title || contextMenu.node.name,
              });
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-cme-bg-hover text-cme-text-base text-left"
          >
            <Shield className="w-3.5 h-3.5 text-blue-500" />
            <span>Permissions</span>
          </button>
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
