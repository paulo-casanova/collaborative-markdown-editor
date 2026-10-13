import { WidgetType, EditorView } from '@codemirror/view';
import katex from 'katex';
import { renderMermaidSvg } from '../utils/mermaidRenderer';
import hljs from 'highlight.js';
import { findHeadingPosition, slugify } from '../../navigation/DocumentOutline';

export class MathBlockWidget extends WidgetType {
  constructor(
    public latex: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: MathBlockWidget): boolean {
    return this.latex === other.latex && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className =
      'math-block-node my-4 rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm select-none';

    // Header
    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between px-3.5 py-1.5 border-b border-cme-border-base bg-cme-bg-subtle text-xs';
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="font-semibold text-[11px] text-cme-text-muted">KaTeX Math Formula</span>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" class="edit-btn px-2 py-0.5 rounded text-[11px] font-medium border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base transition-colors">Edit LaTeX</button>
      </div>
    `;
    container.appendChild(header);

    // Formula display container
    const body = document.createElement('div');
    body.className =
      'p-4 flex flex-col items-center justify-center overflow-x-auto min-h-[60px] cursor-pointer hover:bg-cme-bg-subtle/40 transition-colors';
    const formulaDiv = document.createElement('div');
    formulaDiv.className = 'katex-formula py-1';
    try {
      katex.render(this.latex, formulaDiv, { displayMode: true, throwOnError: false });
    } catch {
      formulaDiv.textContent = this.latex;
    }
    body.appendChild(formulaDiv);

    // Edit container (for e2e tests and inline editing)
    const editContainer = document.createElement('div');
    editContainer.className =
      'edit-container hidden p-3 border-t border-cme-border-base bg-cme-bg-subtle space-y-2';
    const textarea = document.createElement('textarea');
    textarea.className =
      'w-full px-3 py-2 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-surface text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary';
    textarea.value = this.latex;
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className =
      'apply-btn px-3 py-1 rounded text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors';
    applyBtn.textContent = 'Apply Math';

    editContainer.appendChild(textarea);
    editContainer.appendChild(applyBtn);
    container.appendChild(body);
    container.appendChild(editContainer);

    const editBtn = header.querySelector('.edit-btn') as HTMLButtonElement;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editContainer.classList.toggle('hidden');
      if (!editContainer.classList.contains('hidden')) {
        textarea.focus();
      }
    });

    applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newLatex = textarea.value.trim();
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: `$$\n${newLatex}\n$$` },
      });
    });

    body.addEventListener('click', () => {
      view.dispatch({
        selection: { anchor: this.from + 2 },
      });
      view.focus();
    });

    return container;
  }
}

export class MermaidBlockWidget extends WidgetType {
  constructor(
    public source: string,
    public from: number,
    public to: number,
    public isDark: boolean = false
  ) {
    super();
  }

  eq(other: MermaidBlockWidget): boolean {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.to === other.to &&
      this.isDark === other.isDark
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className =
      'mermaid-block-node my-4 rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm select-none';

    let zoom = 1;

    // Header bar with Zoom controls, Edit Source button, etc.
    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between px-3.5 py-1.5 border-b border-cme-border-base bg-cme-bg-subtle text-xs';
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="font-semibold text-[11px] text-cme-text-muted">Mermaid Diagram</span>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" title="Zoom In" class="zoom-in-btn px-1.5 py-0.5 rounded text-[11px] border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover">+</button>
        <button type="button" title="Reset Zoom" class="zoom-reset-btn px-1.5 py-0.5 rounded text-[11px] border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover">Reset</button>
        <span class="zoom-text px-1 text-[11px] font-mono text-cme-text-muted">100%</span>
        <button type="button" class="edit-source-btn px-2 py-0.5 rounded text-[11px] font-medium border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base">Edit Source</button>
      </div>
    `;
    container.appendChild(header);

    // SVG container
    const svgWrapper = document.createElement('div');
    svgWrapper.className =
      'mermaid-svg-container p-4 flex items-center justify-center overflow-x-auto min-h-[100px] cursor-pointer';
    container.appendChild(svgWrapper);

    // Source editor drawer (for interactive toggles and e2e tests)
    const drawer = document.createElement('div');
    drawer.className =
      'source-drawer hidden p-3 border-t border-cme-border-base bg-cme-bg-subtle space-y-2';
    const textarea = document.createElement('textarea');
    textarea.className =
      'w-full px-3 py-2 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-surface text-cme-text-base min-h-[80px] focus:outline-none focus:ring-1 focus:ring-cme-primary';
    textarea.value = this.source;
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className =
      'preview-btn px-3 py-1 rounded text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors';
    previewBtn.textContent = 'Preview';
    drawer.appendChild(textarea);
    drawer.appendChild(previewBtn);
    container.appendChild(drawer);

    const zoomText = header.querySelector('.zoom-text') as HTMLSpanElement;
    const zoomInBtn = header.querySelector('.zoom-in-btn') as HTMLButtonElement;
    const resetZoomBtn = header.querySelector('.zoom-reset-btn') as HTMLButtonElement;
    const editSourceBtn = header.querySelector('.edit-source-btn') as HTMLButtonElement;

    const updateZoom = (z: number) => {
      zoom = z;
      zoomText.textContent = `${Math.round(zoom * 100)}%`;
      const svg = svgWrapper.querySelector('svg');
      if (svg) svg.style.transform = `scale(${zoom})`;
    };

    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateZoom(zoom + 0.15);
    });

    resetZoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateZoom(1);
    });

    editSourceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      drawer.classList.remove('hidden');
      svgWrapper.classList.add('hidden');
    });

    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newSource = textarea.value.trim();
      drawer.classList.add('hidden');
      svgWrapper.classList.remove('hidden');
      if (newSource !== this.source) {
        view.dispatch({
          changes: { from: this.from, to: this.to, insert: `\`\`\`mermaid\n${newSource}\n\`\`\`` },
        });
      }
    });

    svgWrapper.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: this.from + 10 } });
      view.focus();
    });

    // Render Mermaid async
    renderMermaidSvg(this.source, this.isDark)
      .then((svg) => {
        svgWrapper.innerHTML = svg;
      })
      .catch((err) => {
        svgWrapper.innerHTML = `<div class="text-xs text-rose-500 font-mono p-2">Mermaid render error: ${err.message || 'Syntax error'}</div>`;
      });

    return container;
  }
}

export class WikiLinkWidget extends WidgetType {
  constructor(
    public target: string,
    public label: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: WikiLinkWidget): boolean {
    return this.target === other.target && this.label === other.label;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className =
      'wiki-link-node inline-block align-middle select-none relative my-0.5 mx-0.5';

    const cleanTarget = this.target.trim();
    const hashIndex = cleanTarget.indexOf('#');
    const targetDoc = hashIndex >= 0 ? cleanTarget.slice(0, hashIndex).trim() : cleanTarget;
    const rawAnchor = hashIndex >= 0 ? cleanTarget.slice(hashIndex + 1).trim() : '';
    const isSameDoc = cleanTarget.startsWith('#') || targetDoc === '';
    const anchorSlug = rawAnchor ? slugify(rawAnchor) : '';

    const pill = document.createElement('span');
    pill.className =
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-xs cursor-pointer border border-cme-primary/30 bg-cme-primary/5 text-cme-primary hover:bg-cme-primary/15 transition-colors';
    const displayLabel = this.label || (isSameDoc ? (rawAnchor ? `#${rawAnchor}` : cleanTarget) : cleanTarget);
    pill.innerHTML = `<span class="font-medium underline decoration-cme-primary/40 underline-offset-2">${escapeHtml(displayLabel)}</span><span class="open-icon opacity-70 hover:opacity-100 hover:text-cme-primary text-[10px] ml-0.5" title="${isSameDoc ? 'Jump to heading' : 'Open file directly'}">${isSameDoc ? '↓' : '↗'}</span>`;
    pill.title = isSameDoc
      ? `Heading link: [[${cleanTarget}]] (Click to jump to heading)`
      : `Wiki link: [[${cleanTarget}]] (Click for reference card, Ctrl+Click or ↗ to open file)`;
    span.appendChild(pill);

    // Popover
    const popover = document.createElement('div');
    popover.className =
      'hidden absolute left-0 bottom-full mb-1.5 w-64 p-3 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl z-50 text-xs space-y-2';
    if (isSameDoc) {
      popover.innerHTML = `
        <div class="space-y-1">
          <label class="font-semibold text-cme-text-muted text-[10px]">Target Heading:</label>
          <input type="text" readonly class="w-full px-2 py-1 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none" value="#${rawAnchor}" />
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-cme-border-base">
          <button type="button" class="jump-btn px-2 py-1 rounded text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors">Jump to Heading</button>
        </div>
      `;
    } else {
      popover.innerHTML = `
        <div class="space-y-1">
          <label class="font-semibold text-cme-text-muted text-[10px]">Target Document:</label>
          <input type="text" class="w-full px-2 py-1 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary" placeholder="e.g. guides/intro.md" value="${this.target}" />
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-cme-border-base">
          <button type="button" class="open-btn px-2 py-1 rounded text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors">Open File</button>
        </div>
      `;
    }
    span.appendChild(popover);

    const jumpToHeading = () => {
      const pos = findHeadingPosition(view.state.doc, rawAnchor);
      if (pos) {
        view.dispatch({
          selection: { anchor: pos.from },
          scrollIntoView: true,
        });
        view.focus();
        popover.classList.add('hidden');
        return true;
      }
      return false;
    };

    const navigateToTarget = () => {
      if (isSameDoc) {
        jumpToHeading();
        return;
      }
      let handled = false;
      const onHandled = () => {
        handled = true;
      };
      window.addEventListener('cme-wikilink-handled', onHandled, { once: true });
      window.dispatchEvent(
        new CustomEvent('cme-open-wikilink', {
          detail: { target: targetDoc, anchor: anchorSlug },
        })
      );
      setTimeout(() => {
        window.removeEventListener('cme-wikilink-handled', onHandled);
        if (!handled && typeof window !== 'undefined') {
          const hashPart = anchorSlug ? `#${anchorSlug}` : '';
          if (!window.location.search.includes(encodeURIComponent(targetDoc))) {
            window.location.href = `/documents/by-path?path=${encodeURIComponent(targetDoc)}${hashPart}`;
          }
        }
      }, 50);
    };

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetEl = e.target as HTMLElement;
      if (isSameDoc) {
        const jumped = jumpToHeading();
        if (!jumped) {
          popover.classList.toggle('hidden');
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || targetEl.classList.contains('open-icon')) {
        navigateToTarget();
        return;
      }
      popover.classList.toggle('hidden');
    });

    const openBtn = popover.querySelector('.open-btn') as HTMLButtonElement;
    openBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateToTarget();
    });

    const jumpBtn = popover.querySelector('.jump-btn') as HTMLButtonElement;
    jumpBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToHeading();
    });

    return span;
  }
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    public checked: boolean,
    public pos: number
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className =
      'mr-1.5 align-middle rounded border-cme-border-base text-cme-primary focus:ring-0 cursor-pointer';
    input.addEventListener('click', (e) => {
      e.stopPropagation();
      const newBox = input.checked ? '[x]' : '[ ]';
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: newBox },
      });
    });
    return input;
  }
}

export class DividerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr');
    hr.className = 'my-4 border-cme-border-base';
    return hr;
  }
}

export class CodeBlockWidget extends WidgetType {
  constructor(
    public language: string,
    public code: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
    return (
      this.language === other.language &&
      this.code === other.code &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className =
      'code-block-wrapper my-4 rounded-xl border border-cme-border-base bg-cme-bg-subtle overflow-hidden shadow-sm select-none';

    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between px-3.5 py-1.5 border-b border-cme-border-base bg-cme-bg-surface/80 text-xs';

    const currentLangLower = (this.language || '').toLowerCase().trim();
    const effectiveLang = currentLangLower === 'none' ? '' : currentLangLower;

    const knownLanguages = [
      { id: '', label: 'none' },
      { id: 'typescript', label: 'TypeScript' },
      { id: 'javascript', label: 'JavaScript' },
      { id: 'python', label: 'Python' },
      { id: 'cpp', label: 'C++' },
      { id: 'c', label: 'C' },
      { id: 'rust', label: 'Rust' },
      { id: 'go', label: 'Go' },
      { id: 'html', label: 'HTML' },
      { id: 'css', label: 'CSS' },
      { id: 'json', label: 'JSON' },
      { id: 'yaml', label: 'YAML' },
      { id: 'markdown', label: 'Markdown' },
      { id: 'bash', label: 'Bash' },
      { id: 'sql', label: 'SQL' },
    ];

    let optionsHtml = '';
    let found = false;
    for (const item of knownLanguages) {
      const isSelected = item.id === effectiveLang;
      if (isSelected) found = true;
      optionsHtml += `<option value="${item.id}" ${isSelected ? 'selected' : ''}>${item.label}</option>`;
    }
    if (!found && effectiveLang) {
      optionsHtml += `<option value="${effectiveLang}" selected>${effectiveLang}</option>`;
    }

    header.innerHTML = `
      <div class="flex items-center gap-2">
        <select class="bg-transparent font-mono text-[11px] text-cme-text-muted hover:text-cme-text-base border-none focus:outline-none cursor-pointer" data-testid="code-block-lang-select">
          ${optionsHtml}
        </select>
      </div>
      <button type="button" class="copy-btn px-2 py-0.5 rounded text-[11px] font-medium border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base transition-colors">Copy</button>
    `;

    const select = header.querySelector('select') as HTMLSelectElement;
    select.value = effectiveLang;

    select.addEventListener('change', (e) => {
      e.stopPropagation();
      const newLang = select.value;
      const langHeader = newLang ? newLang : '';
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: `\`\`\`${langHeader}\n${this.code}\n\`\`\``,
        },
      });
    });

    const copyBtn = header.querySelector('.copy-btn') as HTMLButtonElement;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(this.code);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 2000);
    });

    // Body container: Flex with line numbers gutter and syntax-highlighted pre
    const body = document.createElement('div');
    body.className = 'flex p-4 overflow-x-auto cursor-pointer font-mono text-xs leading-6';

    const lines = this.code.split('\n');
    const lineCount = lines.length;

    // Line numbers gutter
    const gutter = document.createElement('div');
    gutter.className =
      'line-numbers-gutter select-none text-right pr-3 pl-1 text-cme-text-subtle/50 font-mono text-xs leading-6 border-r border-cme-border-base/40 mr-3 flex-shrink-0';
    gutter.innerHTML = Array.from({ length: lineCount }, (_, i) => `<div>${i + 1}</div>`).join('');

    // Pre & Code with Syntax Highlighting
    const pre = document.createElement('pre');
    pre.className = 'font-mono text-xs text-cme-text-base leading-6 flex-1 overflow-x-auto whitespace-pre';
    const codeElem = document.createElement('code');
    codeElem.className = effectiveLang ? `hljs language-${effectiveLang}` : 'hljs';

    let highlighted = '';
    if (effectiveLang) {
      try {
        if (hljs.getLanguage(effectiveLang)) {
          highlighted = hljs.highlight(this.code, { language: effectiveLang, ignoreIllegals: true }).value;
        } else {
          highlighted = hljs.highlightAuto(this.code).value;
        }
      } catch {
        highlighted = escapeHtml(this.code);
      }
    } else {
      highlighted = escapeHtml(this.code);
    }
    codeElem.innerHTML = highlighted;
    pre.appendChild(codeElem);

    body.appendChild(gutter);
    body.appendChild(pre);

    body.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: this.from + 4 } });
      view.focus();
    });

    container.appendChild(header);
    container.appendChild(body);
    return container;
  }
}

export class InlineMathWidget extends WidgetType {
  constructor(
    public latex: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: InlineMathWidget): boolean {
    return this.latex === other.latex && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className =
      'inline-math-node cme-inline-math inline-flex items-center px-1 py-0.5 rounded hover:bg-cme-bg-subtle/80 cursor-pointer align-baseline';
    span.title = `$${this.latex}$ (Click to edit)`;

    try {
      katex.render(this.latex, span, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      span.textContent = `$${this.latex}$`;
    }

    span.addEventListener('click', (e) => {
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.from + 1 } });
      view.focus();
    });

    return span;
  }
}

export class TableBlockWidget extends WidgetType {
  constructor(
    public rawText: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: TableBlockWidget): boolean {
    return this.rawText === other.rawText && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className =
      'cme-table-block-node my-4 overflow-x-auto rounded-xl border border-cme-border-base bg-cme-bg-surface shadow-sm cursor-pointer select-none';
    container.title = 'Click table to edit markdown source';

    const lines = this.rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      container.textContent = this.rawText;
      return container;
    }

    const splitRow = (line: string): string[] => {
      let trimmed = line;
      if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
      if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
      return trimmed.split('|').map((c) => c.trim());
    };

    const headerCells = splitRow(lines[0]);
    const delimiterCells = splitRow(lines[1]);

    const alignments: ('left' | 'center' | 'right')[] = delimiterCells.map((delim) => {
      if (delim.startsWith(':') && delim.endsWith(':')) return 'center';
      if (delim.endsWith(':')) return 'right';
      return 'left';
    });

    const table = document.createElement('table');
    table.className = 'w-full text-left text-sm border-collapse';

    // Thead
    const thead = document.createElement('thead');
    thead.className = 'bg-cme-bg-subtle/80 text-cme-text-base border-b border-cme-border-base font-semibold';
    const trHead = document.createElement('tr');
    headerCells.forEach((header, idx) => {
      const th = document.createElement('th');
      th.className = 'px-4 py-2.5 text-xs font-semibold tracking-wider border-r border-cme-border-base/40 last:border-r-0';
      th.style.textAlign = alignments[idx] || 'left';
      renderCellContent(th, header);
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    // Tbody
    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-cme-border-base/40 text-cme-text-base';
    for (let r = 2; r < lines.length; r++) {
      const rowCells = splitRow(lines[r]);
      const tr = document.createElement('tr');
      tr.className = (r - 2) % 2 === 1 ? 'bg-cme-bg-subtle/20 hover:bg-cme-bg-hover/40' : 'hover:bg-cme-bg-hover/40';
      headerCells.forEach((_, colIdx) => {
        const td = document.createElement('td');
        td.className = 'px-4 py-2 text-xs border-r border-cme-border-base/40 last:border-r-0';
        td.style.textAlign = alignments[colIdx] || 'left';
        const cellValue = rowCells[colIdx] || '';
        renderCellContent(td, cellValue);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    container.addEventListener('click', (e) => {
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });

    return container;
  }
}

function renderCellContent(container: HTMLElement, text: string) {
  if (!text) {
    container.innerHTML = '&nbsp;';
    return;
  }

  const mathRegex = /(?<![\$\\])\$(?!\s|\$)([^\$\n]+?)(?<!\s|\$)\$(?!\$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mathRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(renderSimpleText(text.slice(lastIndex, match.index)));
    }
    const mathSpan = document.createElement('span');
    mathSpan.className = 'inline-math-cell';
    try {
      katex.render(match[1], mathSpan, { throwOnError: false, displayMode: false });
    } catch {
      mathSpan.textContent = match[0];
    }
    container.appendChild(mathSpan);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    container.appendChild(renderSimpleText(text.slice(lastIndex)));
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderSimpleText(str: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const tokenRegex = /(\*\*[^\*]+\*\*|`[^`]+`|\*[^\*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(str)) !== null) {
    if (m.index > last) {
      frag.appendChild(document.createTextNode(str.slice(last, m.index)));
    }
    const token = m[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      frag.appendChild(strong);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'px-1 py-0.5 rounded bg-cme-bg-subtle text-[11px] font-mono text-pink-600 dark:text-pink-400';
      code.textContent = token.slice(1, -1);
      frag.appendChild(code);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      frag.appendChild(em);
    }
    last = m.index + token.length;
  }
  if (last < str.length) {
    frag.appendChild(document.createTextNode(str.slice(last)));
  }
  return frag;
}

