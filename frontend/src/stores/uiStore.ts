import { create } from 'zustand';
import { BreadcrumbItem } from '../types/document';

export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'live';
export type ViewMode = 'edit' | 'read';

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  reviewSidebarOpen: boolean;
  viewMode: ViewMode;
  breadcrumbs: BreadcrumbItem[];
  syncStatus: SyncStatus;
  loginModalOpen: boolean;
  tokensModalOpen: boolean;
  searchModalOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleReviewSidebar: () => void;
  setReviewSidebarOpen: (open: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setBreadcrumbs: (breadcrumbs: BreadcrumbItem[]) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLoginModalOpen: (open: boolean) => void;
  setTokensModalOpen: (open: boolean) => void;
  setSearchModalOpen: (open: boolean) => void;
  toggleSearchModal: () => void;
}

const getInitialSidebarWidth = (): number => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = Number(window.localStorage.getItem('cme_sidebar_width'));
      if (!Number.isNaN(saved) && saved >= 180 && saved <= 600) {
        return saved;
      }
    }
  } catch {
    // ignore storage errors
  }
  return 256;
};

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: getInitialSidebarWidth(),
  reviewSidebarOpen: false,
  viewMode:
    typeof window !== 'undefined' && window.location.pathname.startsWith('/docs/')
      ? 'read'
      : 'edit',
  breadcrumbs: [{ label: 'Workspaces', path: '/' }],
  syncStatus: 'saved',
  loginModalOpen: false,
  tokensModalOpen: false,
  searchModalOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => {
    const clamped = Math.min(600, Math.max(180, Math.round(width)));
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('cme_sidebar_width', String(clamped));
      }
    } catch {
      // ignore storage errors
    }
    set({ sidebarWidth: clamped });
  },
  toggleReviewSidebar: () => set((state) => ({ reviewSidebarOpen: !state.reviewSidebarOpen })),
  setReviewSidebarOpen: (open) => set({ reviewSidebarOpen: open }),
  setViewMode: (viewMode) => set({ viewMode }),
  setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLoginModalOpen: (loginModalOpen) => set({ loginModalOpen }),
  setTokensModalOpen: (tokensModalOpen) => set({ tokensModalOpen }),
  setSearchModalOpen: (searchModalOpen) => set({ searchModalOpen }),
  toggleSearchModal: () => set((state) => ({ searchModalOpen: !state.searchModalOpen })),
}));
