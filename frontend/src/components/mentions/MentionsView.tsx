import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Check,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  FileText,
  Hash,
  Inbox,
  Search,
  Clock,
} from 'lucide-react';
import {
  DocumentMention,
  fetchMentions,
  acknowledgeMention,
  acknowledgeAllMentions,
} from '../../api/mentions';
import { useUIStore } from '../../stores/uiStore';

function formatRelativeTime(dateStr: string): string {
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

/**
 * Highlights @mentions in snippet text.
 */
function renderSnippetWithHighlight(snippet: string) {
  if (!snippet) return null;
  const parts = snippet.split(/(@[a-zA-Z0-9_\-\.]+)/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('@')) {
          return (
            <span
              key={idx}
              className="inline-block px-1 py-0.5 rounded bg-cme-primary/10 text-cme-primary font-semibold text-xs"
            >
              {part}
            </span>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </>
  );
}

export const MentionsView: React.FC = () => {
  const queryClient = useQueryClient();
  const { viewMode } = useUIStore();
  const baseDocRoute = viewMode === 'read' ? '/docs' : '/documents';

  const [statusFilter, setStatusFilter] = useState<'UNREAD' | 'ALL' | 'ACKNOWLEDGED'>('UNREAD');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch mentions
  const { data, isLoading } = useQuery({
    queryKey: ['mentions', statusFilter],
    queryFn: () => fetchMentions(statusFilter, 100, 0),
    staleTime: 5000,
    refetchInterval: 15000,
  });

  const mentions = data?.mentions || [];
  const unreadCount = data?.unread_count || 0;

  // Acknowledge single mention mutation
  const ackMutation = useMutation({
    mutationFn: (mentionId: string) => acknowledgeMention(mentionId),
    onMutate: async (mentionId: string) => {
      await queryClient.cancelQueries({ queryKey: ['mentions'] });
      await queryClient.cancelQueries({ queryKey: ['mentions-count'] });

      // Optimistically update current view
      queryClient.setQueriesData({ queryKey: ['mentions'] }, (old: any) => {
        if (!old || !old.mentions) return old;
        return {
          ...old,
          unread_count: Math.max(0, (old.unread_count || 1) - 1),
          mentions: old.mentions.map((m: DocumentMention) =>
            m.id === mentionId
              ? { ...m, status: 'ACKNOWLEDGED', acknowledged_at: new Date().toISOString() }
              : m
          ),
        };
      });

      queryClient.setQueryData(['mentions-count'], (old: any) => {
        if (!old) return old;
        return { unread_count: Math.max(0, (old.unread_count || 1) - 1) };
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['mentions'] });
      queryClient.invalidateQueries({ queryKey: ['mentions-count'] });
    },
  });

  // Acknowledge all unread mentions mutation
  const ackAllMutation = useMutation({
    mutationFn: acknowledgeAllMentions,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['mentions'] });
      await queryClient.cancelQueries({ queryKey: ['mentions-count'] });

      queryClient.setQueriesData({ queryKey: ['mentions'] }, (old: any) => {
        if (!old || !old.mentions) return old;
        return {
          ...old,
          unread_count: 0,
          mentions: old.mentions.map((m: DocumentMention) => ({
            ...m,
            status: 'ACKNOWLEDGED',
            acknowledged_at: new Date().toISOString(),
          })),
        };
      });

      queryClient.setQueryData(['mentions-count'], { unread_count: 0 });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['mentions'] });
      queryClient.invalidateQueries({ queryKey: ['mentions-count'] });
    },
  });

  // Filter mentions by search query
  const filteredMentions = useMemo(() => {
    if (!searchQuery.trim()) return mentions;
    const q = searchQuery.toLowerCase();
    return mentions.filter(
      (m) =>
        m.document_title.toLowerCase().includes(q) ||
        m.document_path.toLowerCase().includes(q) ||
        m.author_username.toLowerCase().includes(q) ||
        m.context_snippet.toLowerCase().includes(q) ||
        m.heading_anchor.toLowerCase().includes(q)
    );
  }, [mentions, searchQuery]);

  return (
    <div className="space-y-4" data-testid="mentions-view">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-cme-bg-surface p-3 rounded-xl border border-cme-border-base shadow-xs">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-cme-bg-elevated p-1 rounded-lg text-xs">
          <button
            type="button"
            data-testid="tab-mentions-unread"
            onClick={() => setStatusFilter('UNREAD')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
              statusFilter === 'UNREAD'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            <span>Unread</span>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-cme-primary text-white">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="tab-mentions-all"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            All
          </button>

          <button
            type="button"
            data-testid="tab-mentions-ack"
            onClick={() => setStatusFilter('ACKNOWLEDGED')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
              statusFilter === 'ACKNOWLEDGED'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            Acknowledged
          </button>
        </div>

        {/* Search input and Batch ACK button */}
        <div className="flex items-center gap-2 flex-1 sm:max-w-md justify-end">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cme-text-muted" />
            <input
              type="text"
              placeholder="Search mentions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-cme-border-base bg-cme-bg-base text-cme-text-base placeholder:text-cme-text-muted focus:outline-hidden focus:border-cme-primary"
              data-testid="mentions-search-input"
            />
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => ackAllMutation.mutate()}
              disabled={ackAllMutation.isPending}
              data-testid="ack-all-mentions-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-cme-bg-subtle hover:bg-cme-bg-hover text-cme-text-base border border-cme-border-base transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              title="Acknowledge all unread mentions"
            >
              <CheckCheck className="w-3.5 h-3.5 text-cme-primary" />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Mentions Cards List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-cme-bg-surface border border-cme-border-base animate-pulse"
            />
          ))}
        </div>
      ) : filteredMentions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-cme-bg-surface rounded-2xl border border-cme-border-base">
          <div className="p-3.5 rounded-full bg-cme-bg-subtle text-cme-text-muted mb-3">
            {statusFilter === 'UNREAD' ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            ) : (
              <Inbox className="w-8 h-8" />
            )}
          </div>
          <h3 className="text-sm font-semibold text-cme-text-base">
            {statusFilter === 'UNREAD'
              ? "You're all caught up!"
              : statusFilter === 'ACKNOWLEDGED'
              ? 'No acknowledged mentions yet'
              : 'No mentions found'}
          </h3>
          <p className="text-xs text-cme-text-muted mt-1 max-w-sm">
            {statusFilter === 'UNREAD'
              ? 'When colleagues mention you with @username in any document, notifications will appear here.'
              : searchQuery
              ? 'No mentions matching your search query. Try clearing the filter.'
              : 'Mentions you acknowledge will stay archived here for easy reference.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredMentions.map((mention) => {
            const isUnread = mention.status === 'UNREAD';
            const targetDocUrl = `${baseDocRoute}/${mention.document_id}${
              mention.heading_anchor ? `#${mention.heading_anchor}` : ''
            }`;

            return (
              <div
                key={mention.id}
                data-testid={`mention-item-${mention.id}`}
                className={`group relative p-4 rounded-xl border transition-all duration-150 ${
                  isUnread
                    ? 'bg-cme-bg-surface border-cme-primary/30 shadow-xs hover:border-cme-primary/50'
                    : 'bg-cme-bg-surface/60 border-cme-border-base hover:border-cme-border-strong'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Author Avatar Indicator */}
                    <div
                      className={`p-2 rounded-xl flex-shrink-0 ${
                        isUnread
                          ? 'bg-cme-primary/10 text-cme-primary'
                          : 'bg-cme-bg-subtle text-cme-text-muted'
                      }`}
                    >
                      <AtSign className="w-4 h-4" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* Author & Document Info */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-semibold text-cme-text-base">
                          @{mention.author_username}
                        </span>
                        <span className="text-cme-text-muted">mentioned you in</span>
                        <Link
                          to={targetDocUrl}
                          className="font-medium text-cme-primary hover:underline flex items-center gap-1 truncate max-w-xs"
                          title={`Open ${mention.document_title || mention.document_path}`}
                        >
                          <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">
                            {mention.document_title || mention.document_path || 'Untitled Document'}
                          </span>
                        </Link>
                        {mention.heading_anchor && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-cme-text-muted bg-cme-bg-subtle px-1.5 py-0.5 rounded border border-cme-border-base">
                            <Hash className="w-3 h-3" />
                            <span>{mention.heading_anchor}</span>
                          </span>
                        )}
                      </div>

                      {/* Snippet Quote */}
                      <blockquote className="text-xs text-cme-text-base bg-cme-bg-base/70 p-2.5 rounded-lg border-l-2 border-cme-primary/50 italic leading-relaxed">
                        {renderSnippetWithHighlight(mention.context_snippet)}
                      </blockquote>

                      {/* Meta Footer */}
                      <div className="flex items-center gap-3 text-[11px] text-cme-text-muted pt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatRelativeTime(mention.created_at)}</span>
                        </span>

                        {mention.status === 'ACKNOWLEDGED' && mention.acknowledged_at && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <Check className="w-3 h-3" />
                            <span>Acknowledged {formatRelativeTime(mention.acknowledged_at)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                    {isUnread && (
                      <button
                        type="button"
                        onClick={() => ackMutation.mutate(mention.id)}
                        disabled={ackMutation.isPending}
                        data-testid={`ack-mention-btn-${mention.id}`}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer"
                        title="Mark mention as acknowledged"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">ACK</span>
                      </button>
                    )}

                    <Link
                      to={targetDocUrl}
                      data-testid={`jump-mention-btn-${mention.id}`}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-cme-bg-subtle hover:bg-cme-bg-hover text-cme-text-base border border-cme-border-base transition-colors"
                      title="Jump to mention in document"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-cme-primary" />
                      <span className="hidden sm:inline">Jump</span>
                    </Link>
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
