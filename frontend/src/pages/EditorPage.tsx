import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Clock, BookOpen, AlertCircle, Sparkles } from 'lucide-react';
import { fetchDocument } from '../api/documents';
import { useUIStore } from '../stores/uiStore';
import { Badge } from '../components/common/Badge';

export const EditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { setBreadcrumbs, setSyncStatus } = useUIStore();

  const { data: document, isLoading, isError, error } = useQuery({
    queryKey: ['document', id],
    queryFn: () => (id ? fetchDocument(id) : Promise.reject('No ID')),
    enabled: !!id,
  });

  useEffect(() => {
    if (document) {
      const parts = document.path.split('/');
      const breadcrumbList = [
        { label: 'Workspaces', path: '/' },
        ...parts.slice(0, -1).map((part, idx) => ({
          label: part,
          path: `/?dir=${parts.slice(0, idx + 1).join('/')}`,
        })),
        { label: document.title || parts[parts.length - 1], isCurrent: true },
      ];
      setBreadcrumbs(breadcrumbList);
      setSyncStatus('live');
    }
    return () => {
      setSyncStatus('saved');
    };
  }, [document, setBreadcrumbs, setSyncStatus]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-4 animate-pulse">
        <div className="h-8 bg-cme-bg-subtle rounded-lg w-1/3" />
        <div className="h-4 bg-cme-bg-subtle rounded w-1/4" />
        <div className="h-64 bg-cme-bg-subtle rounded-xl mt-6" />
      </div>
    );
  }

  if (isError || !document) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-base font-semibold text-rose-600 dark:text-rose-400">
          Document Not Found
        </h2>
        <p className="text-xs text-cme-text-muted">
          {(error as any)?.message || 'The requested document does not exist or you lack read access.'}
        </p>
        <div className="pt-2">
          <Link
            to="/"
            className="px-4 py-2 bg-cme-primary text-white rounded-lg text-xs font-medium hover:bg-cme-primary-hover inline-block"
          >
            Back to Workspaces
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-6">
      {/* Document Header & Metadata Bar */}
      <div className="space-y-2 pb-4 border-b border-cme-border-base">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-cme-text-base">
            {document.title || 'Untitled Document'}
          </h1>
          <Link
            to={`/docs/${document.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
            title="Switch to Reader View"
          >
            <BookOpen className="w-3.5 h-3.5 text-cme-text-muted" />
            <span>Reader View</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-cme-text-muted font-mono">
          <span className="flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" />
            <span>{document.path}</span>
          </span>
          {document.is_bundle && (
            <Badge variant="primary" size="sm">
              Bundle
            </Badge>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Updated {new Date(document.updated_at).toLocaleString()}</span>
          </span>
        </div>
      </div>

      {/* TipTap Collaborative Editor Container (Ready for Step 4.2 & 4.3) */}
      <div className="min-h-[500px] border border-cme-border-base rounded-2xl bg-cme-bg-surface p-6 shadow-sm space-y-4">
        <div className="p-3 bg-cme-bg-subtle rounded-xl border border-cme-border-base flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-cme-primary font-medium">
            <Sparkles className="w-4 h-4" />
            <span>TipTap ProseMirror Collaborative Editor Engine</span>
          </div>
          <span className="font-mono text-cme-text-muted">Opcode 0x00 Yjs Wire Bound</span>
        </div>

        {/* Content Preview */}
        <div className="prose prose-sm dark:prose-invert max-w-none text-cme-text-base font-sans leading-relaxed whitespace-pre-wrap">
          {document.content || '*Document is empty.*'}
        </div>
      </div>
    </div>
  );
};
