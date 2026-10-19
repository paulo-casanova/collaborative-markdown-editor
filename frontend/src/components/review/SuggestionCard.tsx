import React, { useState } from 'react';
import {
  Check,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Archive,
  LocateFixed,
} from 'lucide-react';
import { SuggestionRecord } from '../../review/types';
import { useReviewStore } from '../../stores/reviewStore';

interface SuggestionCardProps {
  suggestion: SuggestionRecord;
  onScrollToAnchor?: (anchor: any) => void;
  onApplyReplacement?: (original: string, replacement: string, anchor: any) => void;
}

export const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  onScrollToAnchor,
  onApplyReplacement,
}) => {
  const { acceptSuggestion, rejectSuggestion, archiveSuggestion, activeItemId, setActiveItemId } = useReviewStore();
  const [isProcessing, setIsProcessing] = useState(false);

  const isActive = activeItemId === suggestion.id;
  const isPending = suggestion.status === 'PENDING';
  const isAccepted = suggestion.status === 'ACCEPTED';
  const isRejected = suggestion.status === 'REJECTED';

  const handleAccept = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isProcessing) return;
    setIsProcessing(true);
    await acceptSuggestion(suggestion.id, () => {
      if (onApplyReplacement) {
        onApplyReplacement(suggestion.original_text, suggestion.suggested_text, suggestion.anchor);
      }
    });
    setIsProcessing(false);
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isProcessing) return;
    setIsProcessing(true);
    await rejectSuggestion(suggestion.id);
    setIsProcessing(false);
  };

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isProcessing) return;
    setIsProcessing(true);
    await archiveSuggestion(suggestion.id);
    setIsProcessing(false);
  };

  return (
    <div
      data-testid="suggestion-card"
      onClick={() => {
        setActiveItemId(suggestion.id);
        if (onScrollToAnchor && suggestion.anchor) {
          onScrollToAnchor(suggestion.anchor);
        }
      }}
      className={`rounded-xl border transition-all text-sm p-4 bg-cme-bg-surface ${
        isActive
          ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500/20'
          : 'border-cme-border-base hover:border-cme-border-hover shadow-sm'
      } ${!isPending ? 'opacity-80' : ''}`}
    >
      {/* Header: Author & Status */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-xs"
            style={{ backgroundColor: suggestion.author?.avatar_color || '#10b981' }}
          >
            {(suggestion.author?.display_name || suggestion.author?.username || 'U')[0].toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-cme-text-base">
                {suggestion.author?.display_name || suggestion.author?.username || 'Unknown'}
              </span>
              <span className="text-[10px] text-cme-text-muted">proposed an edit</span>
            </div>
            <span className="text-[10px] text-cme-text-muted font-mono">
              {suggestion.created_at ? new Date(suggestion.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span
            data-testid="suggestion-status-badge"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase flex items-center gap-1 ${
              isAccepted
                ? 'bg-green-100 text-green-700 dark:bg-green-950/70 dark:text-green-300'
                : isRejected
                ? 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
            }`}
          >
            {isAccepted && <CheckCircle2 className="w-3 h-3 text-green-600" />}
            {isRejected && <XCircle className="w-3 h-3 text-neutral-500" />}
            {isPending && <Clock className="w-3 h-3 text-amber-600" />}
            {suggestion.status}
          </span>
          {onScrollToAnchor && suggestion.anchor && (
            <button
              type="button"
              data-testid="jump-to-suggestion-btn"
              onClick={(e) => {
                e.stopPropagation();
                setActiveItemId(suggestion.id);
                onScrollToAnchor(suggestion.anchor);
              }}
              className="p-1 text-cme-text-muted hover:text-cme-primary hover:bg-cme-bg-hover rounded transition-colors"
              title="Jump to location in text"
            >
              <LocateFixed className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            data-testid="archive-suggestion-btn"
            onClick={handleArchive}
            className="p-1 text-cme-text-muted hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded transition-colors"
            title="Archive suggestion"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Side-by-Side or Stacked Diff Display */}
      <div className="space-y-1.5 my-3 font-mono text-xs">
        {/* Original Text (Deletion) */}
        <div
          data-testid="diff-original"
          className="p-2.5 rounded-lg bg-red-50/80 dark:bg-red-950/40 border border-red-200/80 dark:border-red-900/60 text-red-700 dark:text-red-300 relative overflow-hidden"
        >
          <div className="flex items-start gap-1.5">
            <span className="select-none font-bold text-red-500 text-xs">-</span>
            <span className="line-through leading-relaxed whitespace-pre-wrap flex-1">
              {suggestion.original_text}
            </span>
          </div>
        </div>

        {/* Suggested Replacement (Insertion) */}
        <div
          data-testid="diff-suggested"
          className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 relative overflow-hidden"
        >
          <div className="flex items-start gap-1.5">
            <span className="select-none font-bold text-emerald-600 text-xs">+</span>
            <span className="font-medium leading-relaxed whitespace-pre-wrap flex-1">
              {suggestion.suggested_text}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons for Pending Suggestions */}
      {isPending && (
        <div className="mt-3 pt-2.5 border-t border-cme-border-base flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="reject-suggestion-btn"
            disabled={isProcessing}
            onClick={handleReject}
            className="px-2.5 py-1 text-xs font-medium rounded-lg text-cme-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent transition-colors flex items-center gap-1 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
          <button
            type="button"
            data-testid="accept-suggestion-btn"
            disabled={isProcessing}
            onClick={handleAccept}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition-colors flex items-center gap-1 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Accept
          </button>
        </div>
      )}
    </div>
  );
};
