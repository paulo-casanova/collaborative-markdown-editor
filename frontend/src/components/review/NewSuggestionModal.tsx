import React, { useState, useEffect } from 'react';
import { GitPullRequest, X, Check, ArrowRight } from 'lucide-react';
import { useReviewStore } from '../../stores/reviewStore';

export const NewSuggestionModal: React.FC = () => {
  const { pendingSuggestionSelection, setPendingSuggestionSelection, postSuggestion } =
    useReviewStore();
  const [replacementText, setReplacementText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (pendingSuggestionSelection) {
      setReplacementText(pendingSuggestionSelection.text);
    }
  }, [pendingSuggestionSelection]);

  if (!pendingSuggestionSelection) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replacementText.trim() || isSubmitting) return;
    setIsSubmitting(true);
    await postSuggestion(replacementText);
    setIsSubmitting(false);
  };

  return (
    <div
      data-testid="suggestion-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-lg rounded-2xl border border-cme-border-base bg-cme-bg-surface shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-cme-border-base bg-cme-bg-elevated/50">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-emerald-500/10 text-emerald-600">
              <GitPullRequest className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-cme-text-base">Propose Text Edit (Suggestion)</h3>
          </div>
          <button
            type="button"
            onClick={() => setPendingSuggestionSelection(null)}
            className="p-1 text-cme-text-muted hover:text-cme-text-base rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Original Text */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-cme-text-muted uppercase tracking-wider">
              Original Text (to replace)
            </label>
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-700 dark:text-red-300 line-through max-h-28 overflow-y-auto leading-relaxed">
              {pendingSuggestionSelection.text}
            </div>
          </div>

          {/* Replacement Text */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-cme-text-muted uppercase tracking-wider flex items-center justify-between">
              <span>Proposed Replacement</span>
              <span className="text-[10px] text-emerald-600 lowercase font-normal flex items-center gap-0.5">
                <ArrowRight className="w-2.5 h-2.5" /> preview below
              </span>
            </label>
            <textarea
              data-testid="suggestion-replacement-input"
              rows={4}
              autoFocus
              value={replacementText}
              onChange={(e) => setReplacementText(e.target.value)}
              placeholder="Enter your proposed replacement text..."
              className="w-full text-xs font-mono p-3 rounded-xl border border-cme-border-base bg-cme-bg-elevated text-cme-text-base placeholder:text-cme-text-muted focus:outline-none focus:ring-2 focus:ring-emerald-500 leading-relaxed resize-none"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-cme-border-base">
            <button
              type="button"
              onClick={() => setPendingSuggestionSelection(null)}
              className="px-3 py-1.5 text-xs text-cme-text-muted hover:text-cme-text-base rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-suggestion-btn"
              disabled={!replacementText.trim() || isSubmitting}
              className="px-4 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Submit Suggestion
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
