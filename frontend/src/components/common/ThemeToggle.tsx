import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, BookOpen, Monitor } from 'lucide-react';
import { useThemeStore, ThemeMode } from '../../stores/themeStore';

export const ThemeToggle: React.FC = () => {
  const { mode, setMode } = useThemeStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const themeOptions: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'light', label: 'Light', icon: <Sun className="w-4 h-4 text-amber-500" /> },
    { mode: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4 text-blue-400" /> },
    { mode: 'sepia', label: 'Sepia', icon: <BookOpen className="w-4 h-4 text-amber-700" /> },
    { mode: 'system', label: 'System', icon: <Monitor className="w-4 h-4 text-cme-text-muted" /> },
  ];

  const currentOption = themeOptions.find((o) => o.mode === mode) || themeOptions[3];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-cme-text-base transition-colors"
        title={`Theme: ${currentOption.label}`}
      >
        {currentOption.icon}
        <span className="capitalize">{currentOption.label}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-36 py-1 bg-cme-bg-surface border border-cme-border-base rounded-md shadow-lg z-50">
          {themeOptions.map((option) => (
            <button
              key={option.mode}
              onClick={() => {
                setMode(option.mode);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-cme-bg-hover transition-colors ${
                mode === option.mode ? 'font-semibold text-cme-primary bg-cme-primary-subtle' : 'text-cme-text-base'
              }`}
            >
              {option.icon}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
