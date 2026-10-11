import React, { useState, useRef } from 'react';
import {
  CheckCircle2,
  RotateCcw,
  Trash2,
  CornerDownRight,
  Send,
  AtSign,
} from 'lucide-react';
import { CommentRecord } from '../../review/types';
import { useReviewStore } from '../../stores/reviewStore';

interface CommentCardProps {
  comment: CommentRecord;
  collaborators?: { username: string; display_name?: string }[];
  onScrollToAnchor?: (anchor: any) => void;
}

const DEFAULT_COLLABORATORS = [
  { username: 'alice', display_name: 'Alice' },
  { username: 'bob', display_name: 'Bob' },
  { username: 'admin', display_name: 'System Admin' },
];

export const CommentCard: React.FC<CommentCardProps> = ({
  comment,
  collaborators = DEFAULT_COLLABORATORS,
  onScrollToAnchor,
}) => {
  const { postReply, toggleCommentStatus, deleteComment, activeItemId, setActiveItemId } =
    useReviewStore();
  const [replyText, setReplyText] = useState('');
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isActive = activeItemId === comment.id;
  const isResolved = comment.status === 'RESOLVED';
  const quoteExact = comment.anchor?.quote?.exact || comment.anchor?.exact || '';

  const handleReplyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setReplyText(val);

    // Check if user is typing @mention
    const textBefore = val.slice(0, pos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1].toLowerCase());
      setMentionCursorPos(pos);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (username: string) => {
    if (!textareaRef.current) return;
    const pos = mentionCursorPos;
    const textBefore = replyText.slice(0, pos).replace(/@\w*$/, `@${username} `);
    const textAfter = replyText.slice(pos);
    const newText = textBefore + textAfter;
    setReplyText(newText);
    setMentionQuery(null);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = textBefore.length;
        textareaRef.current.selectionEnd = textBefore.length;
      }
    }, 10);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || isSubmitting) return;
    setIsSubmitting(true);
    await postReply(comment.id, replyText);
    setReplyText('');
    setShowReplyForm(false);
    setIsSubmitting(false);
  };

  const filteredMentions = collaborators.filter(
    (c) =>
      c.username.toLowerCase().includes(mentionQuery || '') ||
      (c.display_name && c.display_name.toLowerCase().includes(mentionQuery || ''))
  );

  return (
    <div
      data-testid="comment-card"
      onClick={() => {
        setActiveItemId(comment.id);
        if (onScrollToAnchor && comment.anchor) {
          onScrollToAnchor(comment.anchor);
        }
      }}
      className={`rounded-xl border transition-all text-sm p-4 bg-cme-bg-surface ${
        isActive
          ? 'border-cme-primary shadow-md ring-1 ring-cme-primary/20'
          : 'border-cme-border-base hover:border-cme-border-hover shadow-sm'
      } ${isResolved ? 'opacity-70 bg-cme-bg-elevated/40' : ''}`}
    >
      {/* Quoted Text Preview */}
      {quoteExact && (
        <div className="mb-2.5 p-2 rounded-lg bg-amber-500/10 border-l-2 border-amber-500 text-xs text-amber-900 dark:text-amber-200 italic line-clamp-2">
          &ldquo;{quoteExact}&rdquo;
        </div>
      )}

      {/* Header: Author & Status */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-xs"
            style={{ backgroundColor: comment.author?.avatar_color || '#3b82f6' }}
          >
            {(comment.author?.display_name || comment.author?.username || 'U')[0].toUpperCase()}
          </div>
          <div>
            <span className="font-semibold text-xs text-cme-text-base">
              {comment.author?.display_name || comment.author?.username || 'Unknown'}
            </span>
            <span className="text-[10px] text-cme-text-muted ml-1.5 font-mono">
              {comment.created_at ? new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span
            data-testid="comment-status-badge"
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase ${
              isResolved
                ? 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
            }`}
          >
            {comment.status}
          </span>
          <button
            type="button"
            data-testid="resolve-comment-btn"
            onClick={(e) => {
              e.stopPropagation();
              toggleCommentStatus(comment.id);
            }}
            className="p-1 text-cme-text-muted hover:text-cme-primary hover:bg-cme-bg-hover rounded"
            title={isResolved ? 'Re-open discussion' : 'Resolve discussion'}
          >
            {isResolved ? (
              <RotateCcw className="w-3.5 h-3.5" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
            )}
          </button>
          <button
            type="button"
            data-testid="delete-comment-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Delete this comment thread?')) {
                deleteComment(comment.id);
              }
            }}
            className="p-1 text-cme-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded"
            title="Delete comment"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Comment Body */}
      <div className="text-cme-text-base text-xs leading-relaxed mb-3 whitespace-pre-wrap">
        {comment.content}
      </div>

      {/* Nested Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="space-y-2 pl-3 border-l-2 border-cme-border-base my-2.5">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="text-xs space-y-0.5">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ backgroundColor: reply.author?.avatar_color || '#10b981' }}
                >
                  {(reply.author?.display_name || reply.author?.username || 'U')[0].toUpperCase()}
                </div>
                <span className="font-medium text-[11px] text-cme-text-base">
                  {reply.author?.display_name || reply.author?.username}
                </span>
                <span className="text-[10px] text-cme-text-muted">
                  {reply.created_at ? new Date(reply.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
              <p className="text-cme-text-muted text-[11px] pl-5 leading-normal whitespace-pre-wrap">
                {reply.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Reply Controls */}
      {!isResolved && (
        <div className="mt-2 pt-2 border-t border-cme-border-base/50">
          {!showReplyForm ? (
            <button
              type="button"
              data-testid="toggle-reply-form-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowReplyForm(true);
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-cme-primary hover:underline"
            >
              <CornerDownRight className="w-3 h-3" />
              Reply
            </button>
          ) : (
            <div className="space-y-2 relative" onClick={(e) => e.stopPropagation()}>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  data-testid="reply-input"
                  rows={2}
                  value={replyText}
                  onChange={handleReplyChange}
                  placeholder="Write a reply... Type @ to mention"
                  className="w-full text-xs p-2 rounded-lg border border-cme-border-base bg-cme-bg-elevated text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
                />

                {/* @mention Autocomplete Menu */}
                {mentionQuery !== null && filteredMentions.length > 0 && (
                  <div className="absolute left-0 bottom-full mb-1 w-48 rounded-lg border border-cme-border-base bg-cme-bg-surface shadow-lg z-50 overflow-hidden py-1">
                    <div className="px-2 py-1 text-[10px] text-cme-text-muted font-semibold flex items-center gap-1 border-b border-cme-border-base">
                      <AtSign className="w-2.5 h-2.5" /> Mention Collaborator
                    </div>
                    {filteredMentions.map((user) => (
                      <button
                        key={user.username}
                        type="button"
                        onClick={() => insertMention(user.username)}
                        className="w-full text-left px-2 py-1 text-xs hover:bg-cme-primary/10 hover:text-cme-primary flex items-center justify-between"
                      >
                        <span className="font-medium">@{user.username}</span>
                        {user.display_name && (
                          <span className="text-[10px] text-cme-text-muted">{user.display_name}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowReplyForm(false)}
                  className="px-2 py-1 text-xs text-cme-text-muted hover:text-cme-text-base rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="submit-reply-btn"
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || isSubmitting}
                  className="px-2.5 py-1 text-xs bg-cme-primary text-white rounded-lg font-medium hover:bg-cme-primary-hover flex items-center gap-1 disabled:opacity-50"
                >
                  <Send className="w-3 h-3" />
                  Reply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
