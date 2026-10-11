import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Edit3,
  MessageSquare,
  AlertCircle,
  Maximize2,
  CheckCircle2,
  User,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';
import katex from 'katex';
import {
  fetchDocument,
  fetchDocumentByPath,
  fetchDocumentComments,
  fetchDocumentSuggestions,
  fetchDocumentTasks,
} from '../api/documents';
import { useUIStore } from '../stores/uiStore';
import { DocumentOutline, extractHeadingsFromMarkdown, slugify } from '../components/navigation/DocumentOutline';
import { renderMermaidSvg } from '../components/editor/utils/mermaidRenderer';

type FontMode = 'sans' | 'serif' | 'mono';
type WidthMode = 'focused' | 'standard' | 'fluid';

export const ReaderPage: React.FC = () => {
  const params = useParams();
  const wildcard = params['*'];
  const idParam = params.id;
  const rawTarget = wildcard || idParam || '';

  const { setBreadcrumbs } = useUIStore();
  const [showReviews, setShowReviews] = useState(false);
  const [fontMode, setFontMode] = useState<FontMode>('serif');
  const [widthMode, setWidthMode] = useState<WidthMode>('standard');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Document query supporting both UUID and relative path
  const {
    data: document,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['doc-reader', rawTarget],
    queryFn: async () => {
      if (!rawTarget) throw new Error('No document path or ID provided');
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTarget);
      if (isUuid) {
        return await fetchDocument(rawTarget);
      }
      try {
        return await fetchDocumentByPath(rawTarget);
      } catch (err) {
        if (!rawTarget.startsWith('workspace/')) {
          try {
            return await fetchDocumentByPath(`workspace/${rawTarget}`);
          } catch {
            throw err;
          }
        }
        throw err;
      }
    },
    enabled: Boolean(rawTarget),
    retry: 1,
  });

  // Query reviews for the overlay
  const docId = document?.id || '';
  const { data: comments = [] } = useQuery({
    queryKey: ['reader-comments', docId],
    queryFn: () => (docId ? fetchDocumentComments(docId) : Promise.resolve([])),
    enabled: Boolean(docId) && showReviews,
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ['reader-suggestions', docId],
    queryFn: () => (docId ? fetchDocumentSuggestions(docId) : Promise.resolve([])),
    enabled: Boolean(docId) && showReviews,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['reader-tasks', docId],
    queryFn: () => (docId ? fetchDocumentTasks(docId) : Promise.resolve([])),
    enabled: Boolean(docId) && showReviews,
  });

  // Keep breadcrumbs in sync
  useEffect(() => {
    if (document) {
      const parts = document.path.split('/');
      const breadcrumbs = [
        { label: 'Workspaces', path: '/' },
        ...parts.slice(0, -1).map((part, idx) => ({
          label: part,
          path: `/?dir=${parts.slice(0, idx + 1).join('/')}`,
        })),
        { label: document.title || parts[parts.length - 1], isCurrent: true },
      ];
      setBreadcrumbs(breadcrumbs);
    }
  }, [document, setBreadcrumbs]);

  // Headings extracted for Table of Contents
  const headings = useMemo(() => {
    if (!document?.content) return [];
    return extractHeadingsFromMarkdown(document.content);
  }, [document?.content]);

  // Render markdown content into rich blocks with IDs on headings
  const renderedContent = useMemo(() => {
    if (!document?.content) return null;
    return renderMarkdown(document.content, (code, id) => {
      navigator.clipboard.writeText(code);
      setCopiedCodeId(id);
      setTimeout(() => setCopiedCodeId(null), 2000);
    }, copiedCodeId);
  }, [document?.content, copiedCodeId]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-4 animate-pulse">
        <div className="h-10 bg-cme-bg-subtle rounded w-1/3" />
        <div className="h-4 bg-cme-bg-subtle rounded w-1/4" />
        <div className="h-96 bg-cme-bg-subtle rounded-2xl mt-8" />
      </div>
    );
  }

  if (isError || !document) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-base font-semibold text-rose-600 dark:text-rose-400">
          Documentation Not Found
        </h2>
        <p className="text-xs text-cme-text-muted">
          {(error as any)?.message || `Could not find document at "${rawTarget}".`}
        </p>
        <div className="pt-2">
          <Link
            to="/"
            className="px-4 py-2 bg-cme-primary text-white rounded-lg text-xs font-medium hover:bg-cme-primary-hover inline-block"
          >
            Back to Workspace
          </Link>
        </div>
      </div>
    );
  }

  const fontClass =
    fontMode === 'serif'
      ? 'font-serif'
      : fontMode === 'mono'
      ? 'font-mono'
      : 'font-sans';

  const widthClass =
    widthMode === 'focused'
      ? 'max-w-3xl'
      : widthMode === 'fluid'
      ? 'max-w-6xl'
      : 'max-w-4xl';

  return (
    <div className="min-h-full bg-cme-bg-base text-cme-text-base pb-24">
      {/* Top Reader Controls Header */}
      <header className="sticky top-0 z-20 bg-cme-bg-base/90 backdrop-blur border-b border-cme-border-base px-4 md:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Left Metadata */}
          <div className="flex items-center gap-3 truncate">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cme-primary/10 text-cme-primary text-[11px] font-semibold tracking-wide uppercase flex-shrink-0">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Reader Mode</span>
            </span>
            <span className="truncate text-xs font-mono text-cme-text-muted hidden sm:inline">
              {document.path}
            </span>
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2">
            {/* Font Style Switcher */}
            <div className="hidden md:flex items-center border border-cme-border-base rounded-lg p-0.5 bg-cme-bg-surface text-xs">
              <button
                onClick={() => setFontMode('sans')}
                className={`px-2 py-1 rounded font-sans transition-colors ${
                  fontMode === 'sans'
                    ? 'bg-cme-primary text-white font-medium'
                    : 'text-cme-text-muted hover:text-cme-text-base'
                }`}
                title="Sans-serif typography"
              >
                Sans
              </button>
              <button
                onClick={() => setFontMode('serif')}
                className={`px-2 py-1 rounded font-serif transition-colors ${
                  fontMode === 'serif'
                    ? 'bg-cme-primary text-white font-medium'
                    : 'text-cme-text-muted hover:text-cme-text-base'
                }`}
                title="Serif typography"
              >
                Serif
              </button>
              <button
                onClick={() => setFontMode('mono')}
                className={`px-2 py-1 rounded font-mono transition-colors ${
                  fontMode === 'mono'
                    ? 'bg-cme-primary text-white font-medium'
                    : 'text-cme-text-muted hover:text-cme-text-base'
                }`}
                title="Monospace typography"
              >
                Mono
              </button>
            </div>

            {/* Width Toggle */}
            <button
              onClick={() =>
                setWidthMode(
                  widthMode === 'focused'
                    ? 'standard'
                    : widthMode === 'standard'
                    ? 'fluid'
                    : 'focused'
                )
              }
              className="p-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors hidden sm:flex"
              title={`Width: ${widthMode}`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {/* Review Overlay Toggle */}
            <button
              onClick={() => setShowReviews(!showReviews)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                showReviews
                  ? 'bg-cme-primary text-white border-cme-primary shadow-sm'
                  : 'border-cme-border-base bg-cme-bg-surface text-cme-text-base hover:bg-cme-bg-hover'
              }`}
              data-testid="review-overlay-toggle"
              title="Toggle inline comments and review annotations"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Reviews: {showReviews ? 'ON' : 'OFF'}</span>
            </button>

            {/* Switch to Edit Mode */}
            <Link
              to={`/documents/${document.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
              title="Open in Collaborative Editor"
              data-testid="switch-to-editor-btn"
            >
              <Edit3 className="w-3.5 h-3.5 text-cme-text-muted" />
              <span>Edit</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Reading Area with Right Sticky Table of Contents */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8 flex gap-8 items-start">
        {/* Document Article Body */}
        <main className={`flex-1 min-w-0 ${widthClass} mx-auto transition-all`}>
          <article
            className={`prose dark:prose-invert max-w-none text-cme-text-base ${fontClass} leading-relaxed`}
            data-testid="reader-article"
          >
            {renderedContent}
          </article>

          {/* Review Overlay Section (when enabled) */}
          {showReviews && (
            <section
              className="mt-12 p-6 bg-cme-bg-surface border border-cme-border-base rounded-2xl space-y-6 shadow-sm"
              data-testid="review-overlay-panel"
            >
              <div className="flex items-center justify-between pb-3 border-b border-cme-border-base">
                <div className="flex items-center gap-2 font-semibold text-sm text-cme-text-base">
                  <MessageSquare className="w-4 h-4 text-cme-primary" />
                  <span>Review & Feedback Overlay</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-cme-text-muted">
                  <span className="px-2 py-0.5 rounded bg-cme-bg-subtle font-mono">
                    {comments.length} comments
                  </span>
                  <span className="px-2 py-0.5 rounded bg-cme-bg-subtle font-mono">
                    {suggestions.length} suggestions
                  </span>
                </div>
              </div>

              {/* Review Comments */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                  Inline Discussions ({comments.length})
                </h4>
                {comments.length === 0 ? (
                  <p className="text-xs text-cme-text-muted italic bg-cme-bg-subtle/50 p-3 rounded-xl border border-dashed border-cme-border-base">
                    No open comments on this document.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="p-3 rounded-xl border border-cme-border-base bg-cme-bg-base space-y-1.5"
                        data-testid="comment-item"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-cme-text-base flex items-center gap-1">
                            <User className="w-3 h-3 text-cme-primary" />
                            {comment.username || 'Collaborator'}
                          </span>
                          <span className="text-[11px] text-cme-text-muted font-mono">
                            {new Date(comment.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {comment.quote && (
                          <div className="text-xs italic text-cme-text-muted border-l-2 border-cme-primary pl-2 py-0.5 bg-cme-primary/5 rounded-r">
                            "{comment.quote}"
                          </div>
                        )}
                        <p className="text-xs text-cme-text-base">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Review Suggestions */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                  Suggested Edits ({suggestions.length})
                </h4>
                {suggestions.length === 0 ? (
                  <p className="text-xs text-cme-text-muted italic bg-cme-bg-subtle/50 p-3 rounded-xl border border-dashed border-cme-border-base">
                    No pending suggestions on this document.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {suggestions.map((sugg) => (
                      <div
                        key={sugg.id}
                        className="p-3 rounded-xl border border-cme-border-base bg-cme-bg-base space-y-2"
                        data-testid="suggestion-item"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-cme-text-base flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-500" />
                            {sugg.username || 'Reviewer'}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wider ${
                              sugg.status === 'accepted'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : sugg.status === 'rejected'
                                ? 'bg-rose-500/10 text-rose-500'
                                : 'bg-amber-500/10 text-amber-500'
                            }`}
                          >
                            {sugg.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300">
                            - {sugg.original_text}
                          </div>
                          <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                            + {sugg.suggested_text}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Tasks */}
              {tasks.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-cme-text-muted">
                    Assigned Tasks ({tasks.length})
                  </h4>
                  <div className="space-y-1.5">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 p-2 rounded-lg border border-cme-border-base bg-cme-bg-base text-xs"
                      >
                        <CheckCircle2
                          className={`w-4 h-4 ${
                            task.is_completed ? 'text-emerald-500' : 'text-cme-text-muted'
                          }`}
                        />
                        <span className={task.is_completed ? 'line-through text-cme-text-muted' : ''}>
                          {task.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>

        {/* Right Sticky Column: Document Outline (Table of Contents) */}
        <aside className="w-64 lg:w-72 hidden md:block sticky top-20 flex-shrink-0">
          <div className="border border-cme-border-base rounded-2xl bg-cme-bg-surface overflow-hidden shadow-sm">
            <DocumentOutline headings={headings} markdown={document.content} />
          </div>
        </aside>
      </div>
    </div>
  );
};

// Markdown block renderer helper with heading slug anchors, KaTeX math, and Mermaid support
function renderMarkdown(
  content: string,
  onCopyCode: (code: string, id: string) => void,
  copiedCodeId: string | null
): React.ReactNode[] {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  const slugCounts: Record<string, number> = {};

  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Block or Mermaid block
    if (line.startsWith('```')) {
      const lang = line.replace(/^```/, '').trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = codeLines.join('\n');
      const codeBlockId = `code-block-${i}`;

      if (lang === 'mermaid') {
        elements.push(
          <MermaidBlock key={`mermaid-${i}`} source={code} />
        );
      } else {
        elements.push(
          <div
            key={`code-${i}`}
            className="my-4 rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden group"
          >
            <div className="flex items-center justify-between px-3 py-1.5 bg-cme-bg-subtle text-xs font-mono text-cme-text-muted border-b border-cme-border-base">
              <span>{lang || 'text'}</span>
              <button
                onClick={() => onCopyCode(code, codeBlockId)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
                title="Copy code"
              >
                {copiedCodeId === codeBlockId ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] text-emerald-500">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span className="text-[10px]">Copy</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 font-mono text-xs overflow-x-auto leading-relaxed bg-cme-bg-base/50">
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      continue;
    }

    // Display Math Block $$...$$
    if (line.trim().startsWith('$$')) {
      const mathLines: string[] = [];
      if (line.trim() === '$$') {
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
        i++; // skip ending $$
      } else {
        mathLines.push(line.replace(/^\$\$/, '').replace(/\$\$$/, ''));
        i++;
      }
      const formula = mathLines.join('\n');
      let renderedHtml = formula;
      try {
        renderedHtml = katex.renderToString(formula, { displayMode: true, throwOnError: false });
      } catch {
        // fallback
      }
      elements.push(
        <div
          key={`math-${i}`}
          className="my-4 p-4 rounded-xl bg-cme-bg-subtle border border-cme-border-base text-center overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      );
      continue;
    }

    // Headings #, ##, ###, ####, #####, ######
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawText = headingMatch[2].trim();
      const baseSlug = slugify(rawText.replace(/[*_`]/g, ''));
      const count = slugCounts[baseSlug] || 0;
      slugCounts[baseSlug] = count + 1;
      const id = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      const headingContent = renderInlineFormatted(rawText);

      if (level === 1) {
        elements.push(
          <h1
            key={`h-${i}`}
            id={id}
            className="text-2xl md:text-3xl font-bold tracking-tight mt-8 mb-4 pt-4 border-b border-cme-border-base pb-2 scroll-mt-20"
          >
            {headingContent}
          </h1>
        );
      } else if (level === 2) {
        elements.push(
          <h2
            key={`h-${i}`}
            id={id}
            className="text-xl md:text-2xl font-bold tracking-tight mt-6 mb-3 scroll-mt-20"
          >
            {headingContent}
          </h2>
        );
      } else if (level === 3) {
        elements.push(
          <h3
            key={`h-${i}`}
            id={id}
            className="text-lg md:text-xl font-semibold mt-5 mb-2 scroll-mt-20"
          >
            {headingContent}
          </h3>
        );
      } else {
        elements.push(
          <h4
            key={`h-${i}`}
            id={id}
            className="text-base font-semibold mt-4 mb-2 scroll-mt-20 text-cme-text-muted"
          >
            {headingContent}
          </h4>
        );
      }
      i++;
      continue;
    }

    // Blockquote >
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="my-3 pl-4 border-l-4 border-cme-primary italic text-cme-text-muted bg-cme-primary/5 py-1 rounded-r-lg"
        >
          {quoteLines.join(' ')}
        </blockquote>
      );
      continue;
    }

    // Task list / Checkbox
    if (line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/)) {
      const match = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (match) {
        const checked = match[1].toLowerCase() === 'x';
        elements.push(
          <div key={`task-${i}`} className="flex items-center gap-2 my-1 text-sm">
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="rounded text-cme-primary border-cme-border-base focus:ring-0"
            />
            <span className={checked ? 'line-through text-cme-text-muted' : ''}>
              {renderInlineFormatted(match[2])}
            </span>
          </div>
        );
        i++;
        continue;
      }
    }

    // Unordered List - or *
    if (line.match(/^[-*]\s+(.+)$/)) {
      const match = line.match(/^[-*]\s+(.+)$/);
      if (match) {
        elements.push(
          <li key={`li-${i}`} className="ml-4 list-disc text-sm my-0.5">
            {renderInlineFormatted(match[1])}
          </li>
        );
        i++;
        continue;
      }
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Normal Paragraph
    elements.push(
      <p key={`p-${i}`} className="my-2 text-sm leading-relaxed">
        {renderInlineFormatted(line)}
      </p>
    );
    i++;
  }

  return elements;
}

// Inline formatting helper: Bold, Italic, Inline Code, Inline Math ($...$), and WikiLinks ([[target]])
function renderInlineFormatted(text: string): React.ReactNode {
  // Replace [[target|alias]]
  const parts = text.split(/(\[\[[^\]]+\]\]|\$[^$]+\$|`[^`]+`|\*\*[^*]+\*\*)/g);

  return parts.map((part, idx) => {
    // WikiLinks [[page]] or [[page|alias]]
    if (part.startsWith('[[') && part.endsWith(']]')) {
      const inner = part.slice(2, -2);
      const [target, alias] = inner.split('|');
      const label = alias || target;
      return (
        <Link
          key={idx}
          to={`/docs/${encodeURIComponent(target.trim())}`}
          className="text-cme-primary hover:underline font-medium inline-flex items-center gap-0.5"
          title={`Open wiki link: ${target}`}
        >
          <span>{label}</span>
        </Link>
      );
    }

    // Inline Math $...$
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const latex = part.slice(1, -1);
      try {
        const html = katex.renderToString(latex, { displayMode: false, throwOnError: false });
        return (
          <span
            key={idx}
            className="katex-inline"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } catch {
        return <code key={idx} className="font-mono text-xs">{part}</code>;
      }
    }

    // Inline Code `...`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-cme-bg-subtle font-mono text-xs text-cme-primary border border-cme-border-base"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold **...**
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

// Mermaid diagram interactive container
const MermaidBlock: React.FC<{ source: string }> = ({ source }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    renderMermaidSvg(source)
      .then((res) => {
        setSvg(res);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || 'Mermaid syntax error');
      });
  }, [source]);

  if (error) {
    return (
      <div className="my-4 p-4 border border-rose-500/20 bg-rose-500/10 rounded-xl text-xs text-rose-500 font-mono">
        Failed to render diagram: {error}
      </div>
    );
  }

  return (
    <div
      className="my-6 p-4 rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-x-auto flex justify-center"
      data-testid="mermaid-viewer"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
