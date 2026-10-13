import { EditorView } from '@codemirror/view';
import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands';

export class CodeMirrorEditorAdapter {
  private view: EditorView;
  private selectionListeners = new Set<() => void>();

  private destroyed = false;

  constructor(view: EditorView) {
    this.view = view;
  }

  destroy() {
    this.destroyed = true;
    this.view.destroy();
  }

  get isDestroyed(): boolean {
    return this.destroyed || !this.view.dom.parentNode;
  }

  getView(): EditorView {
    return this.view;
  }

  notifySelectionUpdate() {
    this.selectionListeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.warn('[CodeMirrorEditorAdapter] listener error:', err);
      }
    });
  }

  on(event: string, fn: () => void) {
    if (event === 'selectionUpdate' || event === 'update') {
      this.selectionListeners.add(fn);
    }
  }

  off(event: string, fn: () => void) {
    if (event === 'selectionUpdate' || event === 'update') {
      this.selectionListeners.delete(fn);
    }
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  can(): { undo: () => boolean; redo: () => boolean } {
    return {
      undo: () => true,
      redo: () => true,
    };
  }

  isActive(type: string, attrs?: Record<string, any>): boolean {
    const sel = this.view.state.selection.main;
    const doc = this.view.state.doc;
    const line = doc.lineAt(sel.from);
    const lineText = line.text;

    if (type === 'heading') {
      const level = attrs?.level || 1;
      return lineText.startsWith('#'.repeat(level) + ' ');
    }
    if (type === 'bulletList') return lineText.startsWith('- ') || lineText.startsWith('* ');
    if (type === 'orderedList') return /^\d+\.\s/.test(lineText);
    if (type === 'taskList') return /^\s*[-*]\s+\[[ xX]\]/.test(lineText);
    if (type === 'blockquote') return lineText.startsWith('> ');
    if (type === 'codeBlock') return lineText.startsWith('```');

    const selected = doc.sliceString(sel.from, sel.to);
    if (type === 'bold') return selected.startsWith('**') && selected.endsWith('**');
    if (type === 'italic') return selected.startsWith('*') && selected.endsWith('*');
    if (type === 'strike') return selected.startsWith('~~') && selected.endsWith('~~');
    if (type === 'code') return selected.startsWith('`') && selected.endsWith('`');

    return false;
  }

  get state() {
    const docStr = this.view.state.doc.toString();
    const sel = this.view.state.selection.main;
    return {
      selection: {
        from: sel.from,
        to: sel.to,
        empty: sel.empty,
      },
      doc: {
        textBetween: (from: number, to: number) => {
          return docStr.slice(Math.max(0, from), Math.min(docStr.length, to));
        },
        descendants: (cb: (node: any, pos: number) => boolean | void) => {
          cb(
            {
              isText: true,
              text: docStr,
            },
            0
          );
        },
      },
    };
  }

  get commands() {
    return {
      setTextSelection: (range: { from: number; to: number }) => {
        this.view.dispatch({
          selection: { anchor: range.from, head: range.to },
          scrollIntoView: true,
        });
        this.view.focus();
        this.notifySelectionUpdate();
      },
      setContent: (content: string) => {
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: content },
        });
      },
    };
  }

  chain() {
    const operations: Array<() => void> = [];

    const runner: any = {
      focus: () => {
        operations.push(() => this.view.focus());
        return runner;
      },
      undo: () => {
        operations.push(() => cmUndo(this.view));
        return runner;
      },
      redo: () => {
        operations.push(() => cmRedo(this.view));
        return runner;
      },
      toggleBold: () => {
        operations.push(() => this.wrapSelection('**'));
        return runner;
      },
      toggleItalic: () => {
        operations.push(() => this.wrapSelection('*'));
        return runner;
      },
      toggleStrike: () => {
        operations.push(() => this.wrapSelection('~~'));
        return runner;
      },
      toggleCode: () => {
        operations.push(() => this.wrapSelection('`'));
        return runner;
      },
      toggleHeading: (opts: { level: number }) => {
        operations.push(() => this.toggleHeading(opts?.level || 1));
        return runner;
      },
      toggleBulletList: () => {
        operations.push(() => this.toggleLinePrefix('- '));
        return runner;
      },
      toggleOrderedList: () => {
        operations.push(() => this.toggleLinePrefix('1. '));
        return runner;
      },
      toggleTaskList: () => {
        operations.push(() => this.toggleLinePrefix('- [ ] '));
        return runner;
      },
      toggleBlockquote: () => {
        operations.push(() => this.toggleLinePrefix('> '));
        return runner;
      },
      setHorizontalRule: () => {
        operations.push(() => this.insertHorizontalRule());
        return runner;
      },
      toggleCodeBlock: () => {
        operations.push(() => this.insertCodeBlock());
        return runner;
      },
      insertTable: () => {
        operations.push(() => this.insertTable());
        return runner;
      },
      insertContent: (content: any) => {
        operations.push(() => {
          if (typeof content === 'string') {
            this.insertString(content);
          } else if (content?.type === 'mathBlock') {
            const latex = content.attrs?.latex || 'E = mc^2';
            this.insertString(`$$\n${latex}\n$$\n`);
          } else if (content?.type === 'mermaidBlock') {
            const src = content.attrs?.source || 'flowchart TD\n    A[Start] --> B[Finish]';
            this.insertString(`\`\`\`mermaid\n${src}\n\`\`\`\n`);
          } else if (content?.type === 'wikiLink') {
            const target = content.attrs?.target || 'guides/intro.md';
            const label = content.attrs?.label || target;
            this.insertString(`[[${target}|${label}]]`);
          }
        });
        return runner;
      },
      deleteRange: (range: { from: number; to: number }) => {
        operations.push(() => {
          this.view.dispatch({
            changes: { from: range.from, to: range.to, insert: '' },
          });
        });
        return runner;
      },
      insertContentAt: (pos: number, content: string) => {
        operations.push(() => {
          this.view.dispatch({
            changes: { from: pos, insert: content },
          });
        });
        return runner;
      },
      run: () => {
        for (const op of operations) {
          op();
        }
        this.notifySelectionUpdate();
        return true;
      },
    };

    return runner;
  }

  private insertString(str: string) {
    const sel = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: str },
      selection: { anchor: sel.from + str.length },
    });
    this.view.focus();
  }

  wrapSelection(prefix: string, suffix: string = prefix) {
    const sel = this.view.state.selection.main;
    const from = sel.from;
    const to = sel.to;
    const selected = this.view.state.doc.sliceString(from, to);

    const pLen = prefix.length;
    const sLen = suffix.length;
    if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= pLen + sLen) {
      const unwrapped = selected.slice(pLen, selected.length - sLen);
      this.view.dispatch({
        changes: { from, to, insert: unwrapped },
        selection: { anchor: from, head: from + unwrapped.length },
      });
      return;
    }

    const inserted = `${prefix}${selected || 'text'}${suffix}`;
    this.view.dispatch({
      changes: { from, to, insert: inserted },
      selection: { anchor: from + pLen, head: to + pLen },
    });
    this.view.focus();
  }

  toggleHeading(level: number) {
    const sel = this.view.state.selection.main;
    const line = this.view.state.doc.lineAt(sel.from);
    const lineText = line.text;
    const prefix = '#'.repeat(level) + ' ';

    if (lineText.startsWith(prefix)) {
      this.view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
      });
      return;
    }

    const existingMatch = /^(#{1,6}\s+)/.exec(lineText);
    if (existingMatch) {
      this.view.dispatch({
        changes: { from: line.from, to: line.from + existingMatch[1].length, insert: prefix },
      });
      return;
    }

    this.view.dispatch({
      changes: { from: line.from, insert: prefix },
    });
    this.view.focus();
  }

  insertHorizontalRule() {
    const sel = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from: sel.from, insert: '\n---\n' },
    });
    this.view.focus();
  }

  insertCodeBlock(language: string = 'typescript') {
    const sel = this.view.state.selection.main;
    const selected = this.view.state.doc.sliceString(sel.from, sel.to) || '// code';
    const block = `\`\`\`${language}\n${selected}\n\`\`\`\n`;
    this.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: block },
    });
    this.view.focus();
  }

  insertTable() {
    const sel = this.view.state.selection.main;
    const table = `\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n\n`;
    this.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: table },
    });
    this.view.focus();
  }

  private toggleLinePrefix(prefix: string) {
    const sel = this.view.state.selection.main;
    const line = this.view.state.doc.lineAt(sel.from);
    if (line.text.startsWith(prefix)) {
      this.view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
      });
    } else {
      this.view.dispatch({
        changes: { from: line.from, insert: prefix },
      });
    }
    this.view.focus();
  }
}
