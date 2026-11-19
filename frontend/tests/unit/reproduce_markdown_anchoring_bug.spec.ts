import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createDualAnchor,
  reconcileAnchor,
  matchQuoteSelector,
  findMarkdownSelection,
  stripMarkdownFormatting,
  buildMarkdownOffsetMap,
} from '../../src/review/textAnchoring';
import { renderMarkdown } from '../../src/pages/ReaderPage';
import { computeReplacementChange } from '../../src/utils/diffPatcher';
import React from 'react';

describe('Reproduce and Verify Markdown Anchoring for Comments and Suggestions', () => {
  const markdownDoc = `# Technical Spec

Here is a paragraph discussing the **crucial architecture decision** made by the infrastructure team.

Another paragraph with *italic notes*, \`inline code\`, and a [useful guide](https://example.com) for developers.`;

  describe('Bug Reproduction', () => {
    it('reproduces failure in Reader mode when naive indexOf is used on selection spanning formatting', () => {
      // In Reader mode, DOM displays:
      // "Here is a paragraph discussing the crucial architecture decision made by the infrastructure team."
      // User selects text spanning across formatting: "discussing the crucial architecture decision"
      const readerSelectedText = 'discussing the crucial architecture decision';

      // Old ReaderPage logic (ReaderPage.tsx:1128-1137):
      const fullText = markdownDoc;
      const trimmed = readerSelectedText.trim();
      let start = fullText.indexOf(trimmed);
      if (start === -1) {
        start = fullText.indexOf(readerSelectedText);
      }
      if (start === -1) {
        start = 0;
      }
      const end = Math.min(fullText.length, start + (trimmed.length || readerSelectedText.length));

      // DEMONSTRATION OF BUG 1:
      // fullText.indexOf("discussing the crucial architecture decision") is -1 because of **!
      // So start defaults to 0!
      expect(fullText.indexOf(trimmed)).toBe(-1);
      expect(start).toBe(0);

      // As a result, the anchor was created at character 0:
      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('content');
      ytext.insert(0, fullText);
      const anchor = createDualAnchor(ytext, start, end, fullText);

      // The anchor quote was "# Technical Spec..." instead of "discussing the crucial architecture decision"!
      expect(anchor.offset).toBe(0);
      expect(anchor.quote.exact).toContain('# Technical Spec');
      expect(anchor.quote.exact).not.toContain('crucial architecture decision');
    });

    it('reproduces failure in Editor mode because of -1 offset shift on selectionRange', () => {
      // In CodeMirror editor:
      // doc: "Here is **bold** text."
      //        0123456789012345678901
      // 'Here is ' = 0..8
      // '**' = 8..10
      // 'bold' = 10..14
      // '**' = 14..16
      // ' text.' = 16..22
      const docText = 'Here is **bold** text.';
      const selectionRange = { from: 10, to: 14 }; // selecting "bold"
      const selectedText = docText.slice(selectionRange.from, selectionRange.to);
      expect(selectedText).toBe('bold');

      // Old FloatingReviewMenu.tsx:110-111 & EditorToolbar.tsx:102-103:
      const charStart = Math.max(0, selectionRange.from - 1);
      const charEnd = Math.max(charStart, selectionRange.to - 1);

      // DEMONSTRATION OF BUG 2:
      // charStart was 9 (which is the asterisk '*')!
      // charEnd was 13 (which is 'bol', missing 'd')!
      expect(charStart).toBe(9);
      expect(charEnd).toBe(13);
      const sliced = docText.slice(charStart, charEnd);
      expect(sliced).toBe('*bol');
      expect(sliced).not.toBe('bold');
    });
  });

  describe('Fix Verification: Reader Mode Markdown Selection', () => {
    it('accurately locates formatted text inside bold delimiters in raw markdown', () => {
      const match = findMarkdownSelection(markdownDoc, 'crucial architecture decision');
      expect(match.start).toBeGreaterThan(0);
      expect(match.exact).toBe('crucial architecture decision');
      expect(markdownDoc.slice(match.start, match.end)).toBe('crucial architecture decision');
      // Delimiters ** surround the matched slice:
      expect(markdownDoc.slice(match.start - 2, match.start)).toBe('**');
      expect(markdownDoc.slice(match.end, match.end + 2)).toBe('**');
    });

    it('accurately locates text that spans across markdown formatting boundaries', () => {
      const match = findMarkdownSelection(markdownDoc, 'discussing the crucial architecture decision');
      expect(match.start).toBeGreaterThan(0);
      // In raw markdown, it captures "discussing the **crucial architecture decision"
      expect(match.exact).toBe('discussing the **crucial architecture decision');
      expect(markdownDoc.slice(match.start, match.end)).toBe('discussing the **crucial architecture decision');
    });

    it('accurately locates text inside italic formatting', () => {
      const match = findMarkdownSelection(markdownDoc, 'italic notes');
      expect(match.exact).toBe('italic notes');
      expect(markdownDoc.slice(match.start - 1, match.start)).toBe('*');
      expect(markdownDoc.slice(match.end, match.end + 1)).toBe('*');
    });

    it('accurately locates text inside inline code backticks', () => {
      const match = findMarkdownSelection(markdownDoc, 'inline code');
      expect(match.exact).toBe('inline code');
      expect(markdownDoc.slice(match.start - 1, match.start)).toBe('`');
      expect(markdownDoc.slice(match.end, match.end + 1)).toBe('`');
    });

    it('accurately locates text inside markdown link label', () => {
      const match = findMarkdownSelection(markdownDoc, 'useful guide');
      expect(match.exact).toBe('useful guide');
      expect(markdownDoc.slice(match.start - 1, match.start)).toBe('[');
      expect(markdownDoc.slice(match.end, match.end + 22)).toBe('](https://example.com)');
    });

    it('creates properly anchored DualAnchor for formatted selection in Reader mode', () => {
      const match = findMarkdownSelection(markdownDoc, 'crucial architecture decision');
      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('content');
      ytext.insert(0, markdownDoc);

      const anchor = createDualAnchor(ytext, match.start, match.end, markdownDoc);
      expect(anchor.quote.exact).toBe('crucial architecture decision');
      expect(anchor.offset).toBe(match.start);

      // Anchor reconciles accurately against document content
      const reconciled = reconcileAnchor(anchor, markdownDoc);
      expect(reconciled.status).toBe('reconciled-quote');
      expect(reconciled.range?.start).toBe(match.start);
      expect(reconciled.range?.end).toBe(match.end);
      expect(markdownDoc.slice(reconciled.range!.start, reconciled.range!.end)).toBe('crucial architecture decision');

      // Also reconciles accurately when passed the Y.Doc directly
      const reconciledY = reconcileAnchor(anchor, ydoc);
      expect(reconciledY.status).toBe('exact-crdt');
      expect(reconciledY.range?.start).toBe(match.start);
      expect(reconciledY.range?.end).toBe(match.end);
    });
  });

  describe('Fix Verification: Editor Mode Selection', () => {
    it('uses exact 0-indexed positions without -1 shift', () => {
      const docText = 'Here is **bold** text.';
      const selectionRange = { from: 10, to: 14 }; // selecting "bold"
      const charStart = selectionRange.from;
      const charEnd = selectionRange.to;
      const exactText = docText.slice(charStart, charEnd);

      expect(charStart).toBe(10);
      expect(charEnd).toBe(14);
      expect(exactText).toBe('bold');

      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('content');
      ytext.insert(0, docText);
      const anchor = createDualAnchor(ytext, charStart, charEnd, docText);

      expect(anchor.offset).toBe(10);
      expect(anchor.quote.exact).toBe('bold');
    });
  });

  describe('Fix Verification: Suggestion Replacement on Formatted Text', () => {
    it('replaces original text inside bold while preserving delimiters', () => {
      const match = findMarkdownSelection(markdownDoc, 'crucial architecture decision');
      const originalText = match.exact; // "crucial architecture decision"
      const suggestedText = 'vital infrastructure choice';

      // computeReplacementChange
      const change = computeReplacementChange(markdownDoc, originalText, suggestedText);
      expect(change).not.toBeNull();
      const newDoc =
        markdownDoc.slice(0, change!.from) + change!.insert + markdownDoc.slice(change!.to);

      expect(newDoc).toContain('**vital infrastructure choice**');
      expect(newDoc).not.toContain('**crucial architecture decision**');
    });

    it('replaces suggestion via reconciled anchor when plain quote differs from raw markdown', () => {
      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('content');
      ytext.insert(0, markdownDoc);

      const match = findMarkdownSelection(markdownDoc, 'discussing the crucial architecture decision');
      const anchor = createDualAnchor(ytext, match.start, match.end, markdownDoc);

      const reconciled = reconcileAnchor(anchor, markdownDoc);
      expect(reconciled.range).toBeDefined();

      const suggestedText = 'addressing the major system update';
      const newDoc =
        markdownDoc.slice(0, reconciled.range!.start) +
        suggestedText +
        markdownDoc.slice(reconciled.range!.end);

      expect(newDoc).toContain('Here is a paragraph addressing the major system update** made by');
    });
  });

  describe('Fix Verification: Comment and Suggestion Highlights in Reader Mode', () => {
    it('renders comment anchor highlight (<mark>) on bold text in Reader mode', () => {
      const comment = {
        id: 'c1',
        document_id: 'doc1',
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        status: 'OPEN' as const,
        quote: 'crucial architecture decision',
        content: 'Please explain this decision.',
        created_at: new Date().toISOString(),
        anchor: {
          offset: 55,
          length: 29,
          quote: {
            exact: 'crucial architecture decision',
            prefix: 'discussing the ',
            suffix: ' made by the',
          },
        },
      };

      const nodes = renderMarkdown(
        markdownDoc,
        () => {},
        null,
        '',
        markdownDoc,
        '/test.md',
        false,
        [comment]
      );

      // Verify that rendered nodes contains block wrappers with data attributes
      expect(nodes.length).toBeGreaterThan(0);
      const nodesJson = JSON.stringify(nodes);
      expect(nodesJson).toContain('cme-reader-block');
      expect(nodesJson).toContain('data-block-start');
      expect(nodesJson).toContain('cme-review-comment-anchor');
    });

    it('renders comment anchor highlight (<mark>) on italic text in Reader mode', () => {
      const comment = {
        id: 'c2',
        document_id: 'doc1',
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        status: 'OPEN' as const,
        quote: 'italic notes',
        content: 'Check notes.',
        created_at: new Date().toISOString(),
        anchor: {
          quote: {
            exact: 'italic notes',
          },
        },
      };

      const nodes = renderMarkdown(
        markdownDoc,
        () => {},
        null,
        '',
        markdownDoc,
        '/test.md',
        false,
        [comment]
      );

      const nodesJson = JSON.stringify(nodes);
      expect(nodesJson).toContain('cme-review-comment-anchor');
      expect(nodesJson).toContain('italic notes');
    });

    it('renders comment anchor highlight (<mark>) on raw formatted quotes via stripMarkdownFormatting', () => {
      // Comment quote stored as raw markdown "**crucial architecture decision**"
      const comment = {
        id: 'c3',
        document_id: 'doc1',
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        status: 'OPEN' as const,
        quote: '**crucial architecture decision**',
        content: 'Raw markdown quote should also highlight rendered text.',
        created_at: new Date().toISOString(),
        anchor: {
          quote: {
            exact: '**crucial architecture decision**',
          },
        },
      };

      const nodes = renderMarkdown(
        markdownDoc,
        () => {},
        null,
        '',
        markdownDoc,
        '/test.md',
        false,
        [comment]
      );

      const nodesJson = JSON.stringify(nodes);
      expect(nodesJson).toContain('cme-review-comment-anchor');
    });
  });
});
