import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { LoginModal } from '../auth/LoginModal';
import { TokensModal } from '../auth/TokensModal';
import { SearchModal } from '../search/SearchModal';
import { useThemeStore } from '../../stores/themeStore';
import { useUIStore } from '../../stores/uiStore';

export const AppShell: React.FC = () => {
  const { initThemeListener } = useThemeStore();
  const { setViewMode } = useUIStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const cleanup = initThemeListener();
    return cleanup;
  }, [initThemeListener]);

  // Keep global viewMode ('edit' vs 'read') synchronized with route changes
  useEffect(() => {
    if (location.pathname.startsWith('/docs/')) {
      setViewMode('read');
    } else if (location.pathname.startsWith('/documents/')) {
      setViewMode('edit');
    }
  }, [location.pathname, setViewMode]);

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
    <div className="min-h-screen flex flex-col bg-cme-bg-base text-cme-text-base">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-cme-bg-base">
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
