import React, { useState, useEffect } from 'react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Hash,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Minus,
  Table as TableIcon,
  Code2,
  Sigma,
  GitGraph,
  Link2,
  Undo,
  Redo,
  MessageSquare,
  GitPullRequest,
  Eye,
  EyeOff,
  Tag,
  Sparkles,
  Edit3,
} from 'lucide-react';
import { useReviewStore } from '../../stores/reviewStore';
import { useUIStore } from '../../stores/uiStore';
import { useDialogStore } from '../../stores/dialogStore';
import { createDualAnchor } from '../../review/textAnchoring';
import { CmeCollabProvider } from '../../api/collabProvider';

interface EditorToolbarProps {
  editor: any;
  provider?: CmeCollabProvider | null;
  onToggleNumberHeaders?: () => void;
  documentId?: string;
  documentTitle?: string;
  documentPath?: string;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editor,
  provider,
  onToggleNumberHeaders,
  documentId,
  documentTitle,
  documentPath,
}) => {
  const { numberHeaders, toggleNumberHeaders, lineNumbers, toggleLineNumbers } = useUIStore();
  const {
    comments,
    suggestions,
    tasks,
    suggestingMode,
    toggleSuggestingMode,
    showInTextReviews,
    toggleInTextReviews,
    setPendingCommentSelection,
    setPendingSuggestionSelection,
  } = useReviewStore();

  const [hasSelection, setHasSelection] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const handleUpdate = () => {
      const { selection, doc } = editor.state;
      if (!selection.empty) {
        const text = doc.textBetween(selection.from, selection.to, ' ');
        if (text.trim().length > 0) {
          setHasSelection(true);
          setSelectedText(text);
          setSelectionRange({ from: selection.from, to: selection.to });
          return;
        }
      }
      setHasSelection(false);
      setSelectedText('');
      setSelectionRange(null);
    };

    editor.on('selectionUpdate', handleUpdate);
    return () => {
      editor.off('selectionUpdate', handleUpdate);
    };
  }, [editor]);

  const handleToolbarAddComment = () => {
    if (!editor || !hasSelection || !selectionRange) return;
    const fullText = editor.getText();
    const ydoc = provider?.ydoc;
    const ytype = ydoc ? ydoc.getText('content') : undefined;
    const charStart = Math.max(0, selectionRange.from - 1);
    const charEnd = Math.max(charStart, selectionRange.to - 1);

    const anchor = ytype
      ? createDualAnchor(ytype, charStart, charEnd, fullText)
      : createDualAnchor(ydoc || (fullText as any), charStart, charEnd, fullText);

    setPendingCommentSelection({
      start: charStart,
      end: charEnd,
      text: selectedText,
      anchor,
    });
  };

  const handleToolbarSuggestEdit = () => {
    if (!editor || !hasSelection || !selectionRange) return;
    const fullText = editor.getText();
    const ydoc = provider?.ydoc;
    const ytype = ydoc ? ydoc.getText('content') : undefined;
    const charStart = Math.max(0, selectionRange.from - 1);
    const charEnd = Math.max(charStart, selectionRange.to - 1);

    const anchor = ytype
      ? createDualAnchor(ytype, charStart, charEnd, fullText)
      : createDualAnchor(ydoc || (fullText as any), charStart, charEnd, fullText);

    setPendingSuggestionSelection({
      start: charStart,
      end: charEnd,
      text: selectedText,
      anchor,
    });
  };

  const handleToolbarAskAgent = () => {
    if (!hasSelection || !selectedText) return;

    let lineStart: number | undefined;
    if (editor && selectionRange) {
      try {
        const view = (editor as any).getView?.() || (editor as any).view;
        if (view?.state?.doc) {
          lineStart = view.state.doc.lineAt(selectionRange.from).number;
        } else if (typeof (editor as any).state?.doc?.lineAt === 'function') {
          lineStart = (editor as any).state.doc.lineAt(selectionRange.from).number;
        }
      } catch (_) {}
    }

    useDialogStore.getState().setContextSnapshot({
      document_id: documentId,
      document_title: documentTitle,
      document_path: documentPath,
      selected_text: selectedText,
      line_start: lineStart,
    });
    useUIStore.getState().setDialogSidecarOpen(true);
  };

  const openReviewsCount =
    comments.filter((c) => c.status === 'OPEN').length +
    suggestions.filter((s) => s.status === 'PENDING').length +
    tasks.filter((t) => !t.is_completed).length;

  if (!editor) return null;

  const btnClass = (isActive: boolean = false) =>
    `p-1.5 rounded-md text-xs transition-colors ${
      isActive
        ? 'bg-cme-primary text-white font-medium'
        : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
    }`;

  const divider = <div className="h-4 w-[1px] bg-cme-border-base mx-1" />;

  return (
    <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b border-cme-border-base bg-cme-bg-surface select-none sticky top-0 z-10">
      {/* Undo / Redo */}
      <button
        type="button"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        className={btnClass(false) + ' disabled:opacity-30'}
        title="Undo (Ctrl+Z)"
      >
        <Undo className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        className={btnClass(false) + ' disabled:opacity-30'}
        title="Redo (Ctrl+Y)"
      >
        <Redo className="w-3.5 h-3.5" />
      </button>

      {divider}

      {/* Headings */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={btnClass(editor.isActive('heading', { level: 1 }))}
        title="Heading 1"
      >
        <Heading1 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={btnClass(editor.isActive('heading', { level: 2 }))}
        title="Heading 2"
      >
        <Heading2 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btnClass(editor.isActive('heading', { level: 3 }))}
        title="Heading 3"
      >
        <Heading3 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          if (onToggleNumberHeaders) {
            onToggleNumberHeaders();
          } else {
            toggleNumberHeaders();
          }
        }}
        className={btnClass(numberHeaders)}
        title="Automatically Number Headers"
        data-testid="toggle-header-numbering-btn"
      >
        <Hash className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => toggleLineNumbers()}
        className={btnClass(lineNumbers)}
        title="Toggle Line Numbers"
        data-testid="toggle-line-numbers-btn"
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10" />
        </svg>
      </button>

      {divider}

      {/* Formatting Marks */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btnClass(editor.isActive('bold'))}
        title="Bold (Ctrl+B)"
      >
        <Bold className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btnClass(editor.isActive('italic'))}
        title="Italic (Ctrl+I)"
      >
        <Italic className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={btnClass(editor.isActive('strike'))}
        title="Strikethrough"
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={btnClass(editor.isActive('code'))}
        title="Inline Code"
      >
        <Code className="w-3.5 h-3.5" />
      </button>

      {divider}

      {/* Lists & Quotes */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btnClass(editor.isActive('bulletList'))}
        title="Bullet List"
      >
        <List className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btnClass(editor.isActive('orderedList'))}
        title="Numbered List"
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={btnClass(editor.isActive('taskList'))}
        title="Task List (- [ ])"
      >
        <CheckSquare className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={btnClass(editor.isActive('blockquote'))}
        title="Blockquote"
      >
        <Quote className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className={btnClass(false)}
        title="Horizontal Rule"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      {divider}

      {/* Code Block */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={btnClass(editor.isActive('codeBlock'))}
        title="Code Block"
      >
        <Code2 className="w-3.5 h-3.5" />
      </button>

      {/* Math Block */}
      <button
        type="button"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'mathBlock',
              attrs: { latex: 'E = mc^2' },
            })
            .run()
        }
        className={btnClass(editor.isActive('mathBlock'))}
        title="Insert Display Math Formula ($$...$$)"
      >
        <Sigma className="w-3.5 h-3.5" />
      </button>

      {/* Mermaid Diagram */}
      <button
        type="button"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'mermaidBlock',
              attrs: {
                source: `flowchart TD\n    A["Start"] --> B["Step 1"]\n    B --> C["Finish"]`,
              },
            })
            .run()
        }
        className={btnClass(editor.isActive('mermaidBlock'))}
        title="Insert Mermaid Diagram"
      >
        <GitGraph className="w-3.5 h-3.5" />
      </button>

      {/* Wiki Link */}
      <button
        type="button"
        onClick={() => {
          const target = prompt('Enter wiki target document path (e.g. guides/intro.md):');
          if (target) {
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'wikiLink',
                attrs: { target, label: target },
              })
              .run();
          }
        }}
        className={btnClass(editor.isActive('wikiLink'))}
        title="Insert Wiki Link ([[target|label]])"
      >
        <Link2 className="w-3.5 h-3.5" />
      </button>

      {/* Table */}
      <button
        type="button"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        className={btnClass(editor.isActive('table'))}
        title="Insert Table"
      >
        <TableIcon className="w-3.5 h-3.5" />
      </button>

      {/* Pill / Badge */}
      <button
        type="button"
        onClick={() => {
          const selected = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) || 'Approved';
          const input = prompt(
            'Insert Pill / Badge ([pill:color|label]):\nEnter color and label (e.g. green|Approved, amber|In Progress, rose|Blocked, or Draft):',
            `green|${selected}`
          );
          if (input !== null && input.trim()) {
            const trimmed = input.trim();
            const pillSyntax = trimmed.startsWith('[') && trimmed.endsWith(']')
              ? trimmed
              : `[pill:${trimmed}]`;
            editor.chain().focus().insertContent(pillSyntax).run();
          }
        }}
        className={btnClass(false)}
        title="Insert Pill / Badge ([pill:color|label])"
        data-testid="toolbar-pill-btn"
      >
        <Tag className="w-3.5 h-3.5" />
      </button>

      {divider}

      {/* Suggest Edit */}
      <button
        type="button"
        data-testid="toolbar-suggest-edit-btn"
        disabled={!hasSelection}
        onClick={handleToolbarSuggestEdit}
        className={btnClass(false) + ' disabled:opacity-30 text-emerald-600 dark:text-emerald-400'}
        title="Suggest edit on selected text"
      >
        <GitPullRequest className="w-3.5 h-3.5" />
      </button>

      {/* Add Comment */}
      <button
        type="button"
        data-testid="toolbar-add-comment-btn"
        disabled={!hasSelection}
        onClick={handleToolbarAddComment}
        className={btnClass(false) + ' disabled:opacity-30 text-cme-primary'}
        title="Add review comment on selected text"
      >
        <MessageSquare className="w-3.5 h-3.5" />
      </button>

      {/* Ask Agent */}
      <button
        type="button"
        data-testid="toolbar-ask-agent-btn"
        disabled={!hasSelection}
        onClick={handleToolbarAskAgent}
        className={btnClass(false) + ' disabled:opacity-30 text-amber-600 dark:text-amber-400'}
        title="Ask your AI agent about selected text"
      >
        <Sparkles className="w-3.5 h-3.5" />
      </button>

      {/* Suggesting Mode Toggle */}
      <button
        type="button"
        data-testid="suggesting-mode-toggle"
        onClick={() => toggleSuggestingMode()}
        className={
          btnClass(suggestingMode) +
          (suggestingMode ? ' bg-emerald-600 text-white shadow-xs' : '')
        }
        title={
          suggestingMode
            ? 'Suggesting Mode: ON (Click to switch to direct editing)'
            : 'Direct Editing Mode (Click to switch to suggesting mode)'
        }
      >
        {suggestingMode ? (
          <GitPullRequest className="w-3.5 h-3.5 text-white" />
        ) : (
          <Edit3 className="w-3.5 h-3.5 text-cme-text-muted" />
        )}
        <span className="sr-only">{suggestingMode ? 'Suggesting' : 'Editing'}</span>
      </button>

      {/* In-Text Reviews Toggle */}
      <button
        type="button"
        data-testid="toggle-in-text-reviews-btn"
        onClick={() => toggleInTextReviews()}
        className={`relative ${btnClass(showInTextReviews)} ml-auto`}
        title={showInTextReviews ? 'Hide Reviews in Text' : 'Show Reviews in Text'}
      >
        {showInTextReviews ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        <span className="sr-only">In-Text Reviews</span>
        {openReviewsCount > 0 && (
          <span
            data-testid="toolbar-review-badge"
            className={`absolute -top-1 -right-1 px-1 min-w-[14px] h-3.5 flex items-center justify-center rounded-full text-[9px] font-bold ${
              showInTextReviews ? 'bg-white/20 text-white' : 'bg-amber-500 text-white'
            }`}
          >
            {openReviewsCount}
          </span>
        )}
      </button>
    </div>
  );
};

