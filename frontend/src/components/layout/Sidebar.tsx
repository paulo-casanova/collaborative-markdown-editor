import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FolderTree,
  Trash2,
  Settings,
  Shield,
  Search,
  CheckSquare,
} from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { fetchCurrentUser } from '../../api/auth';
import { FileTree } from '../navigation/FileTree';
import { RecentDocuments } from '../navigation/RecentDocuments';

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { sidebarOpen, setSearchModalOpen } = useUIStore();

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  if (!sidebarOpen) return null;

  const isActive = (path: string) => location.pathname === path;

  return (
    <aside className="w-64 border-r border-cme-border-base bg-cme-bg-surface flex flex-col h-[calc(100vh-3.5rem)] select-none">
      {/* Top Action Items */}
      <div className="p-3 space-y-1 border-b border-cme-border-base text-xs">
        <button
          onClick={() => setSearchModalOpen(true)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-cme-border-base/60 bg-cme-bg-subtle/60 text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
          title="Search documents (Ctrl+K / Cmd+K)"
          data-testid="sidebar-search-btn"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5" />
            <span className="text-xs">Search...</span>
          </div>
          <kbd className="text-[10px] font-mono px-1 py-0.2 rounded bg-cme-bg-surface border border-cme-border-base text-cme-text-subtle">
            ⌘K
          </kbd>
        </button>

        <Link
          to="/"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          <FolderTree className="w-4 h-4" />
          <span>Workspace Explorer</span>
        </Link>

        <Link
          to="/tasks"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/tasks')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-tasks-link"
        >
          <CheckSquare className="w-4 h-4" />
          <span>Task Dashboard</span>
        </Link>

        <Link
          to="/trash"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/trash')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-trash-link"
        >
          <Trash2 className="w-4 h-4" />
          <span>Trash Bin</span>
        </Link>

        <Link
          to="/settings"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/settings')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
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
                ? 'bg-cme-primary/10 text-cme-primary font-medium'
                : 'text-cme-primary hover:bg-cme-primary/10'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span className="font-semibold">Admin Console</span>
          </Link>
        )}
      </div>

      {/* Hierarchical FileTree Section */}
      <div className="flex-1 overflow-hidden p-2 flex flex-col min-h-0">
        <FileTree />
      </div>

      {/* Recent Documents Drawer Section */}
      <div className="px-2 pb-1">
        <RecentDocuments />
      </div>

      {/* Footer Branding info */}
      <div className="p-2.5 border-t border-cme-border-base bg-cme-bg-subtle text-[11px] text-cme-text-muted flex items-center justify-between">
        <span>CME C++23 Core</span>
        <span className="font-mono text-emerald-500 font-semibold">Ready</span>
      </div>
    </aside>
  );
};
