import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { MessageSquare, GitPullRequest, Sparkles } from 'lucide-react';
import { useReviewStore } from '../../stores/reviewStore';
import { useDialogStore } from '../../stores/dialogStore';
import { useUIStore } from '../../stores/uiStore';
import { createDualAnchor } from '../../review/textAnchoring';
import { CmeCollabProvider } from '../../api/collabProvider';

interface FloatingReviewMenuProps {
  editor: Editor | null;
  provider?: CmeCollabProvider | null;
  documentId?: string;
  documentTitle?: string;
  documentPath?: string;
}

export const FloatingReviewMenu: React.FC<FloatingReviewMenuProps> = ({
  editor,
  provider,
  documentId,
  documentTitle,
  documentPath,
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

  const handleAskAgent = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedText) return;

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

      <div className="w-[1px] h-3.5 bg-cme-border-base mx-0.5" />

      <button
        type="button"
        data-testid="floating-ask-agent-btn"
        onClick={handleAskAgent}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded-lg transition-colors cursor-pointer"
        title="Ask your AI agent about selected text"
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        Ask Agent
      </button>
    </div>
  );
};
