import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { MessageSquare, GitPullRequest } from 'lucide-react';
import { useReviewStore } from '../../stores/reviewStore';
import { createDualAnchor } from '../../review/textAnchoring';
import { CmeCollabProvider } from '../../api/collabProvider';

interface FloatingReviewMenuProps {
  editor: Editor | null;
  provider?: CmeCollabProvider | null;
}

export const FloatingReviewMenu: React.FC<FloatingReviewMenuProps> = ({
  editor,
  provider,
}) => {
  const { setPendingCommentSelection, setPendingSuggestionSelection } =
    useReviewStore();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      const { selection, doc } = editor.state;
      if (selection.empty) {
        setPosition(null);
        setSelectedText('');
        setSelectionRange(null);
        return;
      }

      const text = doc.textBetween(selection.from, selection.to, ' ');
      if (!text.trim()) {
        setPosition(null);
        setSelectedText('');
        setSelectionRange(null);
        return;
      }

      setSelectedText(text);
      setSelectionRange({ from: selection.from, to: selection.to });

      // Calculate position using editor coordsAtPos with DOM selection fallback
      try {
        const coords = editor.view.coordsAtPos(selection.from);
        if (coords && coords.top > 0) {
          setPosition({
            top: Math.max(10, coords.top - 46),
            left: Math.max(10, coords.left),
          });
          return;
        }
      } catch (_) {}

      const domSelection = window.getSelection();
      if (domSelection && domSelection.rangeCount > 0) {
        const range = domSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          setPosition({
            top: Math.max(10, rect.top - 46),
            left: Math.max(10, rect.left + rect.width / 2),
          });
          return;
        }
      }

      setPosition(null);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('blur', () => {
      // Small timeout so clicks inside menu aren't dismissed before triggering
      setTimeout(() => {
        if (!menuRef.current?.matches(':hover')) {
          setPosition(null);
        }
      }, 200);
    });

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor]);

  if (!position || !selectedText || !selectionRange) return null;

  const handleOpenComment = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editor) return;

    const fullText = editor.getText();
    const ydoc = provider?.ydoc;
    const ytype = ydoc ? ydoc.getText('content') : undefined;

    // Zero-based character offset for anchoring
    const charStart = Math.max(0, selectionRange.from - 1);
    const charEnd = Math.max(charStart, selectionRange.to - 1);

    const anchor = ytype
      ? createDualAnchor(ytype, charStart, charEnd, fullText)
      : createDualAnchor(ydoc || fullText as any, charStart, charEnd, fullText);

    setPendingCommentSelection({
      start: charStart,
      end: charEnd,
      text: selectedText,
      anchor,
    });
    setPosition(null);
  };

  const handleOpenSuggestion = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editor) return;

    const fullText = editor.getText();
    const ydoc = provider?.ydoc;
    const ytype = ydoc ? ydoc.getText('content') : undefined;

    const charStart = Math.max(0, selectionRange.from - 1);
    const charEnd = Math.max(charStart, selectionRange.to - 1);

    const anchor = ytype
      ? createDualAnchor(ytype, charStart, charEnd, fullText)
      : createDualAnchor(ydoc || fullText as any, charStart, charEnd, fullText);

    setPendingSuggestionSelection({
      start: charStart,
      end: charEnd,
      text: selectedText,
      anchor,
    });
    setPosition(null);
  };

  return (
    <div
      ref={menuRef}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translateX(-50%)',
      }}
      className="fixed z-40 flex items-center gap-1 p-1 rounded-xl bg-cme-bg-surface border border-cme-border-base shadow-xl animate-in fade-in zoom-in-95 duration-100 select-none backdrop-blur-xs"
    >
      <button
        type="button"
        data-testid="suggest-edit-btn"
        onClick={handleOpenSuggestion}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition-colors cursor-pointer"
        title="Suggest an edit to selected text"
      >
        <GitPullRequest className="w-3.5 h-3.5" />
        Suggest Edit
      </button>

      <div className="w-[1px] h-3.5 bg-cme-border-base mx-0.5" />

      <button
        type="button"
        data-testid="add-comment-btn"
        onClick={handleOpenComment}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-cme-primary hover:bg-cme-primary/10 rounded-lg transition-colors cursor-pointer"
        title="Add a comment on selected text"
      >
        <MessageSquare className="w-3.5 h-3.5" />
        Comment
      </button>
    </div>
  );
};
