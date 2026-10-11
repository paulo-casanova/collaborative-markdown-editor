import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { LoginModal } from '../auth/LoginModal';
import { TokensModal } from '../auth/TokensModal';
import { SearchModal } from '../search/SearchModal';
import { useThemeStore } from '../../stores/themeStore';

export const AppShell: React.FC = () => {
  const { initThemeListener } = useThemeStore();

  useEffect(() => {
    const cleanup = initThemeListener();
    return cleanup;
  }, [initThemeListener]);

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
