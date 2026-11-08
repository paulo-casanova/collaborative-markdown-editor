import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Key, Plus, Copy, Check, Clock, Trash2, Activity } from 'lucide-react';
import { listTokens, createToken, deleteToken } from '../../api/auth';
import { useUIStore } from '../../stores/uiStore';

export const TokensModal: React.FC = () => {
  const { tokensModalOpen, setTokensModalOpen } = useUIStore();
  const queryClient = useQueryClient();
  const [tokenName, setTokenName] = useState('');
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingHash, setDeletingHash] = useState<string | null>(null);

  const { data: tokens, isLoading } = useQuery({
    queryKey: ['auth-tokens'],
    queryFn: listTokens,
    enabled: tokensModalOpen,
  });

  const createMutation = useMutation({
    mutationFn: () => createToken(tokenName.trim() || 'Personal Access Token'),
    onSuccess: (data) => {
      setNewlyCreatedToken(data.token);
      setTokenName('');
      queryClient.invalidateQueries({ queryKey: ['auth-tokens'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (tokenHash: string) => deleteToken(tokenHash),
    onSuccess: () => {
      setDeletingHash(null);
      queryClient.invalidateQueries({ queryKey: ['auth-tokens'] });
    },
  });

  if (!tokensModalOpen) return null;

  const handleCopy = () => {
    if (newlyCreatedToken) {
      navigator.clipboard.writeText(newlyCreatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-cme-bg-surface border border-cme-border-base rounded-2xl shadow-2xl overflow-hidden text-cme-text-base">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-cme-border-base bg-cme-bg-subtle">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-cme-primary" />
            <h3 className="font-semibold text-sm">Personal Access Tokens</h3>
          </div>
          <button
            onClick={() => {
              setTokensModalOpen(false);
              setNewlyCreatedToken(null);
              setDeletingHash(null);
            }}
            className="p-1 text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {newlyCreatedToken ? (
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  <Check className="w-4 h-4" />
                  <span>Token Generated! Copy it now (won't be shown again):</span>
                </div>
                <button
                  type="button"
                  onClick={() => setNewlyCreatedToken(null)}
                  className="text-[11px] text-cme-text-muted hover:text-cme-text-base transition-colors"
                >
                  Done
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={newlyCreatedToken}
                  className="w-full p-2 bg-cme-bg-base border border-cme-border-base font-mono text-xs rounded-lg select-all"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1 shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[11px] text-cme-text-muted">
                Use in HTTP requests: <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>
              </p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                placeholder="Token description (e.g. CI Script, LLM Agent)"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                className="flex-1 px-3 py-2 bg-cme-bg-base border border-cme-border-base rounded-lg focus:outline-none focus:border-cme-primary text-cme-text-base"
              />
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-4 py-2 bg-cme-primary text-white font-medium rounded-lg hover:bg-cme-primary-hover disabled:opacity-50 transition-colors flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{createMutation.isPending ? 'Creating...' : 'Generate'}</span>
              </button>
            </form>
          )}

          {/* Existing Tokens */}
          <div className="space-y-2 pt-2">
            <h4 className="font-semibold text-cme-text-muted uppercase text-[11px] tracking-wider">
              Active Tokens
            </h4>
            {isLoading ? (
              <div className="py-4 text-center text-cme-text-muted">Loading tokens...</div>
            ) : !tokens || tokens.length === 0 ? (
              <div className="py-4 text-center text-cme-text-muted italic">No active tokens found.</div>
            ) : (
              <div className="divide-y divide-cme-border-base border border-cme-border-base rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                {tokens.map((t, idx) => (
                  <div key={t.token_hash || idx} className="p-3 bg-cme-bg-surface flex items-center justify-between gap-3 hover:bg-cme-bg-hover/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-cme-text-base truncate">
                        {t.name || 'Personal Access Token'}
                      </div>
                      <div className="text-[11px] text-cme-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 font-mono">
                        {t.token_prefix ? (
                          <span className="bg-cme-bg-subtle px-1.5 py-0.5 rounded border border-cme-border-base text-cme-text-subtle font-semibold">
                            {t.token_prefix}••••••••
                          </span>
                        ) : (
                          <span className="text-cme-text-subtle">••••••••</span>
                        )}
                        <span className="flex items-center gap-1 text-cme-text-muted" title={t.created_at}>
                          <Clock className="w-3 h-3 text-cme-text-subtle shrink-0" />
                          <span>Created {t.created_at ? new Date(t.created_at).toLocaleDateString() : 'recently'}</span>
                        </span>
                        <span className="flex items-center gap-1 text-cme-text-muted" title={t.last_used_at || 'Never used'}>
                          <Activity className="w-3 h-3 text-cme-text-subtle shrink-0" />
                          <span>{t.last_used_at ? `Used ${new Date(t.last_used_at).toLocaleDateString()}` : 'Never used'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Delete / Revoke Action */}
                    <div className="shrink-0 flex items-center">
                      {deletingHash === t.token_hash ? (
                        <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 p-1 rounded-lg animate-in fade-in duration-100">
                          <span className="text-[11px] text-red-500 font-medium px-1">Revoke?</span>
                          <button
                            type="button"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (t.token_hash) {
                                deleteMutation.mutate(t.token_hash);
                              }
                            }}
                            className="px-2 py-0.5 bg-red-600 text-white rounded text-[11px] font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                          >
                            {deleteMutation.isPending ? '...' : 'Yes'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingHash(null)}
                            className="px-1.5 py-0.5 bg-cme-bg-surface border border-cme-border-base rounded text-[11px] text-cme-text-muted hover:text-cme-text-base transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => t.token_hash && setDeletingHash(t.token_hash)}
                          title="Revoke token"
                          aria-label="Revoke token"
                          className="p-1.5 text-cme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
