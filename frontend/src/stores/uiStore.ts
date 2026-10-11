import { create } from 'zustand';
import { BreadcrumbItem } from '../types/document';

export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'live';

interface UIState {
  sidebarOpen: boolean;
  reviewSidebarOpen: boolean;
  breadcrumbs: BreadcrumbItem[];
  syncStatus: SyncStatus;
  loginModalOpen: boolean;
  tokensModalOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleReviewSidebar: () => void;
  setReviewSidebarOpen: (open: boolean) => void;
  setBreadcrumbs: (breadcrumbs: BreadcrumbItem[]) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLoginModalOpen: (open: boolean) => void;
  setTokensModalOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  reviewSidebarOpen: false,
  breadcrumbs: [{ label: 'Workspaces', path: '/' }],
  syncStatus: 'saved',
  loginModalOpen: false,
  tokensModalOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleReviewSidebar: () => set((state) => ({ reviewSidebarOpen: !state.reviewSidebarOpen })),
  setReviewSidebarOpen: (open) => set({ reviewSidebarOpen: open }),
  setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLoginModalOpen: (loginModalOpen) => set({ loginModalOpen }),
  setTokensModalOpen: (tokensModalOpen) => set({ tokensModalOpen }),
}));
