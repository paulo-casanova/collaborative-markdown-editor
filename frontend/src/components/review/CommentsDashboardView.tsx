import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Search,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  fetchParticipatedComments,
  acknowledgeComment,
  acknowledgeAllComments,
} from '../../api/reviews';
import { useUIStore } from '../../stores/uiStore';

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export const CommentsDashboardView: React.FC = () => {
  const queryClient = useQueryClient();
  const { viewMode } = useUIStore();
  const baseDocRoute = viewMode === 'read' ? '/docs' : '/documents';

  const [statusFilter, setStatusFilter] = useState<'active' | 'open' | 'resolved' | 'acknowledged' | 'all'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['participated-comments', statusFilter],
    queryFn: () => fetchParticipatedComments(statusFilter),
    staleTime: 5000,
    refetchInterval: 15000,
  });

  const ackMutation = useMutation({
    mutationFn: (commentId: string) => acknowledgeComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['participated-comments'] });
      queryClient.invalidateQueries({ queryKey: ['comments-count'] });
    },
  });

  const ackAllMutation = useMutation({
    mutationFn: () => acknowledgeAllComments(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['participated-comments'] });
      queryClient.invalidateQueries({ queryKey: ['comments-count'] });
    },
  });

  const toggleThreadExpanded = (threadId: string) => {
    setExpandedThreads((prev) => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  };

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter((th) => {
      const matchDoc =
        (th.document_title && th.document_title.toLowerCase().includes(q)) ||
        (th.document_path && th.document_path.toLowerCase().includes(q));
      const matchAuthor =
        th.author.username.toLowerCase().includes(q) ||
        th.author.display_name.toLowerCase().includes(q);
      const matchContent = th.content.toLowerCase().includes(q);
      const matchReplies = th.replies?.some(
        (r) =>
          r.content.toLowerCase().includes(q) ||
          r.author.username.toLowerCase().includes(q) ||
          r.author.display_name.toLowerCase().includes(q)
      );
      return matchDoc || matchAuthor || matchContent || matchReplies;
    });
  }, [threads, searchQuery]);

  const unackResolvedCount = useMemo(() => {
    return threads.filter((t) => t.status === 'RESOLVED' && !t.is_acknowledged).length;
  }, [threads]);

  return (
    <div className="space-y-6" data-testid="comments-dashboard-view">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-cme-bg-surface p-3 rounded-2xl border border-cme-border-base shadow-xs">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-xs">
          <button
            type="button"
            data-testid="comments-filter-active"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'active'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            Active & Unacknowledged
          </button>
          <button
            type="button"
            data-testid="comments-filter-open"
            onClick={() => setStatusFilter('open')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'open'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            Open
          </button>
          <button
            type="button"
            data-testid="comments-filter-resolved"
            onClick={() => setStatusFilter('resolved')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'resolved'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            Closed / Resolved
          </button>
          <button
            type="button"
            data-testid="comments-filter-acknowledged"
            onClick={() => setStatusFilter('acknowledged')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'acknowledged'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            Acknowledged
          </button>
          <button
            type="button"
            data-testid="comments-filter-all"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            All Threads
          </button>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cme-text-muted pointer-events-none" />
            <input
              type="text"
              data-testid="comments-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search comments, authors, docs..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-base text-cme-text-base text-xs focus:outline-hidden focus:border-cme-primary transition-colors"
            />
          </div>

          {unackResolvedCount > 0 && (
            <button
              type="button"
              data-testid="comments-ack-all-btn"
              onClick={() => ackAllMutation.mutate()}
              disabled={ackAllMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              title="Acknowledge all closed comments"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>ACK All ({unackResolvedCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Threads List */}
      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-28 bg-cme-bg-surface rounded-2xl border border-cme-border-base" />
          <div className="h-28 bg-cme-bg-surface rounded-2xl border border-cme-border-base" />
        </div>
      ) : filteredThreads.length === 0 ? (
        <div className="py-16 text-center bg-cme-bg-surface border border-cme-border-base rounded-2xl p-8" data-testid="comments-empty-state">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-500 flex items-center justify-center mx-auto mb-3">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-cme-text-base">No Comment Threads</h3>
          <p className="text-xs text-cme-text-muted mt-1 max-w-sm mx-auto">
            {searchQuery
              ? 'No comments match your search query.'
              : statusFilter === 'active'
              ? 'All caught up! No active or unacknowledged comment threads.'
              : 'No threads found for the selected filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="comments-threads-list">
          {filteredThreads.map((thread) => {
            const isResolved = thread.status === 'RESOLVED';
            const isAcked = thread.is_acknowledged;
            const replies = thread.replies || [];
            const isExpanded = expandedThreads[thread.id] ?? true;

            return (
              <div
                key={thread.id}
                data-testid={`comment-thread-${thread.id}`}
                className={`bg-cme-bg-surface border rounded-2xl p-4 shadow-xs transition-all ${
                  isResolved && !isAcked
                    ? 'border-amber-500/40 bg-amber-500/[0.02]'
                    : 'border-cme-border-base'
                }`}
              >
                {/* Header: Document & Status Badges */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cme-border-base/50 pb-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-cme-primary shrink-0" />
                    <Link
                      to={`${baseDocRoute}/${thread.document_id}`}
                      className="text-xs font-semibold text-cme-text-base hover:text-cme-primary transition-colors truncate"
                      title={thread.document_path || thread.document_title}
                    >
                      {thread.document_title || 'Untitled Document'}
                    </Link>
                    {thread.document_path && (
                      <span className="text-[11px] font-mono text-cme-text-muted truncate hidden md:inline">
                        ({thread.document_path})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Status Badge */}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${
                        isResolved
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                      }`}
                    >
                      {isResolved ? 'Closed' : 'Open'}
                    </span>

                    {/* ACK Status Badge */}
                    {isResolved && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          isAcked
                            ? 'bg-cme-bg-subtle text-cme-text-muted border border-cme-border-base'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse'
                        }`}
                        data-testid={`comment-ack-status-${thread.id}`}
                      >
                        {isAcked ? 'ACKed' : 'Needs ACK'}
                      </span>
                    )}

                    {/* ACK Action Button */}
                    {isResolved && !isAcked && (
                      <button
                        type="button"
                        data-testid={`comment-ack-btn-${thread.id}`}
                        onClick={() => ackMutation.mutate(thread.id)}
                        disabled={ackMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                        title="Acknowledge this closed comment"
                      >
                        <Check className="w-3 h-3" />
                        <span>ACK</span>
                      </button>
                    )}

                    <Link
                      to={`${baseDocRoute}/${thread.document_id}`}
                      className="p-1 rounded-md text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
                      title="Open document"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Anchor quote context if anchored */}
                {thread.anchor?.quote?.exact && (
                  <div className="mb-3 px-3 py-1.5 rounded-lg bg-cme-bg-base/70 border-l-2 border-indigo-500 text-xs italic text-cme-text-muted">
                    "{thread.anchor.quote.exact}"
                  </div>
                )}

                {/* Root Comment Body */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: thread.author?.avatar_color || '#3b82f6' }}
                      >
                        {thread.author?.display_name?.charAt(0) || thread.author?.username?.charAt(0) || '?'}
                      </div>
                      <span className="font-medium text-cme-text-base">
                        {thread.author?.display_name || thread.author?.username || 'Anonymous'}
                      </span>
                      {thread.author?.username && (
                        <span className="text-[11px] text-cme-text-muted">
                          @{thread.author.username}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-cme-text-muted">
                      <Clock className="w-3 h-3" />
                      <span>{formatRelativeTime(thread.last_activity_at || thread.created_at)}</span>
                    </div>
                  </div>

                  <p className="text-xs text-cme-text-base leading-relaxed pl-7 whitespace-pre-wrap">
                    {thread.content}
                  </p>
                </div>

                {/* Replies section */}
                {replies.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-cme-border-base/40 pl-7 space-y-3">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleThreadExpanded(thread.id)}
                        className="flex items-center gap-1.5 text-[11px] font-medium text-cme-primary hover:underline cursor-pointer"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>Hide {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>Show {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                          </>
                        )}
                      </button>
                      <span className="text-[11px] text-cme-text-muted">
                        Last activity: {formatRelativeTime(thread.last_activity_at)}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="space-y-3 pt-2">
                        {replies.map((reply) => (
                          <div
                            key={reply.id}
                            className="bg-cme-bg-base/60 p-2.5 rounded-xl border border-cme-border-base/50 space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                                  style={{ backgroundColor: reply.author?.avatar_color || '#10b981' }}
                                >
                                  {reply.author?.display_name?.charAt(0) || reply.author?.username?.charAt(0) || '?'}
                                </div>
                                <span className="font-medium text-cme-text-base text-[11px]">
                                  {reply.author?.display_name || reply.author?.username || 'Anonymous'}
                                </span>
                              </div>
                              <span className="text-[10px] text-cme-text-muted">
                                {formatRelativeTime(reply.created_at)}
                              </span>
                            </div>
                            <p className="text-xs text-cme-text-base pl-6 whitespace-pre-wrap">
                              {reply.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
