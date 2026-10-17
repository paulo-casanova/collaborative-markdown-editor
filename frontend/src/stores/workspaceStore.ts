import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkspaceTab {
  id: string; // document UUID
  path: string; // relative file path
  title: string;
  is_bundle?: boolean;
  is_directory?: boolean;
  isPinned?: boolean;
  isDirty?: boolean;
}

export type SplitMode = 'none' | 'vertical' | 'horizontal';

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  splitMode: SplitMode;
  secondaryTabId: string | null;
  splitRatio: number; // 0.2 to 0.8, default 0.5
  outlineWidth: number; // in px, default 256

  // Tab Actions
  openTab: (tab: Omit<WorkspaceTab, 'isPinned' | 'isDirty'>, activate?: boolean) => void;
  updateTabMetadata: (tabId: string, metadata: Partial<Omit<WorkspaceTab, 'id'>>) => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  reorderTabs: (sourceIndex: number, targetIndex: number) => void;
  togglePinTab: (tabId: string) => void;
  setTabDirty: (tabId: string, dirty: boolean) => void;

  // Split-View & Layout Actions
  setSplitMode: (mode: SplitMode, secondaryId?: string | null) => void;
  setSecondaryTabId: (tabId: string | null) => void;
  setSplitRatio: (ratio: number) => void;
  setOutlineWidth: (width: number) => void;
  closeSplit: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      splitMode: 'none',
      secondaryTabId: null,
      splitRatio: 0.5,
      outlineWidth: 256,

      openTab: (newTab, activate = true) => {
        if (!newTab.id || newTab.id === 'by-path') return;
        const { tabs, activeTabId, splitMode, secondaryTabId } = get();
        const existingIndex = tabs.findIndex((t) => t.id === newTab.id);

        if (existingIndex >= 0) {
          // Tab already exists; preserve real title/path if newTab provides a placeholder
          const updatedTabs = [...tabs];
          const existing = updatedTabs[existingIndex];
          const isPlaceholderTitle =
            !newTab.title || newTab.title === 'Document' || newTab.title === newTab.id;
          const isPlaceholderPath = !newTab.path || newTab.path === newTab.id;
          const finalPath = isPlaceholderPath && existing.path ? existing.path : newTab.path;
          const rawBundle = newTab.is_bundle ?? existing.is_bundle;
          const isBundle = Boolean(rawBundle && finalPath?.endsWith('.bundle'));
          updatedTabs[existingIndex] = {
            ...existing,
            path: finalPath,
            title:
              isPlaceholderTitle && existing.title && existing.title !== 'Document'
                ? existing.title
                : newTab.title,
            is_bundle: isBundle,
            is_directory: newTab.is_directory ?? existing.is_directory,
          };
          set({
            tabs: updatedTabs,
            ...(activate ? { activeTabId: newTab.id } : {}),
          });
        } else {
          // Insert tab (after pinned tabs, or at the end)
          const pinnedCount = tabs.filter((t) => t.isPinned).length;
          const updatedTabs = [...tabs];
          updatedTabs.splice(pinnedCount, 0, {
            ...newTab,
            is_bundle: Boolean(newTab.is_bundle && newTab.path?.endsWith('.bundle')),
            isPinned: false,
            isDirty: false,
          });

          // If in split mode and secondaryTabId is null, set as secondary
          let nextSecondary = secondaryTabId;
          if (splitMode !== 'none' && !secondaryTabId && activeTabId && activeTabId !== newTab.id) {
            nextSecondary = newTab.id;
          }

          set({
            tabs: updatedTabs,
            ...(activate ? { activeTabId: newTab.id } : {}),
            secondaryTabId: nextSecondary,
          });
        }
      },

      updateTabMetadata: (tabId, metadata) => {
        const { tabs } = get();
        set({
          tabs: tabs.map((t) => {
            if (t.id !== tabId) return t;
            const updated = { ...t, ...metadata };
            if (metadata.is_bundle !== undefined || metadata.path !== undefined) {
              updated.is_bundle = Boolean(updated.is_bundle && updated.path?.endsWith('.bundle'));
            }
            return updated;
          }),
        });
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId, secondaryTabId, splitMode } = get();
        const targetIndex = tabs.findIndex((t) => t.id === tabId);
        const newTabs = tabs.filter((t) => t.id !== tabId);

        let nextActive = activeTabId;
        if (activeTabId === tabId) {
          if (newTabs.length > 0) {
            const nextIndex = targetIndex >= 0 ? Math.min(targetIndex, newTabs.length - 1) : 0;
            nextActive = newTabs[nextIndex].id;
          } else {
            nextActive = null;
          }
        }

        let nextSecondary = secondaryTabId;
        let nextSplitMode = splitMode;
        if (secondaryTabId === tabId) {
          // If secondary closed, choose another tab or disable split if none left
          const remainingForSecondary = newTabs.filter((t) => t.id !== nextActive);
          if (remainingForSecondary.length > 0) {
            nextSecondary = remainingForSecondary[0].id;
          } else {
            nextSecondary = null;
            nextSplitMode = 'none';
          }
        }

        set({
          tabs: newTabs,
          activeTabId: nextActive,
          secondaryTabId: nextSecondary,
          splitMode: nextSplitMode,
        });
      },

      closeOtherTabs: (tabId) => {
        const { tabs } = get();
        const keepTabs = tabs.filter((t) => t.id === tabId || t.isPinned);
        set({
          tabs: keepTabs,
          activeTabId: tabId,
          secondaryTabId: null,
          splitMode: 'none',
        });
      },

      closeTabsToRight: (tabId) => {
        const { tabs } = get();
        const targetIndex = tabs.findIndex((t) => t.id === tabId);
        if (targetIndex < 0) return;

        const keepTabs = tabs.filter((t, idx) => idx <= targetIndex || t.isPinned);
        set({
          tabs: keepTabs,
          activeTabId: tabId,
        });
      },

      setActiveTabId: (tabId) => {
        if (!tabId || tabId === 'by-path') return;
        set({ activeTabId: tabId });
      },

      reorderTabs: (sourceIndex, targetIndex) => {
        const { tabs } = get();
        if (
          sourceIndex < 0 ||
          sourceIndex >= tabs.length ||
          targetIndex < 0 ||
          targetIndex >= tabs.length
        ) {
          return;
        }

        const newTabs = [...tabs];
        const [movedTab] = newTabs.splice(sourceIndex, 1);
        newTabs.splice(targetIndex, 0, movedTab);
        set({ tabs: newTabs });
      },

      togglePinTab: (tabId) => {
        const { tabs } = get();
        const updated = tabs.map((t) =>
          t.id === tabId ? { ...t, isPinned: !t.isPinned } : t
        );
        // Sort so pinned are first
        updated.sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return 0;
        });
        set({ tabs: updated });
      },

      setTabDirty: (tabId, dirty) => {
        const { tabs } = get();
        set({
          tabs: tabs.map((t) => (t.id === tabId ? { ...t, isDirty: dirty } : t)),
        });
      },

      setSplitMode: (mode, secondaryId) => {
        const { tabs, activeTabId, secondaryTabId } = get();
        if (mode === 'none') {
          set({ splitMode: 'none', secondaryTabId: null });
          return;
        }

        let chosenSecondary = secondaryId !== undefined ? secondaryId : secondaryTabId;
        if (!chosenSecondary) {
          // Default to the first open tab that is not activeTabId
          const candidate = tabs.find((t) => t.id !== activeTabId);
          chosenSecondary = candidate ? candidate.id : activeTabId;
        }

        set({
          splitMode: mode,
          secondaryTabId: chosenSecondary,
        });
      },

      setSecondaryTabId: (tabId) => {
        set({ secondaryTabId: tabId });
      },

      setSplitRatio: (ratio) => {
        const clamped = Math.min(0.8, Math.max(0.2, ratio));
        set({ splitRatio: clamped });
      },

      setOutlineWidth: (width) => {
        const clamped = Math.min(600, Math.max(180, Math.round(width)));
        set({ outlineWidth: clamped });
      },

      closeSplit: () => {
        set({ splitMode: 'none', secondaryTabId: null });
      },
    }),
    {
      name: 'cme_workspace_state',
      partialize: (state) => ({
        tabs: (state.tabs || []).filter((t) => t.id && t.id !== 'by-path'),
        activeTabId: state.activeTabId === 'by-path' ? null : state.activeTabId,
        splitMode: state.splitMode,
        secondaryTabId: state.secondaryTabId === 'by-path' ? null : state.secondaryTabId,
        splitRatio: state.splitRatio,
        outlineWidth: state.outlineWidth,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.tabs = (state.tabs || [])
            .filter((t) => t.id && t.id !== 'by-path')
            .map((t) => ({
              ...t,
              is_bundle: Boolean(t.is_bundle && t.path?.endsWith('.bundle')),
            }));
          if (state.activeTabId === 'by-path') {
            state.activeTabId = state.tabs.length > 0 ? state.tabs[0].id : null;
          }
          if (state.secondaryTabId === 'by-path') {
            state.secondaryTabId = null;
          }
        }
      },
    }
  )
);
