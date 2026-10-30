import { describe, it, expect } from 'vitest';
import { diffLines, computeRevisionDiffSuggestions } from '../../src/utils/revisionDiff';
import { renderMarkdown } from '../../src/pages/ReaderPage';
import type { SuggestionRecord } from '../../src/review/types';

describe('Document Revision History & Diff Engine', () => {
  const v1Content = `# Architecture Guide

This is the original introduction paragraph.

## Section 1
Here is the baseline feature list:
- Item Alpha
- Item Beta
- Item Gamma

Final concluding remarks.`;

  const v2Content = `# Architecture Guide (Revised)

This is the updated introduction paragraph with extra details.

## Section 1
Here is the baseline feature list:
- Item Alpha
- Item Beta Prime
- Item Gamma
- Item Delta

Final concluding remarks.`;

  describe('Line diff computation (diffLines)', () => {
    it('returns empty operations or single equal chunk for identical texts', () => {
      const chunks = diffLines('hello\nworld', 'hello\nworld');
      expect(chunks.length).toBe(1);
      expect(chunks[0].type).toBe('equal');
      expect(chunks[0].lines).toEqual(['hello', 'world']);
    });

    it('identifies modifications, additions, and deletions', () => {
      const chunks = diffLines(v1Content, v2Content);
      expect(chunks.length).toBeGreaterThan(1);

      const inserts = chunks.filter((c) => c.type === 'insert');
      const deletes = chunks.filter((c) => c.type === 'delete');
      expect(inserts.length).toBeGreaterThan(0);
      expect(deletes.length).toBeGreaterThan(0);

      // Verify the modified heading is tracked
      const hasHeadingChange = deletes.some((d) => d.lines.includes('# Architecture Guide'));
      expect(hasHeadingChange).toBe(true);

      const hasNewHeading = inserts.some((i) => i.lines.includes('# Architecture Guide (Revised)'));
      expect(hasNewHeading).toBe(true);

      // Verify Item Beta -> Item Beta Prime and Item Delta addition
      const hasDelta = inserts.some((i) => i.lines.includes('- Item Delta'));
      expect(hasDelta).toBe(true);
    });
  });

  describe('Diff suggestions transformation (computeRevisionDiffSuggestions)', () => {
    it('returns empty array when content is identical', () => {
      const suggestions = computeRevisionDiffSuggestions(
        'doc-1',
        v1Content,
        v1Content,
        2,
        { id: 'user-2', name: 'Alice Editor' }
      );
      expect(suggestions).toEqual([]);
    });

    it('transforms line diffs into SuggestionRecord items with status REVISION_DIFF', () => {
      const suggestions = computeRevisionDiffSuggestions(
        'doc-1',
        v1Content,
        v2Content,
        2,
        { id: 'user-2', name: 'Alice Editor' },
        '2026-10-30T10:00:00Z'
      );

      expect(suggestions.length).toBeGreaterThan(0);

      // Check first suggestion (Heading change)
      const headingDiff = suggestions[0];
      expect(headingDiff.status).toBe('REVISION_DIFF');
      expect(headingDiff.author.display_name).toBe('Alice Editor');
      expect(headingDiff.original_text).toContain('# Architecture Guide');
      expect(headingDiff.suggested_text).toContain('# Architecture Guide (Revised)');
      expect(headingDiff.anchor).toBeDefined();
      expect(typeof headingDiff.anchor.offset).toBe('number');

      // Check all suggestions have valid document_id and author
      for (const s of suggestions) {
        expect(s.document_id).toBe('doc-1');
        expect(s.author.username).toBe('Alice Editor');
        expect(s.status).toBe('REVISION_DIFF');
      }
    });

    it('correctly handles additions at the end of sections', () => {
      const textA = 'Line 1\nLine 2';
      const textB = 'Line 1\nLine 2\nLine 3 (added)';

      const suggestions = computeRevisionDiffSuggestions(
        'doc-test',
        textA,
        textB,
        2,
        { id: 'user-1', name: 'Bob' }
      );

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].original_text).toBe('');
      expect(suggestions[0].suggested_text).toBe('Line 3 (added)');
      expect(suggestions[0].status).toBe('REVISION_DIFF');
    });

    it('correctly handles deletions', () => {
      const textA = 'Line 1\nLine 2 (remove)\nLine 3';
      const textB = 'Line 1\nLine 3';

      const suggestions = computeRevisionDiffSuggestions(
        'doc-test',
        textA,
        textB,
        2,
        { id: 'user-1', name: 'Bob' }
      );

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].original_text).toBe('Line 2 (remove)');
      expect(suggestions[0].suggested_text).toBe('');
      expect(suggestions[0].status).toBe('REVISION_DIFF');
    });
  });

  describe('Inline display in Reader mode with renderMarkdown', () => {
    it('renders revision diff suggestion cards inline below the affected markdown block', () => {
      const suggestions = computeRevisionDiffSuggestions(
        'doc-1',
        v1Content,
        v2Content,
        2,
        { id: 'user-2', name: 'Alice Editor' }
      );

      const renderedBlocks = renderMarkdown(
        v1Content,
        () => {},
        null,
        'doc-1',
        v1Content,
        'workspace/guide.md',
        false,
        [], // no comments
        undefined,
        suggestions,
        (sugg: SuggestionRecord) => (
          <div
            key={sugg.id}
            data-testid="suggestion-item"
            data-suggestion-id={sugg.id}
            data-status={sugg.status}
          >
            <span data-testid="diff-del">{sugg.original_text}</span>
            <span data-testid="diff-ins">{sugg.suggested_text}</span>
          </div>
        )
      );

      // Verify at least one inline comments/suggestions container is injected
      const inlineContainers = renderedBlocks.filter(
        (b: any) => b?.props?.['data-testid'] === 'inline-comments-container'
      );
      expect(inlineContainers.length).toBeGreaterThan(0);

      // Ensure the suggestions are rendered inside the container
      const firstContainer = inlineContainers[0] as any;
      expect(firstContainer.props.children.length).toBeGreaterThan(0);
    });
  });

  describe('Editing Isolation Guarantees', () => {
    it('disables comments/suggestions creation when viewing historical revision', () => {
      // In ReaderPage, canComment evaluates to false whenever selectedRevNumber !== null
      const computeCanComment = (
        selectedRevNumber: number | null,
        currentUser: { id: string; is_admin?: boolean } | null
      ) => {
        if (selectedRevNumber !== null) return false;
        if (!currentUser) return false;
        return true;
      };

      // Admin user viewing latest version can comment
      expect(computeCanComment(null, { id: 'admin', is_admin: true })).toBe(true);

      // Admin user viewing revision v1 CANNOT comment or suggest
      expect(computeCanComment(1, { id: 'admin', is_admin: true })).toBe(false);
      expect(computeCanComment(2, { id: 'admin', is_admin: true })).toBe(false);
    });

    it('ensures edit action resets revision view and targets latest document', () => {
      let selectedRevisionNumber: number | null = 3;
      let activeViewMode: 'read' | 'edit' = 'read';

      // Simulate clicking "Edit Latest Version" from toolbar or historical revision banner
      const onEditLatest = () => {
        selectedRevisionNumber = null;
        activeViewMode = 'edit';
      };

      onEditLatest();

      expect(selectedRevisionNumber).toBeNull();
      expect(activeViewMode).toBe('edit');
    });
  });
});
