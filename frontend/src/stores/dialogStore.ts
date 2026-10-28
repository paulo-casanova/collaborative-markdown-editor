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
} from '../types/dialog';
import * as dialogApi from '../api/dialogs';
import { TOKEN_STORAGE_KEY } from '../api/client';

interface DialogState {
  dialogs: Dialog[];
  activeDialogId: string | null;
  messages: DialogMessage[];
  isLoading: boolean;
  isSending: boolean;
  agentStatus: AgentStatus;
  streamingContent: string;
  activeToolActivity: { tool: string; status: string } | null;
  diffProposals: DiffProposal[];
  contextSnapshot: ContextSnapshot | null;
  pairingModalOpen: boolean;
  ws: WebSocket | null;

  // Actions
  loadDialogs: () => Promise<void>;
  selectDialog: (dialogId: string, docIdToPersist?: string) => Promise<void>;
  createAndSelectDialog: (title?: string, docIdToPersist?: string) => Promise<Dialog>;
  renameDialog: (dialogId: string, newTitle: string) => Promise<void>;
  deleteDialog: (dialogId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  clearContextSnapshot: () => void;
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
  agentStatus: {
    online: false,
    agent_name: '',
    connected_at: null,
    capabilities: [],
  },
  streamingContent: '',
  activeToolActivity: null,
  diffProposals: [],
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
      isLoading: true,
    });

    try {
      const messages = await dialogApi.fetchMessages(dialogId);
      set({ messages, isLoading: false });

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
          });
        }
      }
    } catch (err) {
      console.warn(`[DialogStore] Failed to delete dialog ${dialogId}:`, err);
    }
  },

  sendMessage: async (content: string) => {
    const activeId = get().activeDialogId;
    if (!activeId || !content.trim()) return;

    const snapshot = get().contextSnapshot || undefined;
    set({ isSending: true, streamingContent: '', activeToolActivity: null });

    try {
      const msg = await dialogApi.postMessage(activeId, content, snapshot, 'user');
      // Append user message if not already received via WS broadcast
      set((state) => {
        const exists = state.messages.some((m) => m.id === msg.id);
        return {
          messages: exists ? state.messages : [...state.messages, msg],
          isSending: false,
        };
      });
    } catch (err) {
      console.warn('[DialogStore] Failed to send message:', err);
      set({ isSending: false });
    }
  },

  setContextSnapshot: (snapshot: ContextSnapshot | null) => {
    set({ contextSnapshot: snapshot });
  },

  clearContextSnapshot: () => {
    set({ contextSnapshot: null });
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
                const exists = state.messages.some((m) => m.id === data.message.id);
                return {
                  messages: exists ? state.messages : [...state.messages, data.message],
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
              const proposal: DiffProposal = {
                id: `diff-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                dialog_id: data.dialog_id,
                document_id: data.document_id,
                diff: data.diff,
                applied: false,
              };
              set((state) => ({
                diffProposals: [...state.diffProposals, proposal],
              }));
            }
          } else if (type === 'prompt_complete') {
            if (data.dialog_id === get().activeDialogId) {
              // Finalize message turn: clear streaming buffer and refresh message history
              set({
                streamingContent: '',
                activeToolActivity: null,
              });
              void (async () => {
                const msgs = await dialogApi.fetchMessages(dialogId);
                set({ messages: msgs });
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
