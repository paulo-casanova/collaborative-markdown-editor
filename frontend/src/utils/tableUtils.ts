/**
 * Table parsing and row splitting utilities.
 * Handles escaped pipes, pipes within code spans, and pipes inside WikiLinks/Pills.
 */

export function splitTableRow(rowStr: string): string[] {
  let trimmed = rowStr.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let currentCell = '';
  let inBacktick = false;
  let bracketDepth = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    // Escaped pipe: \|
    if (ch === '\\' && i + 1 < trimmed.length) {
      const next = trimmed[i + 1];
      if (next === '|') {
        currentCell += '|';
        i++;
        continue;
      }
      currentCell += ch;
      continue;
    }

    // Toggle backtick code spans: `code | with | pipe`
    if (ch === '`') {
      inBacktick = !inBacktick;
      currentCell += ch;
      continue;
    }

    // Track bracket depth when not inside backtick code spans
    if (!inBacktick) {
      if (ch === '[') {
        bracketDepth++;
      } else if (ch === ']' && bracketDepth > 0) {
        bracketDepth--;
      }
    }

    // Pipe separator: only treat as table column delimiter when outside code and outside brackets
    if (ch === '|' && !inBacktick && bracketDepth === 0) {
      cells.push(currentCell.trim());
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  cells.push(currentCell.trim());
  return cells;
}

export function parseTableAlignments(delimiterRowStr: string): ('left' | 'center' | 'right')[] {
  const cells = splitTableRow(delimiterRowStr);
  return cells.map((delim) => {
    const trimmed = delim.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });
}

export function isTableDelimiterRow(rowStr: string): boolean {
  const trimmed = rowStr.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

