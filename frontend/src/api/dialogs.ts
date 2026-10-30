/**
 * REST API Client for CME Dialogs & Local Agent Subsystem.
 */

import { apiRequest } from './client';
import {
  Dialog,
  DialogMessage,
  AgentStatus,
  AgentTokenRecord,
  CreatedAgentToken,
  ContextSnapshot,
} from '../types/dialog';

// =============================================================================
// Dialogs API
// =============================================================================

export async function fetchDialogs(): Promise<Dialog[]> {
  try {
    return await apiRequest<Dialog[]>('/api/v1/dialogs');
  } catch (err) {
    console.warn('[DialogAPI] fetchDialogs failed:', err);
    return [];
  }
}

export async function getDialog(dialogId: string): Promise<Dialog> {
  return await apiRequest<Dialog>(`/api/v1/dialogs/${dialogId}`);
}

export async function createDialog(title?: string): Promise<Dialog> {
  return await apiRequest<Dialog>('/api/v1/dialogs', {
    method: 'POST',
    body: JSON.stringify({ title: title || 'New Dialog' }),
  });
}

export async function updateDialog(dialogId: string, title: string): Promise<Dialog> {
  return await apiRequest<Dialog>(`/api/v1/dialogs/${dialogId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteDialog(dialogId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/dialogs/${dialogId}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Dialog Messages API
// =============================================================================

export async function fetchMessages(dialogId: string, limit: number = 50): Promise<DialogMessage[]> {
  try {
    return await apiRequest<DialogMessage[]>(`/api/v1/dialogs/${dialogId}/messages?limit=${limit}`);
  } catch (err) {
    console.warn(`[DialogAPI] fetchMessages failed for ${dialogId}:`, err);
    return [];
  }
}

export async function postMessage(
  dialogId: string,
  content: string,
  contextSnapshot?: ContextSnapshot,
  role: 'user' | 'assistant' = 'user'
): Promise<DialogMessage> {
  return await apiRequest<DialogMessage>(`/api/v1/dialogs/${dialogId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      role,
      content,
      context_snapshot: contextSnapshot || {},
    }),
  });
}

export async function truncateDialog(
  dialogId: string,
  messageId: string,
  inclusive: boolean = false
): Promise<DialogMessage[]> {
  const res = await apiRequest<{ status: string; messages: DialogMessage[] }>(
    `/api/v1/dialogs/${dialogId}/truncate`,
    {
      method: 'POST',
      body: JSON.stringify({ message_id: messageId, inclusive }),
    }
  );
  return res.messages || [];
}

export async function forkDialog(
  dialogId: string,
  upToMessageId?: string,
  title?: string
): Promise<Dialog> {
  return await apiRequest<Dialog>(`/api/v1/dialogs/${dialogId}/fork`, {
    method: 'POST',
    body: JSON.stringify({
      up_to_message_id: upToMessageId || undefined,
      title: title || undefined,
    }),
  });
}

export async function stopDialogPrompt(dialogId: string): Promise<void> {
  try {
    await apiRequest<{ status: string; dialog_id: string }>(`/api/v1/dialogs/${dialogId}/stop`, {
      method: 'POST',
    });
  } catch (err) {
    console.warn(`[DialogAPI] stopDialogPrompt failed for ${dialogId}:`, err);
  }
}

// =============================================================================
// Document Dialog Preferences API
// =============================================================================

export async function getDocumentDialog(documentId: string): Promise<string | null> {
  try {
    const res = await apiRequest<{ dialog_id: string | null }>(`/api/v1/documents/${documentId}/dialog`);
    return res.dialog_id;
  } catch (err) {
    console.warn(`[DialogAPI] getDocumentDialog failed for ${documentId}:`, err);
    return null;
  }
}

export async function setDocumentDialog(documentId: string, dialogId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/documents/${documentId}/dialog`, {
    method: 'PUT',
    body: JSON.stringify({ dialog_id: dialogId }),
  });
}

// =============================================================================
// Local Agent Gateway & Pairing Tokens API
// =============================================================================

export async function fetchAgentStatus(): Promise<AgentStatus> {
  try {
    return await apiRequest<AgentStatus>('/api/v1/user/agent/status');
  } catch (err) {
    console.warn('[DialogAPI] fetchAgentStatus failed:', err);
    return {
      online: false,
      agent_name: '',
      connected_at: null,
      capabilities: [],
    };
  }
}

export async function fetchAgentTokens(): Promise<AgentTokenRecord[]> {
  try {
    return await apiRequest<AgentTokenRecord[]>('/api/v1/user/agent-tokens');
  } catch (err) {
    console.warn('[DialogAPI] fetchAgentTokens failed:', err);
    return [];
  }
}

export async function createAgentToken(
  label: string = 'Local Agent',
  expiresInDays: number = 30
): Promise<CreatedAgentToken> {
  return await apiRequest<CreatedAgentToken>('/api/v1/user/agent-tokens', {
    method: 'POST',
    body: JSON.stringify({
      label,
      expires_in_days: expiresInDays,
    }),
  });
}

export async function deleteAgentToken(tokenId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/user/agent-tokens/${tokenId}`, {
    method: 'DELETE',
  });
}
