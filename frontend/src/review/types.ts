/**
 * Types for the Collaborative Review System:
 * - Threaded Comments
 * - Inline Suggestions
 * - Task Checklist items
 * - Dual Text-Anchoring Engine (Yjs Relative Positions & W3C Web Annotation Quotes)
 */

export interface AuthorInfo {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
}

export interface RelativePositionPoint {
  client: number;
  clock: number;
}

export interface YjsRelativePosition {
  type?: any;
  tname?: string | null;
  item?: RelativePositionPoint | null;
  assoc?: number;
}

/**
 * W3C Web Annotation compliant TextQuoteSelector
 */
export interface W3CQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

/**
 * Dual Text Anchor combining:
 * 1. Strategy A: Yjs Relative Positions (real-time CRDT tracking)
 * 2. Strategy B: W3C Text Quote (offline & external edit fallback)
 * 3. Numerical offset & length for legacy / quick lookups
 */
export interface DualAnchor {
  type: 'dual' | 'yjs-relative';
  start?: YjsRelativePosition | RelativePositionPoint | null;
  end?: YjsRelativePosition | RelativePositionPoint | null;
  yjs?: {
    start: YjsRelativePosition | RelativePositionPoint;
    end: YjsRelativePosition | RelativePositionPoint;
    node_id?: string;
  };
  quote: W3CQuoteSelector;
  offset: number;
  length: number;
  node_id?: string;
}

export type ReconciliationStatus =
  | 'exact-crdt'
  | 'reconciled-quote'
  | 'fuzzy-reconciled'
  | 'orphaned';

export interface ReconciledAnchorResult {
  status: ReconciliationStatus;
  range: { start: number; end: number } | null;
  text: string | null;
  drift: number;
  confidence: number;
  updatedAnchor: DualAnchor;
}

export interface CommentRecord {
  id: string;
  document_id: string;
  parent_id: string | null;
  author: AuthorInfo;
  content: string;
  status: 'OPEN' | 'RESOLVED';
  anchor: DualAnchor | any;
  created_at: string;
  updated_at: string;
  replies?: CommentRecord[];
}

export interface SuggestionRecord {
  id: string;
  document_id: string;
  author: AuthorInfo;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  original_text: string;
  suggested_text: string;
  anchor: DualAnchor | any;
  created_at: string;
  resolved_at?: string | null;
}

export interface TaskRecord {
  id: string;
  document_id: string;
  document_title?: string;
  document_path?: string;
  comment_id?: string | null;
  description: string;
  assignee?: AuthorInfo | null;
  is_completed: boolean;
  due_date?: string | null;
  created_at: string;
  completed_at?: string | null;
}
