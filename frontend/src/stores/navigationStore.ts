import { create } from 'zustand';

export interface NavigationLocation {
  pathname: string;
  search?: string;
  hash?: string;
  scrollTop?: number;
  title?: string;
  docId?: string;
}

export interface LinkJump {
  fromLocation: NavigationLocation;
  toTarget: string;
  timestamp: number;
}

export interface NavigationState {
  // Document-level scroll position cache (keyed by docId or path)
  scrollPositions: Record<string, number>;
  saveScrollPosition: (key: string, scrollTop: number) => void;
  getScrollPosition: (key: string) => number | undefined;

  // Contextual link jump state (when user followed a link)
  lastLinkJump: LinkJump | null;
  recordLinkJump: (fromLocation: NavigationLocation, toTarget: string) => void;
  clearLastLinkJump: () => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  scrollPositions: {},
  saveScrollPosition: (key, scrollTop) => {
    if (!key) return;
    set((state) => ({
      scrollPositions: {
        ...state.scrollPositions,
        [key]: Math.max(0, Math.round(scrollTop)),
      },
    }));
  },
  getScrollPosition: (key) => {
    if (!key) return undefined;
    return get().scrollPositions[key];
  },

  lastLinkJump: null,
  recordLinkJump: (fromLocation, toTarget) => {
    set({
      lastLinkJump: {
        fromLocation,
        toTarget,
        timestamp: Date.now(),
      },
    });
  },
  clearLastLinkJump: () => {
    set({ lastLinkJump: null });
  },
}));
