/**
 * Revision Diff Engine for CME.
 * Computes line-level differences between two document revisions and transforms
 * them into SuggestionRecord structures to display next-revision edits inline.
 */

import { SuggestionRecord } from '../review/types';

export interface DiffHunkChunk {
  type: 'equal' | 'delete' | 'insert';
  lines: string[];
  oldStartLine: number;
  newStartLine: number;
}

/**
 * Standard Longest Common Subsequence line diff.
 */
export function diffLines(textA: string, textB: string): DiffHunkChunk[] {
  const linesA = (textA || '').replace(/\r\n/g, '\n').split('\n');
  const linesB = (textB || '').replace(/\r\n/g, '\n').split('\n');

  // Strip empty single trailing line if present equally
  const n = linesA.length;
  const m = linesB.length;

  // Build matrix for LCS
  // For memory safety on very large docs, cap to 4000 lines
  const maxLines = 4000;
  const safeN = Math.min(n, maxLines);
  const safeM = Math.min(m, maxLines);

  const dp: number[][] = Array.from({ length: safeN + 1 }, () => new Array(safeM + 1).fill(0));

  for (let i = 0; i < safeN; i++) {
    for (let j = 0; j < safeM; j++) {
      if (linesA[i] === linesB[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to build raw operations
  type Op = { type: 'equal' | 'delete' | 'insert'; line: string; lineA: number; lineB: number };
  const ops: Op[] = [];
  let i = safeN;
  let j = safeM;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      ops.push({ type: 'equal', line: linesA[i - 1], lineA: i - 1, lineB: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', line: linesB[j - 1], lineA: i, lineB: j - 1 });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.push({ type: 'delete', line: linesA[i - 1], lineA: i - 1, lineB: j });
      i--;
    }
  }

  ops.reverse();

  // Group contiguous operations into chunks
  const chunks: DiffHunkChunk[] = [];
  let currentChunk: DiffHunkChunk | null = null;

  for (const op of ops) {
    if (!currentChunk || currentChunk.type !== op.type) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        type: op.type,
        lines: [op.line],
        oldStartLine: op.lineA,
        newStartLine: op.lineB,
      };
    } else {
      currentChunk.lines.push(op.line);
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}

/**
 * Transforms line diffs between current revision and next revision into SuggestionRecords.
 */
export function computeRevisionDiffSuggestions(
  docId: string,
  currentContent: string,
  nextContent: string,
  nextRevNumber: number,
  nextAuthor: { id?: string | null; name?: string },
  nextCreatedAt?: string
): SuggestionRecord[] {
  if (currentContent === nextContent) return [];

  const chunks = diffLines(currentContent, nextContent);
  const linesA = (currentContent || '').replace(/\r\n/g, '\n').split('\n');

  // Compute character offsets for lines in A
  const lineOffsets: number[] = new Array(linesA.length);
  let curOff = 0;
  for (let idx = 0; idx < linesA.length; idx++) {
    lineOffsets[idx] = curOff;
    curOff += linesA[idx].length + 1;
  }

  const suggestions: SuggestionRecord[] = [];
  let hunkCounter = 0;

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    if (chunk.type === 'equal') continue;

    let originalLines: string[] = [];
    let suggestedLines: string[] = [];
    let startLine = chunk.oldStartLine;

    if (chunk.type === 'delete') {
      originalLines = chunk.lines;
      // Check if immediately followed by an insert (replacement)
      if (c + 1 < chunks.length && chunks[c + 1].type === 'insert') {
        suggestedLines = chunks[c + 1].lines;
        c++; // consume the insert
      }
    } else if (chunk.type === 'insert') {
      suggestedLines = chunk.lines;
    }

    const originalText = originalLines.join('\n');
    const suggestedText = suggestedLines.join('\n');

    if (!originalText && !suggestedText) continue;

    const charOffset = startLine < lineOffsets.length ? lineOffsets[startLine] : curOff;
    const contextLine = startLine < linesA.length ? linesA[startLine] : linesA[linesA.length - 1] || '';

    hunkCounter++;
    suggestions.push({
      id: `rev-diff-${nextRevNumber}-${hunkCounter}`,
      document_id: docId,
      author: {
        id: nextAuthor.id || '',
        username: nextAuthor.name || 'Author',
        display_name: nextAuthor.name || 'Author',
        avatar_color: '#8b5cf6',
      },
      status: 'REVISION_DIFF',
      original_text: originalText,
      suggested_text: suggestedText,
      anchor: {
        offset: charOffset,
        line_start: startLine + 1,
        quote: {
          exact: originalText || contextLine,
          prefix: '',
          suffix: '',
        },
      },
      created_at: nextCreatedAt || new Date().toISOString(),
    });
  }

  return suggestions;
}
