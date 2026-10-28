import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Plus,
  Send,
  X,
  Bot,
  User,
  Zap,
  Paperclip,
  ChevronDown,
  Trash2,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { useDialogStore } from '../../stores/dialogStore';
import { useUIStore } from '../../stores/uiStore';
import { DiffProposalCard } from './DiffProposalCard';

interface DialogSidecarProps {
  documentId?: string;
  documentTitle?: string;
  onApplyDiff?: (diff: string) => void;
}

export const DialogSidecar: React.FC<DialogSidecarProps> = ({
  documentId,
  documentTitle,
  onApplyDiff,
}) => {
  const { setDialogSidecarOpen } = useUIStore();
  const {
    dialogs,
    activeDialogId,
    messages,
    isLoading,
    isSending,
    agentStatus,
    streamingContent,
    activeToolActivity,
    diffProposals,
    contextSnapshot,
    clearContextSnapshot,
    loadDialogs,
    selectDialog,
    createAndSelectDialog,
    deleteDialog,
    sendMessage,
    setPairingModalOpen,
    refreshAgentStatus,
  } = useDialogStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadDialogs();
    void refreshAgentStatus();
  }, []);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, activeToolActivity]);

  const handleSend = async () => {
    if (!inputPrompt.trim() || isSending) return;
    const content = inputPrompt;
    setInputPrompt('');
    await sendMessage(content);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const currentDialog = dialogs.find((d) => d.id === activeDialogId);

  return (
    <aside
      className="w-96 flex-shrink-0 border-l border-cme-border-base bg-cme-bg-surface flex flex-col h-full shadow-lg z-20 select-text"
      data-testid="dialog-sidecar"
    >
      {/* Sidecar Top Bar */}
      <div className="p-3 border-b border-cme-border-base bg-cme-bg-subtle flex items-center justify-between gap-2 shrink-0">
        {/* Dialog Selector Dropdown */}
        <div className="relative flex-1 min-w-0">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors truncate"
            title="Switch Dialog Thread"
            data-testid="dialog-selector-btn"
          >
            <div className="flex items-center gap-1.5 truncate">
              <MessageSquare className="w-3.5 h-3.5 text-cme-primary shrink-0" />
              <span className="truncate">{currentDialog ? currentDialog.title : 'Select Dialog...'}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-cme-text-muted shrink-0" />
          </button>

          {/* Dialog List Dropdown Menu */}
          {dropdownOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-full bg-cme-bg-surface border border-cme-border-base rounded-lg shadow-xl z-50 overflow-hidden py-1 max-h-64 overflow-y-auto"
              onMouseLeave={() => setDropdownOpen(false)}
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cme-text-muted">
                Your Dialog Threads
              </div>

              {dialogs.map((d) => (
                <div
                  key={d.id}
                  onClick={async () => {
                    await selectDialog(d.id, documentId);
                    setDropdownOpen(false);
                  }}
                  className={`flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer hover:bg-cme-bg-hover transition-colors ${
                    d.id === activeDialogId
                      ? 'bg-cme-primary/10 text-cme-primary font-medium'
                      : 'text-cme-text-base'
                  }`}
                >
                  <span className="truncate flex-1 mr-2">{d.title}</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await deleteDialog(d.id);
                    }}
                    className="p-1 rounded text-cme-text-muted hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    title="Delete Dialog"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <div className="border-t border-cme-border-base mt-1 pt-1">
                <button
                  onClick={async () => {
                    setIsCreatingNew(true);
                    await createAndSelectDialog(
                      documentTitle ? `Chat: ${documentTitle}` : 'New Dialog',
                      documentId
                    );
                    setIsCreatingNew(false);
                    setDropdownOpen(false);
                  }}
                  disabled={isCreatingNew}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-cme-primary hover:bg-cme-bg-hover transition-colors font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isCreatingNew ? 'Creating...' : '+ New Dialog'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Agent Presence Pill */}
        <button
          onClick={() => setPairingModalOpen(true)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-medium transition-colors shrink-0 ${
            agentStatus.online
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-cme-border-base bg-cme-bg-base text-cme-text-muted hover:text-cme-text-base'
          }`}
          title={
            agentStatus.online
              ? `Connected: ${agentStatus.agent_name} (Click to manage)`
              : 'Agent offline (Click to pair local agent)'
          }
          data-testid="agent-status-badge"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              agentStatus.online ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'
            }`}
          />
          <span className="hidden sm:inline">
            {agentStatus.online ? agentStatus.agent_name : 'Pair Agent'}
          </span>
        </button>

        {/* Close Sidecar */}
        <button
          onClick={() => setDialogSidecarOpen(false)}
          className="p-1.5 rounded-lg text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors shrink-0"
          title="Close AI Assistant Sidecar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Thread Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {messages.length === 0 && !streamingContent && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-cme-text-muted space-y-3">
            <div className="p-3 rounded-2xl bg-cme-bg-subtle border border-cme-border-base text-cme-primary">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="font-semibold text-cme-text-base text-sm">
              Local AI Agent Assistant
            </div>
            <p className="text-xs leading-relaxed text-cme-text-subtle">
              Ask questions, highlight text in your document to attach context, or request
              refactoring. Requests route securely to your local agent daemon.
            </p>
            {!agentStatus.online && (
              <button
                onClick={() => setPairingModalOpen(true)}
                className="mt-2 px-3 py-1.5 rounded-lg bg-cme-primary text-white text-xs font-medium hover:opacity-90 transition-opacity"
              >
                Connect Local Agent
              </button>
            )}
          </div>
        )}

        {/* Render Conversation Messages */}
        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`flex flex-col space-y-1.5 ${
                isUser ? 'items-end' : 'items-start'
              }`}
            >
              {/* Header Pill */}
              <div className="flex items-center gap-1.5 text-[11px] text-cme-text-subtle px-1">
                {isUser ? (
                  <>
                    <span className="font-medium">You</span>
                    <User className="w-3 h-3 text-cme-text-muted" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-cme-primary" />
                    <span className="font-medium text-cme-primary">
                      {agentStatus.agent_name || 'Agent'}
                    </span>
                  </>
                )}
                <span className="text-[10px]">
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              {/* Context Attachment Badge if message included a snapshot */}
              {m.context_snapshot &&
                (m.context_snapshot.selected_text || m.context_snapshot.document_title) && (
                  <div className="max-w-[85%] px-2.5 py-1 rounded bg-cme-bg-subtle border border-cme-border-base text-[11px] text-cme-text-muted flex items-center gap-1.5 truncate">
                    <Paperclip className="w-3 h-3 text-cme-primary shrink-0" />
                    <span className="font-medium text-cme-text-base shrink-0">
                      {m.context_snapshot.document_title || 'Document'}
                    </span>
                    {m.context_snapshot.selected_text && (
                      <span className="truncate italic">
                        "{m.context_snapshot.selected_text.trim()}"
                      </span>
                    )}
                  </div>
                )}

              {/* Message Content Bubble */}
              <div
                className={`max-w-[90%] rounded-xl px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap break-words ${
                  isUser
                    ? 'bg-cme-primary text-white shadow-sm'
                    : 'bg-cme-bg-base border border-cme-border-base text-cme-text-base shadow-sm'
                }`}
              >
                {m.content}
              </div>
            </div>
          );
        })}

        {/* Transient Local Tool Activity Notice */}
        {activeToolActivity && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs animate-pulse">
            <Zap className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium">{activeToolActivity.tool}</span>
            <span className="text-[11px] text-cme-text-muted truncate">
              ({activeToolActivity.status})
            </span>
          </div>
        )}

        {/* Streaming Assistant Response Buffer */}
        {streamingContent && (
          <div className="flex flex-col space-y-1.5 items-start">
            <div className="flex items-center gap-1.5 text-[11px] text-cme-primary px-1">
              <Bot className="w-3 h-3 text-cme-primary" />
              <span className="font-medium">
                {agentStatus.agent_name || 'Agent'} (streaming...)
              </span>
            </div>
            <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 bg-cme-bg-base border border-cme-border-base text-cme-text-base shadow-sm whitespace-pre-wrap leading-relaxed">
              {streamingContent}
              <span className="inline-block w-1.5 h-3.5 ml-1 bg-cme-primary animate-pulse align-middle" />
            </div>
          </div>
        )}

        {/* Proposed Diffs */}
        {diffProposals.map((dp) => (
          <DiffProposalCard key={dp.id} proposal={dp} onApply={onApplyDiff} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer Section */}
      <div className="p-3 border-t border-cme-border-base bg-cme-bg-subtle shrink-0 space-y-2">
        {/* Offline Warning banner if agent is not connected */}
        {!agentStatus.online && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-1.5 truncate">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
              <span className="truncate">Agent offline: responses will queue</span>
            </div>
            <button
              onClick={() => setPairingModalOpen(true)}
              className="underline font-semibold hover:opacity-80 shrink-0 ml-1"
            >
              Pair
            </button>
          </div>
        )}

        {/* Context Snapshot Attachment Pill */}
        {contextSnapshot && (
          <div className="flex items-center justify-between px-2.5 py-1 rounded bg-cme-bg-base border border-cme-border-base text-xs text-cme-text-base">
            <div className="flex items-center gap-1.5 truncate">
              <Paperclip className="w-3 h-3 text-cme-primary shrink-0" />
              <span className="font-semibold truncate">
                {contextSnapshot.document_title || 'Document Context'}
              </span>
              {contextSnapshot.selected_text && (
                <span className="text-[11px] text-cme-text-muted truncate">
                  ("{contextSnapshot.selected_text.trim()}")
                </span>
              )}
            </div>
            <button
              onClick={clearContextSnapshot}
              className="p-0.5 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover ml-1 shrink-0"
              title="Remove context attachment"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Composer Textarea & Send Button */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              agentStatus.online
                ? 'Ask your local agent or request edits (Enter to send)...'
                : 'Type prompt to save to dialog...'
            }
            className="flex-1 resize-none px-3 py-2 text-xs bg-cme-bg-base border border-cme-border-base rounded-lg focus:outline-none focus:ring-1 focus:ring-cme-primary text-cme-text-base leading-relaxed"
          />
          <button
            onClick={handleSend}
            disabled={!inputPrompt.trim() || isSending}
            className="p-2 rounded-lg bg-cme-primary text-white hover:opacity-90 disabled:opacity-40 transition-all shrink-0"
            title="Send prompt (Enter)"
            data-testid="send-prompt-btn"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
