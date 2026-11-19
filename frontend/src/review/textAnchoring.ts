/**
 * Dual Text-Anchoring Engine
 *
 * Implements:
 * 1. Strategy A: Yjs Relative Positions (Primary Real-Time Tracking via CRDT IDs)
 * 2. Strategy B: W3C Web Annotation TextQuoteSelector (Offline & External Edit Fallback)
 * 3. Anchor Drift Reconciliation on Document Open & Concurrent Synchronization
 */

import * as Y from 'yjs';
import {
  DualAnchor,
  W3CQuoteSelector,
  RelativePositionPoint,
  YjsRelativePosition,
  ReconciledAnchorResult,
  ReconciliationStatus,
  CommentRecord,
  SuggestionRecord,
} from './types';

export const DEFAULT_CONTEXT_LENGTH = 32;

/**
 * Normalizes and extracts W3C Web Annotation TextQuoteSelector from text.
 */
export function createQuoteSelector(
  fullText: string,
  start: number,
  end: number,
  contextLength = DEFAULT_CONTEXT_LENGTH
): W3CQuoteSelector {
  const safeStart = Math.max(0, Math.min(start, fullText.length));
  const safeEnd = Math.max(safeStart, Math.min(end, fullText.length));

  const exact = fullText.slice(safeStart, safeEnd);
  const prefix = fullText.slice(Math.max(0, safeStart - contextLength), safeStart);
  const suffix = fullText.slice(safeEnd, Math.min(fullText.length, safeEnd + contextLength));

  return { exact, prefix, suffix };
}

/**
 * Creates a clean, JSON-serializable Yjs relative position.
 */
export function createRelativePosition(
  ytype: Y.AbstractType<any>,
  index: number,
  assoc = 0
): YjsRelativePosition {
  const rel = Y.createRelativePositionFromTypeIndex(ytype, index, assoc);
  return {
    type: null,
    tname: (ytype as any)._item?.parentSub || (ytype as any).name || (ytype as any)._tname || 'content',
    item: rel.item ? { client: rel.item.client, clock: rel.item.clock } : null,
    assoc: rel.assoc,
  };
}

/**
 * Resolves a Yjs relative position back to an absolute index in the current Y.Doc.
 */
export function resolveRelativePosition(
  relPos: YjsRelativePosition | RelativePositionPoint | Y.RelativePosition | null | undefined,
  ydoc: Y.Doc,
  defaultTname = 'content'
): number | null {
  if (!relPos || !ydoc) return null;

  let yRel: Y.RelativePosition;
  if ('item' in relPos) {
    yRel = {
      type: null,
      tname: (relPos as YjsRelativePosition).tname || defaultTname,
      item: (relPos as YjsRelativePosition).item
        ? (relPos as YjsRelativePosition).item as any
        : null,
      assoc: (relPos as YjsRelativePosition).assoc ?? 0,
    };
  } else if ('client' in relPos && 'clock' in relPos) {
    yRel = {
      type: null,
      tname: defaultTname,
      item: { client: (relPos as RelativePositionPoint).client, clock: (relPos as RelativePositionPoint).clock } as any,
      assoc: 0,
    };
  } else {
    yRel = relPos as Y.RelativePosition;
  }

  try {
    const absPos = Y.createAbsolutePositionFromRelativePosition(yRel, ydoc);
    return absPos ? absPos.index : null;
  } catch {
    return null;
  }
}

/**
 * Creates a complete DualAnchor combining Strategy A (Yjs CRDT Relative Position)
 * and Strategy B (W3C Web Annotation TextQuoteSelector).
 */
export function createDualAnchor(
  ytypeOrDoc: Y.AbstractType<any> | Y.Doc,
  start: number,
  end: number,
  fullText: string,
  options?: {
    nodeId?: string;
    contextLength?: number;
    tname?: string;
  }
): DualAnchor {
  let ytype: Y.AbstractType<any>;
  if (ytypeOrDoc instanceof Y.Doc) {
    ytype = ytypeOrDoc.getText(options?.tname || 'content');
  } else {
    ytype = ytypeOrDoc;
  }

  const quote = createQuoteSelector(fullText, start, end, options?.contextLength);
  const startRel = createRelativePosition(ytype, start, 0);
  const endRel = createRelativePosition(ytype, end, 0);

  return {
    type: 'dual',
    start: startRel,
    end: endRel,
    yjs: {
      start: startRel,
      end: endRel,
      node_id: options?.nodeId,
    },
    quote,
    offset: start,
    length: end - start,
    node_id: options?.nodeId,
  };
}

/**
 * Levenshtein distance between two strings for fuzzy matching.
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Computes similarity score between 0.0 and 1.0.
 */
export function stringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return 1.0 - dist / maxLen;
}

/**
 * Strips inline and block markdown formatting syntax, returning plain readable text.
 */
export function stripMarkdownFormatting(md: string): string {
  if (!md) return '';
  return md
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(\s*[-*+]\s+)(\[[ xX]\]\s+)?/, '')
    .replace(/^>\s*(?:\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*)?/i, '')
    .replace(/\[!\[([^\]]*)\]\([^)]+\)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[(?:pill|status|priority):(?:[a-zA-Z0-9#_-]+\|)?([^\]]+)\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`+([^`]+)`+/g, '$1')
    .replace(/\$\$([^\$]+)\$\$/g, '$1')
    .replace(/\$([^\$]+)\$/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

/**
 * Builds a character index mapping from plain-text character offsets to raw markdown offsets.
 */
export function buildMarkdownOffsetMap(raw: string): { plainText: string; plainToRaw: number[] } {
  const plainToRaw: number[] = [];
  let plainText = '';
  let i = 0;

  // Skip block-level prefix if any (headings, blockquotes, callouts, lists, tasks)
  const blockPrefixMatch = raw.match(
    /^(#{1,6}\s+|>\s*(?:\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*)?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/i
  );
  if (blockPrefixMatch) {
    i = blockPrefixMatch[0].length;
  }

  while (i < raw.length) {
    // 1. Linked image or embedded image: [![alt](src)](target) or ![alt](src)
    if (raw.slice(i).startsWith('![')) {
      const imgMatch = raw.slice(i).match(/^!\[([^\]]*)\]\([^)]+\)/);
      if (imgMatch) {
        i += imgMatch[0].length;
        continue;
      }
    }
    // 2. WikiLink [[target|label]] or [[target]]
    if (raw.slice(i).startsWith('[[')) {
      const m = raw.slice(i).match(/^\[\[([^\]]+)\]\]/);
      if (m) {
        const parts = m[1].split('|');
        const label = (parts[1] || parts[0]).trim();
        const labelOffset = m[0].indexOf(label);
        for (let c = 0; c < label.length; c++) {
          plainToRaw.push(i + labelOffset + c);
          plainText += label[c];
        }
        i += m[0].length;
        continue;
      }
    }
    // 3. Custom pill [pill:...|label]
    if (
      raw.slice(i).startsWith('[pill:') ||
      raw.slice(i).startsWith('[status:') ||
      raw.slice(i).startsWith('[priority:')
    ) {
      const m = raw
        .slice(i)
        .match(/^\[(?:pill|status|priority):(?:[a-zA-Z0-9#_-]+\|)?([^\]]+)\]/);
      if (m) {
        const label = m[1];
        const labelOffset = m[0].indexOf(label);
        for (let c = 0; c < label.length; c++) {
          plainToRaw.push(i + labelOffset + c);
          plainText += label[c];
        }
        i += m[0].length;
        continue;
      }
    }
    // 4. Standard link [label](url)
    if (raw[i] === '[' && !raw.slice(i).startsWith('[[')) {
      const m = raw.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        const label = m[1];
        for (let c = 0; c < label.length; c++) {
          plainToRaw.push(i + 1 + c);
          plainText += label[c];
        }
        i += m[0].length;
        continue;
      }
    }
    // 5. Code `...`
    if (raw[i] === '`') {
      const m = raw.slice(i).match(/^(`+)(.*?)\1/);
      if (m) {
        const codeText = m[2];
        for (let c = 0; c < codeText.length; c++) {
          plainToRaw.push(i + m[1].length + c);
          plainText += codeText[c];
        }
        i += m[0].length;
        continue;
      }
    }
    // 6. Display Math $$...$$
    if (raw.slice(i).startsWith('$$')) {
      const endIdx = raw.indexOf('$$', i + 2);
      if (endIdx !== -1) {
        const inner = raw.slice(i + 2, endIdx);
        for (let c = 0; c < inner.length; c++) {
          plainToRaw.push(i + 2 + c);
          plainText += inner[c];
        }
        i = endIdx + 2;
        continue;
      }
    }
    // 7. Inline Math $...$
    if (raw[i] === '$' && raw[i + 1] !== '$' && raw[i + 1] !== ' ') {
      const endIdx = raw.indexOf('$', i + 1);
      if (endIdx !== -1 && raw[endIdx - 1] !== ' ') {
        const inner = raw.slice(i + 1, endIdx);
        for (let c = 0; c < inner.length; c++) {
          plainToRaw.push(i + 1 + c);
          plainText += inner[c];
        }
        i = endIdx + 1;
        continue;
      }
    }
    // 8. Delimiters (bold italic, bold, strikethrough, italic)
    if (raw.slice(i).startsWith('***') || raw.slice(i).startsWith('___')) {
      i += 3;
      continue;
    }
    if (raw.slice(i).startsWith('**') || raw.slice(i).startsWith('__')) {
      i += 2;
      continue;
    }
    if (raw.slice(i).startsWith('~~')) {
      i += 2;
      continue;
    }
    if (raw[i] === '*' || raw[i] === '_') {
      const prev = i > 0 ? raw[i - 1] : ' ';
      const next = i + 1 < raw.length ? raw[i + 1] : ' ';
      if (!(prev === ' ' && next === ' ')) {
        i += 1;
        continue;
      }
    }

    // Normal content character
    plainToRaw.push(i);
    plainText += raw[i];
    i++;
  }

  return { plainText, plainToRaw };
}

/**
 * Accurately finds character offsets in raw markdown corresponding to selected text,
 * properly accounting for markdown syntax delimiters and rendered DOM contexts.
 */
export function findMarkdownSelection(
  fullContent: string,
  selectedText: string,
  options?: {
    blockStart?: number;
    blockEnd?: number;
    prefixInBlock?: string;
    suffixInBlock?: string;
    prefix?: string;
    suffix?: string;
  }
): { start: number; end: number; exact: string } {
  if (!fullContent || !selectedText) {
    return { start: 0, end: 0, exact: '' };
  }

  const trimmed = selectedText.trim();
  if (!trimmed) {
    return { start: 0, end: 0, exact: '' };
  }

  // A. Block-scoped search when blockStart/blockEnd are provided from DOM
  if (
    typeof options?.blockStart === 'number' &&
    typeof options?.blockEnd === 'number' &&
    options.blockEnd > options.blockStart
  ) {
    const blockRaw = fullContent.slice(options.blockStart, options.blockEnd);
    const { plainText, plainToRaw } = buildMarkdownOffsetMap(blockRaw);

    let pIdx = -1;
    if (options.prefixInBlock !== undefined) {
      const prefixLen = options.prefixInBlock.length;
      if (
        prefixLen <= plainText.length &&
        plainText.slice(prefixLen, prefixLen + trimmed.length) === trimmed
      ) {
        pIdx = prefixLen;
      } else {
        pIdx = plainText.indexOf(trimmed, Math.max(0, prefixLen - 10));
      }
    }

    if (pIdx === -1) {
      pIdx = plainText.indexOf(trimmed);
    }

    if (pIdx !== -1 && pIdx < plainToRaw.length) {
      const rawStart = plainToRaw[pIdx];
      const endPlainIdx = Math.min(plainToRaw.length - 1, pIdx + trimmed.length - 1);
      const rawEnd = plainToRaw[endPlainIdx] + 1;
      const start = options.blockStart + rawStart;
      const end = options.blockStart + rawEnd;
      return {
        start,
        end,
        exact: fullContent.slice(start, end),
      };
    }
  }

  // B. Exact direct match in fullContent (with prefix/suffix context if available)
  let directIdx = -1;
  if (options?.prefix) {
    const pattern = options.prefix + trimmed;
    const pos = fullContent.indexOf(pattern);
    if (pos !== -1) {
      directIdx = pos + options.prefix.length;
    }
  }
  if (directIdx === -1 && options?.suffix) {
    const pattern = trimmed + options.suffix;
    const pos = fullContent.indexOf(pattern);
    if (pos !== -1) {
      directIdx = pos;
    }
  }
  if (directIdx === -1) {
    directIdx = fullContent.indexOf(trimmed);
  }

  if (directIdx !== -1) {
    return {
      start: directIdx,
      end: directIdx + trimmed.length,
      exact: fullContent.slice(directIdx, directIdx + trimmed.length),
    };
  }

  // C. Markdown-aware scan across lines in fullContent
  const lines = fullContent.split('\n');
  let curOffset = 0;
  for (const line of lines) {
    if (line.trim().length > 0) {
      const { plainText, plainToRaw } = buildMarkdownOffsetMap(line);
      const pIdx = plainText.indexOf(trimmed);
      if (pIdx !== -1 && pIdx < plainToRaw.length) {
        const rawStart = plainToRaw[pIdx];
        const endPlainIdx = Math.min(plainToRaw.length - 1, pIdx + trimmed.length - 1);
        const rawEnd = plainToRaw[endPlainIdx] + 1;
        const start = curOffset + rawStart;
        const end = curOffset + rawEnd;
        return {
          start,
          end,
          exact: fullContent.slice(start, end),
        };
      }
    }
    curOffset += line.length + 1;
  }

  // D. Fallback: return start=0
  return {
    start: 0,
    end: Math.min(fullContent.length, trimmed.length),
    exact: fullContent.slice(0, trimmed.length),
  };
}

/**
 * Strategy B Fallback: Matches W3C TextQuoteSelector against raw document text.
 *
 * Supports:
 * - Tier 1: Full context (prefix + exact + suffix)
 * - Tier 2: Partial context (prefix + exact OR exact + suffix)
 * - Tier 3: Exact quote match with proximity disambiguation
 * - Tier 3.5: Markdown-aware syntax match
 * - Tier 4: Localized fuzzy search
 */
export function matchQuoteSelector(
  text: string,
  quote: W3CQuoteSelector,
  expectedOffset?: number
): { start: number; end: number; score: number } | null {
  if (!quote || !quote.exact) return null;

  const { exact, prefix = '', suffix = '' } = quote;

  // Tier 1: prefix + exact + suffix
  if (prefix && suffix) {
    const fullPattern = prefix + exact + suffix;
    const pos = text.indexOf(fullPattern);
    if (pos !== -1) {
      const start = pos + prefix.length;
      return { start, end: start + exact.length, score: 1.0 };
    }
  }

  // Tier 2a: prefix + exact
  if (prefix) {
    const prePattern = prefix + exact;
    const pos = text.indexOf(prePattern);
    if (pos !== -1) {
      const start = pos + prefix.length;
      return { start, end: start + exact.length, score: 0.95 };
    }
  }

  // Tier 2b: exact + suffix
  if (suffix) {
    const postPattern = exact + suffix;
    const pos = text.indexOf(postPattern);
    if (pos !== -1) {
      return { start: pos, end: pos + exact.length, score: 0.95 };
    }
  }

  // Tier 3: exact text search with proximity to expectedOffset
  const occurrences: number[] = [];
  let cur = text.indexOf(exact);
  while (cur !== -1) {
    occurrences.push(cur);
    cur = text.indexOf(exact, cur + 1);
  }

  if (occurrences.length === 1) {
    return { start: occurrences[0], end: occurrences[0] + exact.length, score: 0.9 };
  } else if (occurrences.length > 1) {
    const target = expectedOffset ?? 0;
    let closest = occurrences[0];
    let minDiff = Math.abs(closest - target);
    for (let i = 1; i < occurrences.length; i++) {
      const diff = Math.abs(occurrences[i] - target);
      if (diff < minDiff) {
        minDiff = diff;
        closest = occurrences[i];
      }
    }
    return { start: closest, end: closest + exact.length, score: 0.85 };
  }

  // Tier 3.5: Markdown-Aware Syntax Matching
  const mdMatch = findMarkdownSelection(text, exact, { prefix, suffix });
  if (mdMatch && mdMatch.end > mdMatch.start && (mdMatch.start !== 0 || text.startsWith(exact))) {
    return { start: mdMatch.start, end: mdMatch.end, score: 0.95 };
  }

  // Tier 4: Prefix/Suffix Boundary-Assisted Fuzzy Search
  if (prefix && suffix) {
    const pPos = text.indexOf(prefix);
    const sPos = text.indexOf(suffix, pPos !== -1 ? pPos + prefix.length : 0);
    if (pPos !== -1 && sPos !== -1 && sPos >= pPos + prefix.length) {
      const start = pPos + prefix.length;
      const end = sPos;
      const candidate = text.slice(start, end);
      const sim = stringSimilarity(candidate, exact);
      if (sim >= 0.65) {
        return { start, end, score: sim };
      }
    }
  }

  // Tier 5: Localized sliding-window fuzzy search around expectedOffset or prefix/suffix
  if (exact.length >= 4) {
    let searchCenter = expectedOffset ?? 0;
    if (prefix && text.indexOf(prefix) !== -1) {
      searchCenter = text.indexOf(prefix) + prefix.length;
    } else if (suffix && text.indexOf(suffix) !== -1) {
      searchCenter = Math.max(0, text.indexOf(suffix) - exact.length);
    }

    const windowStart = Math.max(0, searchCenter - 250);
    const windowEnd = Math.min(text.length, searchCenter + exact.length + 250);
    const candidateText = text.slice(windowStart, windowEnd);

    let bestScore = 0;
    let bestLocalStart = -1;
    let bestLocalLen = exact.length;

    // Search around length variations (-4 .. +4 characters)
    for (let lenOffset = -4; lenOffset <= 4; lenOffset++) {
      const len = exact.length + lenOffset;
      if (len <= 0 || len > candidateText.length) continue;

      for (let i = 0; i <= candidateText.length - len; i++) {
        const slice = candidateText.slice(i, i + len);
        const sim = stringSimilarity(slice, exact);
        if (sim > bestScore) {
          bestScore = sim;
          bestLocalStart = i;
          bestLocalLen = len;
        }
      }
    }

    if (bestScore >= 0.65 && bestLocalStart !== -1) {
      const start = windowStart + bestLocalStart;
      return { start, end: start + bestLocalLen, score: bestScore };
    }
  }

  return null;
}

/**
 * Reconciles an anchor against current document state.
 *
 * 1. Checks Strategy A (Yjs Relative Position) first.
 * 2. If valid, confirms text slice and returns exact CRDT coordinate.
 * 3. If CRDT clocks desynchronized or missing, falls back to Strategy B (W3C Quote matching).
 * 4. If found, updates relative positions and returns reconciled range.
 * 5. If text was deleted and cannot be found, flags as orphaned.
 */
export function reconcileAnchor(
  anchor: DualAnchor | any,
  ydocOrText: Y.Doc | string,
  ytype?: Y.AbstractType<any>
): ReconciledAnchorResult {
  if (!anchor) {
    return {
      status: 'orphaned',
      range: null,
      text: null,
      drift: 0,
      confidence: 0,
      updatedAnchor: anchor,
    };
  }

  let ydoc: Y.Doc | null = null;
  let currentText = '';

  if (typeof ydocOrText === 'string') {
    currentText = ydocOrText;
  } else if (ydocOrText instanceof Y.Doc) {
    ydoc = ydocOrText;
    const type = ytype || ydoc.getText('content');
    currentText = type.toString();
  }

  const quote: W3CQuoteSelector | undefined = anchor.quote || (anchor.exact ? {
    exact: anchor.exact,
    prefix: anchor.prefix || '',
    suffix: anchor.suffix || '',
  } : undefined);

  const startRel = anchor.yjs?.start || anchor.start;
  const endRel = anchor.yjs?.end || anchor.end;

  // ---------------------------------------------------------------------------
  // Strategy A: CRDT Relative Position Tracking
  // ---------------------------------------------------------------------------
  if (ydoc && startRel && endRel) {
    const tname = (ytype as any)?._item?.parentSub || (ytype as any)?.name || 'content';
    const startIdx = resolveRelativePosition(startRel, ydoc, tname);
    const endIdx = resolveRelativePosition(endRel, ydoc, tname);

    if (startIdx !== null && endIdx !== null && startIdx <= endIdx) {
      // Ensure anchor has not collapsed to 0 if document is populated and offset was > 0
      const collapsedToZero = startIdx === 0 && endIdx === 0 && currentText.length > 0 && (anchor.offset || 0) > 0;
      if (!collapsedToZero) {
        const slice = currentText.slice(startIdx, endIdx);
        const originalOffset = typeof anchor.offset === 'number' ? anchor.offset : startIdx;
        const drift = startIdx - originalOffset;

        const isExactMatch = !quote || slice === quote.exact;
        const confidence = isExactMatch ? 1.0 : (quote ? Math.max(0.70, stringSimilarity(slice, quote.exact)) : 0.95);

        const updatedAnchor: DualAnchor = {
          ...anchor,
          type: 'dual',
          offset: startIdx,
          length: endIdx - startIdx,
          start: startRel,
          end: endRel,
          yjs: {
            start: startRel,
            end: endRel,
            node_id: anchor.node_id || anchor.yjs?.node_id,
          },
          quote: quote || createQuoteSelector(currentText, startIdx, endIdx),
        };

        return {
          status: 'exact-crdt',
          range: { start: startIdx, end: endIdx },
          text: slice,
          drift,
          confidence,
          updatedAnchor,
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy B: W3C Text Quote Robustness Fallback
  // ---------------------------------------------------------------------------
  if (quote && quote.exact) {
    const match = matchQuoteSelector(currentText, quote, anchor.offset);
    if (match) {
      const slice = currentText.slice(match.start, match.end);
      const originalOffset = typeof anchor.offset === 'number' ? anchor.offset : match.start;
      const drift = match.start - originalOffset;

      let newAnchor: DualAnchor;
      if (ydoc) {
        const type = ytype || ydoc.getText('content');
        newAnchor = createDualAnchor(type, match.start, match.end, currentText, {
          nodeId: anchor.node_id,
        });
      } else {
        newAnchor = {
          ...anchor,
          type: 'dual',
          offset: match.start,
          length: match.end - match.start,
          quote: createQuoteSelector(currentText, match.start, match.end),
        };
      }

      const status: ReconciliationStatus = match.score >= 0.85 ? 'reconciled-quote' : 'fuzzy-reconciled';

      return {
        status,
        range: { start: match.start, end: match.end },
        text: slice,
        drift,
        confidence: match.score,
        updatedAnchor: newAnchor,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy C: Numerical Offset & Length Validation
  // ---------------------------------------------------------------------------
  if (typeof anchor.offset === 'number' && typeof anchor.length === 'number') {
    const off = anchor.offset;
    const len = anchor.length;
    if (off >= 0 && off + len <= currentText.length) {
      const slice = currentText.slice(off, off + len);
      if (!quote || slice === quote.exact) {
        return {
          status: 'exact-crdt',
          range: { start: off, end: off + len },
          text: slice,
          drift: 0,
          confidence: 0.9,
          updatedAnchor: anchor,
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Orphaned (Text removed or completely transformed)
  // ---------------------------------------------------------------------------
  return {
    status: 'orphaned',
    range: null,
    text: null,
    drift: 0,
    confidence: 0,
    updatedAnchor: anchor,
  };
}

/**
 * Batch reconciles all open comments and suggestions when a document is opened.
 */
export function reconcileDocumentReviewItems<T extends CommentRecord | SuggestionRecord>(
  items: T[],
  ydocOrText: Y.Doc | string,
  ytype?: Y.AbstractType<any>
): {
  reconciledItems: (T & { reconciled: ReconciledAnchorResult })[];
  orphanedCount: number;
  driftedCount: number;
} {
  let orphanedCount = 0;
  let driftedCount = 0;

  const reconciledItems = items.map((item) => {
    const reconciled = reconcileAnchor(item.anchor, ydocOrText, ytype);
    if (reconciled.status === 'orphaned') {
      orphanedCount++;
    } else if (reconciled.drift !== 0) {
      driftedCount++;
    }
    return {
      ...item,
      reconciled,
    };
  });

  return { reconciledItems, orphanedCount, driftedCount };
}
