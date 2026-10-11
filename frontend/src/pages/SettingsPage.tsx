import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sun, Moon, BookOpen, Monitor, Key } from 'lucide-react';
import { useThemeStore, ThemeMode } from '../stores/themeStore';
import { useUIStore } from '../stores/uiStore';
import { fetchCurrentUser } from '../api/auth';
import { Badge } from '../components/common/Badge';

export const SettingsPage: React.FC = () => {
  const { mode, setMode } = useThemeStore();
  const { setBreadcrumbs, setTokensModalOpen } = useUIStore();

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Workspaces', path: '/' },
      { label: 'Settings', isCurrent: true },
    ]);
  }, [setBreadcrumbs]);

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const themes: { mode: ThemeMode; label: string; desc: string; icon: React.ReactNode }[] = [
    {
      mode: 'light',
      label: 'Light Mode',
      desc: 'Clean, high-contrast daylight aesthetic with crisp slate typography.',
      icon: <Sun className="w-5 h-5 text-amber-500" />,
    },
    {
      mode: 'dark',
      label: 'Dark Slate',
      desc: 'Subdued nighttime palette reducing eyestrain during prolonged writing.',
      icon: <Moon className="w-5 h-5 text-blue-400" />,
    },
    {
      mode: 'sepia',
      label: 'Sepia Parchment',
      desc: 'Warm paper-like tones optimized for extended long-form reading and editing.',
      icon: <BookOpen className="w-5 h-5 text-amber-700" />,
    },
    {
      mode: 'system',
      label: 'System Sync',
      desc: 'Automatically matches your operating system dark/light mode preference.',
      icon: <Monitor className="w-5 h-5 text-cme-text-muted" />,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-8">
      <div className="pb-4 border-b border-cme-border-base">
        <h1 className="text-2xl font-bold tracking-tight text-cme-text-base">Settings</h1>
        <p className="text-xs text-cme-text-muted mt-1">
          Customize your editor experience, themes, and personal credentials.
        </p>
      </div>

      {/* Theme Selection */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-cme-text-subtle">
          Appearance & Themes
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {themes.map((theme) => {
            const isSelected = mode === theme.mode;
            return (
              <button
                key={theme.mode}
                onClick={() => setMode(theme.mode)}
                className={`p-4 rounded-xl border text-left transition-all flex items-start gap-3.5 ${
                  isSelected
                    ? 'border-cme-primary bg-cme-primary-subtle/50 ring-2 ring-cme-primary/20 shadow-sm'
                    : 'border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover'
                }`}
              >
                <div className="p-2 rounded-lg bg-cme-bg-surface border border-cme-border-base mt-0.5">
                  {theme.icon}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-cme-text-base">{theme.label}</span>
                    {isSelected && (
                      <Badge variant="primary" size="sm">
                        Active
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-cme-text-muted leading-relaxed">{theme.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Account Info */}
      {user && (
        <section className="space-y-4 pt-4 border-t border-cme-border-base">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-cme-text-subtle">
            Account & Identity
          </h2>
          <div className="p-5 rounded-xl border border-cme-border-base bg-cme-bg-surface space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-cme-text-muted">Username</span>
              <span className="font-mono font-medium text-cme-text-base">@{user.username}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cme-text-muted">Display Name</span>
              <span className="font-medium text-cme-text-base">{user.display_name || user.username}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-cme-text-muted">Role</span>
              <span>
                {user.is_system_admin ? (
                  <Badge variant="warning">System Administrator</Badge>
                ) : (
                  <Badge variant="neutral">Member</Badge>
                )}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* API Tokens */}
      <section className="space-y-3 pt-4 border-t border-cme-border-base">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-cme-text-subtle">
          Programmatic & LLM Access
        </h2>
        <div className="p-5 rounded-xl border border-cme-border-base bg-cme-bg-surface flex items-center justify-between">
          <div>
            <div className="font-semibold text-xs text-cme-text-base">Personal Access Tokens</div>
            <div className="text-[11px] text-cme-text-muted">
              Generate bearer tokens for external agent automation and CLI scripting.
            </div>
          </div>
          <button
            onClick={() => setTokensModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cme-primary text-white text-xs font-medium hover:bg-cme-primary-hover transition-colors"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Manage Tokens</span>
          </button>
        </div>
      </section>
    </div>
  );
};
