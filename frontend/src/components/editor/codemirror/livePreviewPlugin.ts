import {
  EditorView,
  Decoration,
  DecorationSet,
} from '@codemirror/view';
import {
  RangeSetBuilder,
  StateField,
  StateEffect,
  EditorState,
  Extension,
} from '@codemirror/state';
import {
  MathBlockWidget,
  MermaidBlockWidget,
  WikiLinkWidget,
  TaskCheckboxWidget,
  DividerWidget,
  CodeBlockWidget,
  InlineMathWidget,
  TableBlockWidget,
  HeadingNumberWidget,
  ImageEmbedWidget,
  PillWidget,
} from './livePreviewWidgets';
import { parsePillSyntax } from '../../../utils/pillUtils';
import { slugify } from '../../navigation/DocumentOutline';
import {
  validateLinkTarget,
  stripHeadingNumberPrefix,
} from '../../../utils/linkValidator';
import { useUIStore } from '../../../stores/uiStore';

export const forceLivePreviewRebuild = StateEffect.define<boolean>();

interface DecoItem {
  from: number;
  to: number;
  deco: Decoration;
}

export function createLivePreviewPlugin(
  isDark: boolean = false,
  documentPath?: string
): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildLivePreviewDecorations(state, isDark, documentPath);
    },
    update(decorations, tr) {
      const forced = tr.effects.some((e) => e.is(forceLivePreviewRebuild));
      if (tr.docChanged || tr.selection || forced) {
        return buildLivePreviewDecorations(tr.state, isDark, documentPath);
      }
      return decorations.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

export function buildLivePreviewDecorations(
  state: EditorState,
  isDark: boolean = false,
  documentPath?: string
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const sel = state.selection.main;
  const cursorFrom = sel.from;
  const cursorTo = sel.to;

  const docText = doc.toString();
  const numberHeaders = useUIStore.getState().numberHeaders;
  const items: DecoItem[] = [];
  const headingSlugCounts: Record<string, number> = {};
  const headingCounters = [0, 0, 0, 0, 0, 0];

  // Track replaced ranges to prevent overlapping replacement decorations
  const replacedRanges: { from: number; to: number }[] = [];
  // Track fenced code blocks & inline code spans so math/links/formatting inside code are never parsed
  const codeOrFenceRanges: { from: number; to: number }[] = [];

  const isOverlappingReplaced = (from: number, to: number) => {
    return replacedRanges.some((r) => Math.max(from, r.from) < Math.min(to, r.to));
  };

  const isInsideCodeOrFence = (from: number, to: number) => {
    return codeOrFenceRanges.some((r) => Math.max(from, r.from) < Math.min(to, r.to));
  };

  const addReplace = (from: number, to: number, deco: Decoration) => {
    if (from >= to) return;
    if (!isOverlappingReplaced(from, to)) {
      replacedRanges.push({ from, to });
      items.push({ from, to, deco });
    }
  };

  let match: RegExpExecArray | null;

  // 1. Multiline Blocks: Mermaid Diagrams (```mermaid ... ```)
  const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
  while ((match = mermaidRegex.exec(docText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const source = match[1].trim();
    codeOrFenceRanges.push({ from, to });

    const cursorInside = cursorTo >= from && cursorFrom <= to;
    if (!cursorInside && source.length > 0) {
      addReplace(
        from,
        to,
        Decoration.replace({
          widget: new MermaidBlockWidget(source, from, to, isDark),
          block: true,
        })
      );
    }
  }

  // 2. Multiline Blocks: Fenced Code Blocks (```lang ... ``` or ```lang|source|marker ... ```)
  const codeBlockRegex = /```([^\n]*)\n([\s\S]*?)\n```/g;
  while ((match = codeBlockRegex.exec(docText)) !== null) {
    const rawHeader = match[1].trim();
    if (rawHeader.toLowerCase().startsWith('mermaid')) continue;
    const from = match.index;
    const to = from + match[0].length;
    const code = match[2];
    codeOrFenceRanges.push({ from, to });

    const cursorInside = cursorTo >= from && cursorFrom <= to;
    if (!cursorInside && code.length > 0) {
      addReplace(
        from,
        to,
        Decoration.replace({
          widget: new CodeBlockWidget(rawHeader || '', code, from, to, documentPath),
          block: true,
        })
      );
    }
  }

  // Pre-scan inline backtick code spans (`...`) on non-fenced lines so display math & links inside backticks are ignored
  const lineCount = doc.lines;
  for (let i = 1; i <= lineCount; i++) {
    const line = doc.line(i);
    if (isInsideCodeOrFence(line.from, line.to)) continue;
    const inlineBacktickRegex = /(?<!`)`([^`\n]+)`(?!`)/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = inlineBacktickRegex.exec(line.text)) !== null) {
      const cFrom = line.from + cMatch.index;
      const cTo = cFrom + cMatch[0].length;
      codeOrFenceRanges.push({ from: cFrom, to: cTo });
    }
  }

  // Helper to check if a range [from, to] is inside a blockquote line (> ...) or surrounded by quotes ("..." or '...')
  const isRangeInQuote = (from: number, to: number): boolean => {
    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(to);
    for (let l = startLine.number; l <= endLine.number; l++) {
      if (/^\s*>/.test(doc.line(l).text)) {
        return true;
      }
    }
    // Check if wrapped in "..." or '...' on the same line
    if (startLine.number === endLine.number) {
      const lineText = startLine.text;
      const relFrom = from - startLine.from;
      const relTo = to - startLine.from;
      const beforeChar = relFrom > 0 ? lineText[relFrom - 1] : '';
      const afterChar = relTo < lineText.length ? lineText[relTo] : '';
      if ((beforeChar === '"' && afterChar === '"') || (beforeChar === "'" && afterChar === "'")) {
        return true;
      }
      // Also check if inside an enclosing quoted segment on the line
      const prefix = lineText.slice(0, relFrom);
      const suffix = lineText.slice(relTo);
      const doubleQuotesBefore = (prefix.match(/"/g) || []).length;
      const doubleQuotesAfter = (suffix.match(/"/g) || []).length;
      if (doubleQuotesBefore % 2 === 1 && doubleQuotesAfter >= 1) {
        return true;
      }
    }
    return false;
  };

  // 3. Multiline Blocks: Display Math ($$...$$)
  const mathRegex = /\$\$([\s\S]*?)\$\$/g;
  while ((match = mathRegex.exec(docText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const latex = match[1].trim();

    if (isInsideCodeOrFence(from, to)) {
      continue;
    }

    // Math blocks inside quotes should not be formatted as KaTeX: show as monospace
    if (isRangeInQuote(from, to)) {
      const startLine = doc.lineAt(from);
      const endLine = doc.lineAt(to);
      if (startLine.number === endLine.number) {
        items.push({
          from,
          to,
          deco: Decoration.mark({ class: 'cme-live-code font-mono' }),
        });
      }
      continue;
    }

    const cursorInside = cursorTo >= from && cursorFrom <= to;
    if (!cursorInside && latex.length > 0) {
      // Single-line $$...$$ inside text vs multiline block
      const startLine = doc.lineAt(from);
      const endLine = doc.lineAt(to);
      const isFullLines =
        from === startLine.from && to === endLine.to;
      if (isFullLines) {
        addReplace(
          from,
          to,
          Decoration.replace({
            widget: new MathBlockWidget(latex, from, to),
            block: true,
          })
        );
      } else {
        addReplace(
          from,
          to,
          Decoration.replace({
            widget: new InlineMathWidget(latex, from, to),
          })
        );
      }
    }
  }

  // 3.5 Multiline Blocks: GFM Markdown Tables
  let tableScanIdx = 1;
  while (tableScanIdx <= lineCount) {
    const scanLine = doc.line(tableScanIdx);
    const scanText = scanLine.text.trim();
    if (
      scanText.includes('|') &&
      tableScanIdx < lineCount &&
      !isOverlappingReplaced(scanLine.from, scanLine.to) &&
      !isInsideCodeOrFence(scanLine.from, scanLine.to)
    ) {
      const nextLine = doc.line(tableScanIdx + 1);
      const nextText = nextLine.text.trim();
      const isDelimiter = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(nextText);
      if (isDelimiter) {
        const tableStartLine = scanLine;
        let tableEndLine = nextLine;
        let curIdx = tableScanIdx + 2;
        while (curIdx <= lineCount) {
          const curLine = doc.line(curIdx);
          const curText = curLine.text.trim();
          if (!curText.includes('|') || curText.length === 0) {
            break;
          }
          tableEndLine = curLine;
          curIdx++;
        }

        const tFrom = tableStartLine.from;
        const tTo = tableEndLine.to;
        const tableRaw = docText.slice(tFrom, tTo);
        const cursorInsideTable = cursorTo >= tFrom && cursorFrom <= tTo;

        if (!cursorInsideTable) {
          addReplace(
            tFrom,
            tTo,
            Decoration.replace({
              widget: new TableBlockWidget(tableRaw, tFrom, tTo),
              block: true,
            })
          );
        }

        tableScanIdx = curIdx;
        continue;
      }
    }
    tableScanIdx++;
  }

  // 4. Line-by-line inspection for headings, task lists, dividers, inline formatting
  for (let i = 1; i <= lineCount; i++) {
    const line = doc.line(i);
    const lineFrom = line.from;
    const lineTo = line.to;
    const lineText = line.text;

    // If line is part of an already replaced block or fenced code block, skip line-level decorations
    if (isOverlappingReplaced(lineFrom, lineTo) || isInsideCodeOrFence(lineFrom, lineTo)) {
      // Wait: only skip if the whole line is inside a fenced block (not just an inline code span on the line)
      const inFence = codeOrFenceRanges.some(
        (r) => r.from <= lineFrom && r.to >= lineTo && (doc.lineAt(r.from).number !== doc.lineAt(r.to).number)
      );
      if (isOverlappingReplaced(lineFrom, lineTo) || inFence) {
        continue;
      }
    }

    const cursorOnLine = cursorTo >= lineFrom && cursorFrom <= lineTo;

    // 4a. Horizontal Rule: ---, ***, ___, - - -, * * *, etc.
    if (/^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(lineText.trim())) {
      if (!cursorOnLine) {
        addReplace(
          lineFrom,
          lineTo,
          Decoration.replace({
            widget: new DividerWidget(lineFrom),
            block: true,
          })
        );
        continue;
      }
    }

    // 4b. Headings: # through ######
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(lineText);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const prefixLen = level + 1; // e.g. "## " = 3 chars
      const rawHeadingText = headingMatch[2].trim();
      const strippedHeadingText = stripHeadingNumberPrefix(rawHeadingText) || rawHeadingText;
      const baseSlug = slugify(strippedHeadingText.replace(/[*_`]/g, ''));
      const count = headingSlugCounts[baseSlug] || 0;
      headingSlugCounts[baseSlug] = count + 1;
      const headingId = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      // Update hierarchical heading counters
      headingCounters[level - 1] += 1;
      for (let k = level; k < 6; k++) {
        headingCounters[k] = 0;
      }
      let startIdx = 0;
      while (startIdx < level - 1 && headingCounters[startIdx] === 0) {
        startIdx++;
      }
      const numParts: number[] = [];
      for (let k = startIdx; k < level; k++) {
        numParts.push(headingCounters[k] || 1);
      }
      const numberPrefix =
        numParts.length === 1 ? `${numParts[0]}.` : `${numParts.join('.')}.`;
      const alreadyNumbered = /^\d+(?:\.\d+)*\.?\s+/.test(rawHeadingText);

      items.push({
        from: lineFrom,
        to: lineFrom,
        deco: Decoration.line({
          attributes: { id: headingId, 'data-heading-level': String(level) },
        }),
      });

      const headingClass =
        level === 1
          ? 'cme-live-h1'
          : level === 2
            ? 'cme-live-h2'
            : level === 3
              ? 'cme-live-h3'
              : 'cme-live-h4';

      if (!cursorOnLine) {
        addReplace(lineFrom, lineFrom + prefixLen, Decoration.replace({}));
        if (numberHeaders && !alreadyNumbered) {
          items.push({
            from: lineFrom + prefixLen,
            to: lineFrom + prefixLen,
            deco: Decoration.widget({
              widget: new HeadingNumberWidget(numberPrefix),
              side: 1,
            }),
          });
        }
        items.push({
          from: lineFrom + prefixLen,
          to: lineTo,
          deco: Decoration.mark({ class: headingClass }),
        });
      } else {
        items.push({
          from: lineFrom,
          to: lineFrom + prefixLen,
          deco: Decoration.mark({ class: 'cme-syntax-marker' }),
        });
        if (numberHeaders && !alreadyNumbered) {
          items.push({
            from: lineFrom + prefixLen,
            to: lineFrom + prefixLen,
            deco: Decoration.widget({
              widget: new HeadingNumberWidget(numberPrefix),
              side: 1,
            }),
          });
        }
        items.push({
          from: lineFrom + prefixLen,
          to: lineTo,
          deco: Decoration.mark({ class: headingClass }),
        });
      }
      continue;
    }

    // 4c. Blockquote: > text
    const quoteMatch = /^(\s*>\s*)(.*)$/.exec(lineText);
    const isBlockquoteLine = Boolean(quoteMatch);
    if (quoteMatch) {
      const markerLen = quoteMatch[1].length;
      if (!cursorOnLine) {
        addReplace(lineFrom, lineFrom + markerLen, Decoration.replace({}));
        if (lineFrom + markerLen < lineTo) {
          items.push({
            from: lineFrom + markerLen,
            to: lineTo,
            deco: Decoration.mark({ class: 'cme-live-blockquote' }),
          });
        }
      } else {
        items.push({
          from: lineFrom,
          to: lineFrom + markerLen,
          deco: Decoration.mark({ class: 'cme-syntax-marker' }),
        });
      }
    }

    // 4d. Inline code: `code` (processed BEFORE links, bold/italic, and inline math)
    const codeRegex = /(?<!`)`([^`\n]+)`(?!`)/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = codeRegex.exec(lineText)) !== null) {
      const cFrom = lineFrom + cMatch.index;
      const cTo = cFrom + cMatch[0].length;

      if (isOverlappingReplaced(cFrom, cTo)) continue;

      const cursorInCode = cursorTo >= cFrom && cursorFrom <= cTo;
      if (!cursorInCode) {
        addReplace(cFrom, cFrom + 1, Decoration.replace({}));
        items.push({
          from: cFrom + 1,
          to: cTo - 1,
          deco: Decoration.mark({ class: 'cme-live-code' }),
        });
        addReplace(cTo - 1, cTo, Decoration.replace({}));
      }
      // Reserve the entire inline code span so inner syntax is never formatted as math/links/bold
      replacedRanges.push({ from: cFrom, to: cTo });
    }

    // 4e. Task list checkbox: - [ ] or - [x]
    const taskMatch = /^(\s*[-*]\s+)\[([ xX])\]\s+/.exec(lineText);
    if (taskMatch) {
      const prefixLen = taskMatch[1].length;
      const boxStart = lineFrom + prefixLen;
      const boxEnd = boxStart + 3; // "[ ]" or "[x]"
      const isChecked = taskMatch[2].toLowerCase() === 'x';

      const cursorOnBox = cursorTo >= boxStart && cursorFrom <= boxEnd;
      if (!cursorOnBox) {
        addReplace(
          boxStart,
          boxEnd,
          Decoration.replace({
            widget: new TaskCheckboxWidget(isChecked, boxStart),
          })
        );
      }
    }

    // 4f. Embedded Images: ![alt](src)
    const imgRegex = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(lineText)) !== null) {
      const imgFrom = lineFrom + imgMatch.index;
      const imgTo = imgFrom + imgMatch[0].length;
      if (isOverlappingReplaced(imgFrom, imgTo)) continue;

      const alt = imgMatch[1].trim();
      const rawSrc = imgMatch[2].trim().split(/\s+/)[0];
      const cursorInImg = cursorTo >= imgFrom && cursorFrom <= imgTo;
      if (!cursorInImg && rawSrc) {
        addReplace(
          imgFrom,
          imgTo,
          Decoration.replace({
            widget: new ImageEmbedWidget(alt, rawSrc, imgFrom, imgTo, documentPath),
          })
        );
      }
    }

    // 4g. Obsidian File & Image Embeds: ![[target]] or ![[target|alt]]
    const embedRegex = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let embMatch: RegExpExecArray | null;
    while ((embMatch = embedRegex.exec(lineText)) !== null) {
      const embFrom = lineFrom + embMatch.index;
      const embTo = embFrom + embMatch[0].length;
      if (isOverlappingReplaced(embFrom, embTo)) continue;

      const rawTarget = embMatch[1].trim();
      const altOrSize = embMatch[2] ? embMatch[2].trim() : '';
      const cursorInEmb = cursorTo >= embFrom && cursorFrom <= embTo;
      if (!cursorInEmb && rawTarget) {
        addReplace(
          embFrom,
          embTo,
          Decoration.replace({
            widget: new ImageEmbedWidget(altOrSize || rawTarget, rawTarget, embFrom, embTo, documentPath),
          })
        );
      }
    }

    // 4h. Wiki Links: [[target|label]] or [[target]] (excluding embeds ![[...]])
    const wikiRegex = /(?<!\!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let wMatch: RegExpExecArray | null;
    while ((wMatch = wikiRegex.exec(lineText)) !== null) {
      const wFrom = lineFrom + wMatch.index;
      const wTo = wFrom + wMatch[0].length;
      if (isOverlappingReplaced(wFrom, wTo)) continue;

      const target = wMatch[1];
      const label = wMatch[2] || target;

      const cursorInWiki = cursorTo >= wFrom && cursorFrom <= wTo;
      if (!cursorInWiki) {
        const validation = validateLinkTarget(target, docText, documentPath);
        addReplace(
          wFrom,
          wTo,
          Decoration.replace({
            widget: new WikiLinkWidget(
              target,
              label,
              wFrom,
              wTo,
              validation.valid,
              false,
              validation.reason || '',
              documentPath
            ),
          })
        );
      }
    }

    // 4h2. Custom Pills & Badges: [pill:color|label], [pill:label], [status:...], [priority:...]
    const pillRegex = /(?<!!)\[(pill|status|priority):(?:([a-zA-Z0-9#_-]+)\|)?([^\]\n]+)\]/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pillRegex.exec(lineText)) !== null) {
      const pFrom = lineFrom + pMatch.index;
      const pTo = pFrom + pMatch[0].length;
      if (isOverlappingReplaced(pFrom, pTo)) continue;

      const parsed = parsePillSyntax(pMatch[0]);
      if (!parsed) continue;

      const cursorInPill = cursorTo >= pFrom && cursorFrom <= pTo;
      if (!cursorInPill) {
        addReplace(
          pFrom,
          pTo,
          Decoration.replace({
            widget: new PillWidget(parsed.color, parsed.label, pFrom, pTo, pMatch[0]),
          })
        );
      }
    }

    // 4i. Standard Markdown Links: [label](target) (excluding images ![alt](src))
    const mdLinkRegex = /(?<!!)\[([^\][\n]+)\]\(([^)\n]+)\)/g;
    let mdMatch: RegExpExecArray | null;
    while ((mdMatch = mdLinkRegex.exec(lineText)) !== null) {
      const mFrom = lineFrom + mdMatch.index;
      const mTo = mFrom + mdMatch[0].length;
      if (isOverlappingReplaced(mFrom, mTo)) continue;

      const label = mdMatch[1].trim();
      const rawTarget = mdMatch[2].trim().split(/\s+/)[0];

      const cursorInLink = cursorTo >= mFrom && cursorFrom <= mTo;
      if (!cursorInLink && rawTarget) {
        const validation = validateLinkTarget(rawTarget, docText, documentPath);
        addReplace(
          mFrom,
          mTo,
          Decoration.replace({
            widget: new WikiLinkWidget(
              rawTarget,
              label,
              mFrom,
              mTo,
              validation.valid,
              true,
              validation.reason || '',
              documentPath
            ),
          })
        );
      }
    }

    // 4i. Inline formatting: Bold **text**
    const boldRegex = /\*\*([^\*\n]+)\*\*/g;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = boldRegex.exec(lineText)) !== null) {
      const bFrom = lineFrom + bMatch.index;
      const bTo = bFrom + bMatch[0].length;

      if (isOverlappingReplaced(bFrom, bTo)) continue;

      const cursorInBold = cursorTo >= bFrom && cursorFrom <= bTo;
      if (!cursorInBold) {
        addReplace(bFrom, bFrom + 2, Decoration.replace({}));
        items.push({
          from: bFrom + 2,
          to: bTo - 2,
          deco: Decoration.mark({ class: 'cme-live-bold font-bold' }),
        });
        addReplace(bTo - 2, bTo, Decoration.replace({}));
      } else {
        items.push({
          from: bFrom,
          to: bFrom + 2,
          deco: Decoration.mark({ class: 'cme-syntax-marker' }),
        });
        items.push({
          from: bTo - 2,
          to: bTo,
          deco: Decoration.mark({ class: 'cme-syntax-marker' }),
        });
      }
    }

    // 4j. Inline formatting: Italic *text* (when not bold)
    const italicRegex = /(?<!\*)\*([^\*\n]+)\*(?!\*)/g;
    let iMatch: RegExpExecArray | null;
    while ((iMatch = italicRegex.exec(lineText)) !== null) {
      const iFrom = lineFrom + iMatch.index;
      const iTo = iFrom + iMatch[0].length;

      if (isOverlappingReplaced(iFrom, iTo)) continue;

      const cursorInItalic = cursorTo >= iFrom && cursorFrom <= iTo;
      if (!cursorInItalic) {
        addReplace(iFrom, iFrom + 1, Decoration.replace({}));
        items.push({
          from: iFrom + 1,
          to: iTo - 1,
          deco: Decoration.mark({ class: 'cme-live-italic italic' }),
        });
        addReplace(iTo - 1, iTo, Decoration.replace({}));
      }
    }

    // 4k. Inline formatting: Strikethrough ~~text~~
    const strikeRegex = /~~([^~\n]+)~~/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = strikeRegex.exec(lineText)) !== null) {
      const sFrom = lineFrom + sMatch.index;
      const sTo = sFrom + sMatch[0].length;

      if (isOverlappingReplaced(sFrom, sTo)) continue;

      const cursorInStrike = cursorTo >= sFrom && cursorFrom <= sTo;
      if (!cursorInStrike) {
        addReplace(sFrom, sFrom + 2, Decoration.replace({}));
        items.push({
          from: sFrom + 2,
          to: sTo - 2,
          deco: Decoration.mark({ class: 'cme-live-strike' }),
        });
        addReplace(sTo - 2, sTo, Decoration.replace({}));
      }
    }

    // 4l. Inline math: $formula$
    const inlineMathRegex = /(?<![\$\\])\$(?!\s|\$)([^\$\n]+?)(?<!\s|\$)\$(?!\$)/g;
    let mMatch: RegExpExecArray | null;
    while ((mMatch = inlineMathRegex.exec(lineText)) !== null) {
      const mathFormula = mMatch[1].trim();
      // Skip pure currency like $10 or $5.50
      if (/^\d+(?:\.\d+)?$/.test(mathFormula)) {
        continue;
      }
      const mFrom = lineFrom + mMatch.index;
      const mTo = mFrom + mMatch[0].length;

      if (isOverlappingReplaced(mFrom, mTo)) continue;

      // Math blocks inside quotes (> blockquote or "..." / '...') should show as monospace, not rendered
      if (isBlockquoteLine || isRangeInQuote(mFrom, mTo)) {
        items.push({
          from: mFrom,
          to: mTo,
          deco: Decoration.mark({ class: 'cme-live-code font-mono' }),
        });
        continue;
      }

      const cursorInMath = cursorTo >= mFrom && cursorFrom <= mTo;
      if (!cursorInMath) {
        addReplace(
          mFrom,
          mTo,
          Decoration.replace({
            widget: new InlineMathWidget(mathFormula, mFrom, mTo),
          })
        );
      } else {
        items.push({
          from: mFrom,
          to: mFrom + 1,
          deco: Decoration.mark({ class: 'cme-syntax-marker' }),
        });
        items.push({
          from: mFrom + 1,
          to: mTo - 1,
          deco: Decoration.mark({ class: 'cme-live-code font-mono text-pink-600 dark:text-pink-400' }),
        });
        items.push({
          from: mTo - 1,
          to: mTo,
          deco: Decoration.mark({ class: 'cme-syntax-marker' }),
        });
      }
    }
  }

  // Sort items strictly by `from`, then by `startSide`, then by `to`
  items.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    const sideA = (a.deco as any).startSide ?? 0;
    const sideB = (b.deco as any).startSide ?? 0;
    if (sideA !== sideB) return sideA - sideB;
    return a.to - b.to;
  });

  // Add to RangeSetBuilder
  for (const item of items) {
    try {
      builder.add(item.from, item.to, item.deco);
    } catch {
      // Safe guard against duplicate bounds
    }
  }

  return builder.finish();
}
