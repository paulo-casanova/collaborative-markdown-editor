/**
 * Converts legacy HTML fixtures or incoming HTML strings to clean raw Markdown.
 */
export function normalizeContentToMarkdown(content: string): string {
  if (!content) return '';

  // If content doesn't contain HTML tags, it's already markdown
  if (!/<[a-z][\s\S]*>/i.test(content)) {
    return content;
  }

  let md = content;

  // 1. Math blocks
  md = md.replace(
    /<div[^>]*class=["'][^"']*katex-display-block[^"']*["'][^>]*data-latex=["']([^"']*)["'][^>]*>[\s\S]*?<\/div>/gi,
    (_, latex) => `\n$$\n${latex}\n$$\n`
  );

  // 2. Mermaid blocks
  md = md.replace(
    /<div[^>]*class=["'][^"']*mermaid[^"']*["'][^>]*data-source=["']([^"']*)["'][^>]*>[\s\S]*?<\/div>/gi,
    (_, src) => `\n\`\`\`mermaid\n${src}\n\`\`\`\n`
  );

  // 3. Wiki links
  md = md.replace(
    /<a[^>]*class=["'][^"']*wiki-link[^"']*["'][^>]*data-target=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, target, label) => `[[${target}|${label.trim() || target}]]`
  );

  // 4. Code blocks
  md = md.replace(
    /<pre[^>]*data-language=["']([^"']*)["'][^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, lang, code) => `\n\`\`\`${lang || 'typescript'}\n${code.trim()}\n\`\`\`\n`
  );

  // 5. Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n# ${text.trim()}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n## ${text.trim()}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n### ${text.trim()}\n`);

  // 6. Paragraphs and breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n${text.trim()}\n`);
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');

  return md.trim();
}
