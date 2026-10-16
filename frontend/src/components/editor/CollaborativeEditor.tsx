import React, { useEffect, useRef, useState, useMemo } from 'react';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import { Annotation, EditorState, Extension, Text } from '@codemirror/state';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import {
  defaultKeymap,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
  insertNewline,
} from '@codemirror/commands';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';

import {
  createLivePreviewPlugin,
  forceLivePreviewRebuild,
} from './codemirror/livePreviewPlugin';
import { cmeEditorTheme } from './codemirror/theme';
import { CodeMirrorEditorAdapter } from './codemirror/editorAdapter';
import { EditorToolbar } from './EditorToolbar';
import { CmeCollabProvider } from '../../api/collabProvider';
import { FloatingReviewMenu } from './FloatingReviewMenu';
import { NewSuggestionModal } from '../review/NewSuggestionModal';
import { NewCommentModal } from '../review/NewCommentModal';
import { normalizeContentToMarkdown } from '../../utils/htmlToMarkdown';
import { useThemeStore } from '../../stores/themeStore';
import { useUIStore } from '../../stores/uiStore';
import { subscribeLinkValidation } from '../../utils/linkValidator';

const autoRenumberAnnotation = Annotation.define<boolean>();

/**
 * Computes minimal changes to keep contiguous ordered lists sequentially numbered (1., 2., 3., ...)
 * when items are added, removed, or reordered.
 */
export function computeOrderedListRenumberingChanges(
  doc: Text
): Array<{ from: number; to: number; insert: string }> {
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const counters = new Map<number, number>();
  let inCodeFence = false;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    if (/^\s*```/.test(text)) {
      inCodeFence = !inCodeFence;
      counters.clear();
      continue;
    }
    if (inCodeFence) continue;

    const olMatch = /^(\s*)(\d+)\.(\s+.*)$/.exec(text);
    if (olMatch) {
      const indent = olMatch[1].length;
      const numStr = olMatch[2];
      // Clear deeper indentation counters
      for (const k of Array.from(counters.keys())) {
        if (k > indent) {
          counters.delete(k);
        }
      }
      const expected = (counters.get(indent) || 0) + 1;
      counters.set(indent, expected);

      const expectedStr = String(expected);
      if (numStr !== expectedStr) {
        changes.push({
          from: line.from + indent,
          to: line.from + indent + numStr.length,
          insert: expectedStr,
        });
      }
      continue;
    }

    // Check if nested unordered list or indented continuation line
    const ulOrContMatch = /^(\s+)(?:[-*+]\s+|\S)/.exec(text);
    if (ulOrContMatch && counters.size > 0) {
      const indent = ulOrContMatch[1].length;
      for (const k of Array.from(counters.keys())) {
        if (k >= indent) {
          counters.delete(k);
        }
      }
      continue;
    }

    // Any other line breaks the ordered list sequence
    counters.clear();
  }

  return changes;
}

/**
 * Computes minimal changes to number or renumber markdown headings (1., 1.1., 2., ...)
 * or strip numbers when automatic header numbering is disabled.
 */
export function computeHeaderNumberingChanges(
  doc: Text,
  enableNumbering: boolean
): Array<{ from: number; to: number; insert: string }> {
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const counters = [0, 0, 0, 0, 0, 0];
  let inCodeFence = false;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    if (/^\s*```/.test(text)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const hMatch = /^(#{1,6}\s+)(\d+(?:\.\d+)*\.?\s+)?(.*)$/.exec(text);
    if (hMatch) {
      const hashesAndSpace = hMatch[1];
      const existingNumPrefix = hMatch[2] || '';
      const restTitle = hMatch[3];
      if (!restTitle.trim()) continue;

      const level = hashesAndSpace.trim().length;
      counters[level - 1] += 1;
      for (let k = level; k < 6; k++) {
        counters[k] = 0;
      }

      let startIdx = 0;
      while (startIdx < level - 1 && counters[startIdx] === 0) {
        startIdx++;
      }
      const numParts: number[] = [];
      for (let k = startIdx; k < level; k++) {
        numParts.push(counters[k] || 1);
      }
      const expectedPrefix =
        numParts.length === 1 ? `${numParts[0]}. ` : `${numParts.join('.')}. `;

      if (enableNumbering) {
        if (existingNumPrefix !== expectedPrefix) {
          const from = line.from + hashesAndSpace.length;
          const to = from + existingNumPrefix.length;
          changes.push({ from, to, insert: expectedPrefix });
        }
      } else {
        if (existingNumPrefix.length > 0) {
          const from = line.from + hashesAndSpace.length;
          const to = from + existingNumPrefix.length;
          changes.push({ from, to, insert: '' });
        }
      }
    }
  }

  return changes;
}

interface CollaborativeEditorProps {
  initialContent?: string;
  provider?: CmeCollabProvider | null;
  user?: {
    name: string;
    color: string;
  };
  onChange?: (content: string) => void;
  onCursorLineChange?: (line: number) => void;
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
  onCursorLineChange,
  editable = true,
  onEditorReady,
  autoFocus = false,
}) => {
  const { resolvedTheme } = useThemeStore();
  const { numberHeaders } = useUIStore();
  const isDark = resolvedTheme === 'dark';
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<CodeMirrorEditorAdapter | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  onCursorLineChangeRef.current = onCursorLineChange;
  const prevNumberHeadersRef = useRef<boolean>(numberHeaders);
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

  // Subscribe to link validation updates (e.g. when workspace tree finishes loading)
  useEffect(() => {
    return subscribeLinkValidation(() => {
      const view = adapterRef.current?.getView?.();
      if (view) {
        view.dispatch({ effects: forceLivePreviewRebuild.of(true) });
      }
    });
  }, []);

  // When numberHeaders is toggled, update headings and refresh live preview
  useEffect(() => {
    const view = adapterRef.current?.getView?.();
    if (!view) return;

    const wasEnabled = prevNumberHeadersRef.current;
    prevNumberHeadersRef.current = numberHeaders;

    if (editable && (numberHeaders || wasEnabled !== numberHeaders)) {
      const changes = computeHeaderNumberingChanges(view.state.doc, numberHeaders);
      if (changes.length > 0) {
        view.dispatch({
          changes,
          annotations: autoRenumberAnnotation.of(true),
          effects: forceLivePreviewRebuild.of(true),
        });
        return;
      }
    }

    view.dispatch({ effects: forceLivePreviewRebuild.of(true) });
  }, [numberHeaders, editable]);

  // Mount CodeMirror 6 EditorView
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const customKeymap = keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          if (insertNewlineContinueMarkup(view)) {
            return true;
          }
          return insertNewlineAndIndent(view);
        },
        shift: insertNewline,
      },
      {
        key: 'Mod-Enter',
        run: (view) => {
          const end = view.state.doc.length;
          view.dispatch({
            changes: { from: end, insert: '\n' },
            selection: { anchor: end + 1 },
            scrollIntoView: true,
          });
          return true;
        },
      },
      {
        key: 'ArrowDown',
        run: (view) => {
          const sel = view.state.selection.main;
          if (sel.empty && sel.head === view.state.doc.length) {
            const lastLine = view.state.doc.lineAt(view.state.doc.length);
            if (lastLine.length > 0) {
              view.dispatch({
                changes: { from: view.state.doc.length, insert: '\n' },
                selection: { anchor: view.state.doc.length + 1 },
                scrollIntoView: true,
              });
              return true;
            }
          }
          return false;
        },
      },
      ...(provider ? yUndoManagerKeymap : historyKeymap),
      ...defaultKeymap,
      indentWithTab,
    ]);

    const extensions: Extension[] = [
      markdown(),
      createLivePreviewPlugin(isDark),
      cmeEditorTheme,
      remoteCursorClassPlugin,
      EditorView.lineWrapping,
      customKeymap,
      EditorView.contentAttributes.of({
        class:
          'tiptap ProseMirror prose prose-sm md:prose-base dark:prose-invert max-w-none focus:outline-none min-h-[450px] p-6 text-cme-text-base leading-relaxed cursor-text',
        tabindex: '0',
        role: 'textbox',
      }),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          adapterRef.current?.notifySelectionUpdate();
          if (onCursorLineChangeRef.current) {
            const headPos = update.state.selection.main.head;
            const lineNum = update.state.doc.lineAt(headPos).number;
            onCursorLineChangeRef.current(lineNum);
          }
        }
        if (update.docChanged) {
          if (onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }

          // Automatically renumber ordered lists (and headers when enabled) on local edits
          const isAutoRenumber = update.transactions.some((tr) =>
            Boolean(tr.annotation(autoRenumberAnnotation))
          );
          const isLocalEdit = update.transactions.some((tr) =>
            tr.isUserEvent('input') ||
            tr.isUserEvent('delete') ||
            tr.isUserEvent('move') ||
            !tr.annotation(autoRenumberAnnotation)
          );

          if (!isAutoRenumber && isLocalEdit && editable) {
            const listChanges = computeOrderedListRenumberingChanges(update.state.doc);
            const headerChanges = useUIStore.getState().numberHeaders
              ? computeHeaderNumberingChanges(update.state.doc, true)
              : [];
            const combined = [...listChanges, ...headerChanges].sort((a, b) => a.from - b.from);
            if (combined.length > 0) {
              queueMicrotask(() => {
                if (!adapterRef.current) return;
                const currentView = adapterRef.current.getView();
                const freshList = computeOrderedListRenumberingChanges(currentView.state.doc);
                const freshHeaders = useUIStore.getState().numberHeaders
                  ? computeHeaderNumberingChanges(currentView.state.doc, true)
                  : [];
                const freshCombined = [...freshList, ...freshHeaders].sort(
                  (a, b) => a.from - b.from
                );
                if (freshCombined.length > 0) {
                  currentView.dispatch({
                    changes: freshCombined,
                    annotations: autoRenumberAnnotation.of(true),
                  });
                }
              });
            }
          }
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

    let initialDoc = '';
    if (!provider) {
      initialDoc = rawInitialText;
    } else {
      const ytext = provider.ydoc.getText('content');
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

    if (onCursorLineChangeRef.current) {
      const headPos = view.state.selection.main.head;
      onCursorLineChangeRef.current(view.state.doc.lineAt(headPos).number);
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
  }, [provider, editable, isDark]);

  return (
    <div className="collaborative-editor-root rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm flex flex-col flex-1 h-full min-h-0 relative">
      {editable && <EditorToolbar editor={editor as any} provider={provider} />}
      <div
        className="editor-content-viewport flex-1 overflow-y-auto cursor-text"
        onClick={(e) => {
          if (e.target === e.currentTarget && adapterRef.current) {
            const view = adapterRef.current.getView();
            view.dispatch({ selection: { anchor: view.state.doc.length } });
            view.focus();
          }
        }}
      >
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
