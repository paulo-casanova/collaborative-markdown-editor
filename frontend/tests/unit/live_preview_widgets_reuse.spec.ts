import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MermaidBlockWidget,
  GanttBlockWidget,
  MathBlockWidget,
  InlineMathWidget,
  CodeBlockWidget,
  TableBlockWidget,
  ImageEmbedWidget,
  TaskCheckboxWidget,
  DividerWidget,
  PillWidget,
  CalloutHeaderWidget,
} from '../../src/components/editor/codemirror/livePreviewWidgets';
import {
  getCachedMermaidSvg,
  renderMermaidSvg,
  clearMermaidCache,
} from '../../src/components/editor/utils/mermaidRenderer';

describe('Live preview widgets equivalence and reuse (anti-blinking)', () => {
  it('MermaidBlockWidget.eq returns true when source & theme match regardless of document offsets', () => {
    const w1 = new MermaidBlockWidget('graph TD\n  A --> B', 10, 45, false);
    const w2 = new MermaidBlockWidget('graph TD\n  A --> B', 25, 60, false);
    const wThemeDiff = new MermaidBlockWidget('graph TD\n  A --> B', 10, 45, true);
    const wSourceDiff = new MermaidBlockWidget('graph LR\n  A --> B', 10, 45, false);

    expect(w1.eq(w2)).toBe(true);
    expect(w1.eq(wThemeDiff)).toBe(false);
    expect(w1.eq(wSourceDiff)).toBe(false);
  });

  it('GanttBlockWidget.eq returns true when source & theme match regardless of document offsets', () => {
    const g1 = new GanttBlockWidget('gantt\ntitle Roadmap', 0, 30, false);
    const g2 = new GanttBlockWidget('gantt\ntitle Roadmap', 50, 80, false);
    const gDiff = new GanttBlockWidget('gantt\ntitle Other', 0, 30, false);

    expect(g1.eq(g2)).toBe(true);
    expect(g1.eq(gDiff)).toBe(false);
  });

  it('MathBlockWidget and InlineMathWidget eq return true when latex matches regardless of offsets', () => {
    const m1 = new MathBlockWidget('e = mc^2', 5, 25);
    const m2 = new MathBlockWidget('e = mc^2', 105, 125);
    const mDiff = new MathBlockWidget('a^2 + b^2 = c^2', 5, 25);

    expect(m1.eq(m2)).toBe(true);
    expect(m1.eq(mDiff)).toBe(false);

    const im1 = new InlineMathWidget('\\lambda', 2, 10);
    const im2 = new InlineMathWidget('\\lambda', 22, 30);
    expect(im1.eq(im2)).toBe(true);
  });

  it('CodeBlockWidget.eq returns true when language, code and docPath match regardless of offsets', () => {
    const c1 = new CodeBlockWidget('typescript', 'const x = 42;', 10, 50, 'doc.md');
    const c2 = new CodeBlockWidget('typescript', 'const x = 42;', 60, 100, 'doc.md');
    const cDiff = new CodeBlockWidget('typescript', 'const x = 99;', 10, 50, 'doc.md');

    expect(c1.eq(c2)).toBe(true);
    expect(c1.eq(cDiff)).toBe(false);
  });

  it('TableBlockWidget.eq returns true when raw table text matches regardless of offsets', () => {
    const tableStr = '| Col A | Col B |\n|---|---|\n| 1 | 2 |';
    const t1 = new TableBlockWidget(tableStr, 0, 40, 'doc.md');
    const t2 = new TableBlockWidget(tableStr, 25, 65, 'doc.md');

    expect(t1.eq(t2)).toBe(true);
  });

  it('ImageEmbedWidget, TaskCheckboxWidget, DividerWidget, PillWidget, and CalloutHeaderWidget decouple eq from offsets', () => {
    const img1 = new ImageEmbedWidget('alt', 'photo.png', 0, 20, 'doc.md', 'link.md');
    const img2 = new ImageEmbedWidget('alt', 'photo.png', 50, 70, 'doc.md', 'link.md');
    expect(img1.eq(img2)).toBe(true);

    const task1 = new TaskCheckboxWidget(true, 10);
    const task2 = new TaskCheckboxWidget(true, 99);
    expect(task1.eq(task2)).toBe(true);

    const div1 = new DividerWidget(5);
    const div2 = new DividerWidget(100);
    expect(div1.eq(div2)).toBe(true);

    const pill1 = new PillWidget('red', 'Urgent', 10, 30, '[pill:red|Urgent]');
    const pill2 = new PillWidget('red', 'Urgent', 50, 70, '[pill:red|Urgent]');
    expect(pill1.eq(pill2)).toBe(true);

    const callout1 = new CalloutHeaderWidget('note', 'Note Title', 0, 20);
    const callout2 = new CalloutHeaderWidget('note', 'Note Title', 40, 60);
    expect(callout1.eq(callout2)).toBe(true);
  });
});

describe('Mermaid SVG Cache', () => {
  beforeEach(() => {
    clearMermaidCache();
  });

  it('stores and retrieves rendered SVG from cache', async () => {
    const source = 'graph TD\n  Start --> Stop';
    expect(getCachedMermaidSvg(source, false)).toBeUndefined();

    // Mock mermaid render
    const renderedSvg = '<svg id="test-svg"><g></g></svg>';
    const mermaidModule = await import('mermaid');
    const spy = vi.spyOn(mermaidModule.default, 'render').mockResolvedValueOnce({
      svg: renderedSvg,
      bindFunctions: undefined,
    } as any);

    const svgResult = await renderMermaidSvg(source, false);
    expect(svgResult).toBe(renderedSvg);
    expect(spy).toHaveBeenCalledTimes(1);

    // Synchronous retrieval from cache
    const cached = getCachedMermaidSvg(source, false);
    expect(cached).toBe(renderedSvg);

    // Second call to renderMermaidSvg returns from cache without calling mermaid.render
    const svgResult2 = await renderMermaidSvg(source, false);
    expect(svgResult2).toBe(renderedSvg);
    expect(spy).toHaveBeenCalledTimes(1);

    // Clear cache
    clearMermaidCache();
    expect(getCachedMermaidSvg(source, false)).toBeUndefined();
    spy.mockRestore();
  });
});
