import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extension-placeholder';

import { EditorToolbar } from './EditorToolbar';
import { CodeBlockCustom } from './extensions/CodeBlockCustom';
import { MathBlock } from './extensions/MathBlock';
import { InlineMath } from './extensions/InlineMath';
import { MermaidBlock } from './extensions/MermaidBlock';
import { WikiLink } from './extensions/WikiLink';

interface CollaborativeEditorProps {
  initialContent?: string;
  onChange?: (htmlOrJson: string) => void;
  editable?: boolean;
}

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  initialContent = '',
  onChange,
  editable = true,
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Replaced by CodeBlockCustom
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
    ],
    content: initialContent,
    editable,
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
  });

  // Synchronize initial content changes if editor already mounted
  useEffect(() => {
    if (editor && initialContent && editor.isEmpty) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent]);

  return (
    <div className="collaborative-editor-root rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm flex flex-col">
      {editable && <EditorToolbar editor={editor} />}
      <div className="editor-content-viewport flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
