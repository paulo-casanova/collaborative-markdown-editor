import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { LoginModal } from '../auth/LoginModal';
import { TokensModal } from '../auth/TokensModal';
import { SearchModal } from '../search/SearchModal';
import { useThemeStore } from '../../stores/themeStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { RELOAD_KEY } from '../../api/client';

export const AppShell: React.FC = () => {
  const { initThemeListener } = useThemeStore();
  const { setViewMode, isSessionExpired } = useUIStore();
  const hasDirtyTabs = useWorkspaceStore((state) => state.tabs.some((t) => t.isDirty));
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const cleanup = initThemeListener();
    return cleanup;
  }, [initThemeListener]);

  // Keep global viewMode ('edit' vs 'read') synchronized with route changes
  useEffect(() => {
    if (location.pathname.startsWith('/docs/') || location.pathname.startsWith('/docs')) {
      setViewMode('read');
    } else if (
      location.pathname.startsWith('/documents/') ||
      location.pathname.startsWith('/doc/') ||
      location.pathname.startsWith('/d/')
    ) {
      setViewMode('edit');
    }
  }, [location.pathname, setViewMode]);

  // Global keyboard shortcut: Ctrl+W / Cmd+W (or Alt+W) to close the current active tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === 'w') {
        const { activeTabId, tabs, closeTab } = useWorkspaceStore.getState();
        if (!activeTabId) return;

        e.preventDefault();
        e.stopPropagation();

        const tabToClose = tabs.find((t) => t.id === activeTabId);
        if (tabToClose?.isDirty) {
          if (!confirm(`Document "${tabToClose.title}" has unsaved edits. Close anyway?`)) {
            return;
          }
        }

        closeTab(activeTabId);

        const nextActive = useWorkspaceStore.getState().activeTabId;
        const isRead =
          useUIStore.getState().viewMode === 'read' ||
          window.location.pathname.startsWith('/docs/');
        const baseDocRoute = isRead ? '/docs' : '/documents';
        if (nextActive) {
          navigate(`${baseDocRoute}/${nextActive}`);
        } else {
          navigate('/');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [navigate]);

  // Global wikilink navigation listener
  useEffect(() => {
    const handleOpenWikiLink = (e: Event) => {
      const customEvent = e as CustomEvent<{ target: string; anchor?: string }>;
      const target = customEvent.detail?.target;
      const anchor = customEvent.detail?.anchor;
      if (target) {
        window.dispatchEvent(new Event('cme-wikilink-handled'));
        const hash = anchor ? `#${anchor}` : '';
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
        const isRead =
          useUIStore.getState().viewMode === 'read' ||
          window.location.pathname.startsWith('/docs/');
        const baseRoute = isRead ? '/docs' : '/documents';
        if (isUuid) {
          navigate(`${baseRoute}/${target}${hash}`);
        } else {
          navigate(`${baseRoute}/by-path?path=${encodeURIComponent(target)}${hash}`);
        }
      } else if (anchor) {
        window.dispatchEvent(new Event('cme-wikilink-handled'));
        window.location.hash = anchor;
      }
    };
    window.addEventListener('cme-open-wikilink', handleOpenWikiLink as EventListener);
    return () => {
      window.removeEventListener('cme-open-wikilink', handleOpenWikiLink as EventListener);
    };
  }, [navigate]);

  return (
    <div className="h-screen flex flex-col bg-cme-bg-base text-cme-text-base overflow-hidden">
      <Header />
      {isSessionExpired && (
        <div
          data-testid="session-expired-banner"
          className="bg-rose-600 text-white px-4 py-2 flex items-center justify-between text-xs font-medium z-50 shadow-md transition-all shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-white" />
            <span className="truncate">
              {hasDirtyTabs
                ? 'Your authentication session has expired and you have unsaved changes. Please copy your edits before reloading.'
                : 'Your authentication session has expired. Sign in again to restore access.'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              onClick={() => {
                if (hasDirtyTabs) {
                  if (
                    !confirm(
                      'You have unsaved changes that may be lost on reload. Continue to sign in?'
                    )
                  ) {
                    return;
                  }
                }
                if (typeof sessionStorage !== 'undefined') {
                  sessionStorage.setItem(RELOAD_KEY, Date.now().toString());
                }
                if (typeof window !== 'undefined' && window.location) {
                  window.location.reload();
                }
              }}
              className="px-2.5 py-1 bg-white text-rose-600 rounded font-semibold hover:bg-rose-50 transition-colors shadow-sm"
              data-testid="session-reload-btn"
            >
              Sign in again
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-cme-bg-base min-h-0 relative">
          <Outlet />
        </main>
      </div>

      {/* Global Modals */}
      <LoginModal />
      <TokensModal />
      <SearchModal />
    </div>
  );
};
