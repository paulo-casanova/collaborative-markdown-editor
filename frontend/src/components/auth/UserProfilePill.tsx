import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, LogOut, Key, Users, Settings, ChevronDown, LogIn } from 'lucide-react';
import { fetchCurrentUser, logoutUser } from '../../api/auth';
import { useUIStore } from '../../stores/uiStore';
import { Badge } from '../common/Badge';

export const UserProfilePill: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setLoginModalOpen, setTokensModalOpen } = useUIStore();

  const { data: user, isLoading, isError } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: logoutUser,
    onSuccess: () => {
      queryClient.setQueryData(['auth-me'], null);
      queryClient.setQueryData(['workspace-tree'], []);
      queryClient.setQueryData(['recent-documents'], []);
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
      setMenuOpen(false);
      navigate('/');
    },
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) {
    return (
      <div className="h-8 w-24 bg-cme-bg-subtle animate-pulse rounded-full border border-cme-border-base" />
    );
  }

  if (isError || !user) {
    return (
      <button
        onClick={() => setLoginModalOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-cme-primary text-white hover:bg-cme-primary-hover transition-colors shadow-sm"
      >
        <LogIn className="w-3.5 h-3.5" />
        <span>Sign In</span>
      </button>
    );
  }

  const initials = (user.display_name || user.username || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const avatarColor = user.avatar_color || '#3b82f6';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover transition-colors"
        title={`Logged in as ${user.display_name || user.username}`}
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm flex-shrink-0"
          style={{ backgroundColor: avatarColor }}
        >
          {initials}
        </div>
        <span className="text-xs font-medium text-cme-text-base truncate max-w-[120px]">
          {user.display_name || user.username}
        </span>
        {user.is_system_admin && (
          <Badge variant="primary" size="sm" className="hidden sm:inline-flex">
            Admin
          </Badge>
        )}
        <ChevronDown className="w-3 h-3 text-cme-text-muted" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl z-50 overflow-hidden text-xs">
          {/* User Profile Header */}
          <div className="p-3 bg-cme-bg-subtle border-b border-cme-border-base">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shadow flex-shrink-0"
                style={{ backgroundColor: avatarColor }}
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-cme-text-base truncate">
                  {user.display_name || user.username}
                </div>
                <div className="text-[11px] text-cme-text-muted truncate">@{user.username}</div>
              </div>
              {user.is_system_admin && (
                <span title="System Administrator">
                  <Shield className="w-4 h-4 text-cme-primary" />
                </span>
              )}
            </div>

            {/* Effective Teams List */}
            {user.effective_teams && user.effective_teams.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-cme-border-base/50">
                <div className="text-[10px] font-medium text-cme-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  <span>Effective Teams ({user.effective_teams.length})</span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {user.effective_teams.map((team) => (
                    <span
                      key={team}
                      className="px-2 py-0.5 text-[11px] rounded bg-cme-bg-surface border border-cme-border-base text-cme-text-base font-medium"
                    >
                      {team}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Menu Actions */}
          <div className="py-1">
            {user.is_system_admin && (
              <Link
                to="/admin"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-cme-text-base hover:bg-cme-bg-hover transition-colors"
              >
                <Shield className="w-4 h-4 text-cme-primary" />
                <span>Admin Console</span>
              </Link>
            )}

            <button
              onClick={() => {
                setMenuOpen(false);
                setTokensModalOpen(true);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-cme-text-base hover:bg-cme-bg-hover transition-colors text-left"
            >
              <Key className="w-4 h-4 text-cme-text-muted" />
              <span>Personal Access Tokens</span>
            </button>

            <Link
              to="/settings"
              onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-cme-text-base hover:bg-cme-bg-hover transition-colors"
            >
              <Settings className="w-4 h-4 text-cme-text-muted" />
              <span>User Settings</span>
            </Link>

            <div className="my-1 border-t border-cme-border-base" />

            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-rose-500 hover:bg-rose-500/10 transition-colors text-left"
            >
              <LogOut className="w-4 h-4" />
              <span>{logoutMutation.isPending ? 'Signing out...' : 'Sign Out'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
