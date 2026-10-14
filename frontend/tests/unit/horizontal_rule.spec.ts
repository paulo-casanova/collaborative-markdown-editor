import { describe, it, expect } from 'vitest';
import { parseMarkdownToHtml } from '../../src/utils/markdownToHtml';

describe('Markdown Horizontal Rule Parsing', () => {
  it('parses standard 3-hyphen horizontal rules', () => {
    const md = 'Paragraph 1\n\n---\n\nParagraph 2';
    const html = parseMarkdownToHtml(md);
    expect(html).toContain('<hr>');
  });

  it('parses multi-character hyphens, asterisks, and underscores', () => {
    const md = '----\n\n***\n\n*****\n\n___\n\n______';
    const html = parseMarkdownToHtml(md);
    const hrCount = (html.match(/<hr>/g) || []).length;
    expect(hrCount).toBe(5);
  });

  it('parses space-separated horizontal rules', () => {
    const md = '- - -\n\n* * *\n\n_ _ _\n\n-  -  -  -';
    const html = parseMarkdownToHtml(md);
    const hrCount = (html.match(/<hr>/g) || []).length;
    expect(hrCount).toBe(4);
  });

  it('does not confuse lists, tasks, or short hyphens with horizontal rules', () => {
    const md = '--\n- item\n* item\n- [ ] task';
    const html = parseMarkdownToHtml(md);
    expect(html).not.toContain('<hr>');
  });
});
