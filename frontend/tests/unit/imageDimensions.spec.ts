import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseDimensionString,
  parseImageDimensionAndAlt,
  getImageStyles,
} from '../../src/utils/imageDimensions';
import { ImageEmbedWidget } from '../../src/components/editor/codemirror/livePreviewWidgets';

interface MockElement {
  tagName: string;
  className: string;
  title: string;
  alt: string;
  src: string;
  href: string;
  target: string;
  rel: string;
  style: Record<string, string>;
  children: MockElement[];
  appendChild(child: MockElement): void;
  querySelector(selector: string): MockElement | null;
  addEventListener(event: string, handler: Function): void;
}

function createMockElement(tagName: string): MockElement {
  const el: MockElement = {
    tagName: tagName.toUpperCase(),
    className: '',
    title: '',
    alt: '',
    src: '',
    href: '',
    target: '',
    rel: '',
    style: {},
    children: [],
    appendChild(child: MockElement) {
      el.children.push(child);
    },
    querySelector(selector: string): MockElement | null {
      for (const c of el.children) {
        if (c.tagName.toLowerCase() === selector.toLowerCase()) return c;
        const found = c.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    addEventListener() {},
  };
  return el;
}

describe('Image Dimension & Alt Parsing', () => {
  describe('parseDimensionString', () => {
    it('parses pixel widths with or without px suffix', () => {
      expect(parseDimensionString('300')).toEqual({ width: '300px' });
      expect(parseDimensionString('300px')).toEqual({ width: '300px' });
      expect(parseDimensionString('  450px  ')).toEqual({ width: '450px' });
    });

    it('parses percentage widths', () => {
      expect(parseDimensionString('50%')).toEqual({ width: '50%' });
      expect(parseDimensionString('75.5%')).toEqual({ width: '75.5%' });
      expect(parseDimensionString('100%')).toEqual({ width: '100%' });
    });

    it('parses width x height combinations in various formats', () => {
      expect(parseDimensionString('300x200')).toEqual({ width: '300px', height: '200px' });
      expect(parseDimensionString('300X200')).toEqual({ width: '300px', height: '200px' });
      expect(parseDimensionString('300px x 200px')).toEqual({ width: '300px', height: '200px' });
      expect(parseDimensionString('50%x50%')).toEqual({ width: '50%', height: '50%' });
      expect(parseDimensionString('400x300px')).toEqual({ width: '400px', height: '300px' });
    });

    it('parses height-only specifications', () => {
      expect(parseDimensionString('x200')).toEqual({ height: '200px' });
      expect(parseDimensionString('x200px')).toEqual({ height: '200px' });
      expect(parseDimensionString('X350')).toEqual({ height: '350px' });
      expect(parseDimensionString('x50%')).toEqual({ height: '50%' });
    });

    it('returns null for non-dimension strings', () => {
      expect(parseDimensionString('')).toBeNull();
      expect(parseDimensionString('   ')).toBeNull();
      expect(parseDimensionString('Diagram Title')).toBeNull();
      expect(parseDimensionString('some text')).toBeNull();
      expect(parseDimensionString('300px extra')).toBeNull();
    });
  });

  describe('parseImageDimensionAndAlt', () => {
    it('handles default images without sizing specifications', () => {
      const res = parseImageDimensionAndAlt('Architecture Overview');
      expect(res.altText).toBe('Architecture Overview');
      expect(res.width).toBeUndefined();
      expect(res.height).toBeUndefined();
    });

    it('handles empty alt text', () => {
      const res = parseImageDimensionAndAlt('');
      expect(res.altText).toBe('');
      expect(res.width).toBeUndefined();
      expect(res.height).toBeUndefined();
    });

    it('parses standard Markdown alt with pipe dimensions: ![alt|300](url)', () => {
      const res = parseImageDimensionAndAlt('System Diagram|400');
      expect(res.altText).toBe('System Diagram');
      expect(res.width).toBe('400px');
      expect(res.height).toBeUndefined();
    });

    it('parses standard Markdown alt with WxH dimensions: ![alt|400x300](url)', () => {
      const res = parseImageDimensionAndAlt('System Diagram|400x300');
      expect(res.altText).toBe('System Diagram');
      expect(res.width).toBe('400px');
      expect(res.height).toBe('300px');
    });

    it('parses percentage sizing: ![alt|50%](url)', () => {
      const res = parseImageDimensionAndAlt('System Diagram|50%');
      expect(res.altText).toBe('System Diagram');
      expect(res.width).toBe('50%');
      expect(res.height).toBeUndefined();
    });

    it('supports pure dimension without alt text: ![300](url) or ![|300](url)', () => {
      const res1 = parseImageDimensionAndAlt('300');
      expect(res1.altText).toBe('');
      expect(res1.width).toBe('300px');

      const res2 = parseImageDimensionAndAlt('|300');
      expect(res2.altText).toBe('');
      expect(res2.width).toBe('300px');

      const res3 = parseImageDimensionAndAlt('300x200');
      expect(res3.altText).toBe('');
      expect(res3.width).toBe('300px');
      expect(res3.height).toBe('200px');
    });

    it('supports Obsidian embed pipe ordering variations: target|Diagram|500 and target|500|Diagram', () => {
      const res1 = parseImageDimensionAndAlt('Diagram|500');
      expect(res1.altText).toBe('Diagram');
      expect(res1.width).toBe('500px');

      const res2 = parseImageDimensionAndAlt('500|Diagram');
      expect(res2.altText).toBe('Diagram');
      expect(res2.width).toBe('500px');
    });

    it('supports URL =WxH syntax: ![alt](img.png =400x300)', () => {
      const res = parseImageDimensionAndAlt('Diagram', 'img.png =400x300');
      expect(res.altText).toBe('Diagram');
      expect(res.width).toBe('400px');
      expect(res.height).toBe('300px');
    });
  });

  describe('getImageStyles', () => {
    it('provides native size defaults when no dimensions are provided', () => {
      const styles = getImageStyles({ altText: 'Test' });
      expect(styles.linkStyle.maxWidth).toBe('100%');
      expect(styles.imgStyle.maxWidth).toBe('100%');
      expect(styles.imgStyle.height).toBe('auto');
      expect(styles.imgStyle.width).toBeUndefined();
    });

    it('applies pixel dimensions properly', () => {
      const styles = getImageStyles({ altText: 'Test', width: '400px', height: '300px' });
      expect(styles.imgStyle.width).toBe('400px');
      expect(styles.imgStyle.height).toBe('300px');
      expect(styles.imgStyle.objectFit).toBe('contain');
    });

    it('applies percentage width to link wrapper for responsive sizing', () => {
      const styles = getImageStyles({ altText: 'Test', width: '50%' });
      expect(styles.linkStyle.width).toBe('50%');
      expect(styles.imgStyle.width).toBe('100%');
      expect(styles.imgStyle.height).toBe('auto');
    });
  });

  describe('ImageEmbedWidget DOM Generation', () => {
    const origDocument = global.document;

    beforeAll(() => {
      (global as any).document = {
        createElement: (tag: string) => createMockElement(tag),
      };
    });

    afterAll(() => {
      (global as any).document = origDocument;
    });

    it('renders native size by default without artificial max-h-64 constraint', () => {
      const widget = new ImageEmbedWidget('My Diagram', 'diagram.png', 0, 10);
      const fakeView = { dispatch: () => {}, focus: () => {} } as any;
      const dom = widget.toDOM(fakeView) as any;

      const img = dom.querySelector('img') as MockElement;
      expect(img).toBeTruthy();
      expect(img.className).toContain('max-w-full');
      expect(img.className).not.toContain('max-h-64');
      expect(img.style.width).toBeUndefined();
      expect(img.style.height).toBe('auto');
      expect(img.alt).toBe('My Diagram');
    });

    it('applies pixel width when specified via alt: My Diagram|400', () => {
      const widget = new ImageEmbedWidget('My Diagram|400', 'diagram.png', 0, 10);
      const fakeView = { dispatch: () => {}, focus: () => {} } as any;
      const dom = widget.toDOM(fakeView) as any;

      const img = dom.querySelector('img') as MockElement;
      expect(img).toBeTruthy();
      expect(img.style.width).toBe('400px');
      expect(img.style.height).toBe('auto');
      expect(img.alt).toBe('My Diagram');
    });

    it('applies width and height when specified: 400x300', () => {
      const widget = new ImageEmbedWidget('400x300', 'diagram.png', 0, 10);
      const fakeView = { dispatch: () => {}, focus: () => {} } as any;
      const dom = widget.toDOM(fakeView) as any;

      const img = dom.querySelector('img') as MockElement;
      expect(img).toBeTruthy();
      expect(img.style.width).toBe('400px');
      expect(img.style.height).toBe('300px');
      expect(img.style.objectFit).toBe('contain');
      // When alt text is pure dimensions, fallback displayAlt is cleanSrc
      expect(img.alt).toBe('diagram.png');
    });

    it('applies percentage width to wrapper and img', () => {
      const widget = new ImageEmbedWidget('Diagram|60%', 'diagram.png', 0, 10);
      const fakeView = { dispatch: () => {}, focus: () => {} } as any;
      const dom = widget.toDOM(fakeView) as any;

      expect(dom.style.width).toBe('60%');
      const img = dom.querySelector('img') as MockElement;
      expect(img.style.width).toBe('100%');
      expect(img.alt).toBe('Diagram');
    });
  });
});
