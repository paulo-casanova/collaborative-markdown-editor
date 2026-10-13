import { WidgetType, EditorView } from '@codemirror/view';
import katex from 'katex';
import { renderMermaidSvg } from '../utils/mermaidRenderer';

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

  toDOM(_view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className =
      'wiki-link-node inline-block align-middle select-none relative my-0.5 mx-0.5';

    const pill = document.createElement('span');
    pill.className =
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-xs cursor-pointer border border-cme-primary/30 bg-cme-primary/5 text-cme-primary hover:bg-cme-primary/15 transition-colors';
    pill.innerHTML = `<span class="font-medium underline decoration-cme-primary/40 underline-offset-2">${this.label}</span>`;
    span.appendChild(pill);

    // Popover
    const popover = document.createElement('div');
    popover.className =
      'hidden absolute left-0 bottom-full mb-1.5 w-64 p-3 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl z-50 text-xs space-y-2';
    popover.innerHTML = `
      <div class="space-y-1">
        <label class="font-semibold text-cme-text-muted text-[10px]">Target Document:</label>
        <input type="text" class="w-full px-2 py-1 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary" placeholder="e.g. guides/intro.md" value="${this.target}" />
      </div>
      <div class="flex items-center justify-between pt-1 border-t border-cme-border-base">
        <button type="button" class="open-btn px-2 py-1 rounded text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors">Open File</button>
      </div>
    `;
    span.appendChild(popover);

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.classList.toggle('hidden');
    });

    const openBtn = popover.querySelector('.open-btn') as HTMLButtonElement;
    openBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window !== 'undefined') {
        window.location.href = `/documents/by-path?path=${encodeURIComponent(this.target)}`;
      }
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
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <select class="bg-transparent font-mono text-[11px] text-cme-text-muted hover:text-cme-text-base border-none focus:outline-none cursor-pointer">
          <option value="typescript">TypeScript</option>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="cpp">C++</option>
        </select>
      </div>
      <button type="button" class="copy-btn px-2 py-0.5 rounded text-[11px] font-medium border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base">Copy</button>
    `;

    const select = header.querySelector('select') as HTMLSelectElement;
    if (this.language) {
      select.value = this.language;
    }

    select.addEventListener('change', (e) => {
      e.stopPropagation();
      const newLang = select.value;
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: `\`\`\`${newLang}\n${this.code}\n\`\`\``,
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

    const body = document.createElement('div');
    body.className = 'p-4 overflow-x-auto cursor-pointer';
    const pre = document.createElement('pre');
    pre.className = 'font-mono text-xs text-cme-text-base leading-relaxed';
    pre.textContent = this.code;
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

