import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Hash,
  Search,
  FileText,
  Clock,
  BookOpen,
  ArrowRight,
  Tag as TagIcon,
} from 'lucide-react';
import { fetchTags, fetchTagDocuments } from '../../api/tags';

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

export interface TagsViewProps {
  selectedTag?: string;
  onSelectTag?: (tag: string) => void;
}

export const TagsView: React.FC<TagsViewProps> = ({ selectedTag: propSelectedTag, onSelectTag }) => {
  const navigate = useNavigate();
  const [internalSelectedTag, setInternalSelectedTag] = useState<string>('');
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [docSearchQuery, setDocSearchQuery] = useState('');

  const activeTag = propSelectedTag !== undefined ? propSelectedTag : internalSelectedTag;

  const handleSelectTag = (tag: string) => {
    if (onSelectTag) {
      onSelectTag(tag);
    } else {
      setInternalSelectedTag(tag);
      navigate(`/tags/${encodeURIComponent(tag)}`);
    }
  };

  // Fetch all tags (polled periodically every 15s)
  const { data: tags = [], isLoading: isLoadingTags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchTags(),
    staleTime: 5000,
    refetchInterval: 15000,
  });

  // Auto-select first tag if none selected
  React.useEffect(() => {
    if (!activeTag && tags.length > 0) {
      handleSelectTag(tags[0].tag);
    }
  }, [activeTag, tags]);

  // Fetch documents for currently active tag
  const { data: tagDocs, isLoading: isLoadingDocs } = useQuery({
    queryKey: ['tag-documents', activeTag],
    queryFn: () => fetchTagDocuments(activeTag),
    enabled: !!activeTag,
    staleTime: 5000,
    refetchInterval: 15000,
  });

  // Filter tags in left panel
  const filteredTags = useMemo(() => {
    if (!tagSearchQuery.trim()) return tags;
    const q = tagSearchQuery.toLowerCase();
    return tags.filter((t) => t.tag.toLowerCase().includes(q));
  }, [tags, tagSearchQuery]);

  // Filter documents in right panel
  const filteredDocs = useMemo(() => {
    if (!tagDocs || !tagDocs.documents) return [];
    if (!docSearchQuery.trim()) return tagDocs.documents;
    const q = docSearchQuery.toLowerCase();
    return tagDocs.documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.path.toLowerCase().includes(q) ||
        d.occurrences.some((o) => o.heading_anchor.toLowerCase().includes(q))
    );
  }, [tagDocs, docSearchQuery]);

  return (
    <div className="flex h-full bg-cme-bg-base overflow-hidden" data-testid="tags-view">
      {/* Left Column: Tags List & Filter */}
      <div className="w-80 flex-shrink-0 border-r border-cme-border-base bg-cme-bg-surface flex flex-col h-full">
        <div className="p-4 border-b border-cme-border-base">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Hash className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-cme-text-base">Tags Explorer</h2>
              <p className="text-xs text-cme-text-muted">
                {tags.length} distinct {tags.length === 1 ? 'tag' : 'tags'} discovered
              </p>
            </div>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cme-text-muted" />
            <input
              type="text"
              placeholder="Filter tags..."
              value={tagSearchQuery}
              onChange={(e) => setTagSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-cme-border-base bg-cme-bg-base text-cme-text-base placeholder-cme-text-muted focus:outline-none focus:ring-1 focus:ring-cme-primary"
              data-testid="tags-search-input"
            />
          </div>
        </div>

        {/* Tags List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingTags ? (
            <div className="p-4 text-center text-xs text-cme-text-muted">Loading tags...</div>
          ) : filteredTags.length === 0 ? (
            <div className="p-6 text-center text-xs text-cme-text-muted">
              {tagSearchQuery ? 'No tags match your search' : 'No tags found across documents'}
            </div>
          ) : (
            filteredTags.map((t) => {
              const isSelected = activeTag === t.tag;
              return (
                <button
                  key={t.tag}
                  onClick={() => handleSelectTag(t.tag)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-cme-primary text-white font-medium shadow-sm'
                      : 'text-cme-text-base hover:bg-cme-bg-hover'
                  }`}
                  data-testid={`tag-item-${t.tag}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Hash className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-white' : 'text-amber-500'}`} />
                    <span className="truncate">#{t.tag}</span>
                  </div>
                  <span
                    className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-cme-bg-subtle text-cme-text-muted'
                    }`}
                  >
                    {t.document_count}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Matched Documents */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-cme-bg-base">
        {activeTag ? (
          <>
            {/* Header */}
            <div className="p-6 border-b border-cme-border-base bg-cme-bg-surface flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-base font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Hash className="w-4 h-4" />
                    <span>#{activeTag}</span>
                  </span>
                  <span className="text-xs font-medium text-cme-text-muted">
                    {tagDocs?.total_documents || 0} {tagDocs?.total_documents === 1 ? 'document' : 'documents'}
                  </span>
                </div>
                <p className="text-xs text-cme-text-muted mt-1.5">
                  Documents referencing <code className="font-mono text-cme-text-base">#{activeTag}</code> in body content or YAML frontmatter
                </p>
              </div>

              {/* Document search filter */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cme-text-muted" />
                <input
                  type="text"
                  placeholder="Filter documents..."
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-cme-border-base bg-cme-bg-base text-cme-text-base placeholder-cme-text-muted focus:outline-none focus:ring-1 focus:ring-cme-primary"
                  data-testid="tag-docs-search-input"
                />
              </div>
            </div>

            {/* Document Cards List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {isLoadingDocs ? (
                <div className="p-8 text-center text-sm text-cme-text-muted">Loading documents...</div>
              ) : filteredDocs.length === 0 ? (
                <div className="p-12 text-center border-2 border-dashed border-cme-border-base rounded-xl bg-cme-bg-surface">
                  <FileText className="w-8 h-8 mx-auto text-cme-text-muted mb-2 opacity-50" />
                  <p className="text-sm font-medium text-cme-text-base">No matching documents found</p>
                  <p className="text-xs text-cme-text-muted mt-1">
                    {docSearchQuery
                      ? 'No documents match your filter query'
                      : `No documents currently contain #${activeTag}`}
                  </p>
                </div>
              ) : (
                filteredDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface hover:border-cme-border-hover shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                    data-testid={`tag-doc-card-${doc.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-cme-primary flex-shrink-0" />
                        <Link
                          to={`/documents/${doc.id}`}
                          className="text-sm font-semibold text-cme-text-base hover:text-cme-primary hover:underline truncate"
                          title={doc.title}
                        >
                          {doc.title}
                        </Link>
                      </div>

                      <div className="flex items-center gap-3 mt-1.5 text-xs text-cme-text-muted font-mono truncate">
                        <span>{doc.path}</span>
                        {doc.updated_at && (
                          <span className="flex items-center gap-1 font-sans">
                            <Clock className="w-3 h-3 text-cme-text-muted" />
                            {formatRelativeTime(doc.updated_at)}
                          </span>
                        )}
                      </div>

                      {/* Heading Anchor Chips */}
                      {doc.occurrences && doc.occurrences.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                          <span className="text-[11px] text-cme-text-muted font-medium mr-1">Sections:</span>
                          {doc.occurrences.map((occ, oIdx) => {
                            const anchorText = occ.heading_anchor || 'top';
                            return (
                              <Link
                                key={oIdx}
                                to={`/documents/${doc.id}#${occ.heading_anchor}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-cme-bg-subtle text-cme-text-muted hover:text-cme-primary hover:bg-cme-primary/10 transition-colors border border-cme-border-base"
                                title={`Jump to section #${anchorText}`}
                              >
                                <Hash className="w-2.5 h-2.5" />
                                <span>{anchorText}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link
                        to={`/docs/${doc.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cme-border-base bg-cme-bg-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
                        data-testid="open-reader-btn"
                        title="View in Reader Mode"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-cme-text-muted" />
                        <span>Reader</span>
                      </Link>

                      <Link
                        to={`/documents/${doc.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors shadow-sm"
                        data-testid="open-editor-btn"
                        title="Open in Collaborative Editor"
                      >
                        <span>Edit</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-cme-text-muted">
            <TagIcon className="w-12 h-12 mb-3 opacity-30 text-amber-500" />
            <h3 className="text-base font-semibold text-cme-text-base">No Tag Selected</h3>
            <p className="text-xs text-cme-text-muted mt-1 max-w-sm">
              Select a tag from the explorer on the left to see all documents where that tag is mentioned.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
