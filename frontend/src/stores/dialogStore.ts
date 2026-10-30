/**
 * Zustand store for CME Dialogs & Local Agent Subsystem.
 * Manages active dialog threads, real-time WebSocket event streaming,
 * context snapshots, and local agent presence.
 */

import { create } from 'zustand';
import {
  Dialog,
  DialogMessage,
  AgentStatus,
  ContextSnapshot,
  DiffProposal,
  AgentAction,
} from '../types/dialog';
import * as dialogApi from '../api/dialogs';
import { TOKEN_STORAGE_KEY } from '../api/client';

export const sortDialogMessages = (messages: DialogMessage[]): DialogMessage[] => {
  return [...messages].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime() || 0;
    const timeB = new Date(b.created_at).getTime() || 0;
    if (timeA !== timeB) return timeA - timeB;
    // When timestamps match (e.g. same second), user messages always precede assistant responses
    if (a.role === 'user' && b.role !== 'user') return -1;
    if (a.role !== 'user' && b.role === 'user') return 1;
    return (a.id || '').localeCompare(b.id || '');
  });
};

export type DialogWsStatus = 'connected' | 'connecting' | 'disconnected';

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let isExplicitDisconnect = false;
let pollIntervalTimer: ReturnType<typeof setInterval> | null = null;
const PROMPT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;

export const stopPendingPromptPolling = () => {
  if (pollIntervalTimer) {
    clearInterval(pollIntervalTimer);
    pollIntervalTimer = null;
  }
};

export const startPendingPromptPolling = (dialogId: string) => {
  stopPendingPromptPolling();

  pollIntervalTimer = setInterval(async () => {
    const state = useDialogStore.getState();
    if (!state.isGenerating || state.activeDialogId !== dialogId) {
      stopPendingPromptPolling();
      return;
    }

    const now = Date.now();
    const startTime = state.generatingStartTime || now;

    // Timeout check: visible error in conversation
    if (now - startTime > PROMPT_TIMEOUT_MS) {
      stopPendingPromptPolling();
      const timeoutMsg: DialogMessage = {
        id: `timeout-error-${Date.now()}`,
        dialog_id: dialogId,
        user_id: '',
        role: 'assistant',
        content:
          '⚠️ **Request Timed Out:** The AI agent did not respond within 90 seconds. Please check that your local agent companion is running and connected, then try again.',
        created_at: new Date().toISOString(),
      };
      useDialogStore.setState((s) => ({
        messages: sortDialogMessages([...s.messages, timeoutMsg]),
        isGenerating: false,
        generatingStartTime: null,
        activeToolActivity: null,
        streamingContent: '',
      }));
      return;
    }

    // Fallback polling tick: fetch and reconcile
    await useDialogStore.getState().reconcileMessages(dialogId);
  }, POLL_INTERVAL_MS);
};

export const scheduleReconnect = (dialogId: string) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  useDialogStore.setState({ wsStatus: 'connecting' });
  const baseDelay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 15000);
  const jitter = Math.random() * 300;
  const delay = baseDelay + jitter;
  reconnectAttempts++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isExplicitDisconnect && useDialogStore.getState().activeDialogId === dialogId) {
      useDialogStore.getState().connectDialogWs(dialogId);
    }
  }, delay);
};

interface DialogState {
  dialogs: Dialog[];
  activeDialogId: string | null;
  messages: DialogMessage[];
  isLoading: boolean;
  isSending: boolean;
  isGenerating: boolean;
  generatingStartTime: number | null;
  agentStatus: AgentStatus;
  streamingContent: string;
  activeToolActivity: { tool: string; status: string } | null;
  diffProposals: DiffProposal[];
  agentActions: AgentAction[];
  contextSnapshot: ContextSnapshot | null;
  pairingModalOpen: boolean;
  ws: WebSocket | null;
  wsStatus: DialogWsStatus;

  // Actions
  loadDialogs: () => Promise<void>;
  selectDialog: (dialogId: string, docIdToPersist?: string) => Promise<void>;
  createAndSelectDialog: (title?: string, docIdToPersist?: string) => Promise<Dialog>;
  renameDialog: (dialogId: string, newTitle: string) => Promise<void>;
  deleteDialog: (dialogId: string) => Promise<void>;
  sendMessage: (content: string, overrideSnapshot?: ContextSnapshot) => Promise<void>;
  reconcileMessages: (dialogId: string) => Promise<void>;
  resetDialogToMessage: (messageId: string, inclusive?: boolean) => Promise<void>;
  forkDialog: (upToMessageId?: string, customTitle?: string) => Promise<Dialog | null>;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  clearContextSnapshot: () => void;
  updateAgentActionStatus: (actionId: string, status: 'applied' | 'failed', error?: string) => void;
  refreshAgentStatus: () => Promise<void>;
  setPairingModalOpen: (open: boolean) => void;
  connectDialogWs: (dialogId: string) => void;
  disconnectDialogWs: () => void;
  stopGeneration: () => Promise<void>;
  syncDocumentDialogPreference: (documentId: string) => Promise<void>;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  dialogs: [],
  activeDialogId: null,
  messages: [],
  isLoading: false,
  isSending: false,
  isGenerating: false,
  generatingStartTime: null,
  agentStatus: {
    online: false,
    agent_name: '',
    connected_at: null,
    capabilities: [],
  },
  streamingContent: '',
  activeToolActivity: null,
  diffProposals: [],
  agentActions: [],
  contextSnapshot: null,
  pairingModalOpen: false,
  ws: null,
  wsStatus: 'disconnected',

  loadDialogs: async () => {
    try {
      const dialogs = await dialogApi.fetchDialogs();
      set({ dialogs });
      // If no active dialog and we have dialogs, select the first one
      if (!get().activeDialogId && dialogs.length > 0) {
        await get().selectDialog(dialogs[0].id);
      }
    } catch (err) {
      console.warn('[DialogStore] Failed to load dialogs:', err);
    }
  },

  selectDialog: async (dialogId: string, docIdToPersist?: string) => {
    if (get().activeDialogId === dialogId) {
      return;
    }

    // Disconnect any existing WS
    get().disconnectDialogWs();

    set({
      activeDialogId: dialogId,
      messages: [],
      streamingContent: '',
      activeToolActivity: null,
      diffProposals: [],
      agentActions: [],
      isLoading: true,
      isGenerating: false,
      generatingStartTime: null,
    });

    try {
      const messages = await dialogApi.fetchMessages(dialogId);
      set({ messages: sortDialogMessages(messages), isLoading: false });

      // Connect real-time WebSocket stream for this dialog
      get().connectDialogWs(dialogId);

      // Persist document association if provided
      if (docIdToPersist) {
        void dialogApi.setDocumentDialog(docIdToPersist, dialogId);
      }
    } catch (err) {
      console.warn(`[DialogStore] Failed to select dialog ${dialogId}:`, err);
      set({ isLoading: false });
    }
  },

  createAndSelectDialog: async (title?: string, docIdToPersist?: string) => {
    const newDialog = await dialogApi.createDialog(title);
    set((state) => ({
      dialogs: [newDialog, ...state.dialogs],
    }));
    await get().selectDialog(newDialog.id, docIdToPersist);
    return newDialog;
  },

  renameDialog: async (dialogId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      const updated = await dialogApi.updateDialog(dialogId, trimmed);
      set((state) => ({
        dialogs: state.dialogs.map((d) => (d.id === dialogId ? { ...d, title: updated.title } : d)),
      }));
    } catch (err) {
      console.warn(`[DialogStore] Failed to rename dialog ${dialogId}:`, err);
    }
  },

  deleteDialog: async (dialogId: string) => {
    try {
      await dialogApi.deleteDialog(dialogId);
      const remaining = get().dialogs.filter((d) => d.id !== dialogId);
      set({ dialogs: remaining });

      if (get().activeDialogId === dialogId) {
        if (remaining.length > 0) {
          await get().selectDialog(remaining[0].id);
        } else {
          get().disconnectDialogWs();
          set({
            activeDialogId: null,
            messages: [],
            streamingContent: '',
            activeToolActivity: null,
            diffProposals: [],
            agentActions: [],
            isGenerating: false,
            generatingStartTime: null,
          });
        }
      }
    } catch (err) {
      console.warn(`[DialogStore] Failed to delete dialog ${dialogId}:`, err);
    }
  },

  sendMessage: async (content: string, overrideSnapshot?: ContextSnapshot) => {
    const activeId = get().activeDialogId;
    if (!activeId || !content.trim()) return;

    const snapshot = overrideSnapshot || get().contextSnapshot || undefined;
    const isOnline = get().agentStatus.online;
    const tempId = `temp-user-${Date.now()}`;
    const optimisticMsg: DialogMessage = {
      id: tempId,
      dialog_id: activeId,
      user_id: '',
      role: 'user',
      content,
      context_snapshot: snapshot,
      created_at: new Date().toISOString(),
      agent_dispatched: isOnline,
    };

    set((state) => ({
      messages: sortDialogMessages([...state.messages, optimisticMsg]),
      isSending: true,
      isGenerating: isOnline,
      generatingStartTime: isOnline ? Date.now() : null,
      streamingContent: '',
      activeToolActivity: null,
    }));

    if (isOnline) {
      startPendingPromptPolling(activeId);
    }

    try {
      const msg = await dialogApi.postMessage(activeId, content, snapshot, 'user');
      set((state) => {
        const filtered = state.messages.filter(
          (m) => m.id !== tempId && m.id !== msg.id
        );
        const shouldGenerate = msg.agent_dispatched ?? state.agentStatus.online;
        if (shouldGenerate) {
          startPendingPromptPolling(activeId);
        } else {
          stopPendingPromptPolling();
        }
        return {
          messages: sortDialogMessages([...filtered, msg]),
          isSending: false,
          isGenerating: shouldGenerate,
          generatingStartTime: shouldGenerate ? (state.generatingStartTime || Date.now()) : null,
        };
      });
    } catch (err) {
      console.warn('[DialogStore] Failed to send message:', err);
      stopPendingPromptPolling();
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempId),
        isSending: false,
        isGenerating: false,
        generatingStartTime: null,
      }));
    }
  },

  reconcileMessages: async (dialogId: string) => {
    try {
      const messages = await dialogApi.fetchMessages(dialogId);
      if (get().activeDialogId !== dialogId) return;

      const sorted = sortDialogMessages(messages);

      let shouldClearGenerating = false;
      const currentState = get();

      if (currentState.isGenerating && sorted.length > 0) {
        const lastMsg = sorted[sorted.length - 1];
        if (lastMsg.role === 'assistant' || lastMsg.role === 'system') {
          shouldClearGenerating = true;
        } else {
          const userMsgs = sorted.filter((m) => m.role === 'user');
          const lastUser = userMsgs[userMsgs.length - 1];
          if (lastUser) {
            const userTime = new Date(lastUser.created_at).getTime() || 0;
            const hasReply = sorted.some(
              (m) =>
                (m.role === 'assistant' || m.role === 'system') &&
                new Date(m.created_at).getTime() >= userTime
            );
            if (hasReply) {
              shouldClearGenerating = true;
            }
          }
        }
      }

      // Preserve any pending optimistic user message that has not arrived from backend yet
      const optimistic = currentState.messages.filter(
        (m) => m.id.startsWith('temp-user-') && !sorted.some((s) => s.content === m.content)
      );

      set({
        messages: sortDialogMessages([...sorted, ...optimistic]),
        ...(shouldClearGenerating
          ? {
              isGenerating: false,
              generatingStartTime: null,
              activeToolActivity: null,
              streamingContent: '',
            }
          : {}),
      });

      if (shouldClearGenerating) {
        stopPendingPromptPolling();
      }
    } catch (err) {
      console.warn(`[DialogStore] Failed to reconcile messages for ${dialogId}:`, err);
    }
  },

  resetDialogToMessage: async (messageId: string, inclusive: boolean = false) => {
    const activeId = get().activeDialogId;
    if (!activeId) return;
    try {
      const remaining = await dialogApi.truncateDialog(activeId, messageId, inclusive);
      set({ messages: sortDialogMessages(remaining), streamingContent: '', activeToolActivity: null });
    } catch (err) {
      console.warn(`[DialogStore] Failed to reset dialog ${activeId} to message ${messageId}:`, err);
    }
  },

  forkDialog: async (upToMessageId?: string, customTitle?: string) => {
    const activeId = get().activeDialogId;
    if (!activeId) return null;
    try {
      const newDialog = await dialogApi.forkDialog(activeId, upToMessageId, customTitle);
      set((state) => ({
        dialogs: [newDialog, ...state.dialogs],
      }));
      await get().selectDialog(newDialog.id);
      return newDialog;
    } catch (err) {
      console.warn(`[DialogStore] Failed to fork dialog ${activeId}:`, err);
      return null;
    }
  },

  setContextSnapshot: (snapshot: ContextSnapshot | null) => {
    set({ contextSnapshot: snapshot });
  },

  clearContextSnapshot: () => {
    set({ contextSnapshot: null });
  },

  updateAgentActionStatus: (actionId: string, status: 'applied' | 'failed', error?: string) => {
    set((state) => ({
      agentActions: state.agentActions.map((a) =>
        a.id === actionId ? { ...a, status, error } : a
      ),
    }));
  },

  refreshAgentStatus: async () => {
    try {
      const status = await dialogApi.fetchAgentStatus();
      set({ agentStatus: status });
    } catch (err) {
      console.warn('[DialogStore] Failed to refresh agent status:', err);
    }
  },

  setPairingModalOpen: (open: boolean) => {
    set({ pairingModalOpen: open });
    if (open) {
      void get().refreshAgentStatus();
    }
  },

  connectDialogWs: (dialogId: string) => {
    if (typeof window === 'undefined') return;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    isExplicitDisconnect = false;

    // Disconnect any existing WS cleanly without triggering onclose reconnect
    const prevWs = get().ws;
    if (prevWs) {
      try {
        prevWs.onclose = null;
        prevWs.onerror = null;
        prevWs.close();
      } catch {}
      set({ ws: null });
    }

    set({ wsStatus: 'connecting' });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) || '' : '';
    const wsUrl = `${protocol}//${host}/ws/dialog/${dialogId}?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        set({ wsStatus: 'connected' });
        reconnectAttempts = 0;
        // Reconcile messages after (re)connect
        void get().reconcileMessages(dialogId);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const type = data.type;

          if (type === 'agent_status') {
            const online = Boolean(data.online);
            set((state) => {
              const updates: Partial<DialogState> = {
                agentStatus: {
                  online,
                  agent_name: data.agent_name || (online ? 'Local Agent' : ''),
                  connected_at: online ? (data.connected_at || new Date().toISOString()) : null,
                  capabilities: data.capabilities || [],
                },
              };
              if (!online && state.isGenerating) {
                stopPendingPromptPolling();
                updates.isGenerating = false;
                updates.generatingStartTime = null;
                updates.activeToolActivity = null;
                updates.streamingContent = '';
              }
              return updates;
            });
          } else if (type === 'user_message') {
            if (data.message && data.dialog_id === get().activeDialogId) {
              set((state) => {
                const filtered = state.messages.filter(
                  (m) =>
                    m.id !== data.message.id &&
                    !(m.id.startsWith('temp-user-') && m.content === data.message.content)
                );
                return {
                  messages: sortDialogMessages([...filtered, data.message]),
                };
              });
            }
          } else if (type === 'token_stream') {
            if (data.dialog_id === get().activeDialogId && data.delta) {
              set((state) => ({
                streamingContent: state.streamingContent + data.delta,
              }));
            }
          } else if (type === 'tool_activity') {
            if (data.dialog_id === get().activeDialogId) {
              set({
                activeToolActivity: {
                  tool: data.tool || 'local_tool',
                  status: data.status || 'running',
                },
              });
            }
          } else if (type === 'diff_proposal') {
            if (data.dialog_id === get().activeDialogId && data.diff) {
              const proposal: DiffProposal & { timestamp?: number } = {
                id: `diff-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                dialog_id: data.dialog_id,
                document_id: data.document_id,
                diff: data.diff,
                applied: false,
                timestamp: Date.now(),
              };
              set((state) => ({
                diffProposals: [...state.diffProposals, proposal],
              }));
            }
          } else if (type === 'agent_action') {
            if (data.dialog_id === get().activeDialogId && data.action) {
              const actionRecord: AgentAction = {
                id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                dialog_id: data.dialog_id,
                document_id: data.document_id,
                action: data.action,
                payload: data.payload || {},
                status: 'pending',
                timestamp: Date.now(),
              };
              set((state) => ({
                agentActions: [...state.agentActions, actionRecord],
              }));
            }
          } else if (type === 'dialog_truncated') {
            if (data.dialog_id === get().activeDialogId) {
              void (async () => {
                const msgs = await dialogApi.fetchMessages(dialogId);
                set({ messages: sortDialogMessages(msgs), streamingContent: '', activeToolActivity: null });
              })();
            }
          } else if (type === 'prompt_complete' || type === 'prompt_stopped' || type === 'prompt_failed') {
            if (data.dialog_id === get().activeDialogId) {
              stopPendingPromptPolling();
              // Finalize message turn: clear streaming buffer and refresh message history
              const assistantMsg: DialogMessage | undefined = data.message;
              set((state) => {
                const updated = assistantMsg
                  ? sortDialogMessages([
                      ...state.messages.filter((m) => m.id !== assistantMsg.id),
                      assistantMsg,
                    ])
                  : state.messages;
                return {
                  messages: updated,
                  streamingContent: '',
                  activeToolActivity: null,
                  isGenerating: false,
                  generatingStartTime: null,
                };
              });
              void (async () => {
                const msgs = await dialogApi.fetchMessages(dialogId);
                set({ messages: sortDialogMessages(msgs) });
              })();
            }
          }
        } catch {
          // ignore parsing error
        }
      };

      ws.onerror = (err) => {
        console.warn('[DialogWS] WebSocket error:', err);
      };

      ws.onclose = () => {
        set({ ws: null, wsStatus: 'disconnected' });
        if (!isExplicitDisconnect && get().activeDialogId === dialogId) {
          scheduleReconnect(dialogId);
        }
      };

      set({ ws });
    } catch (err) {
      console.warn('[DialogWS] Failed to initiate WebSocket connection:', err);
      set({ ws: null, wsStatus: 'disconnected' });
      if (!isExplicitDisconnect && get().activeDialogId === dialogId) {
        scheduleReconnect(dialogId);
      }
    }
  },

  disconnectDialogWs: () => {
    isExplicitDisconnect = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    stopPendingPromptPolling();

    const ws = get().ws;
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      } catch {}
      set({ ws: null, wsStatus: 'disconnected' });
    } else {
      set({ wsStatus: 'disconnected' });
    }
  },

  stopGeneration: async () => {
    stopPendingPromptPolling();
    const activeId = get().activeDialogId;
    if (!activeId) return;

    // Send stop event over WS immediately if open
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'stop_prompt', dialog_id: activeId }));
      } catch (err) {
        console.warn('[DialogStore] Failed to send stop_prompt via WS:', err);
      }
    }

    // Call REST endpoint to ensure backend and agent process are halted
    try {
      await dialogApi.stopDialogPrompt(activeId);
    } catch (err) {
      console.warn('[DialogStore] Failed to call stopDialogPrompt API:', err);
    }

    set({
      isGenerating: false,
      generatingStartTime: null,
      activeToolActivity: null,
      streamingContent: '',
    });
  },

  syncDocumentDialogPreference: async (documentId: string) => {
    try {
      const preferredDialogId = await dialogApi.getDocumentDialog(documentId);
      if (preferredDialogId) {
        await get().selectDialog(preferredDialogId);
      } else if (!get().activeDialogId) {
        // Fallback to loading existing dialogs or creating a default one
        await get().loadDialogs();
      }
    } catch (err) {
      console.warn(`[DialogStore] Failed to sync document dialog preference for ${documentId}:`, err);
    }
  },
}));

// (2) When tab becomes visible or receives window focus, reconnect socket and reconcile messages
if (typeof document !== 'undefined') {
  const handleVisibilityOrFocus = () => {
    if (document.visibilityState === 'visible') {
      const activeId = useDialogStore.getState().activeDialogId;
      if (!activeId) return;

      const ws = useDialogStore.getState().ws;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        useDialogStore.getState().connectDialogWs(activeId);
      }
      void useDialogStore.getState().reconcileMessages(activeId);
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityOrFocus);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleVisibilityOrFocus);
  }
}
