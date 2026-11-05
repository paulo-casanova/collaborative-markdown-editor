import React, { useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Trash2,
  Settings,
  Shield,
  CheckSquare,
  AtSign,
  Hash,
  Lock,
  MessageSquare,
  GitPullRequest,
} from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { fetchCurrentUser } from '../../api/auth';
import { fetchUnreadMentionsCount } from '../../api/mentions';
import { fetchMyCheckouts } from '../../api/checkouts';
import {
  fetchUnacknowledgedCommentsCount,
  fetchUnacknowledgedSuggestionsCount,
} from '../../api/reviews';
import { FileTree } from '../navigation/FileTree';
import { RecentDocuments } from '../navigation/RecentDocuments';

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { sidebarOpen, sidebarWidth, setSidebarWidth } = useUIStore();
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = sidebarWidth || 256;
      setIsResizing(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        setSidebarWidth(startWidth + deltaX);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [sidebarWidth, setSidebarWidth]
  );

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const { data: unreadMentionsData } = useQuery({
    queryKey: ['mentions-count'],
    queryFn: fetchUnreadMentionsCount,
    staleTime: 5000,
    refetchInterval: 15000,
  });
  const unreadMentionsCount = unreadMentionsData?.unread_count || 0;

  const { data: unackCommentsData } = useQuery({
    queryKey: ['comments-count'],
    queryFn: fetchUnacknowledgedCommentsCount,
    staleTime: 5000,
    refetchInterval: 15000,
  });
  const unackCommentsCount = unackCommentsData?.unacknowledged_count || 0;

  const { data: unackSuggestionsData } = useQuery({
    queryKey: ['suggestions-count'],
    queryFn: fetchUnacknowledgedSuggestionsCount,
    staleTime: 5000,
    refetchInterval: 15000,
  });
  const unackSuggestionsCount = unackSuggestionsData?.unacknowledged_count || 0;

  const { data: rawMyCheckouts = [] } = useQuery({
    queryKey: ['my-checkouts'],
    queryFn: fetchMyCheckouts,
    staleTime: 5000,
    refetchInterval: 15000,
  });
  const myCheckoutsCount = Array.isArray(rawMyCheckouts)
    ? rawMyCheckouts.length
    : (rawMyCheckouts as any)?.checkouts?.length || 0;

  if (!sidebarOpen) return null;

  const isActive = (path: string) => location.pathname === path;

  return (
    <aside
      style={{ width: `${sidebarWidth || 256}px` }}
      className="relative flex-shrink-0 border-r border-cme-border-base bg-cme-bg-surface flex flex-col h-full select-none"
      data-testid="left-sidebar"
    >
      {/* Right-edge Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 transition-colors ${
          isResizing ? 'bg-cme-primary' : 'hover:bg-cme-primary/50'
        }`}
        title="Drag to resize sidebar"
        data-testid="sidebar-resizer"
      />
      {/* Top Action Items */}
      <div className="p-3 space-y-1 border-b border-cme-border-base text-xs">
        <Link
          to="/"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/') || isActive('/tasks')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-tasks-link"
        >
          <CheckSquare className="w-4 h-4" />
          <span>Task Dashboard</span>
        </Link>

        <Link
          to="/mentions"
          className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            isActive('/mentions')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-mentions-link"
        >
          <div className="flex items-center gap-2">
            <AtSign className="w-4 h-4" />
            <span>Mentions</span>
          </div>
          {unreadMentionsCount > 0 && (
            <span
              className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-cme-primary text-white"
              data-testid="sidebar-mentions-badge"
            >
              {unreadMentionsCount}
            </span>
          )}
        </Link>

        <Link
          to="/comments"
          className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            isActive('/comments')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-comments-link"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-sky-500" />
            <span>Comments</span>
          </div>
          {unackCommentsCount > 0 && (
            <span
              className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-sky-500 text-white"
              data-testid="sidebar-comments-badge"
            >
              {unackCommentsCount}
            </span>
          )}
        </Link>

        <Link
          to="/suggestions"
          className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            isActive('/suggestions')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-suggestions-link"
        >
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-4 h-4 text-emerald-500" />
            <span>Suggestions</span>
          </div>
          {unackSuggestionsCount > 0 && (
            <span
              className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-500 text-white"
              data-testid="sidebar-suggestions-badge"
            >
              {unackSuggestionsCount}
            </span>
          )}
        </Link>

        <Link
          to="/tags"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            isActive('/tags') || location.pathname.startsWith('/tags/')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-tags-link"
        >
          <Hash className="w-4 h-4 text-amber-500" />
          <span>Tags</span>
        </Link>

        <Link
          to="/checked-out"
          className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            isActive('/checked-out')
              ? 'bg-cme-primary/10 text-cme-primary font-medium'
              : 'text-cme-text-base hover:bg-cme-bg-hover'
          }`}
          data-testid="sidebar-checkouts-link"
        >
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500" />
            <span>Checked Out</span>
          </div>
          {myCheckoutsCount > 0 && (
            <span
              className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white"
              data-testid="sidebar-checkouts-badge"
            >
              {myCheckoutsCount}
            </span>
          )}
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
    </aside>
  );
};
