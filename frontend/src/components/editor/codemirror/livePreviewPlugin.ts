import {
  EditorView,
  Decoration,
  DecorationSet,
} from '@codemirror/view';
import { RangeSetBuilder, StateField, EditorState, Extension } from '@codemirror/state';
import {
  MathBlockWidget,
  MermaidBlockWidget,
  WikiLinkWidget,
  TaskCheckboxWidget,
  DividerWidget,
  CodeBlockWidget,
  InlineMathWidget,
  TableBlockWidget,
} from './livePreviewWidgets';
import { slugify } from '../../navigation/DocumentOutline';

interface DecoItem {
  from: number;
  to: number;
  deco: Decoration;
}

export function createLivePreviewPlugin(isDark: boolean = false): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildLivePreviewDecorations(state, isDark);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return buildLivePreviewDecorations(tr.state, isDark);
      }
      return decorations.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

export function buildLivePreviewDecorations(state: EditorState, isDark: boolean = false): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const sel = state.selection.main;
  const cursorFrom = sel.from;
  const cursorTo = sel.to;

  const docText = doc.toString();
  const items: DecoItem[] = [];
  const headingSlugCounts: Record<string, number> = {};

  // Track replaced ranges to prevent overlapping replacement decorations
  const replacedRanges: { from: number; to: number }[] = [];

  const isOverlappingReplaced = (from: number, to: number) => {
    return replacedRanges.some((r) => Math.max(from, r.from) < Math.min(to, r.to));
  };

  const addReplace = (from: number, to: number, deco: Decoration) => {
    if (from >= to) return;
    if (!isOverlappingReplaced(from, to)) {
      replacedRanges.push({ from, to });
      items.push({ from, to, deco });
    }
  };

  // 1. Multiline Blocks: Display Math ($$...$$)
  const mathRegex = /\$\$([\s\S]*?)\$\$/g;
  let match: RegExpExecArray | null;
  while ((match = mathRegex.exec(docText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const latex = match[1].trim();

    const cursorInside = cursorTo >= from && cursorFrom <= to;
    if (!cursorInside && latex.length > 0) {
      addReplace(
        from,
        to,
        Decoration.replace({
          widget: new MathBlockWidget(latex, from, to),
          block: true,
        })
      );
    }
  }

  // 2. Multiline Blocks: Mermaid Diagrams (```mermaid ... ```)
  const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
  while ((match = mermaidRegex.exec(docText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const source = match[1].trim();

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

  // 3. Multiline Blocks: Fenced Code Blocks (```lang ... ```)
  const codeRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)\n```/g;
  while ((match = codeRegex.exec(docText)) !== null) {
    const lang = match[1].trim();
    if (lang.toLowerCase() === 'mermaid') continue;
    const from = match.index;
    const to = from + match[0].length;
    const code = match[2];

    const cursorInside = cursorTo >= from && cursorFrom <= to;
    if (!cursorInside && code.length > 0) {
      addReplace(
        from,
        to,
        Decoration.replace({
          widget: new CodeBlockWidget(lang || '', code, from, to),
          block: true,
        })
      );
    }
  }

  // 3.5 Multiline Blocks: GFM Markdown Tables
  const lineCount = doc.lines;
  let tableScanIdx = 1;
  while (tableScanIdx <= lineCount) {
    const scanLine = doc.line(tableScanIdx);
    const scanText = scanLine.text.trim();
    if (scanText.includes('|') && tableScanIdx < lineCount && !isOverlappingReplaced(scanLine.from, scanLine.to)) {
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

    // If line is part of an already replaced block, skip line-level decorations
    if (isOverlappingReplaced(lineFrom, lineTo)) {
      continue;
    }

    const cursorOnLine = cursorTo >= lineFrom && cursorFrom <= lineTo;

    // 4a. Horizontal Rule: --- or ***
    if (/^(?:---|---|\*\*\*|___)\s*$/.test(lineText.trim()) && lineText.trim().length >= 3) {
      if (!cursorOnLine) {
        addReplace(
          lineFrom,
          lineTo,
          Decoration.replace({
            widget: new DividerWidget(),
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
      const baseSlug = slugify(rawHeadingText.replace(/[*_`]/g, ''));
      const count = headingSlugCounts[baseSlug] || 0;
      headingSlugCounts[baseSlug] = count + 1;
      const headingId = count === 0 ? baseSlug : `${baseSlug}-${count}`;

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
        items.push({
          from: lineFrom + prefixLen,
          to: lineTo,
          deco: Decoration.mark({ class: headingClass }),
        });
      }
      continue;
    }

    // 4c. Blockquote: > text
    const quoteMatch = /^>\s+(.*)$/.exec(lineText);
    if (quoteMatch) {
      if (!cursorOnLine) {
        addReplace(lineFrom, lineFrom + 2, Decoration.replace({}));
        items.push({
          from: lineFrom + 2,
          to: lineTo,
          deco: Decoration.mark({ class: 'cme-live-blockquote' }),
        });
      } else {
        items.push({
          from: lineFrom,
          to: lineFrom + 2,
          deco: Decoration.mark({ class: 'cme-syntax-marker' }),
        });
      }
    }

    // 4d. Task list checkbox: - [ ] or - [x]
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

    // 4e. Wiki Links: [[target|label]] or [[target]]
    const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let wMatch: RegExpExecArray | null;
    while ((wMatch = wikiRegex.exec(lineText)) !== null) {
      const wFrom = lineFrom + wMatch.index;
      const wTo = wFrom + wMatch[0].length;
      const target = wMatch[1];
      const label = wMatch[2] || target;

      const cursorInWiki = cursorTo >= wFrom && cursorFrom <= wTo;
      if (!cursorInWiki) {
        addReplace(
          wFrom,
          wTo,
          Decoration.replace({
            widget: new WikiLinkWidget(target, label, wFrom, wTo),
          })
        );
      }
    }

    // 4f. Inline formatting: Bold **text**
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

    // 4g. Inline formatting: Italic *text* (when not bold)
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

    // 4h. Inline formatting: Strikethrough ~~text~~
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

    // 4i. Inline code: `code`
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
    }

    // 4j. Inline math: $formula$
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
