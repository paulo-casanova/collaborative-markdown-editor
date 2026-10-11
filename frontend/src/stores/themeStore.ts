import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'sepia' | 'system';
export type ResolvedTheme = 'light' | 'dark' | 'sepia';

interface ThemeState {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  initThemeListener: () => () => void;
}

const STORAGE_KEY = 'cme-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return getSystemTheme();
  }
  return mode;
}

function applyDomTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialMode: ThemeMode = (typeof localStorage !== 'undefined'
    ? (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'system'
    : 'system');
  const initialResolved = resolveTheme(initialMode);
  applyDomTheme(initialResolved);

  return {
    mode: initialMode,
    resolvedTheme: initialResolved,
    setMode: (newMode: ThemeMode) => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, newMode);
      }
      const newResolved = resolveTheme(newMode);
      applyDomTheme(newResolved);
      set({ mode: newMode, resolvedTheme: newResolved });
    },
    initThemeListener: () => {
      if (typeof window === 'undefined' || !window.matchMedia) {
        return () => {};
      }
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => {
        if (get().mode === 'system') {
          const newResolved = getSystemTheme();
          applyDomTheme(newResolved);
          set({ resolvedTheme: newResolved });
        }
      };

      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    },
  };
});
