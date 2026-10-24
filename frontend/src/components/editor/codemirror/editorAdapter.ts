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
    if (type === 'bold') return (selected.startsWith('**') && selected.endsWith('**')) || (selected.startsWith('__') && selected.endsWith('__'));
    if (type === 'italic') return (selected.startsWith('*') && selected.endsWith('*')) || (selected.startsWith('_') && selected.endsWith('_'));
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
    const doc = this.view.state.doc;
    const docStr = doc.toString();

    const altPrefix = prefix === '*' ? '_' : prefix === '_' ? '*' : prefix === '**' ? '__' : prefix === '__' ? '**' : '';
    const altSuffix = suffix === '*' ? '_' : suffix === '_' ? '*' : suffix === '**' ? '__' : suffix === '__' ? '**' : '';

    const isWrappedBy = (text: string, p: string, s: string) => {
      if (!text.startsWith(p) || !text.endsWith(s) || text.length < p.length + s.length) return false;
      if (p === '*' && text.startsWith('**') && !text.startsWith('***')) return false;
      if (p === '_' && text.startsWith('__') && !text.startsWith('___')) return false;
      if (s === '*' && text.endsWith('**') && !text.endsWith('***')) return false;
      if (s === '_' && text.endsWith('__') && !text.endsWith('___')) return false;
      return true;
    };

    const hasOuterMarkers = (f: number, t: number, p: string, s: string) => {
      if (f < p.length || t + s.length > docStr.length) return false;
      const before = docStr.slice(f - p.length, f);
      const after = docStr.slice(t, t + s.length);
      if (before !== p || after !== s) return false;

      if (p === '*') {
        const charBefore = f > 1 ? docStr[f - 2] : '';
        const charAfter = t + 1 < docStr.length ? docStr[t + 1] : '';
        if (charBefore === '*' && (f <= 2 || docStr[f - 3] !== '*')) return false;
        if (charAfter === '*' && (t + 2 >= docStr.length || docStr[t + 2] !== '*')) return false;
      }
      if (p === '_') {
        const charBefore = f > 1 ? docStr[f - 2] : '';
        const charAfter = t + 1 < docStr.length ? docStr[t + 1] : '';
        if (charBefore === '_' && (f <= 2 || docStr[f - 3] !== '_')) return false;
        if (charAfter === '_' && (t + 2 >= docStr.length || docStr[t + 2] !== '_')) return false;
      }
      return true;
    };

    // 1. Direct outer unwrap for current selection (or cursor between markers like **|**)
    for (const [p, s] of [[prefix, suffix], [altPrefix, altSuffix]]) {
      if (p && s && hasOuterMarkers(from, to, p, s)) {
        this.view.dispatch({
          changes: [
            { from: from - p.length, to: from, insert: '' },
            { from: to, to: to + s.length, insert: '' },
          ],
          selection: { anchor: from - p.length, head: to - p.length },
        });
        this.view.focus();
        this.notifySelectionUpdate();
        return;
      }
    }

    // 2. Direct inner unwrap for current selection
    const selected = docStr.slice(from, to);
    for (const [p, s] of [[prefix, suffix], [altPrefix, altSuffix]]) {
      if (p && s && isWrappedBy(selected, p, s)) {
        const unwrapped = selected.slice(p.length, selected.length - s.length);
        this.view.dispatch({
          changes: { from, to, insert: unwrapped },
          selection: { anchor: from, head: from + unwrapped.length },
        });
        this.view.focus();
        this.notifySelectionUpdate();
        return;
      }
    }

    // 3. If empty selection, check for word at cursor
    let targetFrom = from;
    let targetTo = to;
    if (from === to) {
      const word = this.view.state.wordAt(from);
      if (word && word.from < word.to) {
        targetFrom = word.from;
        targetTo = word.to;

        // Check outer markers on expanded word (e.g. **hel|lo**)
        for (const [p, s] of [[prefix, suffix], [altPrefix, altSuffix]]) {
          if (p && s && hasOuterMarkers(targetFrom, targetTo, p, s)) {
            this.view.dispatch({
              changes: [
                { from: targetFrom - p.length, to: targetFrom, insert: '' },
                { from: targetTo, to: targetTo + s.length, insert: '' },
              ],
              selection: { anchor: targetFrom - p.length, head: targetTo - p.length },
            });
            this.view.focus();
            this.notifySelectionUpdate();
            return;
          }
        }

        // Check inner markers on expanded word
        const wordText = docStr.slice(targetFrom, targetTo);
        for (const [p, s] of [[prefix, suffix], [altPrefix, altSuffix]]) {
          if (p && s && isWrappedBy(wordText, p, s)) {
            const unwrapped = wordText.slice(p.length, wordText.length - s.length);
            this.view.dispatch({
              changes: { from: targetFrom, to: targetTo, insert: unwrapped },
              selection: { anchor: targetFrom, head: targetFrom + unwrapped.length },
            });
            this.view.focus();
            this.notifySelectionUpdate();
            return;
          }
        }
      }
    }

    // 4. Wrap target range or insert empty markers with cursor positioned in middle
    const targetText = docStr.slice(targetFrom, targetTo);
    const inserted = `${prefix}${targetText}${suffix}`;
    this.view.dispatch({
      changes: { from: targetFrom, to: targetTo, insert: inserted },
      selection: { anchor: targetFrom + prefix.length, head: targetTo + prefix.length },
    });
    this.view.focus();
    this.notifySelectionUpdate();
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
