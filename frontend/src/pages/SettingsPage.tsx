import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sun, Moon, BookOpen, Monitor, Key, User, Lock, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { useThemeStore, ThemeMode } from '../stores/themeStore';
import { useUIStore } from '../stores/uiStore';
import { fetchCurrentUser, updateCurrentUserProfile } from '../api/auth';
import { Badge } from '../components/common/Badge';

export const SettingsPage: React.FC = () => {
  const { mode, setMode } = useThemeStore();
  const { setBreadcrumbs, setTokensModalOpen } = useUIStore();
  const queryClient = useQueryClient();

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

  const [displayName, setDisplayName] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);
  const [profileErrorMsg, setProfileErrorMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState<string | null>(null);
  const [passwordErrorMsg, setPasswordErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || user.username || '');
    }
  }, [user]);

  const handleSaveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccessMsg(null);
    setProfileErrorMsg(null);
    if (!displayName.trim()) {
      setProfileErrorMsg('Display name cannot be empty.');
      return;
    }
    setIsUpdatingProfile(true);
    try {
      await updateCurrentUserProfile({ display_name: displayName.trim() });
      setProfileSuccessMsg('Display name updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    } catch (err: any) {
      setProfileErrorMsg(err?.message || 'Failed to update display name.');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccessMsg(null);
    setPasswordErrorMsg(null);
    if (!currentPassword) {
      setPasswordErrorMsg('Please enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordErrorMsg('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordErrorMsg('New password and confirmation do not match.');
      return;
    }
    setIsUpdatingPassword(true);
    try {
      await updateCurrentUserProfile({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordSuccessMsg('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordErrorMsg(err?.message || 'Failed to update password.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

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

          <div className="p-5 rounded-xl border border-cme-border-base bg-cme-bg-surface space-y-5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-cme-border-base">
              <div>
                <span className="text-cme-text-muted block text-[11px]">Username</span>
                <span className="font-mono font-medium text-cme-text-base">@{user.username}</span>
              </div>
              <div>
                <span className="text-cme-text-muted block text-[11px]">Role</span>
                <span className="inline-block mt-0.5">
                  {user.is_system_admin ? (
                    <Badge variant="warning">System Administrator</Badge>
                  ) : (
                    <Badge variant="neutral">Member</Badge>
                  )}
                </span>
              </div>
              <div>
                <span className="text-cme-text-muted block text-[11px]">Authentication System</span>
                <span className="font-medium text-cme-text-base flex items-center gap-1.5 mt-0.5">
                  {user.authn_provider === 'challenge' ? (
                    <Badge variant="primary">Built-in (Password)</Badge>
                  ) : (
                    <Badge variant="neutral">Single Sign-On (Delegated)</Badge>
                  )}
                </span>
              </div>
            </div>

            {/* Profile Settings (Display Name) */}
            <form onSubmit={handleSaveDisplayName} className="space-y-3">
              <div className="flex items-center gap-2 font-semibold text-cme-text-base text-xs">
                <User className="w-4 h-4 text-cme-primary" />
                <span>Profile Details</span>
              </div>

              {profileSuccessMsg && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{profileSuccessMsg}</span>
                </div>
              )}
              {profileErrorMsg && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{profileErrorMsg}</span>
                </div>
              )}

              <div className="max-w-md space-y-1.5">
                <label className="text-[11px] font-medium text-cme-text-muted">Display Name</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter your public display name"
                    className="flex-1 px-3 py-1.5 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                  />
                  <button
                    type="submit"
                    disabled={isUpdatingProfile || displayName.trim() === (user.display_name || user.username)}
                    className="px-3 py-1.5 rounded-lg bg-cme-primary text-white text-xs font-medium hover:bg-cme-primary-hover transition-colors disabled:opacity-40 shrink-0"
                  >
                    {isUpdatingProfile ? 'Saving...' : 'Save Name'}
                  </button>
                </div>
                <p className="text-[10px] text-cme-text-muted">
                  This name is displayed in live collaborative cursors, comments, and review assignments.
                </p>
              </div>
            </form>

            {/* Password Section */}
            <div className="pt-4 border-t border-cme-border-base space-y-3">
              <div className="flex items-center gap-2 font-semibold text-cme-text-base text-xs">
                <Lock className="w-4 h-4 text-cme-primary" />
                <span>Password Security</span>
              </div>

              {user.can_change_password ? (
                <form onSubmit={handleSavePassword} className="space-y-3 max-w-md">
                  {passwordSuccessMsg && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{passwordSuccessMsg}</span>
                    </div>
                  )}
                  {passwordErrorMsg && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{passwordErrorMsg}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-cme-text-muted">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-1.5 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-cme-text-muted">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        className="w-full px-3 py-1.5 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-cme-text-muted">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat new password"
                        className="w-full px-3 py-1.5 bg-cme-bg-subtle border border-cme-border-base rounded-lg text-xs text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isUpdatingPassword || !currentPassword || !newPassword}
                    className="px-3 py-1.5 rounded-lg bg-cme-primary text-white text-xs font-medium hover:bg-cme-primary-hover transition-colors disabled:opacity-40"
                  >
                    {isUpdatingPassword ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              ) : (
                <div className="p-3.5 rounded-lg bg-cme-bg-subtle/80 border border-cme-border-base text-cme-text-muted text-xs flex items-start gap-3 max-w-lg">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-medium text-cme-text-base block">Managed by Identity Provider</span>
                    <p className="text-[11px] leading-relaxed">
                      Your authentication is delegated to an external reverse-proxy or single sign-on provider. Passwords and credentials must be changed through your identity provider.
                    </p>
                  </div>
                </div>
              )}
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
