import {
  EditorView,
  Decoration,
  DecorationSet,
  WidgetType,
} from '@codemirror/view';
import {
  RangeSetBuilder,
  StateField,
  StateEffect,
  EditorState,
  Extension,
} from '@codemirror/state';
import { useReviewStore } from '../../../stores/reviewStore';
import { reconcileAnchor } from '../../../review/textAnchoring';
import { SuggestionRecord, CommentRecord } from '../../../review/types';
import { CmeCollabProvider } from '../../../api/collabProvider';
import { parseMarkdownToHtml } from '../../../utils/markdownToHtml';

export const forceReviewRebuild = StateEffect.define<boolean>();

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Inline Suggestion Diff Widget (Step 8.3)
 * Renders unified diff blocks (- deletions in red strikethrough, + additions in green)
 * with direct Accept and Reject action buttons in the document flow.
 */
export class InlineSuggestionWidget extends WidgetType {
  constructor(
    public suggestion: SuggestionRecord,
    public range: { start: number; end: number },
    public isDark: boolean = false
  ) {
    super();
  }

  eq(other: InlineSuggestionWidget): boolean {
    return (
      this.suggestion.id === other.suggestion.id &&
      this.suggestion.status === other.suggestion.status &&
      this.suggestion.suggested_text === other.suggestion.suggested_text &&
      this.suggestion.original_text === other.suggestion.original_text &&
      this.range.start === other.range.start &&
      this.range.end === other.range.end
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className =
      'cme-inline-suggestion-widget py-0.5 my-1 select-none font-sans text-xs';
    container.setAttribute('data-testid', 'inline-suggestion-widget');
    container.setAttribute('data-suggestion-id', this.suggestion.id);

    const isPending = this.suggestion.status === 'PENDING';
    const isAccepted = this.suggestion.status === 'ACCEPTED';

    const card = document.createElement('div');
    const borderLeftColor = isAccepted
      ? 'border-l-emerald-500'
      : isPending
      ? 'border-l-amber-500'
      : 'border-l-zinc-400';
    card.className =
      `rounded-lg border-y border-r border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm transition-all hover:border-cme-border-hover border-l-4 ${borderLeftColor}`;

    const author = this.suggestion.author || {
      username: 'Reviewer',
      display_name: 'Reviewer',
      avatar_color: '#10b981',
    };
    const authorName = author.display_name || author.username || 'Reviewer';
    const authorColor = author.avatar_color || '#10b981';
    const initials = authorName.slice(0, 2).toUpperCase();

    const statusBadgeClass = isAccepted
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
      : isPending
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
      : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20';

    const statusLabel = isAccepted
      ? '✓ Accepted'
      : isPending
      ? 'Suggestion'
      : '✕ Rejected';

    // Header
    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between px-2.5 py-1 bg-cme-bg-subtle/80 border-b border-cme-border-base text-xs min-h-[26px]';

    const authorGroup = document.createElement('div');
    authorGroup.className = 'flex items-center gap-1.5 min-w-0';
    authorGroup.innerHTML = `
      <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white font-bold text-[8px] select-none flex-shrink-0" style="background-color: ${escapeHtml(authorColor)}">
        ${escapeHtml(initials)}
      </span>
      <span class="font-medium text-cme-text-base text-[11px] truncate max-w-[120px]">${escapeHtml(authorName)}</span>
      <span class="text-cme-text-muted text-[10px] whitespace-nowrap">• ${timeAgo(this.suggestion.created_at)}</span>
      <span class="px-1 py-0.2 rounded text-[9px] font-medium whitespace-nowrap ${statusBadgeClass}">
        ${statusLabel}
      </span>
    `;
    header.appendChild(authorGroup);

    const actionButtons = document.createElement('div');
    actionButtons.className = 'action-buttons flex items-center gap-1 flex-shrink-0';

    if (isPending) {
      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className =
        'accept-btn px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-medium text-[11px] leading-tight flex items-center gap-1 transition-all shadow-xs cursor-pointer';
      acceptBtn.setAttribute('data-testid', 'accept-suggestion-btn');
      acceptBtn.textContent = '✓ Accept';
      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        acceptBtn.disabled = true;
        acceptBtn.textContent = 'Applying...';
        useReviewStore.getState().acceptSuggestion(this.suggestion.id, () => {
          try {
            view.dispatch({
              changes: {
                from: this.range.start,
                to: this.range.end,
                insert: this.suggestion.suggested_text,
              },
            });
          } catch (err) {
            console.warn('[InlineSuggestionWidget] Error applying replacement in view:', err);
          }
        });
      });
      actionButtons.appendChild(acceptBtn);

      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className =
        'reject-btn px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 active:scale-95 text-rose-600 dark:text-rose-400 font-medium text-[11px] leading-tight flex items-center gap-1 border border-rose-500/30 transition-all cursor-pointer';
      rejectBtn.setAttribute('data-testid', 'reject-suggestion-btn');
      rejectBtn.textContent = '✕ Reject';
      rejectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rejectBtn.disabled = true;
        useReviewStore.getState().rejectSuggestion(this.suggestion.id);
      });
      actionButtons.appendChild(rejectBtn);
    }
    header.appendChild(actionButtons);

    // Unified Diff Block
    const diffBody = document.createElement('div');
    diffBody.className =
      'font-mono text-xs divide-y divide-cme-border-base/30 bg-cme-bg-surface';

    // - Deletions (original text)
    const deletionRow = document.createElement('div');
    deletionRow.className =
      'diff-deletion flex items-start gap-2.5 px-3 py-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 border-l-4 border-rose-500';
    deletionRow.innerHTML = `
      <span class="select-none font-bold text-rose-500 flex-shrink-0">-</span>
      <span class="line-through whitespace-pre-wrap break-all leading-relaxed">${escapeHtml(this.suggestion.original_text || '')}</span>
    `;

    // + Additions (suggested text)
    const additionRow = document.createElement('div');
    additionRow.className =
      'diff-addition flex items-start gap-2.5 px-3 py-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-l-4 border-emerald-500';
    additionRow.innerHTML = `
      <span class="select-none font-bold text-emerald-500 flex-shrink-0">+</span>
      <span class="whitespace-pre-wrap break-all leading-relaxed">${escapeHtml(this.suggestion.suggested_text || '')}</span>
    `;

    diffBody.appendChild(deletionRow);
    diffBody.appendChild(additionRow);

    card.appendChild(header);
    card.appendChild(diffBody);
    container.appendChild(card);
    return container;
  }
}

/**
 * Inline Discussion Thread Widget (Step 8.3)
 * Renders threaded comments embedded directly below anchored markdown blocks or lines,
 * with markdown formatting for comments and replies, plus direct inline reply form.
 */
export class InlineCommentThreadWidget extends WidgetType {
  constructor(
    public comment: CommentRecord,
    public range: { start: number; end: number },
    public isDark: boolean = false,
    public canComment: boolean = true
  ) {
    super();
  }

  eq(other: InlineCommentThreadWidget): boolean {
    return (
      this.comment.id === other.comment.id &&
      this.comment.status === other.comment.status &&
      this.comment.content === other.comment.content &&
      this.comment.replies?.length === other.comment.replies?.length &&
      this.range.start === other.range.start &&
      this.range.end === other.range.end &&
      this.canComment === other.canComment
    );
  }

  toDOM(_view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className =
      'cme-inline-comment-widget py-0.5 my-1 select-none font-sans text-xs';
    container.setAttribute('data-testid', 'inline-comment-widget');
    container.setAttribute('data-comment-id', this.comment.id);

    const isResolved = this.comment.status === 'RESOLVED';
    const replies = this.comment.replies || [];

    const card = document.createElement('div');
    const borderLeftColor = isResolved
      ? 'border-l-zinc-400'
      : 'border-l-blue-500';
    card.className =
      `rounded-lg border-y border-r border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm transition-all hover:border-cme-border-hover border-l-4 ${borderLeftColor}`;

    const author = this.comment.author || {
      username: 'Reviewer',
      display_name: 'Reviewer',
      avatar_color: '#3b82f6',
    };
    const authorName = author.display_name || author.username || 'Reviewer';
    const authorColor = author.avatar_color || '#3b82f6';
    const initials = authorName.slice(0, 2).toUpperCase();

    // Header
    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between px-2.5 py-1 bg-cme-bg-subtle/80 border-b border-cme-border-base text-xs min-h-[26px]';

    const authorGroup = document.createElement('div');
    authorGroup.className = 'flex items-center gap-1.5 min-w-0';
    authorGroup.innerHTML = `
      <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white font-bold text-[8px] select-none flex-shrink-0" style="background-color: ${escapeHtml(authorColor)}">
        ${escapeHtml(initials)}
      </span>
      <span class="font-medium text-cme-text-base text-[11px] truncate max-w-[120px]">${escapeHtml(authorName)}</span>
      <span class="text-cme-text-muted text-[10px] whitespace-nowrap">• ${timeAgo(this.comment.created_at)}</span>
      <span class="px-1 py-0.2 rounded text-[9px] font-medium whitespace-nowrap ${
        isResolved
          ? 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
          : 'bg-cme-primary/10 text-cme-primary border border-cme-primary/20'
      }">
        ${isResolved ? 'Resolved' : 'Open'}
      </span>
    `;
    header.appendChild(authorGroup);

    let editBtn: HTMLButtonElement | null = null;
    if (this.canComment) {
      const actionButtons = document.createElement('div');
      actionButtons.className = 'action-buttons flex items-center gap-1 flex-shrink-0';

      editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className =
        'edit-btn px-1.5 py-0.5 rounded border border-cme-border-base hover:bg-cme-bg-hover active:scale-95 text-cme-text-muted hover:text-cme-text-base text-[10px] leading-tight font-medium transition-colors cursor-pointer';
      editBtn.setAttribute('data-testid', 'edit-comment-btn');
      editBtn.title = 'Edit comment';
      editBtn.textContent = '✏️ Edit';
      actionButtons.appendChild(editBtn);

      const resolveBtn = document.createElement('button');
      resolveBtn.type = 'button';
      resolveBtn.className =
        'resolve-btn px-1.5 py-0.5 rounded border border-cme-border-base hover:bg-cme-bg-hover active:scale-95 text-cme-text-muted hover:text-cme-text-base text-[10px] leading-tight font-medium transition-colors cursor-pointer';
      resolveBtn.setAttribute('data-testid', 'resolve-comment-btn');
      resolveBtn.title = 'Toggle resolved status';
      resolveBtn.textContent = isResolved ? 'Reopen' : '✓ Resolve';
      resolveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        useReviewStore.getState().toggleCommentStatus(this.comment.id);
      });
      actionButtons.appendChild(resolveBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className =
        'delete-btn px-1 py-0.5 rounded hover:bg-rose-500/10 active:scale-95 text-cme-text-muted hover:text-rose-500 text-[10px] leading-tight transition-colors cursor-pointer';
      deleteBtn.setAttribute('data-testid', 'delete-comment-btn');
      deleteBtn.title = 'Delete comment';
      deleteBtn.textContent = '🗑';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.confirm('Delete this comment thread?')) {
          useReviewStore.getState().deleteComment(this.comment.id);
        }
      });
      actionButtons.appendChild(deleteBtn);
      header.appendChild(actionButtons);
    }

    // Root Comment Content
    let isEditing = false;
    const body = document.createElement('div');
    body.className =
      'px-3 py-1.5 text-xs text-cme-text-base prose prose-xs dark:prose-invert max-w-none leading-relaxed select-text';
    body.innerHTML = parseMarkdownToHtml(this.comment.content || '');

    // Comment Edit Form (hidden by default)
    const editForm = document.createElement('div');
    editForm.className = 'px-3 py-1.5 bg-cme-bg-subtle/30 space-y-1.5 hidden';
    if (editForm.style) editForm.style.display = 'none';

    const updateEditDisplay = () => {
      body.className = isEditing
        ? 'hidden'
        : 'px-3 py-1.5 text-xs text-cme-text-base prose prose-xs dark:prose-invert max-w-none leading-relaxed select-text';
      editForm.className = isEditing
        ? 'px-3 py-1.5 bg-cme-bg-subtle/30 space-y-1.5'
        : 'px-3 py-1.5 bg-cme-bg-subtle/30 space-y-1.5 hidden';
      if (editForm.style) editForm.style.display = isEditing ? '' : 'none';
      if (body.style) body.style.display = isEditing ? 'none' : '';
    };

    const editTextarea = document.createElement('textarea');
    editTextarea.className =
      'w-full p-1.5 text-xs bg-cme-bg-surface border border-cme-border-base rounded text-cme-text-base focus:outline-none focus:border-cme-primary resize-y min-h-[48px]';
    editTextarea.setAttribute('data-testid', 'inline-comment-edit-textarea');
    editTextarea.value = this.comment.content || '';

    const editBtnRow = document.createElement('div');
    editBtnRow.className = 'flex items-center justify-end gap-1.5';

    const cancelEditBtn = document.createElement('button');
    cancelEditBtn.type = 'button';
    cancelEditBtn.className =
      'px-2 py-0.5 text-[10px] rounded border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-muted cursor-pointer';
    cancelEditBtn.textContent = 'Cancel';
    cancelEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isEditing = false;
      updateEditDisplay();
    });

    const saveEditBtn = document.createElement('button');
    saveEditBtn.type = 'button';
    saveEditBtn.className =
      'px-2.5 py-0.5 text-[10px] rounded bg-cme-primary hover:bg-cme-primary/90 text-white font-medium cursor-pointer';
    saveEditBtn.setAttribute('data-testid', 'inline-comment-save-edit-btn');
    saveEditBtn.textContent = 'Save';
    saveEditBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newText = editTextarea.value.trim();
      if (!newText) return;
      saveEditBtn.disabled = true;
      saveEditBtn.textContent = '...';
      const updated = await useReviewStore.getState().editComment(this.comment.id, newText);
      if (updated) {
        this.comment.content = updated.content;
        body.innerHTML = parseMarkdownToHtml(updated.content || '');
      }
      isEditing = false;
      updateEditDisplay();
      saveEditBtn.disabled = false;
      saveEditBtn.textContent = 'Save';
    });

    editBtnRow.appendChild(cancelEditBtn);
    editBtnRow.appendChild(saveEditBtn);
    editForm.appendChild(editTextarea);
    editForm.appendChild(editBtnRow);

    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isEditing = !isEditing;
        updateEditDisplay();
        if (isEditing) {
          editTextarea.value = this.comment.content || '';
          editTextarea.focus();
        }
      });
    }

    // Threaded Replies
    const repliesContainer = document.createElement('div');
    repliesContainer.className =
      'border-t border-cme-border-base/40 divide-y divide-cme-border-base/30 bg-cme-bg-subtle/30';

    replies.forEach((reply) => {
      const rAuthor = reply.author || {
        username: 'Collaborator',
        display_name: 'Collaborator',
        avatar_color: '#6366f1',
      };
      const rName = rAuthor.display_name || rAuthor.username || 'Collaborator';
      const rColor = rAuthor.avatar_color || '#6366f1';
      const rInitials = rName.slice(0, 2).toUpperCase();

      const replyRow = document.createElement('div');
      replyRow.className = 'px-3 py-1.5 flex items-start gap-2 text-xs select-text';

      const replyContentCol = document.createElement('div');
      replyContentCol.className = 'flex-1 min-w-0';

      const replyHeaderRow = document.createElement('div');
      replyHeaderRow.className = 'flex items-center justify-between gap-1.5 mb-0.5';

      const replyMeta = document.createElement('div');
      replyMeta.className = 'flex items-center gap-1.5';
      replyMeta.innerHTML = `
        <span class="font-medium text-cme-text-base text-[11px]">${escapeHtml(rName)}</span>
        <span class="text-cme-text-muted text-[10px]">${timeAgo(reply.created_at)}</span>
      `;

      const rEditBtn = document.createElement('button');
      rEditBtn.type = 'button';
      rEditBtn.className =
        'p-0.5 text-cme-text-muted hover:text-cme-text-base text-[10px] rounded cursor-pointer';
      rEditBtn.title = 'Edit reply';
      rEditBtn.textContent = '✏️';
      rEditBtn.setAttribute('data-testid', 'inline-reply-edit-btn');

      replyHeaderRow.appendChild(replyMeta);
      if (this.canComment) {
        replyHeaderRow.appendChild(rEditBtn);
      }

      const replyBody = document.createElement('div');
      replyBody.className = 'text-cme-text-base prose prose-xs dark:prose-invert max-w-none leading-relaxed';
      replyBody.innerHTML = parseMarkdownToHtml(reply.content || '');

      let isEditingReply = false;
      const replyEditForm = document.createElement('div');
      replyEditForm.className = 'pt-1 space-y-1.5 hidden';
      if (replyEditForm.style) replyEditForm.style.display = 'none';

      const updateReplyDisplay = () => {
        replyBody.className = isEditingReply
          ? 'hidden'
          : 'text-cme-text-base prose prose-xs dark:prose-invert max-w-none leading-relaxed';
        replyEditForm.className = isEditingReply ? 'pt-1 space-y-1.5' : 'pt-1 space-y-1.5 hidden';
        if (replyEditForm.style) replyEditForm.style.display = isEditingReply ? '' : 'none';
        if (replyBody.style) replyBody.style.display = isEditingReply ? 'none' : '';
      };

      const replyTextarea = document.createElement('textarea');
      replyTextarea.className =
        'w-full p-1.5 text-xs bg-cme-bg-surface border border-cme-border-base rounded text-cme-text-base focus:outline-none focus:border-cme-primary resize-y min-h-[40px]';
      replyTextarea.value = reply.content || '';

      const replyBtnRow = document.createElement('div');
      replyBtnRow.className = 'flex items-center justify-end gap-1.5';

      const cancelReplyEditBtn = document.createElement('button');
      cancelReplyEditBtn.type = 'button';
      cancelReplyEditBtn.className =
        'px-2 py-0.5 text-[10px] rounded border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-muted cursor-pointer';
      cancelReplyEditBtn.textContent = 'Cancel';
      cancelReplyEditBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isEditingReply = false;
        updateReplyDisplay();
      });

      const saveReplyEditBtn = document.createElement('button');
      saveReplyEditBtn.type = 'button';
      saveReplyEditBtn.className =
        'px-2 py-0.5 text-[10px] rounded bg-cme-primary hover:bg-cme-primary/90 text-white font-medium cursor-pointer';
      saveReplyEditBtn.textContent = 'Save';
      saveReplyEditBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newReplyText = replyTextarea.value.trim();
        if (!newReplyText) return;
        saveReplyEditBtn.disabled = true;
        saveReplyEditBtn.textContent = '...';
        const updated = await useReviewStore.getState().editComment(reply.id, newReplyText);
        if (updated) {
          reply.content = updated.content;
          replyBody.innerHTML = parseMarkdownToHtml(updated.content || '');
        }
        isEditingReply = false;
        updateReplyDisplay();
        saveReplyEditBtn.disabled = false;
        saveReplyEditBtn.textContent = 'Save';
      });

      replyBtnRow.appendChild(cancelReplyEditBtn);
      replyBtnRow.appendChild(saveReplyEditBtn);
      replyEditForm.appendChild(replyTextarea);
      replyEditForm.appendChild(replyBtnRow);

      rEditBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isEditingReply = !isEditingReply;
        updateReplyDisplay();
        if (isEditingReply) {
          replyTextarea.value = reply.content || '';
          replyTextarea.focus();
        }
      });

      replyContentCol.appendChild(replyHeaderRow);
      replyContentCol.appendChild(replyBody);
      replyContentCol.appendChild(replyEditForm);

      const avatarSpan = document.createElement('span');
      avatarSpan.className =
        'inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white font-bold text-[8px] select-none flex-shrink-0 mt-0.5';
      avatarSpan.textContent = rInitials;
      if (avatarSpan.style) avatarSpan.style.backgroundColor = rColor;

      replyRow.appendChild(avatarSpan);
      replyRow.appendChild(replyContentCol);
      repliesContainer.appendChild(replyRow);
    });

    // Inline Reply Input Form
    const replyForm = document.createElement('div');
    replyForm.className =
      'px-2.5 py-1 bg-cme-bg-surface border-t border-cme-border-base flex items-center gap-1.5';

    const replyInput = document.createElement('input');
    replyInput.type = 'text';
    replyInput.placeholder = 'Write an inline reply...';
    replyInput.className =
      'reply-input flex-1 px-2 py-0.5 rounded-md border border-cme-border-base bg-cme-bg-surface text-xs text-cme-text-base focus:outline-none focus:border-cme-primary';
    replyInput.setAttribute('data-testid', 'inline-reply-input');

    const replySubmit = document.createElement('button');
    replySubmit.type = 'button';
    replySubmit.className =
      'reply-submit-btn px-2.5 py-0.5 rounded-md bg-cme-primary hover:bg-cme-primary/90 active:scale-95 text-white font-medium text-xs transition-all cursor-pointer';
    replySubmit.setAttribute('data-testid', 'inline-reply-submit-btn');
    replySubmit.textContent = 'Reply';

    const handleSendReply = () => {
      const text = replyInput.value.trim();
      if (!text) return;
      replySubmit.disabled = true;
      replySubmit.textContent = '...';
      useReviewStore
        .getState()
        .postReply(this.comment.id, text)
        .then(() => {
          replyInput.value = '';
          replySubmit.disabled = false;
          replySubmit.textContent = 'Reply';
        })
        .catch(() => {
          replySubmit.disabled = false;
          replySubmit.textContent = 'Reply';
        });
    };

    replySubmit.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSendReply();
    });

    replyInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendReply();
      }
    });

    replyForm.appendChild(replyInput);
    replyForm.appendChild(replySubmit);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(editForm);
    if (replies.length > 0) {
      card.appendChild(repliesContainer);
    }
    if (this.canComment) {
      card.appendChild(replyForm);
    }
    container.appendChild(card);
    return container;
  }
}

interface ReviewDecoItem {
  from: number;
  to: number;
  deco: Decoration;
  isBlockWidget: boolean;
}

/**
 * Creates the CodeMirror 6 extension that renders inline review diff blocks and discussion threads.
 */
export function createInlineReviewPlugin(
  provider?: CmeCollabProvider | null,
  isDark: boolean = false,
  canComment: boolean = true
): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildInlineReviewDecorations(state, provider, isDark, canComment);
    },
    update(decorations, tr) {
      const forced = tr.effects.some((e) => e.is(forceReviewRebuild));
      if (tr.docChanged || forced) {
        return buildInlineReviewDecorations(tr.state, provider, isDark, canComment);
      }
      return decorations.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

function buildInlineReviewDecorations(
  state: EditorState,
  provider?: CmeCollabProvider | null,
  isDark: boolean = false,
  canComment: boolean = true
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const docText = doc.toString();
  const ydoc = provider?.ydoc;

  const { comments, suggestions, showResolved, showInTextReviews } = useReviewStore.getState();
  if (showInTextReviews === false) {
    return Decoration.none;
  }

  const items: ReviewDecoItem[] = [];

  // 1. Process Suggestions: Diff Blocks and Anchor Marks (only pending suggestions appear inline)
  const activeSuggestions = suggestions.filter((s) => s.status === 'PENDING');

  for (const suggestion of activeSuggestions) {
    const reconciled = reconcileAnchor(
      suggestion.anchor,
      ydoc || docText,
      ydoc ? ydoc.getText('content') : undefined
    );
    const range = reconciled.range;
    if (!range) continue;

    const safeStart = Math.max(0, Math.min(range.start, doc.length));
    const safeEnd = Math.max(safeStart, Math.min(range.end, doc.length));

    // Anchor highlight mark
    if (safeStart < safeEnd) {
      items.push({
        from: safeStart,
        to: safeEnd,
        deco: Decoration.mark({
          class:
            'cme-review-suggestion-anchor bg-amber-500/15 border-b-2 border-amber-500 border-dashed rounded-xs',
        }),
        isBlockWidget: false,
      });
    }

    // Inline Diff Block Widget placed directly after the line containing the anchor end
    const targetLine = doc.lineAt(safeEnd);
    const widgetPos = targetLine.to;

    items.push({
      from: widgetPos,
      to: widgetPos,
      deco: Decoration.widget({
        widget: new InlineSuggestionWidget(suggestion, { start: safeStart, end: safeEnd }, isDark),
        side: 1,
        block: true,
      }),
      isBlockWidget: true,
    });
  }

  // 2. Process Threaded Comments: Discussion Threads and Anchor Marks
  const activeComments = comments.filter(
    (c) => c.status !== 'ARCHIVED' && (showResolved || c.status === 'OPEN')
  );

  for (const comment of activeComments) {
    // Only anchor root comments (replies are displayed inside their thread)
    if (comment.parent_id) continue;

    const reconciled = reconcileAnchor(
      comment.anchor,
      ydoc || docText,
      ydoc ? ydoc.getText('content') : undefined
    );
    const range = reconciled.range;
    if (!range) continue;

    const safeStart = Math.max(0, Math.min(range.start, doc.length));
    const safeEnd = Math.max(safeStart, Math.min(range.end, doc.length));

    // Anchor highlight mark
    if (safeStart < safeEnd) {
      items.push({
        from: safeStart,
        to: safeEnd,
        deco: Decoration.mark({
          class:
            'cme-review-comment-anchor bg-yellow-400/20 border-b-2 border-yellow-500 rounded-xs',
        }),
        isBlockWidget: false,
      });
    }

    // Inline Discussion Thread Widget placed directly after the line containing the anchor end
    const targetLine = doc.lineAt(safeEnd);
    const widgetPos = targetLine.to;

    items.push({
      from: widgetPos,
      to: widgetPos,
      deco: Decoration.widget({
        widget: new InlineCommentThreadWidget(
          comment,
          { start: safeStart, end: safeEnd },
          isDark,
          canComment
        ),
        side: 1,
        block: true,
      }),
      isBlockWidget: true,
    });
  }

  // RangeSetBuilder requires items sorted strictly by `from` ascending.
  // When `from` is equal, non-block marks must precede block widgets.
  items.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.isBlockWidget !== b.isBlockWidget) {
      return a.isBlockWidget ? 1 : -1;
    }
    return a.to - b.to;
  });

  for (const item of items) {
    builder.add(item.from, item.to, item.deco);
  }

  return builder.finish();
}
