import React from 'react';
import {
  FileEdit,
  Sparkles,
  MessageSquarePlus,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { AgentAction } from '../../types/dialog';

interface AgentActionCardProps {
  action: AgentAction;
}

export const AgentActionCard: React.FC<AgentActionCardProps> = ({ action }) => {
  const { action: actionType, payload, status, error } = action;

  const renderActionDetails = () => {
    switch (actionType) {
      case 'direct_edit': {
        const diff = payload.diff || '';
        const orig = payload.original_text;
        const rep = payload.replacement_text;
        return (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-cme-text-muted">
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                Direct edit applied
              </span>
              <span>— no manual approval needed</span>
            </div>
            {orig && rep ? (
              <div className="bg-zinc-950/80 rounded p-2 font-mono text-[11px] text-zinc-200 space-y-1">
                <div className="text-rose-400 line-through truncate">- {orig}</div>
                <div className="text-emerald-400 truncate">+ {rep}</div>
              </div>
            ) : diff ? (
              <div className="bg-zinc-950/80 rounded p-2 font-mono text-[11px] text-zinc-200 max-h-36 overflow-y-auto whitespace-pre">
                {diff.split('\n').slice(0, 8).join('\n')}
              </div>
            ) : null}
          </div>
        );
      }

      case 'add_suggestion': {
        return (
          <div className="space-y-1.5">
            <div className="text-xs text-cme-text-muted">
              Proposed inline review recommendation:
            </div>
            <div className="bg-cme-bg-subtle border border-cme-border-base rounded p-2 space-y-1 text-[11px]">
              {payload.original_text && (
                <div className="text-rose-600 dark:text-rose-400 flex items-start gap-1">
                  <span className="font-semibold shrink-0">Original:</span>
                  <span className="italic truncate">"{payload.original_text}"</span>
                </div>
              )}
              {payload.suggested_text && (
                <div className="text-emerald-600 dark:text-emerald-400 flex items-start gap-1">
                  <span className="font-semibold shrink-0">Proposed:</span>
                  <span className="font-medium truncate">"{payload.suggested_text}"</span>
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'reject_suggestion':
      case 'remove_suggestion': {
        return (
          <div className="text-xs text-cme-text-muted flex items-center gap-1.5">
            <span>Rejected suggestion</span>
            {payload.suggestion_id && (
              <code className="px-1.5 py-0.5 rounded bg-cme-bg-subtle border border-cme-border-base text-[10px] font-mono text-cme-text-base">
                {payload.suggestion_id}
              </code>
            )}
          </div>
        );
      }

      case 'accept_suggestion': {
        return (
          <div className="text-xs text-cme-text-muted flex items-center gap-1.5">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              Accepted & applied suggestion
            </span>
            {payload.suggestion_id && (
              <code className="px-1.5 py-0.5 rounded bg-cme-bg-subtle border border-cme-border-base text-[10px] font-mono text-cme-text-base">
                {payload.suggestion_id}
              </code>
            )}
          </div>
        );
      }

      case 'add_comment': {
        return (
          <div className="space-y-1">
            {payload.target_text && (
              <div className="text-[11px] text-cme-text-subtle italic truncate">
                On: "{payload.target_text}"
              </div>
            )}
            <div className="text-xs text-cme-text-base bg-blue-500/10 border border-blue-500/20 rounded p-2">
              "{payload.content}"
            </div>
          </div>
        );
      }

      case 'reply_comment': {
        return (
          <div className="space-y-1">
            <div className="text-[11px] text-cme-text-subtle flex items-center gap-1">
              <span>Reply to comment</span>
              {payload.comment_id && (
                <code className="font-mono text-[10px] bg-cme-bg-subtle px-1 rounded">
                  {payload.comment_id}
                </code>
              )}
            </div>
            <div className="text-xs text-cme-text-base bg-indigo-500/10 border border-indigo-500/20 rounded p-2">
              "{payload.content}"
            </div>
          </div>
        );
      }

      default:
        return (
          <div className="text-xs text-cme-text-muted">
            Executed action: <code className="font-mono">{actionType}</code>
          </div>
        );
    }
  };

  const getHeaderMeta = () => {
    switch (actionType) {
      case 'direct_edit':
        return {
          icon: <FileEdit className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
          title: 'Direct Edit Applied',
          badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        };
      case 'add_suggestion':
        return {
          icon: <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />,
          title: 'Review Suggestion Added',
          badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
        };
      case 'reject_suggestion':
      case 'remove_suggestion':
        return {
          icon: <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />,
          title: 'Suggestion Rejected',
          badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
        };
      case 'accept_suggestion':
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
          title: 'Suggestion Accepted',
          badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        };
      case 'add_comment':
        return {
          icon: <MessageSquarePlus className="w-3.5 h-3.5 text-blue-500 shrink-0" />,
          title: 'Comment Created',
          badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
        };
      case 'reply_comment':
        return {
          icon: <MessageSquare className="w-3.5 h-3.5 text-indigo-500 shrink-0" />,
          title: 'Comment Replied',
          badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
        };
      default:
        return {
          icon: <Sparkles className="w-3.5 h-3.5 text-cme-primary shrink-0" />,
          title: 'Action Executed',
          badgeClass: 'bg-cme-bg-subtle text-cme-text-muted border-cme-border-base',
        };
    }
  };

  const meta = getHeaderMeta();

  return (
    <div
      className="rounded-lg border border-cme-border-base bg-cme-bg-base overflow-hidden my-2 shadow-sm text-xs"
      data-testid={`agent-action-card-${action.id}`}
    >
      <div className="px-3 py-2 bg-cme-bg-subtle border-b border-cme-border-base flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-cme-text-base">
          {meta.icon}
          <span>{meta.title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {status === 'pending' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 border border-amber-500/30 animate-pulse">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              <span>Applying</span>
            </span>
          )}
          {status === 'applied' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              <Check className="w-2.5 h-2.5" />
              <span>Applied</span>
            </span>
          )}
          {status === 'failed' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/10 text-rose-600 border border-rose-500/30">
              <AlertCircle className="w-2.5 h-2.5" />
              <span>Failed</span>
            </span>
          )}
        </div>
      </div>

      <div className="p-3 space-y-2">
        {renderActionDetails()}
        {error && (
          <div className="text-[11px] text-rose-500 bg-rose-500/10 p-1.5 rounded">
            Error: {error}
          </div>
        )}
      </div>
    </div>
  );
};
