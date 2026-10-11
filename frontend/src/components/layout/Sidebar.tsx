import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FolderTree,
  Trash2,
  Settings,
  Shield,
  FileText,
  Folder,
} from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { fetchCurrentUser } from '../../api/auth';
import { fetchWorkspaceTree } from '../../api/documents';
import { WorkspaceNode } from '../../types/document';

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { sidebarOpen } = useUIStore();

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['workspace-tree'],
    queryFn: fetchWorkspaceTree,
    retry: false,
  });

  if (!sidebarOpen) return null;

  const isActive = (path: string) => location.pathname === path;

  const renderTreeNode = (node: WorkspaceNode, depth: number = 0) => {
    const isDoc = !node.is_directory;
    const paddingLeft = `${depth * 12 + 12}px`;

    if (isDoc) {
      const docLink = node.id ? `/documents/${node.id}` : `/documents/by-path?path=${encodeURIComponent(node.path)}`;
      const active = location.pathname.includes(node.id || '');

      return (
        <Link
          key={node.path}
          to={docLink}
          style={{ paddingLeft }}
          className={`flex items-center gap-2 py-1.5 pr-3 text-xs rounded-lg transition-colors truncate ${
            active
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          title={node.title || node.name}
        >
          <FileText className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{node.title || node.name}</span>
        </Link>
      );
    }

    return (
      <div key={node.path} className="space-y-0.5">
        <div
          style={{ paddingLeft }}
          className="flex items-center gap-2 py-1.5 pr-3 text-xs font-semibold text-cme-text-base select-none truncate"
        >
          <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span className="truncate">{node.name || 'Root'}</span>
        </div>
        {node.children && node.children.map((child) => renderTreeNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="w-64 border-r border-cme-border-base bg-cme-bg-surface flex flex-col h-[calc(100vh-3.5rem)] select-none">
      {/* Top Action Items */}
      <div className="p-3 space-y-1 border-b border-cme-border-base text-xs">
        <Link
          to="/"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/')
              ? 'bg-cme-primary-subtle text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <FolderTree className="w-4 h-4" />
          <span>Workspace Explorer</span>
        </Link>

        <Link
          to="/trash"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/trash')
              ? 'bg-cme-primary-subtle text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <Trash2 className="w-4 h-4" />
          <span>Trash Bin</span>
        </Link>

        <Link
          to="/settings"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/settings')
              ? 'bg-cme-primary-subtle text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>

        {user?.is_system_admin && (
          <Link
            to="/admin"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              isActive('/admin')
                ? 'bg-cme-primary-subtle text-cme-primary font-medium'
                : 'text-cme-primary hover:bg-cme-primary/10'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span className="font-semibold">Admin Console</span>
          </Link>
        )}
      </div>

      {/* Workspace Directory Tree Section */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-cme-text-subtle">
            Documents
          </span>
        </div>

        {treeLoading ? (
          <div className="py-4 text-center text-xs text-cme-text-muted">Loading workspace...</div>
        ) : tree ? (
          <div className="space-y-0.5">{renderTreeNode(tree)}</div>
        ) : (
          <div className="py-4 text-center text-xs text-cme-text-muted italic">
            No documents found.
          </div>
        )}
      </div>

      {/* Footer Branding info */}
      <div className="p-3 border-t border-cme-border-base bg-cme-bg-subtle text-[11px] text-cme-text-muted flex items-center justify-between">
        <span>CME C++23 Core</span>
        <span className="font-mono">Ready</span>
      </div>
    </aside>
  );
};
