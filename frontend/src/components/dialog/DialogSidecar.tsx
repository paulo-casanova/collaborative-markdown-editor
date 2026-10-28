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
  Pencil,
  Check,
  Sparkles,
  AlertCircle,
  GitFork,
  RotateCcw,
  Loader2,
  Clock,
} from 'lucide-react';
import { useDialogStore } from '../../stores/dialogStore';
import { useUIStore } from '../../stores/uiStore';
import { DiffProposalCard } from './DiffProposalCard';
import { ContextSnapshot } from '../../types/dialog';

interface DialogSidecarProps {
  documentId?: string;
  documentTitle?: string;
  documentPath?: string;
  documentContent?: string;
  onApplyDiff?: (diff: string) => void;
}

export const DialogSidecar: React.FC<DialogSidecarProps> = ({
  documentId,
  documentTitle,
  documentPath,
  documentContent,
  onApplyDiff,
}) => {
  const { setDialogSidecarOpen } = useUIStore();
  const {
    dialogs,
    activeDialogId,
    messages,
    isLoading,
    isSending,
    isGenerating,
    generatingStartTime,
    agentStatus,
    streamingContent,
    activeToolActivity,
    diffProposals,
    contextSnapshot,
    clearContextSnapshot,
    loadDialogs,
    selectDialog,
    createAndSelectDialog,
    renameDialog,
    deleteDialog,
    resetDialogToMessage,
    forkDialog,
    sendMessage,
    setPairingModalOpen,
    refreshAgentStatus,
  } = useDialogStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [editingDialogId, setEditingDialogId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Live elapsed response timer when agent is generating/responding
  useEffect(() => {
    if (!isGenerating || !generatingStartTime) {
      setElapsedSeconds(0);
      return;
    }
    const update = () => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - generatingStartTime) / 1000)));
    };
    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [isGenerating, generatingStartTime]);

  const handleStartRename = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingDialogId(id);
    setEditingTitleText(currentTitle);
  };

  const handleSaveRename = async (id: string) => {
    if (editingTitleText.trim()) {
      await renameDialog(id, editingTitleText.trim());
    }
    setEditingDialogId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSaveRename(id);
    } else if (e.key === 'Escape') {
      setEditingDialogId(null);
    }
  };

  useEffect(() => {
    void loadDialogs();
    void refreshAgentStatus();

    // Poll periodically while sidecar is open so agent presence updates immediately
    const interval = setInterval(() => {
      void refreshAgentStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, activeToolActivity, isGenerating]);

  const handleSend = async () => {
    if (!inputPrompt.trim() || isSending || isGenerating) return;
    const content = inputPrompt;
    setInputPrompt('');

    const sanitizeContent = (val: any): string | undefined => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed && trimmed !== '[object Object]') {
          return val;
        }
      }
      return undefined;
    };

    const cleanContent =
      sanitizeContent(contextSnapshot?.document_content) || sanitizeContent(documentContent);

    const effectiveSnapshot: ContextSnapshot | undefined = contextSnapshot
      ? {
          ...contextSnapshot,
          document_id: contextSnapshot.document_id || documentId,
          document_title: contextSnapshot.document_title || documentTitle,
          document_path: contextSnapshot.document_path || documentPath,
          document_content: cleanContent,
        }
      : (documentId || documentPath || documentTitle
          ? {
              document_id: documentId,
              document_title: documentTitle,
              document_path: documentPath,
              document_content: cleanContent,
            }
          : undefined);

    await sendMessage(content, effectiveSnapshot);
    clearContextSnapshot();
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
        {/* Dialog Selector or Active Rename Field */}
        {editingDialogId === activeDialogId && activeDialogId ? (
          <div className="flex-1 flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              autoFocus
              value={editingTitleText}
              onChange={(e) => setEditingTitleText(e.target.value)}
              onKeyDown={(e) => handleRenameKeyDown(e, activeDialogId)}
              onBlur={() => void handleSaveRename(activeDialogId)}
              className="flex-1 px-2 py-1 text-xs bg-cme-bg-base border border-cme-primary rounded text-cme-text-base focus:outline-none"
              placeholder="Dialog Title"
              data-testid="active-dialog-rename-input"
            />
            <button
              onClick={() => void handleSaveRename(activeDialogId)}
              className="p-1 rounded text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
              title="Save Title"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setEditingDialogId(null)}
              className="p-1 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex-1 flex items-center gap-1.5 min-w-0">
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
                        if (editingDialogId === d.id) return;
                        await selectDialog(d.id, documentId);
                        setDropdownOpen(false);
                      }}
                      className={`flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer hover:bg-cme-bg-hover transition-colors ${
                        d.id === activeDialogId
                          ? 'bg-cme-primary/10 text-cme-primary font-medium'
                          : 'text-cme-text-base'
                      }`}
                    >
                      {editingDialogId === d.id ? (
                        <div
                          className="flex-1 flex items-center gap-1 min-w-0 mr-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={editingTitleText}
                            onChange={(e) => setEditingTitleText(e.target.value)}
                            onKeyDown={(e) => handleRenameKeyDown(e, d.id)}
                            onBlur={() => void handleSaveRename(d.id)}
                            className="flex-1 px-1.5 py-0.5 text-xs bg-cme-bg-base border border-cme-primary rounded text-cme-text-base focus:outline-none"
                          />
                          <button
                            onClick={() => void handleSaveRename(d.id)}
                            className="p-1 rounded text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                            title="Save"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="truncate flex-1 mr-2">{d.title}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => handleStartRename(e, d.id, d.title)}
                              className="p-1 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-subtle transition-colors"
                              title="Rename Dialog"
                              data-testid={`rename-dialog-btn-${d.id}`}
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                await deleteDialog(d.id);
                              }}
                              className="p-1 rounded text-cme-text-muted hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                              title="Delete Dialog"
                              data-testid={`delete-dialog-btn-${d.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
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

            {/* Quick Rename Button for Active Dialog */}
            {activeDialogId && currentDialog && (
              <>
                <button
                  onClick={(e) => handleStartRename(e, activeDialogId, currentDialog.title)}
                  className="p-1.5 rounded-lg border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors shrink-0"
                  title="Rename current dialog"
                  data-testid="rename-active-dialog-btn"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    await forkDialog();
                  }}
                  className="p-1.5 rounded-lg border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors shrink-0"
                  title="Fork dialog into a new thread"
                  data-testid="fork-active-dialog-btn"
                >
                  <GitFork className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}

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
              className={`group flex flex-col space-y-1.5 ${
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

                {/* Message Hover Actions: Fork thread from here & Reset dialog to here */}
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-1 transition-opacity">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await forkDialog(m.id);
                    }}
                    className="p-1 rounded text-cme-text-muted hover:text-cme-primary hover:bg-cme-bg-subtle transition-colors"
                    title="Fork conversation thread from this message"
                    data-testid={`fork-from-msg-${m.id}`}
                  >
                    <GitFork className="w-3 h-3" />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          'Reset conversation to this message? Subsequent messages in this dialog will be deleted.'
                        )
                      ) {
                        await resetDialogToMessage(m.id);
                      }
                    }}
                    className="p-1 rounded text-cme-text-muted hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                    title="Reset conversation to this message (rewind)"
                    data-testid={`reset-to-msg-${m.id}`}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Context Attachment Badge if message included a snapshot */}
              {m.context_snapshot &&
                (m.context_snapshot.selected_text ||
                  m.context_snapshot.document_title ||
                  m.context_snapshot.document_path) && (
                  <div className="max-w-[85%] px-2.5 py-1 rounded bg-cme-bg-subtle border border-cme-border-base text-[11px] text-cme-text-muted flex items-center gap-1.5 truncate">
                    <Paperclip className="w-3 h-3 text-cme-primary shrink-0" />
                    <span className="font-medium text-cme-text-base shrink-0">
                      {m.context_snapshot.document_title ||
                        m.context_snapshot.document_path ||
                        'Document'}
                    </span>
                    {m.context_snapshot.selected_text ? (
                      <span className="truncate italic">
                        "{m.context_snapshot.selected_text.trim()}"
                      </span>
                    ) : (
                      <span className="text-[10px] text-cme-text-subtle shrink-0">
                        (active document context)
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

        {/* Waiting / Generating State with Live Timer */}
        {isGenerating && !streamingContent && (
          <div className="flex flex-col space-y-1.5 items-start" data-testid="agent-waiting-state">
            <div className="flex items-center gap-1.5 text-[11px] text-cme-primary px-1">
              <Loader2 className="w-3.5 h-3.5 text-cme-primary animate-spin shrink-0" />
              <span className="font-medium text-cme-primary">
                {agentStatus.agent_name || 'Agent'} is thinking...
              </span>
              <span className="flex items-center gap-1 text-[10px] text-cme-text-muted px-1.5 py-0.5 rounded-full bg-cme-bg-subtle border border-cme-border-base font-mono">
                <Clock className="w-2.5 h-2.5 text-cme-primary/70" />
                {elapsedSeconds}s
              </span>
            </div>
            <div className="flex items-center gap-2.5 max-w-[90%] rounded-xl px-4 py-2.5 bg-cme-bg-base border border-cme-border-base text-cme-text-muted shadow-sm">
              <span className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cme-primary animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-cme-primary animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-cme-primary animate-bounce" />
              </span>
              <span className="text-xs text-cme-text-muted">
                Waiting for model response ({elapsedSeconds}s)
              </span>
            </div>
          </div>
        )}

        {/* Streaming Assistant Response Buffer */}
        {streamingContent && (
          <div className="flex flex-col space-y-1.5 items-start">
            <div className="flex items-center gap-1.5 text-[11px] text-cme-primary px-1">
              <Bot className="w-3 h-3 text-cme-primary" />
              <span className="font-medium">
                {agentStatus.agent_name || 'Agent'} (responding...)
              </span>
              {elapsedSeconds > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-cme-text-muted px-1.5 py-0.5 rounded-full bg-cme-bg-subtle border border-cme-border-base font-mono">
                  <Clock className="w-2.5 h-2.5 text-cme-primary/70" />
                  {elapsedSeconds}s
                </span>
              )}
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

        {/* Active Document Context Pill when no custom snippet is selected */}
        {!contextSnapshot && (documentTitle || documentPath) && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cme-bg-base/70 border border-cme-border-base text-xs text-cme-text-muted truncate">
            <Paperclip className="w-3 h-3 text-cme-primary shrink-0" />
            <span className="font-semibold text-cme-text-base truncate">
              {documentTitle || documentPath}
            </span>
            <span className="text-[10px] text-cme-text-subtle shrink-0">
              (active document attached)
            </span>
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
            disabled={!inputPrompt.trim() || isSending || isGenerating}
            className="p-2 rounded-lg bg-cme-primary text-white hover:opacity-90 disabled:opacity-40 transition-all shrink-0 flex items-center justify-center"
            title={isGenerating ? `Agent responding (${elapsedSeconds}s)` : 'Send prompt (Enter)'}
            data-testid="send-prompt-btn"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
