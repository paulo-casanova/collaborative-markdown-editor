import { describe, it, expect } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  computeOrderedListRenumberingChanges,
  indentListCommand,
  outdentListCommand,
  continueListCommand,
  LIST_ITEM_REGEX,
  EMPTY_LIST_ITEM_REGEX,
} from '../../src/components/editor/CollaborativeEditor';
import {
  toAlpha,
  toRoman,
  ListMarkerWidget,
} from '../../src/components/editor/codemirror/livePreviewWidgets';
import { buildLivePreviewDecorations } from '../../src/components/editor/codemirror/livePreviewPlugin';
import { renderMarkdown } from '../../src/pages/ReaderPage';

describe('Nested List Indentation, Outdentation, and Marker Formatting', () => {
  function createView(docText: string, selAnchor: number, selHead: number = selAnchor) {
    let state = EditorState.create({
      doc: docText,
      selection: { anchor: selAnchor, head: selHead },
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: any) {
        state = state.update(tr).state;
      },
    } as unknown as EditorView;
    return {
      view,
      get state() {
        return state;
      },
      get doc() {
        return state.doc.toString();
      },
      get cursor() {
        return state.selection.main.head;
      },
    };
  }

  describe('toAlpha and toRoman numbering conversions', () => {
    it('converts integers to lower-alpha characters', () => {
      expect(toAlpha(1)).toBe('a');
      expect(toAlpha(2)).toBe('b');
      expect(toAlpha(3)).toBe('c');
      expect(toAlpha(26)).toBe('z');
      expect(toAlpha(27)).toBe('aa');
    });

    it('converts integers to lower-roman numerals', () => {
      expect(toRoman(1)).toBe('i');
      expect(toRoman(2)).toBe('ii');
      expect(toRoman(3)).toBe('iii');
      expect(toRoman(4)).toBe('iv');
      expect(toRoman(5)).toBe('v');
      expect(toRoman(9)).toBe('ix');
      expect(toRoman(10)).toBe('x');
      expect(toRoman(14)).toBe('xiv');
    });
  });

  describe('computeOrderedListRenumberingChanges across multiple levels', () => {
    it('renumbers nested lists at level 1 starting at 1', () => {
      const doc = Text.of([
        '1. Parent 1',
        '  3. Child 1',
        '  5. Child 2',
        '4. Parent 2',
      ]);
      const changes = computeOrderedListRenumberingChanges(doc);
      expect(changes.length).toBe(3);
      expect(changes[0].insert).toBe('1'); // Child 1
      expect(changes[1].insert).toBe('2'); // Child 2
      expect(changes[2].insert).toBe('2'); // Parent 2
    });

    it('renumbers multiple levels of nesting cleanly', () => {
      const doc = Text.of([
        '1. Top 1',
        '  1. Sub 1',
        '    4. SubSub 1',
        '    5. SubSub 2',
        '  2. Sub 2',
        '2. Top 2',
      ]);
      const changes = computeOrderedListRenumberingChanges(doc);
      expect(changes.length).toBe(2);
      expect(changes[0].insert).toBe('1'); // SubSub 1
      expect(changes[1].insert).toBe('2'); // SubSub 2
    });
  });

  describe('indentListCommand (Tab)', () => {
    it('indents an ordered list item by 2 spaces and renumbers atomically', () => {
      // "1. First\n2. Second\n3. Third"
      // Cursor on line 2: '2. Second' (pos 14 is right after 'Second')
      const ctx = createView('1. First\n2. Second\n3. Third', 14);
      const handled = indentListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. First\n  1. Second\n2. Third');
      expect(ctx.cursor).toBe(16);
    });

    it('indents multi-line selections of list items', () => {
      // Select lines 2 and 3
      const text = '1. First\n2. Second\n3. Third\n4. Fourth';
      const from = 9; // start of line 2
      const to = text.length; // end of line 4
      const ctx = createView(text, from, to);
      const handled = indentListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. First\n  1. Second\n  2. Third\n  3. Fourth');
    });

    it('returns false when cursor is on a non-list line', () => {
      const ctx = createView('Hello world', 5);
      const handled = indentListCommand(ctx.view);
      expect(handled).toBe(false);
      expect(ctx.doc).toBe('Hello world');
    });
  });

  describe('outdentListCommand (Shift-Tab)', () => {
    it('outdents an indented list item by 2 spaces and updates parent numbering', () => {
      const ctx = createView('1. First\n  1. Second\n2. Third', 16);
      const handled = outdentListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. First\n2. Second\n3. Third');
      expect(ctx.cursor).toBe(14);
    });

    it('outdents an unindented list item with text by unwrapping marker and renumbering', () => {
      const ctx = createView('1. First\n2. Second\n3. Third', 14);
      const handled = outdentListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. First\nSecond\n1. Third');
    });

    it('outdents an unindented empty list item by deleting the marker completely', () => {
      const ctx = createView('1. First\n2. ', 12);
      const handled = outdentListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. First\n');
    });

    it('returns false when cursor is on a non-list line', () => {
      const ctx = createView('Some paragraph', 4);
      const handled = outdentListCommand(ctx.view);
      expect(handled).toBe(false);
      expect(ctx.doc).toBe('Some paragraph');
    });
  });

  describe('continueListCommand (Enter on list items)', () => {
    it('continues a level 1 numbered list on Enter', () => {
      const ctx = createView('1. Item 1', 9);
      const handled = continueListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. Item 1\n2. ');
      expect(ctx.cursor).toBe(13);
    });

    it('continues a level 2 numbered list on Enter', () => {
      const text = '1. Item 1\n  1. Item 2';
      const ctx = createView(text, text.length);
      const handled = continueListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. Item 1\n  1. Item 2\n  2. ');
    });

    it('continues a level 3 numbered list on Enter with next number added', () => {
      const text = '1. Item 1\n  1. Item 2\n    1. Item 3';
      const ctx = createView(text, text.length);
      const handled = continueListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. Item 1\n  1. Item 2\n    1. Item 3\n    2. ');
      expect(ctx.cursor).toBe(text.length + '\n    2. '.length);
    });

    it('continues a level 3 task list on Enter with unchecked box', () => {
      const text = '1. Item 1\n  1. Item 2\n    1. [x] Item 3';
      const ctx = createView(text, text.length);
      const handled = continueListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. Item 1\n  1. Item 2\n    1. [x] Item 3\n    2. [ ] ');
    });

    it('continues an unordered list on Enter with identical bullet', () => {
      const text = '1. Item 1\n  1. Item 2\n    - Sub item';
      const ctx = createView(text, text.length);
      const handled = continueListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. Item 1\n  1. Item 2\n    - Sub item\n    - ');
    });

    it('renumbers subsequent items when Enter is pressed in between items', () => {
      const text = '1. Item 1\n  1. Item 2\n    1. Item 3\n    2. Item 4';
      const enterPos = '1. Item 1\n  1. Item 2\n    1. Item 3'.length;
      const ctx = createView(text, enterPos);
      const handled = continueListCommand(ctx.view);
      expect(handled).toBe(true);
      expect(ctx.doc).toBe('1. Item 1\n  1. Item 2\n    1. Item 3\n    2. \n    3. Item 4');
    });

    it('returns false when cursor is on a non-list line', () => {
      const ctx = createView('Just text', 9);
      const handled = continueListCommand(ctx.view);
      expect(handled).toBe(false);
      expect(ctx.doc).toBe('Just text');
    });
  });

  describe('Live Preview Hierarchical Markers', () => {
    it('decorates level 1 nested ordered lists with lower-alpha markers when cursor is not on line', () => {
      const md = '1. First parent\n  1. First child\n  2. Second child\n2. Second parent';
      // Place cursor at pos 0 (on line 1)
      const state = EditorState.create({
        doc: md,
        selection: { anchor: 0 },
      });
      const decos = buildLivePreviewDecorations(state, false, '', true);

      // Find widgets created for markers
      const widgets: any[] = [];
      const iter = decos.iter();
      while (iter.value) {
        if (iter.value.spec?.widget instanceof ListMarkerWidget) {
          widgets.push(iter.value.spec.widget);
        }
        iter.next();
      }

      expect(widgets.length).toBe(2);
      expect(widgets[0].marker).toBe('a.');
      expect(widgets[1].marker).toBe('b.');
    });

    it('decorates level 2 nested ordered lists with lower-roman markers', () => {
      const md = '1. Parent\n  1. Child\n    1. Grandchild 1\n    2. Grandchild 2';
      const state = EditorState.create({
        doc: md,
        selection: { anchor: 0 },
      });
      const decos = buildLivePreviewDecorations(state, false, '', true);

      const widgets: any[] = [];
      const iter = decos.iter();
      while (iter.value) {
        if (iter.value.spec?.widget instanceof ListMarkerWidget) {
          widgets.push(iter.value.spec.widget);
        }
        iter.next();
      }

      expect(widgets.length).toBe(3);
      expect(widgets[0].marker).toBe('a.');
      expect(widgets[1].marker).toBe('i.');
      expect(widgets[2].marker).toBe('ii.');
    });

    it('reveals raw markdown marker when cursor is on that line', () => {
      const md = '1. Parent\n  1. Child';
      // Cursor on line 2 (pos 15: '  1. Child')
      const state = EditorState.create({
        doc: md,
        selection: { anchor: 15 },
      });
      const decos = buildLivePreviewDecorations(state, false, '', true);

      const widgets: any[] = [];
      const iter = decos.iter();
      while (iter.value) {
        if (iter.value.spec?.widget instanceof ListMarkerWidget) {
          widgets.push(iter.value.spec.widget);
        }
        iter.next();
      }

      // Because cursor is on line 2, line 2 should reveal raw '  1.' and NOT have ListMarkerWidget
      expect(widgets.length).toBe(0);
    });
  });

  describe('ReaderPage Markdown Rendering of Nested Lists', () => {
    it('renders level 0 with decimal and level 1 with lower-alpha in Reader mode', () => {
      const md = '1. First item\n  1. First nested\n  2. Second nested\n2. Second item';
      const elements = renderMarkdown(md) as any[];

      const listItems = elements.filter((el) => el.type === 'li');
      expect(listItems.length).toBe(4);

      // Level 0
      expect(listItems[0].props['data-level']).toBe(0);
      expect(listItems[0].props.style.listStyleType).toBe('decimal');

      // Level 1
      expect(listItems[1].props['data-level']).toBe(1);
      expect(listItems[1].props.style.listStyleType).toBe('lower-alpha');

      expect(listItems[2].props['data-level']).toBe(1);
      expect(listItems[2].props.style.listStyleType).toBe('lower-alpha');

      // Back to level 0
      expect(listItems[3].props['data-level']).toBe(0);
      expect(listItems[3].props.style.listStyleType).toBe('decimal');
    });

    it('renders level 2 with lower-roman in Reader mode', () => {
      const md = '1. Parent\n  1. Child\n    1. Grandchild';
      const elements = renderMarkdown(md) as any[];

      const listItems = elements.filter((el) => el.type === 'li');
      expect(listItems.length).toBe(3);

      expect(listItems[2].props['data-level']).toBe(2);
      expect(listItems[2].props.style.listStyleType).toBe('lower-roman');
    });
  });
});
