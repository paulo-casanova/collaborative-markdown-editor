import React, { useEffect } from 'react';
import { Trash2, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUIStore } from '../stores/uiStore';

export const TrashPage: React.FC = () => {
  const { setBreadcrumbs } = useUIStore();

  useEffect(() => {
    setBreadcrumbs([
      { label: 'Workspaces', path: '/' },
      { label: 'Trash Bin', isCurrent: true },
    ]);
  }, [setBreadcrumbs]);

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-cme-border-base">
        <div className="flex items-center gap-2.5">
          <Trash2 className="w-5 h-5 text-cme-text-muted" />
          <h1 className="text-xl font-bold text-cme-text-base">Trash Explorer</h1>
        </div>
        <Link
          to="/"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-cme-text-base transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Workspaces</span>
        </Link>
      </div>

      <div className="p-12 text-center border-2 border-dashed border-cme-border-base rounded-2xl space-y-3 bg-cme-bg-surface">
        <Trash2 className="w-10 h-10 text-cme-text-subtle mx-auto" />
        <h3 className="font-semibold text-sm text-cme-text-base">Trash bin is clean</h3>
        <p className="text-xs text-cme-text-muted max-w-sm mx-auto">
          Documents soft-deleted via <code className="font-mono">DELETE /api/v1/documents/:id</code> are
          safely preserved in the POSIX <code className="font-mono">trash/</code> directory with sidecar metadata.
        </p>
      </div>
    </div>
  );
};
