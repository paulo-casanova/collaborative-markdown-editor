import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import {
  stripHeadingNumberPrefix,
  slugifyHeading,
  matchesHeadingTarget,
  validateLinkTarget,
  updateKnownWorkspaceNodes,
} from '../../src/utils/linkValidator';
import {
  getWorkspaceFileUrl,
  resolveWorkspaceRelativePath,
  updateWorkspaceNodesCache,
} from '../../src/api/documents';
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

  it('resolves relative workspace paths correctly', () => {
    expect(resolveWorkspaceRelativePath('uk.jpg', 'specs/Test File Modified.md')).toBe('specs/uk.jpg');
    expect(resolveWorkspaceRelativePath('./uk.jpg', 'specs/Test File Modified.md')).toBe('specs/uk.jpg');
    expect(resolveWorkspaceRelativePath('../assets/uk.jpg', 'specs/deep/Test.md')).toBe('specs/assets/uk.jpg');
    expect(resolveWorkspaceRelativePath('/specs/uk.jpg', 'specs/Test File.md')).toBe('specs/uk.jpg');
    expect(resolveWorkspaceRelativePath('uk.jpg')).toBe('uk.jpg');
  });

  it('resolves getWorkspaceFileUrl with currentDocPath and workspace cache', () => {
    updateWorkspaceNodesCache([
      {
        path: 'specs/uk.jpg',
        name: 'uk.jpg',
        is_directory: false,
        size_bytes: 96943,
        updated_at: '2026-10-16T00:00:00Z',
      },
    ]);

    // When relative path from document is used
    const urlFromDoc = getWorkspaceFileUrl('uk.jpg', 'specs/Test File Modified.md');
    expect(urlFromDoc).toContain('path=specs%2Fuk.jpg');

    // When leading slash is used
    const urlWithSlash = getWorkspaceFileUrl('/specs/uk.jpg');
    expect(urlWithSlash).toContain('path=specs%2Fuk.jpg');

    // When only basename is used, should resolve to cached workspace path
    const urlFromBasename = getWorkspaceFileUrl('uk.jpg');
    expect(urlFromBasename).toContain('path=specs%2Fuk.jpg');
  });

  it('validates relative image and file links via validateLinkTarget', () => {
    updateKnownWorkspaceNodes([
      {
        path: 'specs/uk.jpg',
        name: 'uk.jpg',
        is_directory: false,
        size_bytes: 96943,
        updated_at: '2026-10-16T00:00:00Z',
      },
    ]);

    const res = validateLinkTarget('uk.jpg', undefined, 'specs/Test File Modified.md');
    expect(res.valid).toBe(true);

    const missingRes = validateLinkTarget('nonexistent.png', undefined, 'specs/Test File Modified.md');
    expect(missingRes.valid).toBe(false);
  });
});
