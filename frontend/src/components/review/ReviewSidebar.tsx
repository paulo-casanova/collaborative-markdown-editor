import React, { useMemo, useState } from 'react';
import {
  MessageSquare,
  X,
  Inbox,
  Plus,
} from 'lucide-react';
import { useReviewStore } from '../../stores/reviewStore';
import { CommentCard } from './CommentCard';
import { SuggestionCard } from './SuggestionCard';
import { TaskCard } from './TaskCard';
import { NewTaskModal } from './NewTaskModal';

interface ReviewSidebarProps {
  onScrollToAnchor?: (anchor: any) => void;
  onApplyReplacement?: (original: string, replacement: string, anchor: any) => void;
}

export const ReviewSidebar: React.FC<ReviewSidebarProps> = ({
  onScrollToAnchor,
  onApplyReplacement,
}) => {
  const {
    comments,
    suggestions,
    tasks,
    filter,
    setFilter,
    showResolved,
    setShowResolved,
    showInTextReviews,
    setShowInTextReviews,
    setSidebarOpen,
    isLoading,
  } = useReviewStore();

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  // Compute counts
  const openComments = useMemo(
    () => comments.filter((c) => c.status === 'OPEN'),
    [comments]
  );
  const pendingSuggestions = useMemo(
    () => suggestions.filter((s) => s.status === 'PENDING'),
    [suggestions]
  );
  const openTasks = useMemo(
    () => tasks.filter((t) => !t.is_completed),
    [tasks]
  );

  const activeComments = showResolved ? comments : openComments;
  const activeSuggestions = showResolved ? suggestions : pendingSuggestions;
  const activeTasks = showResolved ? tasks : openTasks;

  // Interleave and sort review items by position or date
  const displayItems = useMemo(() => {
    type ReviewItem =
      | { type: 'comment'; data: typeof comments[0]; offset: number; date: string }
      | { type: 'suggestion'; data: typeof suggestions[0]; offset: number; date: string }
      | { type: 'task'; data: typeof tasks[0]; offset: number; date: string };

    const items: ReviewItem[] = [];

    if (filter === 'all' || filter === 'comments') {
      activeComments.forEach((c) => {
        items.push({
          type: 'comment',
          data: c,
          offset: c.anchor?.offset ?? 999999,
          date: c.created_at,
        });
      });
    }

    if (filter === 'all' || filter === 'suggestions') {
      activeSuggestions.forEach((s) => {
        items.push({
          type: 'suggestion',
          data: s,
          offset: s.anchor?.offset ?? 999999,
          date: s.created_at,
        });
      });
    }

    if (filter === 'all' || filter === 'tasks') {
      activeTasks.forEach((t) => {
        items.push({
          type: 'task',
          data: t,
          offset: 999999,
          date: t.created_at,
        });
      });
    }

    // Sort items by offset in document, then by timestamp
    return items.sort((a, b) => {
      if (a.offset !== b.offset) return a.offset - b.offset;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [filter, activeComments, activeSuggestions, activeTasks]);

  const totalOpenCount = openComments.length + pendingSuggestions.length + openTasks.length;

  return (
    <aside
      data-testid="review-sidebar"
      className="review-sidebar-root w-80 sm:w-96 flex flex-col h-full border-l border-cme-border-base bg-cme-bg-surface flex-shrink-0 select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cme-border-base bg-cme-bg-elevated/40">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-cme-primary" />
          <h2 className="text-sm font-semibold text-cme-text-base">Reviews & Discussions</h2>
          {totalOpenCount > 0 && (
            <span
              data-testid="review-count-badge"
              className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cme-primary text-white"
            >
              {totalOpenCount}
            </span>
          )}
        </div>

        <button
          type="button"
          data-testid="close-review-sidebar"
          onClick={() => setSidebarOpen(false)}
          className="p-1 rounded-md text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover"
          title="Close review panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs & Resolved Toggle */}
      <div className="px-3 pt-2.5 pb-2 border-b border-cme-border-base space-y-2">
        <div className="flex items-center gap-1 bg-cme-bg-elevated p-0.5 rounded-lg text-xs">
          <button
            type="button"
            data-testid="filter-all-btn"
            onClick={() => setFilter('all')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition-colors ${
              filter === 'all'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            All ({activeComments.length + activeSuggestions.length + activeTasks.length})
          </button>
          <button
            type="button"
            data-testid="filter-comments-btn"
            onClick={() => setFilter('comments')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition-colors ${
              filter === 'comments'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            Comments ({activeComments.length})
          </button>
          <button
            type="button"
            data-testid="filter-suggestions-btn"
            onClick={() => setFilter('suggestions')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition-colors ${
              filter === 'suggestions'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            Diffs ({activeSuggestions.length})
          </button>
          <button
            type="button"
            data-testid="filter-tasks-btn"
            onClick={() => setFilter('tasks')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition-colors ${
              filter === 'tasks'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            Tasks ({activeTasks.length})
          </button>
        </div>

        {/* Resolved Checkbox, Show in Text & Add Task Action */}
        <div className="flex items-center justify-between text-xs px-1 text-cme-text-muted">
          <div className="flex items-center gap-2.5">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-cme-text-base select-none">
              <input
                type="checkbox"
                data-testid="toggle-show-resolved"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
                className="rounded text-cme-primary focus:ring-cme-primary cursor-pointer w-3.5 h-3.5"
              />
              <span className="text-[11px]">Show resolved</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-cme-text-base select-none">
              <input
                type="checkbox"
                data-testid="toggle-show-in-text"
                checked={showInTextReviews}
                onChange={(e) => setShowInTextReviews(e.target.checked)}
                className="rounded text-cme-primary focus:ring-cme-primary cursor-pointer w-3.5 h-3.5"
              />
              <span className="text-[11px]">Show in text</span>
            </label>
          </div>

          <button
            type="button"
            data-testid="open-new-task-modal-btn"
            onClick={() => setIsTaskModalOpen(true)}
            className="flex items-center gap-1 text-[11px] font-medium text-cme-primary hover:underline hover:text-cme-primary/80"
          >
            <Plus className="w-3 h-3" />
            <span>Add Task</span>
          </button>
        </div>
      </div>

      {/* Review Items List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-xs text-cme-text-muted">
            Loading review threads...
          </div>
        ) : displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <div className="p-2.5 rounded-full bg-cme-bg-elevated text-cme-text-muted mb-2">
              <Inbox className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-cme-text-base mb-1">No review discussions</p>
            <p className="text-[11px] text-cme-text-muted leading-relaxed">
              Select text in the editor and click &ldquo;Add Comment&rdquo; or &ldquo;Suggest Edit&rdquo; to start a review.
            </p>
          </div>
        ) : (
          displayItems.map((item) => {
            if (item.type === 'comment') {
              return (
                <CommentCard
                  key={item.data.id}
                  comment={item.data}
                  onScrollToAnchor={onScrollToAnchor}
                />
              );
            } else if (item.type === 'suggestion') {
              return (
                <SuggestionCard
                  key={item.data.id}
                  suggestion={item.data}
                  onScrollToAnchor={onScrollToAnchor}
                  onApplyReplacement={onApplyReplacement}
                />
              );
            } else {
              return <TaskCard key={item.data.id} task={item.data} />;
            }
          })
        )}
      </div>

      <NewTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
      />
    </aside>
  );
};
