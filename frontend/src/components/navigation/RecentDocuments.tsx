import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, ChevronDown, ChevronRight, FileText, Package } from 'lucide-react';
import { fetchRecentDocuments } from '../../api/documents';
import { fetchCurrentUser } from '../../api/auth';
import { DocumentRecord } from '../../types/document';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

function timeAgo(dateStr: string): string {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

export const RecentDocuments: React.FC = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(true);
  const { viewMode } = useUIStore();
  const { openTab } = useWorkspaceStore();

  const isReadMode = viewMode === 'read' || location.pathname.startsWith('/docs/');
  const baseDocRoute = isReadMode ? '/docs' : '/documents';

  const { data: user } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    retry: false,
  });

  const { data: recents, isLoading } = useQuery({
    queryKey: ['recent-documents', user?.id ?? 'anon'],
    queryFn: () => fetchRecentDocuments(30),
    staleTime: 5000,
    retry: 1,
  });

  return (
    <div className="border-t border-cme-border-base/50 pt-2 pb-1" data-testid="recent-documents-container">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-cme-text-subtle hover:text-cme-text-base transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-cme-text-subtle" />
          <span>Recent Documents</span>
        </div>
        <div className="flex items-center gap-1">
          {recents && recents.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cme-bg-subtle text-cme-text-muted">
              {recents.length}
            </span>
          )}
          {isOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="mt-1 space-y-0.5 px-1 max-h-48 overflow-y-auto">
          {isLoading ? (
            <div className="py-2 text-center text-xs text-cme-text-muted">Loading recents...</div>
          ) : recents && recents.length > 0 ? (
            recents.map((doc: DocumentRecord) => {
              const isActive = location.pathname.includes(doc.id);
              return (
                <Link
                  key={doc.id}
                  to={`${baseDocRoute}/${doc.id}`}
                  onClick={() => {
                    openTab({
                      id: doc.id,
                      path: doc.path,
                      title: doc.title || doc.path,
                      is_bundle: Boolean(doc.is_bundle && doc.path?.endsWith('.bundle')),
                    });
                  }}
                  className={`flex items-center justify-between py-1.5 px-2 rounded-lg text-xs transition-colors group ${
                    isActive
                      ? 'bg-cme-primary/10 text-cme-primary font-medium'
                      : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
                  }`}
                  title={`${doc.title} (${doc.path})`}
                  data-testid="recent-doc-item"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 truncate mr-2">
                    {(doc.is_bundle && doc.path?.endsWith('.bundle')) ? (
                      <Package className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-cme-text-subtle flex-shrink-0" />
                    )}
                    <span className="truncate">{doc.title || doc.path}</span>
                  </div>
                  <span className="text-[10px] text-cme-text-subtle flex-shrink-0">
                    {timeAgo(doc.updated_at)}
                  </span>
                </Link>
              );
            })
          ) : (
            <div className="py-2 text-center text-[11px] text-cme-text-muted italic">
              No recent documents.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
