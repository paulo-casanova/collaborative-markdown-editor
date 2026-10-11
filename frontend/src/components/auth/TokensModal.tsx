import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Key, Plus, Copy, Check, Clock } from 'lucide-react';
import { listTokens, createToken } from '../../api/auth';
import { useUIStore } from '../../stores/uiStore';

export const TokensModal: React.FC = () => {
  const { tokensModalOpen, setTokensModalOpen } = useUIStore();
  const queryClient = useQueryClient();
  const [tokenName, setTokenName] = useState('');
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: tokens, isLoading } = useQuery({
    queryKey: ['auth-tokens'],
    queryFn: listTokens,
    enabled: tokensModalOpen,
  });

  const createMutation = useMutation({
    mutationFn: () => createToken(tokenName || 'Personal Access Token'),
    onSuccess: (data) => {
      setNewlyCreatedToken(data.token);
      setTokenName('');
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
            }}
            className="p-1 text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {newlyCreatedToken ? (
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="w-4 h-4" />
                <span>Token Generated! Copy it now (won't be shown again):</span>
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
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1"
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
                className="px-4 py-2 bg-cme-primary text-white font-medium rounded-lg hover:bg-cme-primary-hover disabled:opacity-50 transition-colors flex items-center gap-1"
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
              <div className="divide-y divide-cme-border-base border border-cme-border-base rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {tokens.map((t, idx) => (
                  <div key={idx} className="p-2.5 bg-cme-bg-surface flex items-center justify-between">
                    <div>
                      <div className="font-medium text-cme-text-base">{t.name || 'Personal Access Token'}</div>
                      <div className="text-[11px] text-cme-text-muted flex items-center gap-2 mt-0.5 font-mono">
                        {t.token_prefix && <span>{t.token_prefix}••••••••</span>}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-cme-text-subtle" />
                          <span>{t.created_at ? new Date(t.created_at).toLocaleDateString() : 'Active'}</span>
                        </span>
                      </div>
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
