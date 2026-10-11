/**
 * Unit Tests for Dual Text-Anchoring Engine (Step 6.1)
 *
 * Verifies:
 * - Yjs Relative Position calculation for primary anchor coordinates (`anchor`, `head`)
 * - Concurrent text insertion before anchor shifting offset dynamically
 * - W3C Web Annotation quote fallback (`exact`, `prefix`, `suffix`) for external edits
 * - Localized fuzzy matching fallback
 * - Anchor drift reconciliation on document open
 * - Status criteria: anchors comment at offset 100, inserts 50 characters at offset 10,
 *   confirms anchor dynamically updates to offset 150 without losing text reference.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createDualAnchor,
  createQuoteSelector,
  createRelativePosition,
  resolveRelativePosition,
  matchQuoteSelector,
  reconcileAnchor,
  reconcileDocumentReviewItems,
  stringSimilarity,
} from '../../src/review/textAnchoring';
import { DualAnchor, CommentRecord, SuggestionRecord } from '../../src/review/types';

describe('Step 6.1: Dual Text-Anchoring Engine', () => {
  let doc: Y.Doc;
  let text: Y.Text;

  beforeEach(() => {
    doc = new Y.Doc();
    text = doc.getText('content');
  });

  describe('Core Status Criteria Verification', () => {
    it('anchors a comment to character offset 100, inserts 50 characters at offset 10, and confirms anchor dynamically updates to offset 150 without losing text reference', () => {
      // 1. Setup document with initial text of >= 200 characters
      const prefixPadding = 'A'.repeat(100); // 100 characters padding from index 0 to 99
      const annotatedPhrase = 'Conflict-free Replicated Data Types'; // 35 characters
      const suffixPadding = 'Z'.repeat(100); // 100 characters padding after phrase

      const initialDocumentContent = prefixPadding + annotatedPhrase + suffixPadding;
      text.insert(0, initialDocumentContent);

      expect(text.toString().length).toBe(235);
      expect(text.toString().slice(100, 135)).toBe(annotatedPhrase);

      // 2. Create dual anchor for comment at offset 100, length 35
      const anchor: DualAnchor = createDualAnchor(text, 100, 135, initialDocumentContent);

      expect(anchor.type).toBe('dual');
      expect(anchor.offset).toBe(100);
      expect(anchor.length).toBe(35);
      expect(anchor.quote.exact).toBe(annotatedPhrase);
      expect(anchor.quote.prefix.length).toBeGreaterThan(0);
      expect(anchor.quote.suffix.length).toBeGreaterThan(0);
      expect(anchor.yjs?.start).toBeDefined();
      expect(anchor.yjs?.end).toBeDefined();

      // 3. Concurrently insert 50 characters at offset 10
      const insertedDelta = 'X'.repeat(50);
      text.insert(10, insertedDelta);

      // Total document length is now 235 + 50 = 285
      expect(text.toString().length).toBe(285);

      // 4. Reconcile anchor dynamically against updated Y.Doc
      const reconciled = reconcileAnchor(anchor, doc, text);

      // 5. Verify status criteria:
      // - dynamically updates to offset 150
      expect(reconciled.range).not.toBeNull();
      expect(reconciled.range?.start).toBe(150);
      expect(reconciled.range?.end).toBe(185);

      // - drift calculation reflects exact shift
      expect(reconciled.drift).toBe(50);

      // - text reference is preserved without loss
      expect(reconciled.text).toBe(annotatedPhrase);
      expect(text.toString().slice(150, 185)).toBe(annotatedPhrase);

      // - Strategy A CRDT status confirmed
      expect(reconciled.status).toBe('exact-crdt');
      expect(reconciled.confidence).toBe(1.0);

      // - updatedAnchor properties updated to new position
      expect(reconciled.updatedAnchor.offset).toBe(150);
      expect(reconciled.updatedAnchor.length).toBe(35);
    });
  });

  describe('Strategy A: CRDT Relative Position Tracking', () => {
    it('shifts anchor backwards when text is deleted prior to the anchor', () => {
      const initialText = 'P'.repeat(100) + 'CRDT-ANCHORED-SECTION' + 'S'.repeat(50);
      text.insert(0, initialText);

      const phrase = 'CRDT-ANCHORED-SECTION';
      const anchor = createDualAnchor(text, 100, 100 + phrase.length, initialText);

      // Delete 30 characters at offset 20
      text.delete(20, 30);

      const reconciled = reconcileAnchor(anchor, doc, text);
      expect(reconciled.status).toBe('exact-crdt');
      expect(reconciled.range?.start).toBe(70);
      expect(reconciled.range?.end).toBe(70 + phrase.length);
      expect(reconciled.drift).toBe(-30);
      expect(reconciled.text).toBe(phrase);
    });

    it('preserves anchor positions through multi-client peer synchronization', () => {
      const docA = new Y.Doc();
      const textA = docA.getText('content');
      const docB = new Y.Doc();
      const textB = docB.getText('content');

      const baseText = 'Initial documentation line '.repeat(10);
      textA.insert(0, baseText);

      // Sync initial state from A to B
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

      // Client A anchors a comment at offset 50
      const targetPhrase = baseText.slice(50, 80);
      const anchorA = createDualAnchor(textA, 50, 80, textA.toString());

      // Client B concurrently inserts 40 characters at offset 5
      textB.insert(5, '>>>CONCURRENT_EDIT_FROM_PEER_B<<<');

      // Sync delta from Client B to Client A
      const deltaB = Y.encodeStateAsUpdate(docB);
      Y.applyUpdate(docA, deltaB);

      // Reconcile Client A's anchor
      const reconciled = reconcileAnchor(anchorA, docA, textA);
      expect(reconciled.status).toBe('exact-crdt');
      expect(reconciled.range?.start).toBe(50 + '>>>CONCURRENT_EDIT_FROM_PEER_B<<<'.length);
      expect(reconciled.text).toBe(targetPhrase);
    });

    it('expands anchor range when text is inserted directly inside the anchored span', () => {
      const initial = 'Start of line [ORIGINAL_PHRASE] end of line';
      text.insert(0, initial);

      const start = initial.indexOf('[ORIGINAL_PHRASE]');
      const end = start + '[ORIGINAL_PHRASE]'.length;
      const anchor = createDualAnchor(text, start, end, initial);

      // Insert inside phrase: after "[ORIGINAL_"
      const insertPos = start + 10;
      text.insert(insertPos, '_MODIFIED_');

      const reconciled = reconcileAnchor(anchor, doc, text);
      expect(reconciled.status).toBe('exact-crdt');
      expect(reconciled.range?.start).toBe(start);
      expect(reconciled.range?.end).toBe(end + '_MODIFIED_'.length);
      expect(reconciled.text).toBe('[ORIGINAL__MODIFIED_PHRASE]');
    });
  });

  describe('Strategy B: W3C Web Annotation Quote Fallback (External Edits)', () => {
    it('recovers anchor coordinates using exact quote + prefix + suffix when CRDT clocks desynchronize', () => {
      const originalText = 'Section 1: Introduction\n\nThe architecture adopts Conflict-free Replicated Data Types rather than OT.\n\nSection 2: Details';
      const targetExact = 'Conflict-free Replicated Data Types';
      const start = originalText.indexOf(targetExact);
      const end = start + targetExact.length;

      const quote = createQuoteSelector(originalText, start, end, 24);
      expect(quote.exact).toBe(targetExact);
      expect(quote.prefix).toBe('The architecture adopts ');
      expect(quote.suffix).toBe(' rather than OT.\n\nSectio');

      // Simulate external headless edit outside browser (e.g. Git commit or CLI editor)
      // Author prepends 5 new paragraphs at the top of the markdown document
      const externallyModifiedText =
        '# Document Title\n\n' +
        'Author: John Doe\n\n' +
        'Revision: 2.0\n\n' +
        originalText;

      // New Y.Doc loaded from disk without previous CRDT history (clocks reset)
      const freshDoc = new Y.Doc();
      const freshText = freshDoc.getText('content');
      freshText.insert(0, externallyModifiedText);

      // Old anchor with invalidated clock IDs
      const detachedAnchor: DualAnchor = {
        type: 'dual',
        start: { client: 999999, clock: 1 }, // Invalid clock ID
        end: { client: 999999, clock: 2 },
        yjs: {
          start: { client: 999999, clock: 1 },
          end: { client: 999999, clock: 2 },
        },
        quote,
        offset: start,
        length: targetExact.length,
      };

      // Reconcile: Strategy A fails, Strategy B recovers
      const reconciled = reconcileAnchor(detachedAnchor, freshDoc, freshText);

      expect(reconciled.status).toBe('reconciled-quote');
      expect(reconciled.confidence).toBeGreaterThanOrEqual(0.95);
      expect(reconciled.text).toBe(targetExact);
      expect(reconciled.range?.start).toBe(externallyModifiedText.indexOf(targetExact));
      expect(reconciled.range?.end).toBe(externallyModifiedText.indexOf(targetExact) + targetExact.length);

      // Confirm fresh relative positions were created in updatedAnchor
      expect(reconciled.updatedAnchor.offset).toBe(reconciled.range?.start);
      expect(reconciled.updatedAnchor.yjs?.start).toBeDefined();
    });

    it('disambiguates recurring phrases using surrounding context prefix/suffix', () => {
      const textWithDuplicates =
        'First appearance: NOTE_TOKEN in section A.\n' +
        'Second appearance: NOTE_TOKEN in section B.\n' +
        'Third appearance: NOTE_TOKEN in section C.\n';

      // Anchor specifically targets the second appearance
      const targetPos = textWithDuplicates.indexOf('Second appearance: NOTE_TOKEN') + 'Second appearance: '.length;
      const quote = createQuoteSelector(textWithDuplicates, targetPos, targetPos + 'NOTE_TOKEN'.length, 20);

      const match = matchQuoteSelector(textWithDuplicates, quote, targetPos);
      expect(match).not.toBeNull();
      expect(match?.start).toBe(targetPos);
      expect(match?.score).toBe(1.0);
    });

    it('performs localized fuzzy matching when small wording variations occur', () => {
      const baseText = 'The quick brown fox jumps over the lazy sleeping dog in the park.';
      const quote = {
        exact: 'lazy sleeping dog',
        prefix: 'jumps over the ',
        suffix: ' in the park.',
      };

      // External edit changed "sleeping dog" to "sleepy dog"
      const modifiedText = 'The quick brown fox jumps over the lazy sleepy dog in the park.';

      const match = matchQuoteSelector(modifiedText, quote, 35);
      expect(match).not.toBeNull();
      expect(match?.score).toBeGreaterThanOrEqual(0.70);
      expect(modifiedText.slice(match!.start, match!.end)).toContain('lazy sleepy');
    });

    it('flags anchor as orphaned when the target text was completely removed', () => {
      const anchor: DualAnchor = {
        type: 'dual',
        quote: {
          exact: 'COMPLETELY_DELETED_CONTENT_NEVER_FOUND',
          prefix: 'before ',
          suffix: ' after',
        },
        offset: 50,
        length: 38,
      };

      const docText = 'Completely different document content with no matches whatsoever.';
      const reconciled = reconcileAnchor(anchor, docText);

      expect(reconciled.status).toBe('orphaned');
      expect(reconciled.range).toBeNull();
      expect(reconciled.text).toBeNull();
      expect(reconciled.confidence).toBe(0);
    });
  });

  describe('Document Open Batch Reconciliation', () => {
    it('batch reconciles comment threads and suggestions across full document', () => {
      const content =
        '# Technical Architecture\n\n' +
        'Section 1: Data Structures\n' +
        'We use CRDTs for collaborative editing.\n\n' +
        'Section 2: Networking\n' +
        'WebSockets provide sub-50ms fanout.\n';

      text.insert(0, content);

      const phrase1 = 'CRDTs for collaborative editing';
      const p1Start = content.indexOf(phrase1);
      const anchor1 = createDualAnchor(text, p1Start, p1Start + phrase1.length, content);

      const phrase2 = 'WebSockets provide sub-50ms fanout';
      const p2Start = content.indexOf(phrase2);
      const anchor2 = createDualAnchor(text, p2Start, p2Start + phrase2.length, content);

      const comments: CommentRecord[] = [
        {
          id: 'comment-1',
          document_id: 'doc-1',
          parent_id: null,
          author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
          content: 'Great explanation!',
          status: 'OPEN',
          anchor: anchor1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const suggestions: SuggestionRecord[] = [
        {
          id: 'sugg-1',
          document_id: 'doc-1',
          author: { id: 'u2', username: 'bob', display_name: 'Bob', avatar_color: '#10b981' },
          status: 'PENDING',
          original_text: phrase2,
          suggested_text: 'WebSockets ensure ultra-low latency real-time event distribution',
          anchor: anchor2,
          created_at: new Date().toISOString(),
        },
      ];

      // Mutate text: Insert 40 characters at beginning
      text.insert(0, '<!-- Document Header Information -->\n\n');

      const commentResults = reconcileDocumentReviewItems(comments, doc, text);
      const suggestionResults = reconcileDocumentReviewItems(suggestions, doc, text);

      expect(commentResults.driftedCount).toBe(1);
      expect(commentResults.orphanedCount).toBe(0);
      expect(commentResults.reconciledItems[0].reconciled.range?.start).toBe(
        p1Start + '<!-- Document Header Information -->\n\n'.length
      );
      expect(commentResults.reconciledItems[0].reconciled.text).toBe(phrase1);

      expect(suggestionResults.driftedCount).toBe(1);
      expect(suggestionResults.orphanedCount).toBe(0);
      expect(suggestionResults.reconciledItems[0].reconciled.range?.start).toBe(
        p2Start + '<!-- Document Header Information -->\n\n'.length
      );
      expect(suggestionResults.reconciledItems[0].reconciled.text).toBe(phrase2);
    });
  });

  describe('String Similarity and Helpers', () => {
    it('computes accurate similarity metrics for fuzzy text comparison', () => {
      expect(stringSimilarity('hello world', 'hello world')).toBe(1.0);
      expect(stringSimilarity('hello world', 'hello word')).toBeGreaterThan(0.9);
      expect(stringSimilarity('completely different', 'something else')).toBeLessThan(0.3);
    });
  });
});
