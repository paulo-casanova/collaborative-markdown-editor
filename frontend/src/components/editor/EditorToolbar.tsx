import React from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
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
} from 'lucide-react';

interface EditorToolbarProps {
  editor: Editor | null;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor }) => {
  if (!editor) return null;

  const btnClass = (isActive: boolean = false) =>
    `p-1.5 rounded-md text-xs transition-colors ${
      isActive
        ? 'bg-cme-primary text-white font-medium'
        : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
    }`;

  const divider = <div className="h-4 w-[1px] bg-cme-border-base mx-1" />;

  return (
    <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b border-cme-border-base bg-cme-bg-surface select-none sticky top-14 z-30">
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
    </div>
  );
};
