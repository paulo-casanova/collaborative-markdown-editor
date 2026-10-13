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
    /<pre(?:[^>]*data-language=["']([^"']*)["'])?[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, lang, code) => `\n\`\`\`${lang || ''}\n${code.trim()}\n\`\`\`\n`
  );

  // 5. Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n# ${text.trim()}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n## ${text.trim()}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n### ${text.trim()}\n`);

  // 6. Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const headers: string[] = [];
    const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/gi.exec(tableContent);
    if (theadMatch) {
      const thMatches = theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi);
      for (const m of thMatches) {
        headers.push(m[1].replace(/<[^>]+>/g, '').trim());
      }
    }
    const rows: string[][] = [];
    const tbodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi.exec(tableContent) || [null, tableContent];
    if (tbodyMatch && tbodyMatch[1]) {
      const trMatches = tbodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      for (const tr of trMatches) {
        const row: string[] = [];
        const tdMatches = tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        for (const td of tdMatches) {
          row.push(td[1].replace(/<[^>]+>/g, '').trim());
        }
        if (row.length > 0) rows.push(row);
      }
    }
    if (headers.length === 0 && rows.length > 0) {
      headers.push(...rows.shift()!);
    }
    if (headers.length === 0) return '';
    const headerLine = `| ${headers.join(' | ')} |`;
    const delimLine = `| ${headers.map(() => '---').join(' | ')} |`;
    const rowLines = rows.map((r) => `| ${headers.map((_, i) => r[i] || '').join(' | ')} |`);
    return `\n${headerLine}\n${delimLine}\n${rowLines.join('\n')}\n`;
  });

  // 7. Paragraphs and breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n${text.trim()}\n`);
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');

  return md
    .split('\n')
    .map((l) => (l.trim().startsWith('|') ? l.trim() : l))
    .join('\n')
    .trim();
}
