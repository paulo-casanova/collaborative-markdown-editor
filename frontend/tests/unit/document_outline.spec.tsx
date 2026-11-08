import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DocumentOutline,
  buildOutlineTree,
  countDescendants,
  getAllParentIds,
  getAncestorIds,
  getHeadingIcon,
  getHeadingFontClass,
  extractHeadingsFromMarkdown,
  OutlineItem,
} from '../../src/components/navigation/DocumentOutline';
import { useUIStore } from '../../src/stores/uiStore';

describe('DocumentOutline Tree & Heading Icons', () => {
  beforeEach(() => {
    useUIStore.setState({
      numberHeaders: false,
    });
  });

  describe('buildOutlineTree & hierarchy operations', () => {
    const sampleItems: OutlineItem[] = [
      { id: 'intro', text: 'Intro', level: 1 },
      { id: 'getting-started', text: 'Getting Started', level: 2 },
      { id: 'installation', text: 'Installation', level: 3 },
      { id: 'usage', text: 'Usage', level: 2 },
      { id: 'faq', text: 'FAQ', level: 1 },
    ];

    it('builds a hierarchical tree from a flat list of headings', () => {
      const tree = buildOutlineTree(sampleItems);
      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('intro');
      expect(tree[1].id).toBe('faq');

      // 'intro' has two level 2 children
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children[0].id).toBe('getting-started');
      expect(tree[0].children[1].id).toBe('usage');

      // 'getting-started' has one level 3 child
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].id).toBe('installation');

      // 'usage' and 'faq' have no children
      expect(tree[0].children[1].children).toHaveLength(0);
      expect(tree[1].children).toHaveLength(0);
    });

    it('handles documents with skipped heading levels cleanly', () => {
      const skippedItems: OutlineItem[] = [
        { id: 'top', text: 'Top Level', level: 1 },
        { id: 'deep', text: 'Deep Child', level: 4 },
        { id: 'sibling', text: 'Sibling', level: 1 },
      ];
      const tree = buildOutlineTree(skippedItems);
      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('top');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe('deep');
      expect(tree[1].id).toBe('sibling');
    });

    it('handles documents starting at H2 or H3 without H1', () => {
      const h2Items: OutlineItem[] = [
        { id: 'section-a', text: 'Section A', level: 2 },
        { id: 'sub-a', text: 'Sub A', level: 3 },
        { id: 'section-b', text: 'Section B', level: 2 },
      ];
      const tree = buildOutlineTree(h2Items);
      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('section-a');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe('sub-a');
      expect(tree[1].id).toBe('section-b');
      expect(tree[1].children).toHaveLength(0);
    });

    it('calculates total descendant count accurately', () => {
      const tree = buildOutlineTree(sampleItems);
      // 'intro' has 3 total descendants (getting-started, installation, usage)
      expect(countDescendants(tree[0])).toBe(3);
      // 'getting-started' has 1 descendant (installation)
      expect(countDescendants(tree[0].children[0])).toBe(1);
      // 'usage' has 0 descendants
      expect(countDescendants(tree[0].children[1])).toBe(0);
      // 'faq' has 0 descendants
      expect(countDescendants(tree[1])).toBe(0);
    });

    it('finds all collapsible parent node IDs', () => {
      const tree = buildOutlineTree(sampleItems);
      const parentIds = getAllParentIds(tree);
      expect(parentIds).toEqual(['intro', 'getting-started']);
    });

    it('traces ancestor IDs from root to leaf', () => {
      const tree = buildOutlineTree(sampleItems);
      expect(getAncestorIds('installation', tree)).toEqual(['intro', 'getting-started']);
      expect(getAncestorIds('usage', tree)).toEqual(['intro']);
      expect(getAncestorIds('intro', tree)).toEqual([]);
      expect(getAncestorIds('faq', tree)).toEqual([]);
    });
  });

  describe('Heading icons & font classes', () => {
    it('generates distinct heading level icons without generic #', () => {
      const h1Markup = renderToStaticMarkup(getHeadingIcon(1));
      const h2Markup = renderToStaticMarkup(getHeadingIcon(2));
      const h3Markup = renderToStaticMarkup(getHeadingIcon(3));
      const h4Markup = renderToStaticMarkup(getHeadingIcon(4));
      const h5Markup = renderToStaticMarkup(getHeadingIcon(5));
      const h6Markup = renderToStaticMarkup(getHeadingIcon(6));

      // None of them should be a generic Hash icon
      expect(h1Markup).toContain('lucide-heading1');
      expect(h1Markup).not.toContain('lucide-hash');
      expect(h2Markup).toContain('lucide-heading2');
      expect(h3Markup).toContain('lucide-heading3');
      expect(h4Markup).toContain('lucide-heading4');
      expect(h5Markup).toContain('lucide-heading5');
      expect(h6Markup).toContain('lucide-heading6');
    });

    it('styles active heading icon with primary theme classes', () => {
      const activeMarkup = renderToStaticMarkup(getHeadingIcon(1, true));
      expect(activeMarkup).toContain('text-cme-primary');
    });

    it('returns appropriate font weight classes based on heading level', () => {
      expect(getHeadingFontClass(1)).toContain('font-semibold');
      expect(getHeadingFontClass(2)).toContain('font-medium');
      expect(getHeadingFontClass(3)).not.toContain('font-semibold');
    });
  });

  describe('DocumentOutline rendering & collapse/expand defaults', () => {
    const markdown = `# Architecture Overview
Detailed architecture description.

## Storage Layer
Details on storage.

### POSIX Drivers
POSIX specific details.

## Network Protocol
Protocol description.

# Operations
Deployment guide.
`;

    it('starts all expanded by default with all items visible', () => {
      const html = renderToStaticMarkup(<DocumentOutline markdown={markdown} />);

      // Verify Table of Contents renders
      expect(html).toContain('data-testid="table-of-contents"');

      // Verify all 5 headings are rendered and visible by default
      expect(html).toContain('data-testid="toc-item-architecture-overview"');
      expect(html).toContain('data-testid="toc-item-storage-layer"');
      expect(html).toContain('data-testid="toc-item-posix-drivers"');
      expect(html).toContain('data-testid="toc-item-network-protocol"');
      expect(html).toContain('data-testid="toc-item-operations"');

      // Verify parent headings have collapse chevrons (starting expanded, so showing toc-collapse-*)
      expect(html).toContain('data-testid="toc-collapse-architecture-overview"');
      expect(html).toContain('data-testid="toc-collapse-storage-layer"');

      // Verify leaf headings (posix-drivers, network-protocol, operations) do not have collapse buttons
      expect(html).not.toContain('data-testid="toc-collapse-posix-drivers"');
      expect(html).not.toContain('data-testid="toc-collapse-network-protocol"');
      expect(html).not.toContain('data-testid="toc-collapse-operations"');

      // Verify expand/collapse all toggle button is present in header
      expect(html).toContain('data-testid="toc-toggle-all-btn"');

      // Verify level icons are rendered (H1, H2, H3) and NOT generic Hash (#)
      expect(html).toContain('lucide-heading1');
      expect(html).toContain('lucide-heading2');
      expect(html).toContain('lucide-heading3');
      expect(html).not.toContain('lucide-hash');
    });

    it('displays empty state when document has no headings', () => {
      const html = renderToStaticMarkup(<DocumentOutline markdown="Just plain text with no headings." />);
      expect(html).toContain('data-testid="table-of-contents"');
      expect(html).toContain('No headings in this document.');
    });
  });

  describe('extractHeadingsFromMarkdown with display math blocks', () => {
    it('does not skip headings when single-line display math is present', () => {
      const doc = [
        '# Title',
        '## 1. Intro',
        '$$E = mc^2$$',
        '## 2. Next Section',
        '$$a^2 + b^2 = c^2$$',
        '## 3. Final Section',
      ].join('\n');

      const headings = extractHeadingsFromMarkdown(doc);
      expect(headings.map((h) => h.text)).toEqual([
        'Title',
        '1. Intro',
        '2. Next Section',
        '3. Final Section',
      ]);
    });

    it('handles multiline display math and matrices without skipping subsequent headings', () => {
      const doc = [
        '# Document',
        '## 4. Hierarchical Shapes',
        '### 4.1 Transform',
        '$$\\begin{bmatrix}',
        'x \\\\',
        'y',
        '\\end{bmatrix}$$',
        '## 5. Shape Item Definitions',
        '## 6. Snapping & Connector Bindings',
        '### 6.4 Dynamic Endpoint Resolution',
        '   $$\\text{Endpoint} = \\text{TargetSideVertex} + \\text{ratio}$$',
        '## 7. Rendering & Tree Traversal',
      ].join('\n');

      const headings = extractHeadingsFromMarkdown(doc);
      expect(headings.map((h) => h.text)).toEqual([
        'Document',
        '4. Hierarchical Shapes',
        '4.1 Transform',
        '5. Shape Item Definitions',
        '6. Snapping & Connector Bindings',
        '6.4 Dynamic Endpoint Resolution',
        '7. Rendering & Tree Traversal',
      ]);
    });
  });
});
