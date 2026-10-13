import React, { useState } from 'react';
import { MessageSquare, X, Send } from 'lucide-react';
import { useReviewStore } from '../../stores/reviewStore';

export const NewCommentModal: React.FC = () => {
  const { pendingCommentSelection, setPendingCommentSelection, postComment } = useReviewStore();
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!pendingCommentSelection) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSubmitting) return;
    setIsSubmitting(true);
    await postComment(content);
    setContent('');
    setIsSubmitting(false);
  };

  return (
    <div
      data-testid="comment-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-lg rounded-2xl border border-cme-border-base bg-cme-bg-surface shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cme-border-base bg-cme-bg-elevated/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-cme-primary/10 text-cme-primary">
              <MessageSquare className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-cme-text-base">Add Review Comment</h3>
          </div>
          <button
            type="button"
            onClick={() => setPendingCommentSelection(null)}
            className="p-1 text-cme-text-muted hover:text-cme-text-base rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Quoted Text Preview */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-cme-text-muted uppercase tracking-wider">
              Selected Text
            </label>
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs italic text-amber-900 dark:text-amber-200 max-h-24 overflow-y-auto leading-relaxed">
              &ldquo;{pendingCommentSelection.text}&rdquo;
            </div>
          </div>

          {/* Comment Body */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-cme-text-muted uppercase tracking-wider">
              Comment
            </label>
            <textarea
              data-testid="new-comment-input"
              rows={4}
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What would you like to discuss? Type @ to mention collaborators..."
              className="w-full text-xs p-3 rounded-xl border border-cme-border-base bg-cme-bg-elevated text-cme-text-base placeholder:text-cme-text-muted focus:outline-none focus:ring-2 focus:ring-cme-primary leading-relaxed resize-none"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-cme-border-base">
            <button
              type="button"
              onClick={() => setPendingCommentSelection(null)}
              className="px-3 py-1.5 text-xs text-cme-text-muted hover:text-cme-text-base rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-comment-btn"
              disabled={!content.trim() || isSubmitting}
              className="px-4 py-1.5 text-xs bg-cme-primary text-white rounded-lg font-medium hover:bg-cme-primary-hover shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Post Comment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
