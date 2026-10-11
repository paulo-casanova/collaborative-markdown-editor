import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkspaceTab {
  id: string; // document UUID
  path: string; // relative file path
  title: string;
  is_bundle?: boolean;
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

  // Split-View Actions
  setSplitMode: (mode: SplitMode, secondaryId?: string | null) => void;
  setSecondaryTabId: (tabId: string | null) => void;
  setSplitRatio: (ratio: number) => void;
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

      openTab: (newTab, activate = true) => {
        const { tabs, activeTabId, splitMode, secondaryTabId } = get();
        const existingIndex = tabs.findIndex((t) => t.id === newTab.id);

        if (existingIndex >= 0) {
          // Tab already exists; update path/title if changed, and activate if requested
          const updatedTabs = [...tabs];
          updatedTabs[existingIndex] = {
            ...updatedTabs[existingIndex],
            path: newTab.path,
            title: newTab.title,
            is_bundle: newTab.is_bundle,
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
          tabs: tabs.map((t) => (t.id === tabId ? { ...t, ...metadata } : t)),
        });
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId, secondaryTabId, splitMode } = get();
        const targetIndex = tabs.findIndex((t) => t.id === tabId);
        if (targetIndex < 0) return;

        const newTabs = tabs.filter((t) => t.id !== tabId);

        let nextActive = activeTabId;
        if (activeTabId === tabId) {
          if (newTabs.length > 0) {
            const nextIndex = Math.min(targetIndex, newTabs.length - 1);
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

      closeSplit: () => {
        set({ splitMode: 'none', secondaryTabId: null });
      },
    }),
    {
      name: 'cme_workspace_state',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        splitMode: state.splitMode,
        secondaryTabId: state.secondaryTabId,
        splitRatio: state.splitRatio,
      }),
    }
  )
);
