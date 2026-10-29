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

  // Actions
  loadDialogs: () => Promise<void>;
  selectDialog: (dialogId: string, docIdToPersist?: string) => Promise<void>;
  createAndSelectDialog: (title?: string, docIdToPersist?: string) => Promise<Dialog>;
  renameDialog: (dialogId: string, newTitle: string) => Promise<void>;
  deleteDialog: (dialogId: string) => Promise<void>;
  sendMessage: (content: string, overrideSnapshot?: ContextSnapshot) => Promise<void>;
  resetDialogToMessage: (messageId: string, inclusive?: boolean) => Promise<void>;
  forkDialog: (upToMessageId?: string, customTitle?: string) => Promise<Dialog | null>;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  clearContextSnapshot: () => void;
  updateAgentActionStatus: (actionId: string, status: 'applied' | 'failed', error?: string) => void;
  refreshAgentStatus: () => Promise<void>;
  setPairingModalOpen: (open: boolean) => void;
  connectDialogWs: (dialogId: string) => void;
  disconnectDialogWs: () => void;
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

    try {
      const msg = await dialogApi.postMessage(activeId, content, snapshot, 'user');
      set((state) => {
        const filtered = state.messages.filter(
          (m) => m.id !== tempId && m.id !== msg.id
        );
        const shouldGenerate = msg.agent_dispatched ?? state.agentStatus.online;
        return {
          messages: sortDialogMessages([...filtered, msg]),
          isSending: false,
          isGenerating: shouldGenerate,
          generatingStartTime: shouldGenerate ? (state.generatingStartTime || Date.now()) : null,
        };
      });
    } catch (err) {
      console.warn('[DialogStore] Failed to send message:', err);
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempId),
        isSending: false,
        isGenerating: false,
        generatingStartTime: null,
      }));
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

    get().disconnectDialogWs();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) || '' : '';
    const wsUrl = `${protocol}//${host}/ws/dialog/${dialogId}?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const type = data.type;

          if (type === 'agent_status') {
            set({
              agentStatus: {
                online: Boolean(data.online),
                agent_name: data.agent_name || (data.online ? 'Local Agent' : ''),
                connected_at: data.online ? (data.connected_at || new Date().toISOString()) : null,
                capabilities: data.capabilities || [],
              },
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
          } else if (type === 'prompt_complete') {
            if (data.dialog_id === get().activeDialogId) {
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
        set({ ws: null });
      };

      set({ ws });
    } catch (err) {
      console.warn('[DialogWS] Failed to initiate WebSocket connection:', err);
    }
  },

  disconnectDialogWs: () => {
    const ws = get().ws;
    if (ws) {
      try {
        ws.close();
      } catch {}
      set({ ws: null });
    }
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
