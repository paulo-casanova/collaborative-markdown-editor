import { WidgetType, EditorView } from '@codemirror/view';
import katex from 'katex';
import { renderMermaidSvg } from '../utils/mermaidRenderer';
import hljs from 'highlight.js';
import { findHeadingPosition, slugify } from '../../navigation/DocumentOutline';
import {
  isExternalUrl,
  stripHeadingNumberPrefix,
  validateLinkTarget,
  extractDocumentHeadings,
  matchesHeadingTarget,
} from '../../../utils/linkValidator';
import { getWorkspaceFileUrl, isMarkdownPath } from '../../../api/documents';
import {
  parseCodeFenceHeader,
  extractSnippetFromText,
  fetchSnippetSource,
  getSnippetState,
  setSnippetState,
} from '../../../utils/snippetSync';
import { resolvePillStyle, parsePillSyntax } from '../../../utils/pillUtils';
import { parseImageDimensionAndAlt, parseImageTarget } from '../../../utils/imageDimensions';
import { splitTableRow, parseTableAlignments } from '../../../utils/tableUtils';

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
    container.className = 'math-block-node py-2 my-0 select-none';

    const card = document.createElement('div');
    card.className =
      'rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm';

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
    card.appendChild(header);

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
    card.appendChild(body);
    card.appendChild(editContainer);
    container.appendChild(card);

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
    container.className = 'mermaid-block-node py-2 my-0 select-none';

    const card = document.createElement('div');
    card.className =
      'rounded-xl border border-cme-border-base bg-cme-bg-surface overflow-hidden shadow-sm';

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
    card.appendChild(header);

    // SVG container
    const svgWrapper = document.createElement('div');
    svgWrapper.className =
      'mermaid-svg-container p-4 flex items-center justify-center overflow-x-auto min-h-[100px] cursor-pointer';
    card.appendChild(svgWrapper);

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
    card.appendChild(drawer);
    container.appendChild(card);

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

export class HeadingNumberWidget extends WidgetType {
  constructor(public numberPrefix: string) {
    super();
  }

  eq(other: HeadingNumberWidget): boolean {
    return this.numberPrefix === other.numberPrefix;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cme-heading-number font-mono text-cme-primary/85 mr-1.5 select-none';
    span.setAttribute('data-testid', 'heading-number-badge');
    span.textContent = `${this.numberPrefix} `;
    return span;
  }
}

export class ImageEmbedWidget extends WidgetType {
  constructor(
    public alt: string,
    public src: string,
    public from: number,
    public to: number,
    public docPath?: string
  ) {
    super();
  }

  eq(other: ImageEmbedWidget): boolean {
    return (
      this.alt === other.alt &&
      this.src === other.src &&
      this.from === other.from &&
      this.to === other.to &&
      this.docPath === other.docPath
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'cme-image-embed inline-flex flex-col items-start gap-1 my-1 select-none max-w-full';

    const parsed = parseImageDimensionAndAlt(this.alt, this.src);
    const targetInfo = parseImageTarget(this.src);
    const cleanSrc = targetInfo.cleanSrc;
    const displayAlt = parsed.altText || targetInfo.title || cleanSrc;

    const resolvedUrl =
      isExternalUrl(cleanSrc) || cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')
        ? (cleanSrc.includes(' ') ? encodeURI(cleanSrc) : cleanSrc)
        : getWorkspaceFileUrl(cleanSrc, this.docPath);

    const link = document.createElement('a');
    link.href = resolvedUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = `${displayAlt} (Click to open in new tab)`;
    link.className = 'inline-block rounded-lg overflow-hidden border border-cme-border-base bg-cme-bg-surface shadow-sm hover:border-cme-primary transition-colors max-w-full';

    const img = document.createElement('img');
    img.src = resolvedUrl;
    img.alt = displayAlt;
    img.className = 'max-w-full block';

    if (parsed.width) {
      if (parsed.width.endsWith('%')) {
        wrapper.style.width = parsed.width;
        link.style.width = '100%';
        img.style.width = '100%';
      } else {
        img.style.width = parsed.width;
      }
    }
    if (parsed.height) {
      img.style.height = parsed.height;
      img.style.objectFit = 'contain';
    } else {
      img.style.height = 'auto';
    }

    img.onerror = () => {
      wrapper.innerHTML = '';
      const badge = document.createElement('span');
      badge.className =
        'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border border-rose-500/40 bg-rose-500/10 text-rose-500 shadow-sm select-none cursor-pointer hover:bg-rose-500/20 transition-colors';
      badge.innerHTML = `🖼⚠ Image not found: <span class="underline font-semibold">${cleanSrc}</span>`;
      badge.title = `Image file could not be loaded: ${cleanSrc} (Click to edit)`;
      badge.onclick = (e) => {
        e.stopPropagation();
        view.dispatch({ selection: { anchor: this.from + 2 } });
        view.focus();
      };
      wrapper.appendChild(badge);
    };

    link.appendChild(img);
    wrapper.appendChild(link);

    wrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });

    return wrapper;
  }
}

export class WikiLinkWidget extends WidgetType {
  constructor(
    public target: string,
    public label: string,
    public from: number,
    public to: number,
    public isValid: boolean = true,
    public isMarkdownLink: boolean = false,
    public invalidReason: string = '',
    public docPath?: string
  ) {
    super();
  }

  eq(other: WikiLinkWidget): boolean {
    return (
      this.target === other.target &&
      this.label === other.label &&
      this.isValid === other.isValid &&
      this.isMarkdownLink === other.isMarkdownLink &&
      this.docPath === other.docPath
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = `${this.isMarkdownLink ? 'markdown-link-node' : 'wiki-link-node'} inline-block align-middle select-none relative my-0 mx-0.5`;
    if (!this.isValid) {
      span.setAttribute('data-broken-link', 'true');
    }

    const cleanTarget = this.target.trim();
    const external = isExternalUrl(cleanTarget);
    const hashIndex = cleanTarget.indexOf('#');
    const targetDoc = !external && hashIndex >= 0 ? cleanTarget.slice(0, hashIndex).trim() : cleanTarget;
    const rawAnchor = !external && hashIndex >= 0 ? cleanTarget.slice(hashIndex + 1).trim() : '';
    let isSameDoc = !external && (cleanTarget.startsWith('#') || targetDoc === '');
    let effectiveAnchor = rawAnchor;
    if (!external && !isSameDoc && targetDoc) {
      if (findHeadingPosition(view.state.doc, targetDoc)) {
        isSameDoc = true;
        effectiveAnchor = rawAnchor || targetDoc;
      }
    }
    const strippedAnchor = stripHeadingNumberPrefix(effectiveAnchor);
    const anchorSlug = effectiveAnchor ? slugify(strippedAnchor || effectiveAnchor) : '';
    const isNonMarkdownAsset = !external && !isSameDoc && !isMarkdownPath(targetDoc);

    const pill = document.createElement('span');
    if (this.isValid) {
      pill.className =
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-xs cursor-pointer border border-cme-primary/30 bg-cme-primary/5 text-cme-primary hover:bg-cme-primary/15 transition-colors';
    } else {
      pill.className =
        'broken-link-pill inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-xs cursor-pointer border border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors';
    }

    const displayLabel =
      this.label || (isSameDoc ? (effectiveAnchor ? `#${effectiveAnchor}` : cleanTarget) : cleanTarget);

    const underlineClass = this.isValid
      ? 'decoration-cme-primary/40'
      : 'decoration-rose-500/60';
    const warningHtml = !this.isValid
      ? `<span class="broken-link-sign text-rose-600 dark:text-rose-400 font-bold" data-testid="broken-link-indicator" title="${escapeHtml(this.invalidReason || 'Target file or heading does not exist')}">⚠</span>`
      : '';

    pill.innerHTML = `${warningHtml}<span class="font-medium underline ${underlineClass} underline-offset-2">${escapeHtml(displayLabel)}</span><span class="open-icon opacity-70 hover:opacity-100 text-[10px] ml-0.5" title="${isSameDoc ? 'Jump to heading' : 'Open target'}">${isSameDoc ? '↓' : '↗'}</span>`;
    pill.title = !this.isValid
      ? `Broken link: ${this.invalidReason || cleanTarget}`
      : external
        ? `External link: ${cleanTarget} (Click to open)`
        : isSameDoc
          ? `Heading link: ${cleanTarget} (Click to jump to heading)`
          : `Link: ${cleanTarget} (Click to open)`;
    span.appendChild(pill);

    // Popover
    const popover = document.createElement('div');
    popover.className =
      'hidden absolute left-0 bottom-full mb-1.5 w-64 p-3 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl z-50 text-xs space-y-2';
    if (isSameDoc) {
      popover.innerHTML = `
        <div class="space-y-1">
          <label class="font-semibold text-cme-text-muted text-[10px]">Target Heading:</label>
          <input type="text" readonly class="w-full px-2 py-1 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none" value="#${escapeHtml(effectiveAnchor || rawAnchor)}" />
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-cme-border-base">
          <button type="button" class="jump-btn px-2 py-1 rounded text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors">Jump to Heading</button>
        </div>
      `;
    } else {
      popover.innerHTML = `
        <div class="space-y-1">
          <label class="font-semibold text-cme-text-muted text-[10px]">Target:</label>
          <input type="text" class="w-full px-2 py-1 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary" placeholder="e.g. guides/intro.md" value="${escapeHtml(this.target)}" />
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-cme-border-base">
          <button type="button" class="open-btn px-2 py-1 rounded text-xs font-medium bg-cme-primary text-white hover:bg-cme-primary/90 transition-colors">Open File</button>
        </div>
      `;
    }
    span.appendChild(popover);

    const jumpToHeading = () => {
      const headingRef = effectiveAnchor || rawAnchor;
      const pos = findHeadingPosition(view.state.doc, headingRef);
      if (pos) {
        view.dispatch({
          selection: { anchor: pos.from },
          effects: EditorView.scrollIntoView(pos.from, { y: 'start', yMargin: 40 }),
        });
        view.focus();
        requestAnimationFrame(() => {
          if (view?.dom?.isConnected) {
            view.dispatch({
              effects: EditorView.scrollIntoView(pos.from, { y: 'start', yMargin: 40 }),
            });
          }
        });
        popover.classList.add('hidden');
        return true;
      }
      return false;
    };

    const navigateToTarget = () => {
      if (external) {
        window.open(cleanTarget, '_blank', 'noopener,noreferrer');
        popover.classList.add('hidden');
        return;
      }
      if (isNonMarkdownAsset) {
        window.open(getWorkspaceFileUrl(targetDoc, this.docPath), '_blank', 'noopener,noreferrer');
        popover.classList.add('hidden');
        return;
      }
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
      if (external || isNonMarkdownAsset) {
        navigateToTarget();
        return;
      }
      if (isSameDoc) {
        const jumped = jumpToHeading();
        if (!jumped) {
          popover.classList.toggle('hidden');
        }
        return;
      }
      if (
        this.isMarkdownLink ||
        e.ctrlKey ||
        e.metaKey ||
        targetEl.classList.contains('open-icon')
      ) {
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
  constructor(public from: number = 0) {
    super();
  }

  eq(other: DividerWidget): boolean {
    return this.from === other.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cme-divider-node py-3 my-0 flex items-center cursor-pointer';
    const hr = document.createElement('hr');
    hr.className = 'w-full border-t border-cme-border-base m-0 p-0 pointer-events-none';
    wrap.appendChild(hr);
    wrap.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return wrap;
  }
}

export class CodeBlockWidget extends WidgetType {
  constructor(
    public language: string,
    public code: string,
    public from: number,
    public to: number,
    public docPath?: string
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
    return (
      this.language === other.language &&
      this.code === other.code &&
      this.from === other.from &&
      this.to === other.to &&
      this.docPath === other.docPath
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'code-block-wrapper py-2 my-0 select-none';

    const card = document.createElement('div');
    card.className =
      'rounded-xl border border-cme-border-base bg-cme-bg-subtle overflow-hidden shadow-sm';

    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between px-3 py-1.5 border-b border-cme-border-base bg-cme-bg-surface/80 text-xs gap-2 min-w-0';

    const snippetInfo = parseCodeFenceHeader(this.language);
    const isSnippet = snippetInfo.isSnippet;
    const effectiveLang = (snippetInfo.language || '').toLowerCase().trim();

    if (isSnippet) {
      const sourceDisplay =
        snippetInfo.source.length > 36
          ? '...' + snippetInfo.source.slice(-33)
          : snippetInfo.source;

      const leftContainer = document.createElement('div');
      leftContainer.className = 'flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden';

      const langBadge = document.createElement('span');
      langBadge.className =
        'px-1.5 py-0.5 rounded bg-cme-bg-subtle font-mono text-[11px] font-semibold text-cme-text-base border border-cme-border-base uppercase shrink-0';
      langBadge.textContent = effectiveLang || 'code';
      leftContainer.appendChild(langBadge);

      const sourceLink = document.createElement('span');
      sourceLink.className =
        'font-mono text-[11px] text-cme-primary flex items-center gap-1 select-text shrink-0 truncate max-w-[200px]';
      sourceLink.title = `${snippetInfo.source} #${snippetInfo.marker}`;
      sourceLink.innerHTML = `🔗 ${escapeHtml(sourceDisplay)}<span class="text-cme-text-muted">#${escapeHtml(snippetInfo.marker)}</span>`;
      leftContainer.appendChild(sourceLink);

      const badge = document.createElement('span');
      badge.className = 'sync-status-badge min-w-0 truncate';
      leftContainer.appendChild(badge);

      header.appendChild(leftContainer);

      const rightContainer = document.createElement('div');
      rightContainer.className = 'flex items-center gap-1.5 shrink-0';

      const resyncBtn = document.createElement('button');
      resyncBtn.type = 'button';
      resyncBtn.className =
        'resync-btn px-2 py-0.5 rounded text-[11px] font-medium border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base transition-colors cursor-pointer';
      resyncBtn.setAttribute('data-testid', 'resync-snippet-btn');
      resyncBtn.title = 'Re-sync code snippet from source';
      resyncBtn.textContent = 'Sync';
      rightContainer.appendChild(resyncBtn);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className =
        'copy-btn px-2 py-0.5 rounded text-[11px] font-medium border border-cme-border-base bg-cme-bg-surface text-cme-text-muted hover:text-cme-text-base transition-colors';
      copyBtn.textContent = 'Copy';
      rightContainer.appendChild(copyBtn);

      header.appendChild(rightContainer);

      const updateSyncBadge = (status?: string, error?: string) => {
        if (status === 'syncing') {
          badge.innerHTML = `<span class="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-sans text-[11px] font-medium animate-pulse inline-flex items-center gap-1 shrink-0">⟳ Syncing...</span>`;
        } else if (status === 'failed') {
          const errDisplay = error ? escapeHtml(error) : 'Snippet sync failed';
          badge.innerHTML = `<span class="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-sans text-[11px] font-medium inline-flex items-center gap-1 border border-rose-500/30 truncate max-w-full" data-testid="snippet-sync-warning" title="${errDisplay}">⚠ ${errDisplay}</span>`;
        } else if (status === 'synced') {
          badge.innerHTML = `<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-sans text-[11px] font-medium inline-flex items-center gap-1 shrink-0" data-testid="snippet-sync-success">✓ Synced</span>`;
        } else {
          badge.innerHTML = '';
        }
      };

      const triggerSync = (force: boolean = false) => {
        const cached = getSnippetState(snippetInfo.source, snippetInfo.marker);
        if (!force && cached) {
          updateSyncBadge(cached.status, cached.error);
          if (
            cached.status === 'synced' &&
            cached.code !== undefined &&
            cached.code.trim() !== this.code.trim()
          ) {
            view.dispatch({
              changes: {
                from: this.from,
                to: this.to,
                insert: `\`\`\`${this.language}\n${cached.code}\n\`\`\``,
              },
            });
          }
          return;
        }

        updateSyncBadge('syncing');
        setSnippetState(snippetInfo.source, snippetInfo.marker, { status: 'syncing' });

        fetchSnippetSource(snippetInfo.source, this.docPath)
          .then((rawSource) => {
            const extracted = extractSnippetFromText(rawSource, snippetInfo.marker);
            if (extracted.error) {
              setSnippetState(snippetInfo.source, snippetInfo.marker, {
                status: 'failed',
                error: extracted.error,
              });
              updateSyncBadge('failed', extracted.error);
            } else {
              setSnippetState(snippetInfo.source, snippetInfo.marker, {
                status: 'synced',
                code: extracted.code,
              });
              updateSyncBadge('synced');
              if (extracted.code.trim() !== this.code.trim()) {
                view.dispatch({
                  changes: {
                    from: this.from,
                    to: this.to,
                    insert: `\`\`\`${this.language}\n${extracted.code}\n\`\`\``,
                  },
                });
              }
            }
          })
          .catch((err) => {
            const errMsg = err?.message || 'Network error';
            setSnippetState(snippetInfo.source, snippetInfo.marker, {
              status: 'failed',
              error: errMsg,
            });
            updateSyncBadge('failed', errMsg);
          });
      };

      triggerSync(false);

      resyncBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerSync(true);
      });
    } else {
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
    }

    const copyBtn = header.querySelector('.copy-btn') as HTMLButtonElement | null;
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText?.(this.code);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 2000);
      });
    }

    // Body container: Flex with line numbers gutter and syntax-highlighted pre
    const body = document.createElement('div');
    body.className = 'flex p-4 overflow-x-auto cursor-pointer font-mono text-xs leading-6';

    const lines = this.code.split('\n');
    const lineCount = this.code.length === 0 ? 1 : lines.length;

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
    if (this.code.length > 0) {
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
    }
    codeElem.innerHTML = highlighted || '\n';
    pre.appendChild(codeElem);

    body.appendChild(gutter);
    body.appendChild(pre);

    body.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: Math.min(this.from + 4, this.to) } });
      view.focus();
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
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
    public to: number,
    public docPath?: string
  ) {
    super();
  }

  eq(other: TableBlockWidget): boolean {
    return (
      this.rawText === other.rawText &&
      this.from === other.from &&
      this.to === other.to &&
      this.docPath === other.docPath
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cme-table-block-node py-2 my-0 select-none';

    const lines = this.rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      container.textContent = this.rawText;
      return container;
    }

    const card = document.createElement('div');
    card.className =
      'overflow-x-auto rounded-xl border border-cme-border-base bg-cme-bg-surface shadow-sm cursor-pointer';
    card.title = 'Click table to edit markdown source';

    const headerCells = splitTableRow(lines[0]);
    const alignments = parseTableAlignments(lines[1]);

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
      renderCellContent(th, header, view, this.docPath);
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    // Tbody
    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-cme-border-base/40 text-cme-text-base';
    for (let r = 2; r < lines.length; r++) {
      const rowCells = splitTableRow(lines[r]);
      const tr = document.createElement('tr');
      tr.className = (r - 2) % 2 === 1 ? 'bg-cme-bg-subtle/20 hover:bg-cme-bg-hover/40' : 'hover:bg-cme-bg-hover/40';
      headerCells.forEach((_, colIdx) => {
        const td = document.createElement('td');
        td.className = 'px-4 py-2 text-xs border-r border-cme-border-base/40 last:border-r-0';
        td.style.textAlign = alignments[colIdx] || 'left';
        const cellValue = rowCells[colIdx] || '';
        renderCellContent(td, cellValue, view, this.docPath);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
    container.appendChild(card);

    container.addEventListener('click', (e) => {
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });

    return container;
  }
}

function createTableCellLink(
  rawTarget: string,
  displayLabel: string,
  view: EditorView,
  docPath?: string
): HTMLElement {
  const docText = view.state.doc.toString();
  const targetInfo = parseImageTarget(rawTarget);
  const cleanTarget = targetInfo.cleanSrc;
  const external = isExternalUrl(cleanTarget);
  const hashIdx = cleanTarget.indexOf('#');
  const targetDoc = !external && hashIdx >= 0 ? cleanTarget.slice(0, hashIdx).trim() : cleanTarget;
  const rawAnchor = !external && hashIdx >= 0 ? cleanTarget.slice(hashIdx + 1).trim() : '';

  let isSameDoc = !external && (cleanTarget.startsWith('#') || targetDoc === '');
  let effectiveAnchor = rawAnchor;
  if (!external && !isSameDoc && targetDoc) {
    const headings = extractDocumentHeadings(docText);
    if (headings.some((h) => matchesHeadingTarget(h.rawText, targetDoc))) {
      isSameDoc = true;
      effectiveAnchor = rawAnchor || targetDoc;
    }
  }

  const validation = validateLinkTarget(cleanTarget, docText, docPath);
  if (!validation.valid) {
    const broken = document.createElement('span');
    broken.className =
      'broken-link-span inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded-md border border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400';
    broken.title = `Broken link: ${validation.reason || 'Target file or heading does not exist'}`;
    const sign = document.createElement('span');
    sign.className = 'broken-link-sign font-bold';
    sign.textContent = '⚠';
    const txt = document.createElement('span');
    txt.className = 'font-medium underline decoration-rose-500/60';
    txt.textContent = displayLabel;
    broken.appendChild(sign);
    broken.appendChild(txt);
    return broken;
  }

  const a = document.createElement('a');
  a.className =
    'text-cme-primary hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer';
  a.textContent = displayLabel;
  a.title = `${displayLabel} (${cleanTarget})`;

  if (external) {
    a.href = cleanTarget;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const extIcon = document.createElement('span');
    extIcon.className = 'text-[10px] opacity-70 ml-0.5';
    extIcon.textContent = '↗';
    a.appendChild(extIcon);
  } else {
    a.href = '#';
  }

  a.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (external) {
      window.open(cleanTarget, '_blank', 'noopener,noreferrer');
      return;
    }

    if (isSameDoc) {
      const headingRef = effectiveAnchor || rawAnchor || cleanTarget.replace(/^#/, '');
      const pos = findHeadingPosition(view.state.doc, headingRef);
      if (pos) {
        view.dispatch({
          selection: { anchor: pos.from },
          effects: EditorView.scrollIntoView(pos.from, { y: 'start', yMargin: 40 }),
        });
        view.focus();
      }
      return;
    }

    const isNonMarkdownAsset = !isMarkdownPath(targetDoc);
    if (isNonMarkdownAsset) {
      window.open(getWorkspaceFileUrl(targetDoc, docPath), '_blank', 'noopener,noreferrer');
      return;
    }

    const anchorSlug = effectiveAnchor ? slugify(effectiveAnchor) : '';
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
  });

  return a;
}

function renderCellContent(
  container: HTMLElement,
  text: string,
  view: EditorView,
  docPath?: string
) {
  if (!text || !text.trim()) {
    container.innerHTML = '&nbsp;';
    return;
  }

  const tokenRegex =
    /(`[^`]+`|(?<![\$\\])\$(?!\s|\$)([^\$\n]+?)(?<!\s|\$)\$(?!\$)|(?<!!)\[(?:pill|status|priority):(?:[a-zA-Z0-9#_-]+\|)?[^\]\n]+\]|(?<!\!)\[\[([^\]]+)\]\]|(?<!!)\[([^\][\n]+)\]\(([^)\n]+)\)|~~[^~\n]+~~|\*\*[^*\n]+\*\*|(?<![a-zA-Z0-9_])__(?:[^\s_\n]|[^\s_\n][^_\n]*?[^\s_\n])__(?![a-zA-Z0-9_])|\*[^*\n]+\*|(?<![a-zA-Z0-9_])_(?:[^\s_\n]|[^\s_\n][^_\n]*?[^\s_\n])_(?![a-zA-Z0-9_]))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];

    // 1. Math: $inline$
    if (match[2] && token.startsWith('$') && token.endsWith('$')) {
      const mathSpan = document.createElement('span');
      mathSpan.className = 'inline-math-cell';
      try {
        katex.render(match[2], mathSpan, { throwOnError: false, displayMode: false });
      } catch {
        mathSpan.textContent = token;
      }
      container.appendChild(mathSpan);
    }
    // 2. Inline Code: `...`
    else if (token.startsWith('`') && token.endsWith('`') && token.length > 1) {
      const code = document.createElement('code');
      code.className = 'px-1 py-0.5 rounded bg-cme-bg-subtle text-[11px] font-mono text-pink-600 dark:text-pink-400';
      code.textContent = token.slice(1, -1);
      container.appendChild(code);
    }
    // 3. Custom Pills: [pill:...], [status:...], [priority:...]
    else if (token.startsWith('[') && token.endsWith(']') && (token.startsWith('[pill:') || token.startsWith('[status:') || token.startsWith('[priority:'))) {
      const parsed = parsePillSyntax(token);
      if (parsed) {
        const style = resolvePillStyle(parsed.color);
        const pillSpan = document.createElement('span');
        pillSpan.className = `cme-pill inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border align-baseline select-none transition-colors my-0.5 mx-0.5 ${style.bgClass} ${style.textClass} ${style.borderClass}`;
        pillSpan.title = token;
        if (parsed.isCustomHex) {
          pillSpan.style.backgroundColor = `${parsed.color}20`;
          pillSpan.style.borderColor = `${parsed.color}40`;
          pillSpan.style.color = parsed.color;
        }
        const dot = document.createElement('span');
        dot.className = 'w-1.5 h-1.5 rounded-full flex-shrink-0';
        dot.style.backgroundColor = parsed.isCustomHex ? parsed.color : (style.dotColor || '#94a3b8');
        pillSpan.appendChild(dot);
        const labelSpan = document.createElement('span');
        labelSpan.textContent = parsed.label;
        pillSpan.appendChild(labelSpan);
        container.appendChild(pillSpan);
      } else {
        container.appendChild(document.createTextNode(token));
      }
    }
    // 4. WikiLinks: [[target|label]] or [[target]]
    else if (token.startsWith('[[') && token.endsWith(']]')) {
      const inner = token.slice(2, -2);
      const pipeIdx = inner.indexOf('|');
      const target = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
      const alias = (pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : '').trim();
      const displayLabel = alias || target;
      container.appendChild(createTableCellLink(target, displayLabel, view, docPath));
    }
    // 5. Markdown Links: [label](target)
    else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const linkMatch = token.match(/^\[([^\][\n]+)\]\(([^)\n]+)\)$/);
      if (linkMatch) {
        const label = linkMatch[1].trim();
        const rawTarget = linkMatch[2].trim();
        container.appendChild(createTableCellLink(rawTarget, label, view, docPath));
      } else {
        container.appendChild(document.createTextNode(token));
      }
    }
    // 6. Strikethrough: ~~...~~
    else if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
      const del = document.createElement('del');
      del.textContent = token.slice(2, -2);
      container.appendChild(del);
    }
    // 7. Bold: **...** or __...__
    else if ((token.startsWith('**') && token.endsWith('**') && token.length > 4) ||
             (token.startsWith('__') && token.endsWith('__') && token.length > 4)) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      container.appendChild(strong);
    }
    // 8. Italic: *...* or _..._
    else if ((token.startsWith('*') && token.endsWith('*') && token.length > 2) ||
             (token.startsWith('_') && token.endsWith('_') && token.length > 2)) {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      container.appendChild(em);
    } else {
      container.appendChild(document.createTextNode(token));
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export class PillWidget extends WidgetType {
  constructor(
    public color: string,
    public label: string,
    public from: number,
    public to: number,
    public rawText: string
  ) {
    super();
  }

  eq(other: PillWidget): boolean {
    return (
      this.color === other.color &&
      this.label === other.label &&
      this.from === other.from &&
      this.to === other.to &&
      this.rawText === other.rawText
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    const style = resolvePillStyle(this.color);
    span.className = `cme-pill inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border cursor-pointer align-baseline select-none transition-colors my-0.5 mx-0.5 ${style.bgClass} ${style.textClass} ${style.borderClass}`;
    span.title = `${this.rawText} (Click to edit)`;

    if (this.color.startsWith('#')) {
      span.style.backgroundColor = `${this.color}20`;
      span.style.borderColor = `${this.color}40`;
      span.style.color = this.color;
    }

    // Dot indicator
    const dot = document.createElement('span');
    dot.className = 'w-1.5 h-1.5 rounded-full flex-shrink-0';
    dot.style.backgroundColor = this.color.startsWith('#') ? this.color : (style.dotColor || '#94a3b8');
    span.appendChild(dot);

    // Label
    const textNode = document.createElement('span');
    textNode.textContent = this.label;
    span.appendChild(textNode);

    // Focus cursor inside pill text on click to reveal raw markdown
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.from + 1 } });
      view.focus();
    });

    return span;
  }
}


