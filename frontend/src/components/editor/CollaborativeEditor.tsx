import React, { useEffect, useRef, useState, useMemo } from 'react';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { EditorState, Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';

import { createLivePreviewPlugin } from './codemirror/livePreviewPlugin';
import { cmeEditorTheme } from './codemirror/theme';
import { CodeMirrorEditorAdapter } from './codemirror/editorAdapter';
import { EditorToolbar } from './EditorToolbar';
import { CmeCollabProvider } from '../../api/collabProvider';
import { FloatingReviewMenu } from './FloatingReviewMenu';
import { NewSuggestionModal } from '../review/NewSuggestionModal';
import { NewCommentModal } from '../review/NewCommentModal';
import { normalizeContentToMarkdown } from '../../utils/htmlToMarkdown';
import { useThemeStore } from '../../stores/themeStore';

interface CollaborativeEditorProps {
  initialContent?: string;
  provider?: CmeCollabProvider | null;
  user?: {
    name: string;
    color: string;
  };
  onChange?: (content: string) => void;
  editable?: boolean;
  onEditorReady?: (editor: any) => void;
  autoFocus?: boolean | 'start' | 'end' | 'all';
}

const remoteCursorClassPlugin = ViewPlugin.fromClass(
  class {
    private observer: MutationObserver | null = null;
    constructor(view: EditorView) {
      const applyCursorClasses = () => {
        const carets = view.dom.querySelectorAll('.cm-ySelectionCaret');
        carets.forEach((caret) => {
          if (!caret.classList.contains('collaboration-cursor__caret')) {
            caret.classList.add('collaboration-cursor__caret');
          }
          const info = caret.querySelector('.cm-ySelectionInfo');
          if (info) {
            if (!info.classList.contains('collaboration-cursor__label')) {
              info.classList.add('collaboration-cursor__label');
            }
            (info as HTMLElement).style.opacity = '1';
            (info as HTMLElement).style.visibility = 'visible';
          }
        });
      };

      this.observer = new MutationObserver(() => {
        applyCursorClasses();
      });

      this.observer.observe(view.dom, { childList: true, subtree: true });
      applyCursorClasses();
    }

    destroy() {
      this.observer?.disconnect();
      this.observer = null;
    }
  }
);

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  initialContent = '',
  provider,
  user,
  onChange,
  editable = true,
  onEditorReady,
  autoFocus = false,
}) => {
  const { resolvedTheme } = useThemeStore();
  const isDark = resolvedTheme === 'dark';
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<CodeMirrorEditorAdapter | null>(null);
  const [editor, setEditor] = useState<CodeMirrorEditorAdapter | null>(null);

  const rawInitialText = useMemo(() => {
    return normalizeContentToMarkdown(initialContent);
  }, [initialContent]);

  // Synchronize user profile updates with collaboration awareness
  useEffect(() => {
    if (provider) {
      const profile = user || {
        name: 'Collaborator',
        color: '#3b82f6',
      };
      provider.awareness.setLocalStateField('user', profile);
    }
  }, [user, provider]);

  // Mount CodeMirror 6 EditorView
  useEffect(() => {
    if (!editorContainerRef.current) return;

    let initialDoc = rawInitialText;
    const extensions: Extension[] = [
      markdown(),
      createLivePreviewPlugin(isDark),
      cmeEditorTheme,
      remoteCursorClassPlugin,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        class:
          'tiptap ProseMirror prose prose-sm md:prose-base dark:prose-invert max-w-none focus:outline-none min-h-[450px] p-6 text-cme-text-base leading-relaxed cursor-text',
        tabindex: '0',
        role: 'textbox',
      }),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) {
          adapterRef.current?.notifySelectionUpdate();
        }
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString());
        }
        if (provider && (update.selectionSet || update.docChanged)) {
          const ytext = provider.ydoc.getText('content');
          const sel = update.state.selection.main;
          if (sel) {
            const anchor = Y.createRelativePositionFromTypeIndex(ytext, sel.anchor);
            const head = Y.createRelativePositionFromTypeIndex(ytext, sel.head);
            provider.awareness.setLocalStateField('cursor', {
              anchor,
              head,
            });
          }
        }
      }),
    ];

    if (!editable) {
      extensions.push(EditorView.editable.of(false));
    }

    if (provider) {
      const ytext = provider.ydoc.getText('content');
      if (ytext.length === 0 && rawInitialText) {
        ytext.insert(0, rawInitialText);
      }
      initialDoc = ytext.toString();
      extensions.push(yCollab(ytext, provider.awareness));
    }

    const state = EditorState.create({
      doc: initialDoc,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    const adapter = new CodeMirrorEditorAdapter(view);
    adapterRef.current = adapter;
    (view.dom as any).__tiptapEditor = adapter;
    (view.contentDOM as any).__tiptapEditor = adapter;

    if (autoFocus) {
      const pos = autoFocus === 'start' ? 0 : view.state.doc.length;
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    }

    setEditor(adapter);

    if (onEditorReady) {
      onEditorReady(adapter);
    }

    return () => {
      view.destroy();
      setEditor(null);
      adapterRef.current = null;
    };
  }, [provider, rawInitialText, editable, isDark]);

  return (
    <div className="collaborative-editor-root rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm flex flex-col flex-1 h-full min-h-0 relative">
      {editable && <EditorToolbar editor={editor as any} provider={provider} />}
      <div className="editor-content-viewport flex-1 overflow-y-auto">
        <div ref={editorContainerRef} className="h-full" />
      </div>

      {/* Floating Selection Menu */}
      {editable && <FloatingReviewMenu editor={editor as any} provider={provider} />}

      {/* New Suggestion / Comment Modals */}
      <NewSuggestionModal />
      <NewCommentModal />
    </div>
  );
};
