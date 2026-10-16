import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import {
  stripHeadingNumberPrefix,
  slugifyHeading,
  matchesHeadingTarget,
  validateLinkTarget,
} from '../../src/utils/linkValidator';
import {
  computeOrderedListRenumberingChanges,
  computeHeaderNumberingChanges,
} from '../../src/components/editor/CollaborativeEditor';

describe('Link Validator and Header Numbering Utils', () => {
  it('strips hierarchical heading numbers while keeping non-section digits intact', () => {
    expect(stripHeadingNumberPrefix('3. Whatever')).toBe('Whatever');
    expect(stripHeadingNumberPrefix('1.2. Getting Started')).toBe('Getting Started');
    expect(stripHeadingNumberPrefix('1.2.3. Sub Section')).toBe('Sub Section');
    expect(stripHeadingNumberPrefix('1.2 Sub Section')).toBe('Sub Section');
    expect(stripHeadingNumberPrefix('123 Numbers and Symbols')).toBe('123 Numbers and Symbols');
    expect(stripHeadingNumberPrefix('Plain Title')).toBe('Plain Title');
  });

  it('matches heading targets whether reference has numbers or not', () => {
    expect(matchesHeadingTarget('3. Whatever', 'Whatever')).toBe(true);
    expect(matchesHeadingTarget('3. Whatever', '#Whatever')).toBe(true);
    expect(matchesHeadingTarget('3. Whatever', '#3. Whatever')).toBe(true);
    expect(matchesHeadingTarget('1.2. Getting Started', 'getting-started')).toBe(true);
    expect(matchesHeadingTarget('Plain Title', '#plain-title')).toBe(true);
    expect(matchesHeadingTarget('Plain Title', '#unrelated')).toBe(false);
  });

  it('validates local heading links against current document content', () => {
    const docMarkdown = `# 1. Overview
Welcome.

## 1.1. Architecture
System details.

### Deep Dive
Deep details.`;

    // Valid heading reference without section number
    const res1 = validateLinkTarget('#Overview', docMarkdown);
    expect(res1.valid).toBe(true);

    const res2 = validateLinkTarget('#Architecture', docMarkdown);
    expect(res2.valid).toBe(true);

    const res3 = validateLinkTarget('#deep-dive', docMarkdown);
    expect(res3.valid).toBe(true);

    // Invalid missing heading
    const res4 = validateLinkTarget('#NonExistent', docMarkdown);
    expect(res4.valid).toBe(false);
    expect(res4.reason).toContain('does not exist');
  });

  it('validates external URLs as valid', () => {
    expect(validateLinkTarget('https://example.com').valid).toBe(true);
    expect(validateLinkTarget('http://localhost:3000').valid).toBe(true);
    expect(validateLinkTarget('mailto:test@example.com').valid).toBe(true);
  });

  it('renumbers ordered lists when item is removed or inserted', () => {
    const lines = [
      '1. First item',
      '2. Second item',
      '4. Fourth item', // Notice 3 was removed/skipped
      '5. Fifth item',
    ];
    const doc = Text.of(lines);

    const changes = computeOrderedListRenumberingChanges(doc);
    expect(changes.length).toBe(2);
    expect(changes[0].insert).toBe('3');
    expect(changes[1].insert).toBe('4');
  });

  it('renumbers headers hierarchically when header numbering is computed', () => {
    const lines = [
      '# Introduction',
      'Content',
      '## Getting Started',
      'Content',
      '### Details',
      '# Next Chapter',
    ];
    const doc = Text.of(lines);

    const changes = computeHeaderNumberingChanges(doc, true);
    expect(changes.length).toBe(4);
    expect(changes[0].insert).toBe('1. ');
    expect(changes[1].insert).toBe('1.1. ');
    expect(changes[2].insert).toBe('1.1.1. ');
    expect(changes[3].insert).toBe('2. ');
  });
});
