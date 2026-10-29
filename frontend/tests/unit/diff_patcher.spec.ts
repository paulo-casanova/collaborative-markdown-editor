import { describe, it, expect } from 'vitest';
import {
  parseUnifiedDiff,
  computeDiffChanges,
  computeReplacementChange,
  applyUnifiedDiff,
} from '../../src/utils/diffPatcher';

describe('Diff Patcher Engine', () => {
  it('parses standard unified diff with headers and hunks', () => {
    const diff = `--- a/file.md
+++ b/file.md
@@ -10,5 +10,5 @@
 context 1
-old erroneous line
+new corrected line
 context 2
`;
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(10);
    expect(hunks[0].oldCount).toBe(5);
    expect(hunks[0].newStart).toBe(10);
    expect(hunks[0].newCount).toBe(5);
    expect(hunks[0].lines).toContain('-old erroneous line');
    expect(hunks[0].lines).toContain('+new corrected line');
  });

  it('correctly applies a unified diff at the right line position', () => {
    const doc = [
      '# Document Title',
      '',
      'Line 1: intro',
      'Line 2: setup',
      'Line 3: erroneous word here',
      'Line 4: conclusion',
      'Line 5: footer',
    ].join('\n');

    const diff = `--- a/doc.md
+++ b/doc.md
@@ -4,5 +4,5 @@
 Line 2: setup
-Line 3: erroneous word here
+Line 3: fixed word here
 Line 4: conclusion
`;

    const result = applyUnifiedDiff(doc, diff);
    expect(result.appliedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.newText).toContain('Line 3: fixed word here');
    expect(result.newText).not.toContain('Line 3: erroneous word here');
    // Ensure rest of doc is untouched
    expect(result.newText.startsWith('# Document Title\n\nLine 1: intro')).toBe(true);
    expect(result.newText.endsWith('Line 5: footer')).toBe(true);
  });

  it('handles multiple hunks in a single diff without offset drift', () => {
    const doc = [
      'Header Line',
      'Section 1: start',
      'Section 1: bug A',
      'Section 1: end',
      'Middle filler line 1',
      'Middle filler line 2',
      'Middle filler line 3',
      'Section 2: start',
      'Section 2: bug B',
      'Section 2: end',
      'Footer Line',
    ].join('\n');

    const diff = `--- a/doc.md
+++ b/doc.md
@@ -2,4 +2,4 @@
 Section 1: start
-Section 1: bug A
+Section 1: fixed A
 Section 1: end
@@ -8,4 +8,4 @@
 Section 2: start
-Section 2: bug B
+Section 2: fixed B
 Section 2: end
`;

    const result = applyUnifiedDiff(doc, diff);
    expect(result.appliedCount).toBe(2);
    expect(result.newText).toContain('Section 1: fixed A');
    expect(result.newText).toContain('Section 2: fixed B');
    expect(result.newText).not.toContain('bug A');
    expect(result.newText).not.toContain('bug B');
  });

  it('falls back gracefully and does NOT corrupt text when hunk does not match', () => {
    const doc = [
      'Line 1: apples',
      'Line 2: oranges',
      'Line 3: bananas',
    ].join('\n');

    const diff = `--- a/doc.md
+++ b/doc.md
@@ -10,3 +10,3 @@
 Nonexistent line 1
-Nonexistent line 2
+Replaced text
 Nonexistent line 3
`;

    const result = applyUnifiedDiff(doc, diff);
    expect(result.appliedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    // Document text must remain completely unchanged!
    expect(result.newText).toBe(doc);
  });

  it('computeReplacementChange locates target text and does not fall back to selection', () => {
    const doc = 'Hello world, this is a test document with an error on line 3.';
    const change = computeReplacementChange(doc, 'an error on line 3', 'a correction on line 3');
    expect(change).not.toBeNull();
    expect(change?.insert).toBe('a correction on line 3');
    expect(doc.slice(change!.from, change!.to)).toBe('an error on line 3');

    // Missing text returns null
    const missing = computeReplacementChange(doc, 'nonexistent string', 'replacement');
    expect(missing).toBeNull();
  });

  it('disambiguates matching text using hintLine', () => {
    const doc = [
      'function test() {',
      '  const x = 1;', // line 2
      '  console.log(x);',
      '}',
      'function other() {',
      '  const x = 1;', // line 6
      '  console.log(x);',
      '}',
    ].join('\n');

    // Without hint, matches first occurrence (line 2)
    const change1 = computeReplacementChange(doc, 'const x = 1;', 'const x = 10;');
    expect(change1?.from).toBe(doc.indexOf('const x = 1;'));

    // With hint pointing to line 6, matches second occurrence
    const change2 = computeReplacementChange(doc, 'const x = 1;', 'const x = 20;', 6);
    expect(change2?.from).toBe(doc.lastIndexOf('const x = 1;'));
  });

  it('matches hunks with line offset drift (fuzzing)', () => {
    const doc = [
      'Line 1',
      'Line 2',
      'Line 3',
      'Line 4',
      'Line 5',
      'Target line to change',
      'Line 7',
    ].join('\n');

    // Hunk specifies line 2, but actual text is at line 6
    const diff = `@@ -2,3 +2,3 @@
 Line 5
-Target line to change
+Target line updated
 Line 7
`;

    const result = applyUnifiedDiff(doc, diff);
    expect(result.appliedCount).toBe(1);
    expect(result.newText).toContain('Target line updated');
    expect(result.newText).not.toContain('Target line to change');
  });

  it('handles bare diffs without hunk headers', () => {
    const doc = 'The quick brown fox jumps over the lazy dog.';
    const diff = '-brown fox\n+agile auburn fox\n';

    const result = applyUnifiedDiff(doc, diff);
    expect(result.appliedCount).toBe(1);
    expect(result.newText).toBe('The quick agile auburn fox jumps over the lazy dog.');
  });

  it('handles multi-line replacements smoothly', () => {
    const doc = [
      '# Code Block',
      'function compute() {',
      '  return 42;',
      '}',
      '# End',
    ].join('\n');

    const change = computeReplacementChange(
      doc,
      'function compute() {\n  return 42;\n}',
      'function compute(x: number) {\n  return x * 2;\n}'
    );
    expect(change).not.toBeNull();
    const patched = doc.slice(0, change!.from) + change!.insert + doc.slice(change!.to);
    expect(patched).toContain('function compute(x: number) {\n  return x * 2;\n}');
  });
});
