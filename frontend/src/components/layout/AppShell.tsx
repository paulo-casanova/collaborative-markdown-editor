import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { LoginModal } from '../auth/LoginModal';
import { TokensModal } from '../auth/TokensModal';
import { SearchModal } from '../search/SearchModal';
import { useThemeStore } from '../../stores/themeStore';

export const AppShell: React.FC = () => {
  const { initThemeListener } = useThemeStore();
  const navigate = useNavigate();

  useEffect(() => {
    const cleanup = initThemeListener();
    return cleanup;
  }, [initThemeListener]);

  // Global wikilink navigation listener
  useEffect(() => {
    const handleOpenWikiLink = (e: Event) => {
      const customEvent = e as CustomEvent<{ target: string }>;
      const target = customEvent.detail?.target;
      if (target) {
        window.dispatchEvent(new Event('cme-wikilink-handled'));
        navigate(`/documents/by-path?path=${encodeURIComponent(target)}`);
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
