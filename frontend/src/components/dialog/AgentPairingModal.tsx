import React, { useState, useEffect } from 'react';
import { X, Bot, Key, Copy, Check, Terminal, ShieldCheck, RefreshCw } from 'lucide-react';
import { useDialogStore } from '../../stores/dialogStore';
import * as dialogApi from '../../api/dialogs';
import { AgentTokenRecord, CreatedAgentToken } from '../../types/dialog';

export const AgentPairingModal: React.FC = () => {
  const { pairingModalOpen, setPairingModalOpen, agentStatus, refreshAgentStatus } = useDialogStore();
  const [tokens, setTokens] = useState<AgentTokenRecord[]>([]);
  const [createdToken, setCreatedToken] = useState<CreatedAgentToken | null>(null);
  const [label, setLabel] = useState('Local Workstation');
  const [isCreating, setIsCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  useEffect(() => {
    if (pairingModalOpen) {
      void refreshAgentStatus();
      void loadTokens();
    }
  }, [pairingModalOpen]);

  const loadTokens = async () => {
    const list = await dialogApi.fetchAgentTokens();
    setTokens(list);
  };

  if (!pairingModalOpen) return null;

  const handleCreateToken = async () => {
    setIsCreating(true);
    try {
      const res = await dialogApi.createAgentToken(label || 'Local Agent', 30);
      setCreatedToken(res);
      await loadTokens();
    } catch (err) {
      console.warn('Failed to create agent token:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const serverOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:18080';
  const cliCommand = createdToken
    ? `cme-agent --server ${serverOrigin} --token ${createdToken.token}`
    : `cme-agent --server ${serverOrigin} --token <YOUR_AGENT_TOKEN>`;

  const handleCopyCmd = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(cliCommand);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    }
  };

  const handleCopyToken = () => {
    if (createdToken && typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(createdToken.token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => setPairingModalOpen(false)}
      data-testid="agent-pairing-modal"
    >
      <div
        className="w-full max-w-lg bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-cme-border-base flex items-center justify-between bg-cme-bg-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary-500/10 text-primary-500 border border-primary-500/20">
              <Bot className="w-5 h-5 text-cme-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-cme-text-base">Local AI Agent Gateway</h2>
              <p className="text-xs text-cme-text-muted">
                Run an autonomous AI daemon on your local workstation with native permissions
              </p>
            </div>
          </div>
          <button
            onClick={() => setPairingModalOpen(false)}
            className="p-1 rounded-md text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Status Banner */}
          <div className="flex items-center justify-between p-3.5 rounded-lg border border-cme-border-base bg-cme-bg-base">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                {agentStatus.online && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-3 w-3 ${
                    agentStatus.online ? 'bg-emerald-500' : 'bg-zinc-400'
                  }`}
                />
              </span>
              <div>
                <div className="text-xs font-semibold text-cme-text-base flex items-center gap-1.5">
                  {agentStatus.online ? (
                    <>
                      <span>Agent Online:</span>
                      <span className="text-emerald-500 font-mono">{agentStatus.agent_name}</span>
                    </>
                  ) : (
                    <span className="text-cme-text-muted">No Agent Connected</span>
                  )}
                </div>
                <div className="text-[11px] text-cme-text-subtle">
                  {agentStatus.online
                    ? 'Connected via outbound secure WebSocket. Listening for prompt requests.'
                    : 'Launch cme-agent on your terminal to connect your local LLM / tools.'}
                </div>
              </div>
            </div>
            <button
              onClick={() => void refreshAgentStatus()}
              className="p-1.5 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
              title="Refresh Agent Status"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* How It Works */}
          <div className="p-3.5 rounded-lg border border-cme-border-base bg-cme-bg-subtle text-xs space-y-2 text-cme-text-muted">
            <div className="flex items-center gap-1.5 font-medium text-cme-text-base">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Zero Inbound Ports & Preserved User Privileges</span>
            </div>
            <p className="leading-relaxed">
              Your agent connects <strong>outbound</strong> to CME over WebSocket. It runs on your own machine as your
              user, with access to your local Ollama models, Claude/OpenAI keys, Git repository, and CLI tools.
            </p>
          </div>

          {/* Pairing Token Generation */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-cme-text-base flex items-center justify-between">
              <span>Generate Pairing Token</span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Agent Label (e.g., MacBook M2, Linux Workstation)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs bg-cme-bg-base border border-cme-border-base rounded-md focus:outline-none focus:ring-1 focus:ring-cme-primary text-cme-text-base"
              />
              <button
                onClick={handleCreateToken}
                disabled={isCreating}
                className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-cme-primary text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5 shrink-0"
              >
                <Key className="w-3.5 h-3.5" />
                <span>{isCreating ? 'Generating...' : 'Create Token'}</span>
              </button>
            </div>

            {/* Newly Created Token Display */}
            {createdToken && (
              <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span>Pairing Token Created (Expires in 30 days)</span>
                  <button
                    onClick={handleCopyToken}
                    className="flex items-center gap-1 text-[11px] hover:underline"
                  >
                    {copiedToken ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedToken ? 'Copied' : 'Copy Token'}</span>
                  </button>
                </div>
                <div className="font-mono text-[11px] p-2 rounded bg-cme-bg-base border border-cme-border-base text-cme-text-base break-all">
                  {createdToken.token}
                </div>
              </div>
            )}
          </div>

          {/* Quickstart Command */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-cme-text-base">
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>Terminal Launch Command</span>
              </span>
              <button
                onClick={handleCopyCmd}
                className="flex items-center gap-1 text-[11px] text-cme-primary hover:underline font-normal"
              >
                {copiedCmd ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCmd ? 'Copied command' : 'Copy command'}</span>
              </button>
            </div>
            <pre className="font-mono text-[11px] p-3 rounded-lg bg-zinc-900 text-zinc-100 border border-zinc-800 overflow-x-auto whitespace-pre-wrap select-all">
              {cliCommand}
            </pre>
          </div>

          {/* Active Tokens List */}
          {tokens.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-cme-border-base">
              <div className="text-xs font-semibold text-cme-text-base">Existing Pairing Tokens</div>
              <div className="space-y-1.5">
                {tokens.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md border border-cme-border-base bg-cme-bg-base text-xs"
                  >
                    <div>
                      <span className="font-medium text-cme-text-base">{t.label}</span>
                      <span className="text-[10px] text-cme-text-subtle ml-2">
                        {t.last_used_at ? `Last used: ${new Date(t.last_used_at).toLocaleDateString()}` : 'Never used'}
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        await dialogApi.deleteAgentToken(t.id);
                        await loadTokens();
                      }}
                      className="text-rose-500 hover:text-rose-600 text-[11px] p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                      title="Revoke Token"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-cme-border-base flex justify-end bg-cme-bg-subtle">
          <button
            onClick={() => setPairingModalOpen(false)}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-cme-bg-surface border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
