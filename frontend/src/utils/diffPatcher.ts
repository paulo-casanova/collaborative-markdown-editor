/**
 * Unified Diff & Direct Text Replacement Engine for CME.
 *
 * Robustly parses and applies unified diffs and direct replacements to
 * document text with line number hints, context anchoring, fuzzy offset search,
 * and bottom-to-top change ordering to prevent offset drift.
 */

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface PatchResult {
  newText: string;
  appliedCount: number;
  failedCount: number;
  changes: TextChange[];
}

/**
 * Parses a unified diff string into an array of DiffHunk structures.
 */
export function parseUnifiedDiff(diff: string): DiffHunk[] {
  if (!diff || typeof diff !== 'string') return [];

  const rawLines = diff.replace(/\r\n/g, '\n').split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const match = hunkHeaderRegex.exec(line);

    if (match) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(match[1], 10),
        oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
        newStart: parseInt(match[3], 10),
        newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
        lines: [],
      };
      continue;
    }

    if (currentHunk) {
      // Lines inside a hunk
      if (line.startsWith('---') || line.startsWith('+++')) {
        // File header inside diff (could occur between hunks)
        continue;
      }
      if (line.startsWith('\\')) {
        // '\ No newline at end of file' - skip
        continue;
      }
      if (line.startsWith(' ') || line.startsWith('-') || line.startsWith('+')) {
        currentHunk.lines.push(line);
      } else if (line === '') {
        // If blank line occurs before another hunk line, treat as empty context line
        if (
          i + 1 < rawLines.length &&
          (rawLines[i + 1].startsWith(' ') ||
            rawLines[i + 1].startsWith('-') ||
            rawLines[i + 1].startsWith('+'))
        ) {
          currentHunk.lines.push(' ');
        }
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  // Trim trailing empty lines from hunks
  for (const h of hunks) {
    while (h.lines.length > 0 && h.lines[h.lines.length - 1].trim() === '') {
      h.lines.pop();
    }
  }

  // If no @@ header was found, check if it's a bare diff with +/- lines
  if (hunks.length === 0) {
    const removed: string[] = [];
    const added: string[] = [];
    for (const line of rawLines) {
      if (line.startsWith('-') && !line.startsWith('---')) {
        removed.push(line.slice(1));
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        added.push(line.slice(1));
      }
    }
    if (removed.length > 0 || added.length > 0) {
      const syntheticLines: string[] = [];
      for (const r of removed) syntheticLines.push('-' + r);
      for (const a of added) syntheticLines.push('+' + a);
      hunks.push({
        oldStart: 1,
        oldCount: removed.length,
        newStart: 1,
        newCount: added.length,
        lines: syntheticLines,
      });
    }
  }

  return hunks;
}

/**
 * Computes line offsets (starting character index for each line in docText).
 */
function computeLineOffsets(docLines: string[]): number[] {
  const offsets: number[] = new Array(docLines.length);
  let current = 0;
  for (let i = 0; i < docLines.length; i++) {
    offsets[i] = current;
    current += docLines[i].length + 1; // + 1 for \n
  }
  return offsets;
}

/**
 * Checks if candidate slice in docLines matches expected target lines.
 */
function matchLines(
  docLines: string[],
  startIndex: number,
  expectedLines: string[],
  trim: boolean = false
): boolean {
  if (startIndex < 0 || startIndex + expectedLines.length > docLines.length) {
    return false;
  }
  for (let j = 0; j < expectedLines.length; j++) {
    const d = docLines[startIndex + j];
    const e = expectedLines[j];
    if (trim ? d.trimEnd() !== e.trimEnd() : d !== e) {
      return false;
    }
  }
  return true;
}

/**
 * Computes non-overlapping TextChange operations from a unified diff against docText.
 * Returned changes are sorted in DESCENDING order of document character position `from`.
 */
export function computeDiffChanges(docText: string, diff: string): TextChange[] {
  if (!docText || !diff) return [];

  const hunks = parseUnifiedDiff(diff);
  if (hunks.length === 0) return [];

  const normalizedDoc = docText.replace(/\r\n/g, '\n');
  const docLines = normalizedDoc.split('\n');
  const lineOffsets = computeLineOffsets(docLines);

  const changes: TextChange[] = [];

  for (const hunk of hunks) {
    const oldLines: string[] = [];
    const newLines: string[] = [];
    const removedOnly: string[] = [];
    const addedOnly: string[] = [];

    for (const hl of hunk.lines) {
      if (hl.startsWith('+')) {
        newLines.push(hl.slice(1));
        addedOnly.push(hl.slice(1));
      } else if (hl.startsWith('-')) {
        oldLines.push(hl.slice(1));
        removedOnly.push(hl.slice(1));
      } else if (hl.startsWith(' ')) {
        oldLines.push(hl.slice(1));
        newLines.push(hl.slice(1));
      } else if (hl === '') {
        // Empty line treated as empty context line
        oldLines.push('');
        newLines.push('');
      }
    }

    if (oldLines.length === 0 && newLines.length === 0) continue;

    let matchLine = -1;
    let oldLineCountToReplace = oldLines.length;
    let replacementLinesToInsert = newLines;

    // Strategy 1: Search with full context lines
    if (oldLines.length > 0) {
      const targetStart = Math.max(0, hunk.oldStart - 1);

      // 1a. Try exact oldStart line
      if (matchLines(docLines, targetStart, oldLines, false)) {
        matchLine = targetStart;
      }

      // 1b. Search with small offset window around targetStart
      if (matchLine === -1) {
        const maxOffset = Math.min(100, docLines.length);
        for (let delta = 1; delta <= maxOffset; delta++) {
          if (matchLines(docLines, targetStart + delta, oldLines, false)) {
            matchLine = targetStart + delta;
            break;
          }
          if (matchLines(docLines, targetStart - delta, oldLines, false)) {
            matchLine = targetStart - delta;
            break;
          }
        }
      }

      // 1c. Search entire document for full context lines
      if (matchLine === -1) {
        for (let i = 0; i <= docLines.length - oldLines.length; i++) {
          if (matchLines(docLines, i, oldLines, false)) {
            matchLine = i;
            break;
          }
        }
      }

      // 1d. Search entire document with trailing whitespace trimming
      if (matchLine === -1) {
        for (let i = 0; i <= docLines.length - oldLines.length; i++) {
          if (matchLines(docLines, i, oldLines, true)) {
            matchLine = i;
            break;
          }
        }
      }
    }

    // Strategy 2: If full context match failed, match removed lines only
    if (matchLine === -1 && removedOnly.length > 0) {
      const targetStart = Math.max(0, hunk.oldStart - 1);

      // 2a. Try removed lines near targetStart
      const maxOffset = Math.min(100, docLines.length);
      for (let delta = 0; delta <= maxOffset; delta++) {
        if (matchLines(docLines, targetStart + delta, removedOnly, false)) {
          matchLine = targetStart + delta;
          break;
        }
        if (delta > 0 && matchLines(docLines, targetStart - delta, removedOnly, false)) {
          matchLine = targetStart - delta;
          break;
        }
      }

      // 2b. Search entire document for removed lines
      if (matchLine === -1) {
        for (let i = 0; i <= docLines.length - removedOnly.length; i++) {
          if (matchLines(docLines, i, removedOnly, false)) {
            matchLine = i;
            break;
          }
        }
      }

      // 2c. Search with trim
      if (matchLine === -1) {
        for (let i = 0; i <= docLines.length - removedOnly.length; i++) {
          if (matchLines(docLines, i, removedOnly, true)) {
            matchLine = i;
            break;
          }
        }
      }

      if (matchLine !== -1) {
        oldLineCountToReplace = removedOnly.length;
        replacementLinesToInsert = addedOnly;
      }
    }

    // Strategy 3: Substring search in raw docText if line matching failed
    if (matchLine === -1) {
      const rawOld = (oldLines.length > 0 ? oldLines : removedOnly).join('\n');
      if (rawOld) {
        const charIdx = normalizedDoc.indexOf(rawOld);
        if (charIdx !== -1) {
          changes.push({
            from: charIdx,
            to: charIdx + rawOld.length,
            insert: (newLines.length > 0 ? newLines : addedOnly).join('\n'),
          });
          continue;
        }
      }
      // If still not found, do not corrupt document; skip hunk
      continue;
    }

    // Determine minimal replacement range by trimming identical leading/trailing context
    let prefixCount = 0;
    while (
      prefixCount < oldLineCountToReplace &&
      prefixCount < replacementLinesToInsert.length &&
      oldLines[prefixCount] === newLines[prefixCount]
    ) {
      prefixCount++;
    }

    let suffixCount = 0;
    while (
      suffixCount < oldLineCountToReplace - prefixCount &&
      suffixCount < replacementLinesToInsert.length - prefixCount &&
      oldLines[oldLines.length - 1 - suffixCount] === newLines[newLines.length - 1 - suffixCount]
    ) {
      suffixCount++;
    }

    const effStartLine = matchLine + prefixCount;
    const effEndLine = matchLine + oldLineCountToReplace - suffixCount;
    const effNewLines = replacementLinesToInsert.slice(
      prefixCount,
      replacementLinesToInsert.length - suffixCount
    );

    const from = lineOffsets[effStartLine] !== undefined ? lineOffsets[effStartLine] : normalizedDoc.length;
    let to: number;
    let insert: string;

    if (effStartLine === effEndLine) {
      // Pure insertion
      to = from;
      insert = effNewLines.join('\n') + (effStartLine < docLines.length ? '\n' : '');
    } else {
      to =
        effEndLine < docLines.length
          ? lineOffsets[effEndLine]
          : normalizedDoc.length;
      insert =
        effNewLines.length > 0
          ? effNewLines.join('\n') + (effEndLine < docLines.length ? '\n' : '')
          : '';
    }

    changes.push({ from, to, insert });
  }

  // Sort descending by document character position `from` to prevent line shift drift
  changes.sort((a, b) => b.from - a.from);

  // Filter overlapping changes (keeping first valid one from bottom)
  const nonOverlapping: TextChange[] = [];
  let lastFrom = Infinity;

  for (const c of changes) {
    if (c.to <= lastFrom) {
      nonOverlapping.push(c);
      lastFrom = c.from;
    }
  }

  return nonOverlapping;
}

/**
 * Computes a single TextChange for replacing `originalText` with `replacementText`,
 * optionally guided by a `hintLine` (1-based line number).
 * Returns null if `originalText` cannot be found (never falls back to cursor selection).
 */
export function computeReplacementChange(
  docText: string,
  originalText: string,
  replacementText: string,
  hintLine?: number
): TextChange | null {
  if (!docText || !originalText) return null;

  const normalizedDoc = docText.replace(/\r\n/g, '\n');
  const normalizedOrig = originalText.replace(/\r\n/g, '\n');
  const normalizedRep = replacementText.replace(/\r\n/g, '\n');

  let matchIndex = -1;

  // 1. If hintLine is provided, search near hintLine first
  if (hintLine && hintLine >= 1) {
    const lines = normalizedDoc.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(hintLine - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    const idx = normalizedDoc.indexOf(normalizedOrig, offset);
    if (idx !== -1 && idx - offset < 2000) {
      matchIndex = idx;
    }
  }

  // 2. Exact match in full document
  if (matchIndex === -1) {
    matchIndex = normalizedDoc.indexOf(normalizedOrig);
  }

  // 3. Trimmed line comparison if multi-line
  if (matchIndex === -1 && normalizedOrig.includes('\n')) {
    const origLines = normalizedOrig.split('\n');
    const docLines = normalizedDoc.split('\n');
    const offsets = computeLineOffsets(docLines);

    for (let i = 0; i <= docLines.length - origLines.length; i++) {
      if (matchLines(docLines, i, origLines, true)) {
        matchIndex = offsets[i];
        let endOffset = offsets[i];
        for (let j = 0; j < origLines.length; j++) {
          endOffset += docLines[i + j].length + (i + j < docLines.length - 1 ? 1 : 0);
        }
        return {
          from: matchIndex,
          to: endOffset,
          insert: normalizedRep,
        };
      }
    }
  }

  // 4. Trimmed single line comparison
  if (matchIndex === -1) {
    const trimmedOrig = normalizedOrig.trim();
    if (trimmedOrig) {
      matchIndex = normalizedDoc.indexOf(trimmedOrig);
      if (matchIndex !== -1) {
        return {
          from: matchIndex,
          to: matchIndex + trimmedOrig.length,
          insert: normalizedRep,
        };
      }
    }
  }

  if (matchIndex === -1) {
    return null;
  }

  return {
    from: matchIndex,
    to: matchIndex + normalizedOrig.length,
    insert: normalizedRep,
  };
}

/**
 * Applies a unified diff to a full document string and returns the patched result.
 */
export function applyUnifiedDiff(docText: string, diff: string): PatchResult {
  const normalizedDoc = (docText || '').replace(/\r\n/g, '\n');
  const changes = computeDiffChanges(normalizedDoc, diff);

  if (changes.length === 0) {
    return {
      newText: normalizedDoc,
      appliedCount: 0,
      failedCount: parseUnifiedDiff(diff).length || 1,
      changes: [],
    };
  }

  let text = normalizedDoc;
  for (const c of changes) {
    text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  }

  return {
    newText: text,
    appliedCount: changes.length,
    failedCount: Math.max(0, parseUnifiedDiff(diff).length - changes.length),
    changes,
  };
}
