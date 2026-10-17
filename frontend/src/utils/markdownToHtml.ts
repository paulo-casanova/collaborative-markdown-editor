/**
 * Lightweight and robust Markdown to semantic HTML parser for TipTap / ProseMirror editor initialization.
 */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'heading';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineFormat(text: string): string {
  let res = escapeHtml(text);

  // Math: $inline$
  res = res.replace(/\$([^$\n]+)\$/g, '<span class="inline-math" data-latex="$1"></span>');

  // WikiLinks: [[target|label]] or [[target]]
  res = res.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<a class="wiki-link" data-target="$1">$2</a>');
  res = res.replace(/\[\[([^\]]+)\]\]/g, '<a class="wiki-link" data-target="$1">$1</a>');

  // Custom Pills & Badges: [pill:color|label], [pill:label], [status:...], [priority:...]
  res = res.replace(/(?<!!)\[(pill|status|priority):(?:([a-zA-Z0-9#_-]+)\|)?([^\]\n]+)\]/g, (_match, prefix, color, rawLabel) => {
    let c = (color || 'slate').toLowerCase();
    let label = rawLabel.trim();
    if (prefix === 'status') {
      const norm = label.toLowerCase();
      if (norm === 'done' || norm === 'completed') { c = 'green'; label = 'Done'; }
      else if (norm === 'in-progress' || norm === 'in progress') { c = 'amber'; label = 'In Progress'; }
      else if (norm === 'blocked') { c = 'rose'; label = 'Blocked'; }
      else { c = 'blue'; }
    } else if (prefix === 'priority') {
      const norm = label.toLowerCase();
      if (norm === 'p0' || norm === 'high') { c = 'rose'; label = label.toUpperCase(); }
      else if (norm === 'p1' || norm === 'medium') { c = 'amber'; label = label.toUpperCase(); }
      else { c = 'blue'; label = label.toUpperCase(); }
    }
    return `<span class="cme-pill cme-pill-${escapeHtml(c)}" data-color="${escapeHtml(c)}">${escapeHtml(label)}</span>`;
  });

  // Bold & Italic
  res = res.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  res = res.replace(/(?<![a-zA-Z0-9_])___([^_]+)___(?![a-zA-Z0-9_])/g, '<strong><em>$1</em></strong>');
  res = res.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  res = res.replace(/(?<![a-zA-Z0-9_])__([^_]+)__(?![a-zA-Z0-9_])/g, '<strong>$1</strong>');
  res = res.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  res = res.replace(/(?<![a-zA-Z0-9_])_([^\s_]|(?:[^\s_][^_]*[^\s_]))_(?![a-zA-Z0-9_])/g, '<em>$1</em>');

  // Strikethrough
  res = res.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Inline Code
  res = res.replace(/`([^`]+)`/g, '<code>$1</code>');

  return res;
}

export function parseMarkdownToHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) {
    return '<p></p>';
  }

  const lines = markdown.split('\n');
  const output: string[] = [];

  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList: 'ul' | 'ol' | 'taskList' | null = null;
  let inBlockquote = false;

  function closeList() {
    if (inList === 'ul') output.push('</ul>');
    else if (inList === 'ol') output.push('</ol>');
    else if (inList === 'taskList') output.push('</ul>');
    inList = null;
  }

  function closeBlockquote() {
    if (inBlockquote) {
      output.push('</blockquote>');
      inBlockquote = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced Code Block or Mermaid block
    if (line.startsWith('```')) {
      closeList();
      closeBlockquote();

      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        inCode = false;
        const code = codeLines.join('\n');
        if (codeLang === 'mermaid') {
          output.push(`<div class="mermaid" data-source="${code.replace(/"/g, '&quot;')}"></div>`);
        } else {
          const isSnippet = codeLang.includes('|');
          const parts = codeLang.split('|').map((p) => p.trim());
          const effectiveLang = (parts[0] || 'plaintext').toLowerCase();
          const sourceAttr = isSnippet && parts[1] ? ` data-snippet-source="${escapeHtml(parts[1])}"` : '';
          const markerAttr = isSnippet && parts[2] ? ` data-snippet-marker="${escapeHtml(parts[2])}"` : '';
          output.push(`<pre${sourceAttr}${markerAttr}><code class="language-${effectiveLang || 'plaintext'}">${escapeHtml(code)}</code></pre>`);
        }
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Display Math $$...$$
    if (line.trim().startsWith('$$')) {
      closeList();
      closeBlockquote();

      const mathLines: string[] = [];
      if (line.trim() === '$$') {
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
      } else {
        mathLines.push(line.replace(/^\$\$/, '').replace(/\$\$$/, ''));
      }
      const formula = mathLines.join('\n');
      output.push(`<div class="katex-display-block" data-latex="${formula.replace(/"/g, '&quot;')}"></div>`);
      continue;
    }

    const trimmed = line.trim();

    // Empty lines break lists & blockquotes
    if (!trimmed) {
      closeList();
      closeBlockquote();
      continue;
    }

    // Horizontal Rule
    if (/^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(trimmed)) {
      closeList();
      closeBlockquote();
      output.push('<hr>');
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      closeList();
      if (!inBlockquote) {
        output.push('<blockquote>');
        inBlockquote = true;
      }
      output.push(`<p>${inlineFormat(line.replace(/^>\s*/, ''))}</p>`);
      continue;
    } else {
      closeBlockquote();
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const rawHeading = headingMatch[2].trim();
      const slug = slugify(rawHeading);
      output.push(`<h${level} id="${slug}">${inlineFormat(rawHeading)}</h${level}>`);
      continue;
    }

    // Task List item: - [ ] or - [x]
    const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      if (inList !== 'taskList') {
        closeList();
        output.push('<ul data-type="taskList">');
        inList = 'taskList';
      }
      const checked = taskMatch[1].toLowerCase() === 'x';
      output.push(
        `<li data-type="taskItem" data-checked="${checked}"><p>${inlineFormat(taskMatch[2])}</p></li>`
      );
      continue;
    }

    // Bullet List item: - or *
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (inList !== 'ul') {
        closeList();
        output.push('<ul>');
        inList = 'ul';
      }
      output.push(`<li><p>${inlineFormat(bulletMatch[1])}</p></li>`);
      continue;
    }

    // Numbered List item: 1.
    const numMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numMatch) {
      if (inList !== 'ol') {
        closeList();
        output.push('<ol>');
        inList = 'ol';
      }
      output.push(`<li><p>${inlineFormat(numMatch[1])}</p></li>`);
      continue;
    }

    // Regular Paragraph
    closeList();
    output.push(`<p>${inlineFormat(line)}</p>`);
  }

  closeList();
  closeBlockquote();

  return output.length > 0 ? output.join('') : '<p></p>';
}
