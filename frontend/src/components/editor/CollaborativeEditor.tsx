import React, { useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import { CollaborationCursor } from './extensions/CollaborationCursor';

import { EditorToolbar } from './EditorToolbar';
import { CodeBlockCustom } from './extensions/CodeBlockCustom';
import { MathBlock } from './extensions/MathBlock';
import { InlineMath } from './extensions/InlineMath';
import { MermaidBlock } from './extensions/MermaidBlock';
import { WikiLink } from './extensions/WikiLink';
import { CmeCollabProvider } from '../../api/collabProvider';
import { FloatingReviewMenu } from './FloatingReviewMenu';
import { NewSuggestionModal } from '../review/NewSuggestionModal';
import { NewCommentModal } from '../review/NewCommentModal';

interface CollaborativeEditorProps {
  initialContent?: string;
  provider?: CmeCollabProvider | null;
  user?: {
    name: string;
    color: string;
  };
  onChange?: (htmlOrJson: string) => void;
  editable?: boolean;
  onEditorReady?: (editor: any) => void;
}

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  initialContent = '',
  provider,
  user,
  onChange,
  editable = true,
  onEditorReady,
}) => {
  const extensions = useMemo(() => {
    const baseExtensions: any[] = [
      StarterKit.configure({
        codeBlock: false, // Replaced by CodeBlockCustom
        undoRedo: provider ? false : undefined, // Yjs manages history in collaborative mode
      }),
      CodeBlockCustom,
      MathBlock,
      InlineMath,
      MermaidBlock,
      WikiLink,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder: 'Start writing your document... Use toolbar for Math, Mermaid & WikiLinks.',
      }),
    ];

    if (provider) {
      baseExtensions.push(
        Collaboration.configure({
          document: provider.ydoc,
        }),
        CollaborationCursor.configure({
          provider: provider as any,
          user: user || {
            name: 'Anonymous',
            color: '#3b82f6',
          },
        })
      );
    }

    return baseExtensions;
  }, [provider, user]);

  const editor = useEditor(
    {
      extensions,
      content: provider ? undefined : initialContent,
      editable,
      onCreate: ({ editor }) => {
        try {
          if (editor.view?.dom) {
            (editor.view.dom as any).__tiptapEditor = editor;
          }
        } catch (_) {}
      },
      onUpdate: ({ editor }) => {
        if (onChange) {
          onChange(editor.getHTML());
        }
      },
      editorProps: {
        attributes: {
          class:
            'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[450px] p-6 text-cme-text-base leading-relaxed',
        },
      },
    },
    [extensions]
  );

  // Synchronize initial content if in standalone mode
  useEffect(() => {
    if (!provider && editor && initialContent && editor.isEmpty) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent, provider]);

  // Synchronize user profile updates with collaboration awareness
  useEffect(() => {
    if (user && provider) {
      provider.awareness.setLocalStateField('user', user);
    }
  }, [user, provider]);

  const onEditorReadyCalled = React.useRef(false);

  // Expose editor instance when ready
  useEffect(() => {
    if (editor) {
      try {
        if (editor.view?.dom) {
          (editor.view.dom as any).__tiptapEditor = editor;
        }
      } catch (_) {}
      if (!onEditorReadyCalled.current && onEditorReady) {
        onEditorReadyCalled.current = true;
        onEditorReady(editor);
      }
    }
  }, [editor, onEditorReady]);

  return (
    <div className="collaborative-editor-root rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm flex flex-col relative">
      {editable && <EditorToolbar editor={editor} provider={provider} />}
      <div className="editor-content-viewport flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      {/* Floating Selection Menu */}
      {editable && <FloatingReviewMenu editor={editor} provider={provider} />}

      {/* New Suggestion / Comment Modals */}
      <NewSuggestionModal />
      <NewCommentModal />
    </div>
  );
};
