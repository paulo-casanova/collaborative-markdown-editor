import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { BreadcrumbItem } from '../types/document';

export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'live' | 'expired';
export type ViewMode = 'edit' | 'read';

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  reviewSidebarOpen: boolean;
  dialogSidecarOpen: boolean;
  viewMode: ViewMode;
  breadcrumbs: BreadcrumbItem[];
  syncStatus: SyncStatus;
  isSessionExpired: boolean;
  setSessionExpired: (expired: boolean) => void;
  loginModalOpen: boolean;
  tokensModalOpen: boolean;
  searchModalOpen: boolean;
  searchTitleOnly: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleReviewSidebar: () => void;
  setReviewSidebarOpen: (open: boolean) => void;
  toggleDialogSidecar: () => void;
  setDialogSidecarOpen: (open: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setBreadcrumbs: (breadcrumbs: BreadcrumbItem[]) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLoginModalOpen: (open: boolean) => void;
  setTokensModalOpen: (open: boolean) => void;
  setSearchModalOpen: (open: boolean, titleOnly?: boolean) => void;
  setSearchTitleOnly: (titleOnly: boolean) => void;
  toggleSearchModal: (titleOnly?: boolean) => void;
  numberHeaders: boolean;
  setNumberHeaders: (enabled: boolean) => void;
  toggleNumberHeaders: () => void;
  lineNumbers: boolean;
  setLineNumbers: (enabled: boolean) => void;
  toggleLineNumbers: () => void;
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

const getInitialNumberHeaders = (): boolean => {
  return false;
};

const getInitialLineNumbers = (): boolean => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('cme_line_numbers');
      if (saved !== null) {
        return saved === 'true';
      }
    }
  } catch {
    // ignore storage errors
  }
  return false;
};

const uiStore = createStore<UIState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: getInitialSidebarWidth(),
  reviewSidebarOpen: false,
  dialogSidecarOpen: false,
  viewMode:
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/documents/') ||
      window.location.pathname.startsWith('/doc/') ||
      window.location.pathname.startsWith('/d/'))
      ? 'edit'
      : 'read',
  breadcrumbs: [{ label: 'Workspaces', path: '/' }],
  syncStatus: 'saved',
  isSessionExpired: false,
  setSessionExpired: (expired) =>
    set((state) => ({
      isSessionExpired: expired,
      syncStatus: expired ? 'expired' : state.syncStatus === 'expired' ? 'saved' : state.syncStatus,
    })),
  loginModalOpen: false,
  tokensModalOpen: false,
  searchModalOpen: false,
  searchTitleOnly: false,
  numberHeaders: getInitialNumberHeaders(),
  lineNumbers: getInitialLineNumbers(),
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
  toggleDialogSidecar: () => set((state) => ({ dialogSidecarOpen: !state.dialogSidecarOpen })),
  setDialogSidecarOpen: (open) => set({ dialogSidecarOpen: open }),
  setViewMode: (viewMode) => set({ viewMode }),
  setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLoginModalOpen: (loginModalOpen) => set({ loginModalOpen }),
  setTokensModalOpen: (tokensModalOpen) => set({ tokensModalOpen }),
  setSearchModalOpen: (searchModalOpen, titleOnly) =>
    set((state) => ({
      searchModalOpen,
      searchTitleOnly: titleOnly !== undefined ? titleOnly : state.searchTitleOnly,
    })),
  setSearchTitleOnly: (searchTitleOnly) => set({ searchTitleOnly }),
  toggleSearchModal: (titleOnly) =>
    set((state) => ({
      searchModalOpen: !state.searchModalOpen,
      searchTitleOnly: titleOnly !== undefined ? titleOnly : state.searchTitleOnly,
    })),
  setNumberHeaders: (enabled) => {
    set({ numberHeaders: enabled });
  },
  toggleNumberHeaders: () =>
    set((state) => ({ numberHeaders: !state.numberHeaders })),
  setLineNumbers: (enabled) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('cme_line_numbers', String(enabled));
      }
    } catch {
      // ignore storage errors
    }
    set({ lineNumbers: enabled });
  },
  toggleLineNumbers: () =>
    set((state) => {
      const next = !state.lineNumbers;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('cme_line_numbers', String(next));
        }
      } catch {
        // ignore storage errors
      }
      return { lineNumbers: next };
    }),
}));

(uiStore as any).getServerState = () => uiStore.getState();

export const useUIStore = Object.assign(
  (selector?: any, equalityFn?: any) => useStore(uiStore, selector, equalityFn),
  uiStore
) as typeof uiStore & (<T = UIState>(selector?: (state: UIState) => T, equalityFn?: (a: T, b: T) => boolean) => T);
