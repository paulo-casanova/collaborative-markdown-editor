import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Lock, User, AlertCircle, ShieldCheck } from 'lucide-react';
import { loginUser } from '../../api/auth';
import { useUIStore } from '../../stores/uiStore';

export const LoginModal: React.FC = () => {
  const { loginModalOpen, setLoginModalOpen } = useUIStore();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: () => loginUser(username, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      setLoginModalOpen(false);
      setUsername('');
      setPassword('');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Invalid credentials');
    },
  });

  if (!loginModalOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setErrorMessage(null);
    loginMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl overflow-hidden text-cme-text-base">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-cme-border-base bg-cme-bg-subtle">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cme-primary" />
            <h3 className="font-semibold text-sm">Sign in to CME</h3>
          </div>
          <button
            onClick={() => setLoginModalOpen(false)}
            className="p-1 text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="font-medium text-cme-text-muted">Username</label>
            <div className="relative">
              <User className="w-4 h-4 text-cme-text-subtle absolute left-3 top-2.5" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice, bob"
                autoFocus
                required
                className="w-full pl-9 pr-3 py-2 bg-cme-bg-base border border-cme-border-base rounded-lg focus:outline-none focus:border-cme-primary text-cme-text-base transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-cme-text-muted">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-cme-text-subtle absolute left-3 top-2.5" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                className="w-full pl-9 pr-3 py-2 bg-cme-bg-base border border-cme-border-base rounded-lg focus:outline-none focus:border-cme-primary text-cme-text-base transition-colors"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full py-2.5 px-4 bg-cme-primary text-white font-medium rounded-lg hover:bg-cme-primary-hover disabled:opacity-50 transition-colors shadow-sm"
            >
              {loginMutation.isPending ? 'Authenticating...' : 'Sign In'}
            </button>
          </div>

          <div className="p-2.5 bg-cme-bg-subtle rounded-lg border border-cme-border-base text-[11px] text-cme-text-muted">
            Delegated authentication enabled: If running behind a reverse proxy (e.g. Caddy/Nginx) providing <code className="font-mono text-cme-text-base">X-Remote-User</code>, your session is provisioned automatically.
          </div>
        </form>
      </div>
    </div>
  );
};
