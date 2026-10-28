import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  PanelLeft,
  CheckCircle,
  RefreshCw,
  WifiOff,
  Radio,
  ChevronRight,
  Search,
} from 'lucide-react';
import { useUIStore, SyncStatus } from '../../stores/uiStore';
import { HealthPopover } from './HealthPopover';
import { ThemeToggle } from '../common/ThemeToggle';
import { UserProfilePill } from '../auth/UserProfilePill';

export const Header: React.FC = () => {
  const location = useLocation();
  const { sidebarOpen, toggleSidebar, breadcrumbs, syncStatus, setSearchModalOpen } = useUIStore();

  const isEditorMode = location.pathname.startsWith('/documents/');
  const isReaderMode = location.pathname.startsWith('/docs/');

  const renderSyncBadge = (status: SyncStatus) => {
    switch (status) {
      case 'live':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Radio className="w-3 h-3" />
            <span>Collab Live</span>
          </span>
        );
      case 'syncing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Syncing...</span>
          </span>
        );
      case 'offline':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <WifiOff className="w-3 h-3" />
            <span>Offline</span>
          </span>
        );
      case 'expired':
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
            data-testid="session-expired-badge"
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Session expired - reconnecting...</span>
          </span>
        );
      case 'saved':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-cme-bg-subtle text-cme-text-muted border border-cme-border-base">
            <CheckCircle className="w-3 h-3 text-emerald-500" />
            <span>Saved</span>
          </span>
        );
    }
  };

  return (
    <header className="h-14 border-b border-cme-border-base bg-cme-bg-surface px-4 flex items-center justify-between gap-3 sticky top-0 z-40 select-none">
      {/* Left side: Sidebar toggle, Logo, and Breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggleSidebar}
          className={`p-1.5 rounded-lg border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors ${
            sidebarOpen ? 'bg-cme-bg-subtle' : 'bg-cme-bg-surface'
          }`}
          title="Toggle Navigation Sidebar"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        {/* CME Brand */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0 group" title="Collaborative Markdown Editor">
          {/* Full CME Logo with Dark/Light theme switching for medium+ screens */}
          <img
            src="/cme-light.png"
            alt="CME"
            className="h-7 w-auto object-contain group-hover:opacity-90 transition-opacity dark:hidden hidden sm:block"
          />
          <img
            src="/cme-dark.png"
            alt="CME"
            className="h-7 w-auto object-contain group-hover:opacity-90 transition-opacity hidden dark:sm:block"
          />
          {/* Square CME Icon Mark for small mobile screens */}
          <img
            src="/cme-icon-light.png"
            alt="CME"
            className="w-7 h-7 object-contain group-hover:opacity-90 transition-opacity sm:hidden dark:hidden"
          />
          <img
            src="/cme-icon-dark.png"
            alt="CME"
            className="w-7 h-7 object-contain group-hover:opacity-90 transition-opacity sm:hidden hidden dark:block dark:sm:hidden"
          />
        </Link>

        <div className="h-4 w-[1px] bg-cme-border-base mx-1 hidden sm:block" />

        {/* Breadcrumb Trail */}
        <nav className="flex items-center gap-1 text-xs text-cme-text-muted truncate">
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />}
              {crumb.path && !crumb.isCurrent ? (
                <Link
                  to={crumb.path}
                  className="hover:text-cme-text-base truncate max-w-[150px] transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={`truncate max-w-[200px] ${
                    crumb.isCurrent ? 'font-semibold text-cme-text-base' : ''
                  }`}
                >
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>
      </div>

      {/* Right side: Sync badge, Mode switcher, Telemetry, Theme, and User profile */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {/* Global Search Shortcut */}
        <button
          onClick={() => setSearchModalOpen(true, false)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-subtle hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base text-xs transition-colors"
          title="Search documents (Ctrl+K: All, Ctrl+Shift+K: Title only)"
          data-testid="header-search-btn"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[11px]">Search</span>
          <kbd className="hidden sm:inline-block text-[10px] font-mono px-1 py-0.2 rounded bg-cme-bg-surface border border-cme-border-base text-cme-text-subtle">
            ⌘K
          </kbd>
        </button>

        {/* Sync Status Badge */}
        {(isEditorMode || isReaderMode) && (
          <div className="hidden lg:block">{renderSyncBadge(syncStatus)}</div>
        )}

        {/* Health Probe & Version Popover */}
        <HealthPopover />

        {/* Multi-Theme Selector */}
        <ThemeToggle />

        {/* Logged-in User Profile Pill */}
        <UserProfilePill />
      </div>
    </header>
  );
};
