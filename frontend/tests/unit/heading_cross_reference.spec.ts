import { describe, it, expect } from 'vitest';
import {
  findHeadingPosition,
  extractHeadingsFromMarkdown,
  slugify,
} from '../../src/components/navigation/DocumentOutline';

describe('Heading Cross-References & Navigation', () => {
  it('correctly slugifies heading titles', () => {
    expect(slugify('Heading text')).toBe('heading-text');
    expect(slugify('Getting Started with CME!')).toBe('getting-started-with-cme');
    expect(slugify('  Spaced  Out  ')).toBe('spaced-out');
    expect(slugify('123 Numbers and Symbols @#$')).toBe('123-numbers-and-symbols');
  });

  it('extracts outline items with levels and deduplicated slug IDs', () => {
    const markdown = `# Main Title
Some intro text.

## Section One
Content one.

### Sub Section
Content sub.

## Section One
Duplicate section heading.
`;

    const headings = extractHeadingsFromMarkdown(markdown);
    expect(headings).toHaveLength(4);
    expect(headings[0]).toEqual({ id: 'main-title', text: 'Main Title', level: 1, lineNumber: 1 });
    expect(headings[1]).toEqual({ id: 'section-one', text: 'Section One', level: 2, lineNumber: 4 });
    expect(headings[2]).toEqual({ id: 'sub-section', text: 'Sub Section', level: 3, lineNumber: 7 });
    expect(headings[3]).toEqual({ id: 'section-one-1', text: 'Section One', level: 2, lineNumber: 10 });
  });

  it('correctly numbers headers and allows referencing them without numbers', () => {
    const markdown = `# Introduction
## Getting Started
### Setup Details
## Conclusion`;

    const numbered = extractHeadingsFromMarkdown(markdown, true);
    expect(numbered[0].text).toBe('1. Introduction');
    expect(numbered[0].id).toBe('introduction');
    expect(numbered[1].text).toBe('1.1. Getting Started');
    expect(numbered[1].id).toBe('getting-started');
    expect(numbered[2].text).toBe('1.1.1. Setup Details');
    expect(numbered[2].id).toBe('setup-details');
    expect(numbered[3].text).toBe('1.2. Conclusion');
    expect(numbered[3].id).toBe('conclusion');
  });

  it('findHeadingPosition locates headings by exact text, leading hash, or slug', () => {
    const lines = [
      '# Introduction Guide',
      'Some paragraph text here.',
      '',
      '## Getting Started',
      'Getting started text.',
      '',
      '### Sub Section Details',
      'Details here.',
      '',
      '## **Formatted Heading**',
      'Formatting text.',
    ];

    // Mock CodeMirror doc object
    let offset = 0;
    const lineObjs = lines.map((text) => {
      const from = offset;
      const to = offset + text.length;
      offset = to + 1; // newline
      return { from, to, text };
    });

    const mockDoc = {
      lines: lines.length,
      line: (n: number) => lineObjs[n - 1],
    };

    // 1. By exact text without leading hash
    const pos1 = findHeadingPosition(mockDoc, 'Getting Started');
    expect(pos1).not.toBeNull();
    expect(pos1?.from).toBe(lineObjs[3].from);

    // 2. With leading hash (#Getting Started)
    const pos2 = findHeadingPosition(mockDoc, '#Getting Started');
    expect(pos2).not.toBeNull();
    expect(pos2?.from).toBe(lineObjs[3].from);

    // 3. With leading hash and space (# Getting Started)
    const pos3 = findHeadingPosition(mockDoc, '# Getting Started');
    expect(pos3).not.toBeNull();
    expect(pos3?.from).toBe(lineObjs[3].from);

    // 4. By slugified anchor (getting-started)
    const pos4 = findHeadingPosition(mockDoc, 'getting-started');
    expect(pos4).not.toBeNull();
    expect(pos4?.from).toBe(lineObjs[3].from);

    // 5. Case-insensitive
    const pos5 = findHeadingPosition(mockDoc, 'sub section details');
    expect(pos5).not.toBeNull();
    expect(pos5?.from).toBe(lineObjs[6].from);

    // 6. Formatted heading stripped of markdown syntax
    const pos6 = findHeadingPosition(mockDoc, 'Formatted Heading');
    expect(pos6).not.toBeNull();
    expect(pos6?.from).toBe(lineObjs[9].from);

    // 7. Non-existent heading returns null
    const pos7 = findHeadingPosition(mockDoc, 'Non Existent');
    expect(pos7).toBeNull();
  });
});
