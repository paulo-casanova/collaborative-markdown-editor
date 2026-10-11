import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Edit3, MessageSquare, AlertCircle } from 'lucide-react';
import { fetchDocument } from '../api/documents';
import { useUIStore } from '../stores/uiStore';

export const ReaderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { setBreadcrumbs } = useUIStore();
  const [showReviews, setShowReviews] = useState(false);

  const { data: document, isLoading, isError } = useQuery({
    queryKey: ['document', id],
    queryFn: () => (id ? fetchDocument(id) : Promise.reject('No ID')),
    enabled: !!id,
  });

  useEffect(() => {
    if (document) {
      setBreadcrumbs([
        { label: 'Workspaces', path: '/' },
        { label: document.title || 'Document', isCurrent: true },
      ]);
    }
  }, [document, setBreadcrumbs]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-8 space-y-4 animate-pulse">
        <div className="h-10 bg-cme-bg-subtle rounded w-1/2" />
        <div className="h-64 bg-cme-bg-subtle rounded mt-6" />
      </div>
    );
  }

  if (isError || !document) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-base font-semibold text-rose-600 dark:text-rose-400">
          Reader Error
        </h2>
        <p className="text-xs text-cme-text-muted">Document could not be loaded for reading.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
      {/* Top Controls */}
      <div className="flex items-center justify-between pb-4 border-b border-cme-border-base">
        <div className="flex items-center gap-2 text-xs text-cme-text-muted">
          <BookOpen className="w-4 h-4 text-cme-primary" />
          <span className="font-semibold uppercase tracking-wider">Reader Mode</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Review Overlay Toggle */}
          <button
            onClick={() => setShowReviews(!showReviews)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              showReviews
                ? 'bg-cme-primary text-white border-cme-primary'
                : 'border-cme-border-base bg-cme-bg-surface text-cme-text-base hover:bg-cme-bg-hover'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Reviews: {showReviews ? 'ON' : 'OFF'}</span>
          </button>

          <Link
            to={`/documents/${document.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5 text-cme-text-muted" />
            <span>Edit</span>
          </Link>
        </div>
      </div>

      {/* Reader Body */}
      <article className="prose prose-base dark:prose-invert max-w-none text-cme-text-base font-serif leading-relaxed">
        <h1 className="font-sans font-bold tracking-tight text-3xl mb-4 text-cme-text-base">
          {document.title || 'Untitled'}
        </h1>
        <div className="whitespace-pre-wrap font-sans text-sm">
          {document.content || '*Document is empty.*'}
        </div>
      </article>

      {/* Review Overlay Panel (when enabled) */}
      {showReviews && (
        <div className="mt-8 p-4 bg-cme-bg-subtle border border-cme-border-base rounded-2xl space-y-3">
          <div className="flex items-center gap-2 font-semibold text-xs text-cme-text-base">
            <MessageSquare className="w-4 h-4 text-cme-primary" />
            <span>Review Overlay Active (Comments, Suggestions & Tasks)</span>
          </div>
          <p className="text-xs text-cme-text-muted">
            Inline annotations and discussions are synchronized over WebSocket Opcode 0x02.
          </p>
        </div>
      )}
    </div>
  );
};
