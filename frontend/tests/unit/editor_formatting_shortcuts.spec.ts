import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { CodeMirrorEditorAdapter } from '../../src/components/editor/codemirror/editorAdapter';

describe('Issue #18: Editor formatting & keyboard shortcuts (wrapSelection)', () => {
  function createAdapter(docText: string, selFrom: number, selTo: number = selFrom) {
    let state = EditorState.create({
      doc: docText,
      selection: { anchor: selFrom, head: selTo },
    });
    const view = {
      get state() {
        return state;
      },
      dispatch: (tr: any) => {
        state = state.update(tr).state;
      },
      focus: () => {},
    } as unknown as EditorView;

    return {
      adapter: new CodeMirrorEditorAdapter(view),
      get state() {
        return state;
      },
    };
  }

  it('wraps selected text with bold (**)', () => {
    const ctx = createAdapter('hello world', 0, 5);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('**hello** world');
    expect(ctx.state.selection.main.from).toBe(2);
    expect(ctx.state.selection.main.to).toBe(7);
  });

  it('unwraps bold text when selection contains markdown markers', () => {
    const ctx = createAdapter('**hello** world', 0, 9);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('hello world');
    expect(ctx.state.selection.main.from).toBe(0);
    expect(ctx.state.selection.main.to).toBe(5);
  });

  it('unwraps bold text when selection is inside outer markers (**hello**)', () => {
    const ctx = createAdapter('**hello** world', 2, 7);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('hello world');
    expect(ctx.state.selection.main.from).toBe(0);
    expect(ctx.state.selection.main.to).toBe(5);
  });

  it('auto-expands to word under cursor when nothing is selected', () => {
    const ctx = createAdapter('hello world', 2, 2);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('**hello** world');
    expect(ctx.state.selection.main.from).toBe(2);
    expect(ctx.state.selection.main.to).toBe(7);
  });

  it('unwraps word under cursor when cursor is inside bold word', () => {
    const ctx = createAdapter('**hello** world', 4, 4);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('hello world');
    expect(ctx.state.selection.main.from).toBe(0);
    expect(ctx.state.selection.main.to).toBe(5);
  });

  it('inserts empty markers (****) and centers cursor when on whitespace/empty document', () => {
    const ctx = createAdapter('', 0, 0);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('****');
    expect(ctx.state.selection.main.from).toBe(2);
    expect(ctx.state.selection.main.to).toBe(2);
  });

  it('collapses/deletes markers when cursor is directly between markers (**|**)', () => {
    const ctx = createAdapter('****', 2, 2);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('');
    expect(ctx.state.selection.main.from).toBe(0);
    expect(ctx.state.selection.main.to).toBe(0);
  });

  it('toggles italic (*) on word without stripping bold (**)', () => {
    const ctx = createAdapter('**hello** world', 4, 4);
    ctx.adapter.wrapSelection('*');
    expect(ctx.state.doc.toString()).toBe('***hello*** world');
    expect(ctx.state.selection.main.from).toBe(3);
    expect(ctx.state.selection.main.to).toBe(8);
  });

  it('unwraps italic (*) on italic word (*hello*)', () => {
    const ctx = createAdapter('*hello* world', 3, 3);
    ctx.adapter.wrapSelection('*');
    expect(ctx.state.doc.toString()).toBe('hello world');
    expect(ctx.state.selection.main.from).toBe(0);
    expect(ctx.state.selection.main.to).toBe(5);
  });

  it('supports alternate markdown markers (__ and _)', () => {
    const ctx = createAdapter('__hello__ world', 4, 4);
    ctx.adapter.wrapSelection('**');
    expect(ctx.state.doc.toString()).toBe('hello world');
  });
});
