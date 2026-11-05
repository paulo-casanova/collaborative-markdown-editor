import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitPullRequest,
  Search,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  Clock,
  XCircle,
  CheckCircle,
} from 'lucide-react';
import {
  fetchAllSuggestions,
  acknowledgeSuggestion,
  acknowledgeAllSuggestions,
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

export const SuggestionsDashboardView: React.FC = () => {
  const queryClient = useQueryClient();
  const { viewMode } = useUIStore();
  const baseDocRoute = viewMode === 'read' ? '/docs' : '/documents';

  const [statusFilter, setStatusFilter] = useState<'active' | 'pending' | 'accepted' | 'rejected' | 'acknowledged' | 'all'>('active');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['all-suggestions', statusFilter],
    queryFn: () => fetchAllSuggestions(statusFilter),
    staleTime: 5000,
    refetchInterval: 15000,
  });

  const ackMutation = useMutation({
    mutationFn: (suggestionId: string) => acknowledgeSuggestion(suggestionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['suggestions-count'] });
    },
  });

  const ackAllMutation = useMutation({
    mutationFn: () => acknowledgeAllSuggestions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['suggestions-count'] });
    },
  });

  const filteredSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return suggestions;
    const q = searchQuery.toLowerCase();
    return suggestions.filter((s) => {
      const matchDoc =
        (s.document_title && s.document_title.toLowerCase().includes(q)) ||
        (s.document_path && s.document_path.toLowerCase().includes(q));
      const matchAuthor =
        s.author.username.toLowerCase().includes(q) ||
        s.author.display_name.toLowerCase().includes(q);
      const matchOrig = s.original_text.toLowerCase().includes(q);
      const matchSugg = s.suggested_text.toLowerCase().includes(q);
      return matchDoc || matchAuthor || matchOrig || matchSugg;
    });
  }, [suggestions, searchQuery]);

  const unackResolvedCount = useMemo(() => {
    return suggestions.filter((s) => (s.status === 'ACCEPTED' || s.status === 'REJECTED') && !s.is_acknowledged).length;
  }, [suggestions]);

  return (
    <div className="space-y-6" data-testid="suggestions-dashboard-view">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-cme-bg-surface p-3 rounded-2xl border border-cme-border-base shadow-xs">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-xs">
          <button
            type="button"
            data-testid="suggestions-filter-active"
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
            data-testid="suggestions-filter-pending"
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'pending'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            Pending
          </button>
          <button
            type="button"
            data-testid="suggestions-filter-accepted"
            onClick={() => setStatusFilter('accepted')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'accepted'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            Accepted
          </button>
          <button
            type="button"
            data-testid="suggestions-filter-rejected"
            onClick={() => setStatusFilter('rejected')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'rejected'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            Rejected
          </button>
          <button
            type="button"
            data-testid="suggestions-filter-acknowledged"
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
            data-testid="suggestions-filter-all"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-cme-primary text-white shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            All Suggestions
          </button>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cme-text-muted pointer-events-none" />
            <input
              type="text"
              data-testid="suggestions-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search diffs, authors, docs..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-base text-cme-text-base text-xs focus:outline-hidden focus:border-cme-primary transition-colors"
            />
          </div>

          {unackResolvedCount > 0 && (
            <button
              type="button"
              data-testid="suggestions-ack-all-btn"
              onClick={() => ackAllMutation.mutate()}
              disabled={ackAllMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              title="Acknowledge all resolved suggestions"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>ACK All ({unackResolvedCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Suggestions List */}
      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-28 bg-cme-bg-surface rounded-2xl border border-cme-border-base" />
          <div className="h-28 bg-cme-bg-surface rounded-2xl border border-cme-border-base" />
        </div>
      ) : filteredSuggestions.length === 0 ? (
        <div className="py-16 text-center bg-cme-bg-surface border border-cme-border-base rounded-2xl p-8" data-testid="suggestions-empty-state">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-3">
            <GitPullRequest className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-cme-text-base">No Suggestions Found</h3>
          <p className="text-xs text-cme-text-muted mt-1 max-w-sm mx-auto">
            {searchQuery
              ? 'No suggestions match your search query.'
              : statusFilter === 'active'
              ? 'All caught up! No pending or unacknowledged suggestions.'
              : 'No suggestions found for the selected filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="suggestions-list">
          {filteredSuggestions.map((suggestion) => {
            const isResolved = suggestion.status === 'ACCEPTED' || suggestion.status === 'REJECTED';
            const isAcked = suggestion.is_acknowledged;

            return (
              <div
                key={suggestion.id}
                data-testid={`suggestion-card-${suggestion.id}`}
                className={`bg-cme-bg-surface border rounded-2xl p-4 shadow-xs transition-all ${
                  isResolved && !isAcked
                    ? 'border-amber-500/40 bg-amber-500/[0.02]'
                    : 'border-cme-border-base'
                }`}
              >
                {/* Header: Document & Status Badges */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cme-border-base/50 pb-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
                    <Link
                      to={`${baseDocRoute}/${suggestion.document_id}`}
                      className="text-xs font-semibold text-cme-text-base hover:text-cme-primary transition-colors truncate"
                      title={suggestion.document_path || suggestion.document_title}
                    >
                      {suggestion.document_title || 'Untitled Document'}
                    </Link>
                    {suggestion.document_path && (
                      <span className="text-[11px] font-mono text-cme-text-muted truncate hidden md:inline">
                        ({suggestion.document_path})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Status Badge */}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase flex items-center gap-1 ${
                        suggestion.status === 'ACCEPTED'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : suggestion.status === 'REJECTED'
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {suggestion.status === 'ACCEPTED' && <CheckCircle className="w-3 h-3" />}
                      {suggestion.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                      {suggestion.status === 'PENDING' && <Clock className="w-3 h-3" />}
                      <span>{suggestion.status}</span>
                    </span>

                    {/* ACK Status Badge */}
                    {isResolved && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          isAcked
                            ? 'bg-cme-bg-subtle text-cme-text-muted border border-cme-border-base'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse'
                        }`}
                        data-testid={`suggestion-ack-status-${suggestion.id}`}
                      >
                        {isAcked ? 'ACKed' : 'Needs ACK'}
                      </span>
                    )}

                    {/* ACK Action Button */}
                    {!isAcked && (
                      <button
                        type="button"
                        data-testid={`suggestion-ack-btn-${suggestion.id}`}
                        onClick={() => ackMutation.mutate(suggestion.id)}
                        disabled={ackMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                        title="Acknowledge this suggestion"
                      >
                        <Check className="w-3 h-3" />
                        <span>ACK</span>
                      </button>
                    )}

                    <Link
                      to={`${baseDocRoute}/${suggestion.document_id}`}
                      className="p-1 rounded-md text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
                      title="Open document"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Author & Timestamp */}
                <div className="flex items-center justify-between text-xs mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                      style={{ backgroundColor: suggestion.author?.avatar_color || '#10b981' }}
                    >
                      {suggestion.author?.display_name?.charAt(0) || suggestion.author?.username?.charAt(0) || '?'}
                    </div>
                    <span className="font-medium text-cme-text-base">
                      {suggestion.author?.display_name || suggestion.author?.username || 'Anonymous'}
                    </span>
                    {suggestion.author?.username && (
                      <span className="text-[11px] text-cme-text-muted">
                        @{suggestion.author.username}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-cme-text-muted">
                    <Clock className="w-3 h-3" />
                    <span>{formatRelativeTime(suggestion.created_at)}</span>
                    <span className="hidden sm:inline">({new Date(suggestion.created_at).toLocaleString()})</span>
                  </div>
                </div>

                {/* Diff Comparison Visualization */}
                <div className="space-y-2 text-xs font-mono">
                  {suggestion.original_text && (
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600/70 mb-1">Original Text:</div>
                      <div className="line-through whitespace-pre-wrap">{suggestion.original_text}</div>
                    </div>
                  )}

                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600/70 mb-1">Suggested Replacement:</div>
                    <div className="whitespace-pre-wrap">{suggestion.suggested_text}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
