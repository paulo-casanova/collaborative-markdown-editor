import { create } from 'zustand';
import { BreadcrumbItem } from '../types/document';

export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'live';
export type ViewMode = 'edit' | 'read';

interface UIState {
  sidebarOpen: boolean;
  reviewSidebarOpen: boolean;
  viewMode: ViewMode;
  breadcrumbs: BreadcrumbItem[];
  syncStatus: SyncStatus;
  loginModalOpen: boolean;
  tokensModalOpen: boolean;
  searchModalOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
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

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
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
