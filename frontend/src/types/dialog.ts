/**
 * TypeScript types and interfaces for CME Dialogs & Local Agent Subsystem.
 */

export interface Dialog {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ContextSnapshot {
  document_id?: string;
  document_title?: string;
  document_path?: string;
  document_content?: string;
  selected_text?: string;
  line_start?: number;
  line_end?: number;
  [key: string]: any;
}

export interface DialogMessage {
  id: string;
  dialog_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context_snapshot?: ContextSnapshot;
  created_at: string;
  agent_dispatched?: boolean;
}

export interface AgentStatus {
  online: boolean;
  agent_name: string;
  connected_at: string | null;
  capabilities: string[];
}

export interface AgentTokenRecord {
  id: string;
  label: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

export interface CreatedAgentToken {
  token: string;
  id: string;
  label: string;
  created_at: string;
  expires_at: string | null;
}

export interface DiffProposal {
  id: string;
  dialog_id: string;
  document_id?: string;
  diff: string;
  applied?: boolean;
}

export type AgentActionType =
  | 'direct_edit'
  | 'add_suggestion'
  | 'remove_suggestion'
  | 'reject_suggestion'
  | 'accept_suggestion'
  | 'add_comment'
  | 'reply_comment'
  | string;

export interface AgentAction {
  id: string;
  dialog_id: string;
  document_id?: string;
  action: AgentActionType;
  payload: Record<string, any>;
  status: 'applied' | 'pending' | 'failed';
  error?: string;
  timestamp: number;
}
