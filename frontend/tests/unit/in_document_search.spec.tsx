import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { search } from '@codemirror/search';
import { ReaderFindBar } from '../../src/components/reader/ReaderFindBar';
import { CodeMirrorEditorAdapter } from '../../src/components/editor/codemirror/editorAdapter';
import { EditorToolbar } from '../../src/components/editor/EditorToolbar';

describe('In-Document Search (Find in Document)', () => {
  describe('ReaderFindBar Rendering', () => {
    it('does not render when isOpen is false', () => {
      const html = renderToStaticMarkup(
        <ReaderFindBar
          isOpen={false}
          onClose={() => {}}
          containerRef={{ current: null }}
          contentRootRef={{ current: null }}
        />
      );
      expect(html).toBe('');
    });

    it('renders input, navigation buttons, count badge, options and close button when isOpen is true', () => {
      const html = renderToStaticMarkup(
        <ReaderFindBar
          isOpen={true}
          onClose={() => {}}
          containerRef={{ current: null }}
          contentRootRef={{ current: null }}
        />
      );

      expect(html).toContain('data-testid="reader-find-bar"');
      expect(html).toContain('data-testid="reader-find-input"');
      expect(html).toContain('data-testid="reader-find-prev-btn"');
      expect(html).toContain('data-testid="reader-find-next-btn"');
      expect(html).toContain('data-testid="reader-find-case-btn"');
      expect(html).toContain('data-testid="reader-find-word-btn"');
      expect(html).toContain('data-testid="reader-find-close-btn"');
      expect(html).toContain('Find in document...');
    });
  });

  describe('Search Query Regex and Matching Logic', () => {
    it('escapes special characters and constructs case-insensitive regex by default', () => {
      const query = 'test[item].(foo)?';
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');

      expect(regex.test('Here is a TEST[item].(foo)? inside text')).toBe(true);
      expect(regex.test('Here is another text without match')).toBe(false);
    });

    it('handles case-sensitive matching when enabled', () => {
      const query = 'Markdown';
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const caseInsensitiveRegex = new RegExp(escaped, 'gi');
      const caseSensitiveRegex = new RegExp(escaped, 'g');

      const text = 'markdown in lower, MARKDOWN in upper, Markdown in title';

      const allMatches = text.match(caseInsensitiveRegex);
      expect(allMatches?.length).toBe(3);

      const exactMatches = text.match(caseSensitiveRegex);
      expect(exactMatches?.length).toBe(1);
      expect(exactMatches?.[0]).toBe('Markdown');
    });

    it('handles whole-word boundary matching when enabled', () => {
      const query = 'cat';
      const escaped = `\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
      const regex = new RegExp(escaped, 'gi');

      const text = 'The cat sat on concatenation catalog';
      const matches = text.match(regex);

      expect(matches?.length).toBe(1);
      expect(matches?.[0]).toBe('cat');
    });
  });

  describe('CodeMirrorEditorAdapter Search Integration', () => {
    it('openFind() and closeFind() dispatch search panel commands to view', () => {
      let state = EditorState.create({
        doc: 'sample document text for searching',
        extensions: [search({ top: true })],
      });
      const dispatched: any[] = [];
      const view = {
        get state() {
          return state;
        },
        dispatch: (tr: any) => {
          dispatched.push(tr);
          if (tr.state) {
            state = tr.state;
          } else {
            state = state.update(tr).state;
          }
        },
        focus: vi.fn(),
        plugin: vi.fn().mockReturnValue(null),
      } as unknown as EditorView;

      const adapter = new CodeMirrorEditorAdapter(view);
      expect(typeof adapter.openFind).toBe('function');
      expect(typeof adapter.closeFind).toBe('function');

      adapter.openFind();
      expect(dispatched.length).toBeGreaterThan(0);

      adapter.closeFind();
      expect(view.plugin).toHaveBeenCalled();
    });
  });

  describe('EditorToolbar Find Button', () => {
    it('renders find button with title and testid', () => {
      const mockEditor: any = {
        can: () => ({ undo: () => true, redo: () => true }),
        chain: () => ({
          focus: () => ({
            undo: () => ({ run: vi.fn() }),
            redo: () => ({ run: vi.fn() }),
            toggleHeading: () => ({ run: vi.fn() }),
          }),
        }),
        isActive: () => false,
        on: vi.fn(),
        off: vi.fn(),
        openFind: vi.fn(),
      };

      const html = renderToStaticMarkup(<EditorToolbar editor={mockEditor} />);
      expect(html).toContain('data-testid="toolbar-find-btn"');
      expect(html).toContain('Find in document (Ctrl+F)');
    });
  });
});
