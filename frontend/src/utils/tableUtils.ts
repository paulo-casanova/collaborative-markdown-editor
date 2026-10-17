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

export interface TableData {
  headers: string[];
  alignments: ('left' | 'center' | 'right')[];
  rows: string[][];
}

export function parseMarkdownTable(rawText: string): TableData | null {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  const delimLine = lines[1];
  if (!isTableDelimiterRow(delimLine)) return null;

  const headers = splitTableRow(headerLine);
  if (headers.length === 0) return null;

  const parsedAlignments = parseTableAlignments(delimLine);
  const alignments: ('left' | 'center' | 'right')[] = headers.map(
    (_, i) => parsedAlignments[i] || 'left'
  );

  const rows: string[][] = [];
  for (let r = 2; r < lines.length; r++) {
    const rowCells = splitTableRow(lines[r]);
    // Normalize each row length to match headers length
    const normalizedRow: string[] = headers.map((_, i) => rowCells[i] ?? '');
    rows.push(normalizedRow);
  }

  return { headers, alignments, rows };
}

export function escapeTableCell(cellText: string): string {
  if (!cellText) return '';
  let result = '';
  let inBacktick = false;
  let bracketDepth = 0;

  for (let i = 0; i < cellText.length; i++) {
    const ch = cellText[i];

    // Already escaped pipe: \|
    if (ch === '\\' && i + 1 < cellText.length && cellText[i + 1] === '|') {
      result += '\\|';
      i++;
      continue;
    }

    if (ch === '`') {
      inBacktick = !inBacktick;
      result += ch;
      continue;
    }

    if (!inBacktick) {
      if (ch === '[') bracketDepth++;
      else if (ch === ']' && bracketDepth > 0) bracketDepth--;
    }

    if (ch === '|' && !inBacktick && bracketDepth === 0) {
      result += '\\|';
    } else {
      result += ch;
    }
  }

  return result;
}

function formatDelimiterCell(alignment: 'left' | 'center' | 'right', width: number): string {
  const dashes = Math.max(3, width);
  if (alignment === 'center') {
    return ':' + '-'.repeat(Math.max(1, dashes - 2)) + ':';
  }
  if (alignment === 'right') {
    return '-'.repeat(Math.max(2, dashes - 1)) + ':';
  }
  return ':' + '-'.repeat(Math.max(2, dashes - 1));
}

export function formatMarkdownTable(data: TableData): string {
  const colCount = data.headers.length;
  if (colCount === 0) return '';

  const escapedHeaders = data.headers.map(escapeTableCell);
  const escapedRows = data.rows.map((row) =>
    Array.from({ length: colCount }, (_, c) => escapeTableCell(row[c] ?? ''))
  );

  // Compute minimum column width for clean alignment
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxLen = Math.max(3, escapedHeaders[c].length);
    for (const row of escapedRows) {
      maxLen = Math.max(maxLen, row[c].length);
    }
    colWidths.push(maxLen);
  }

  // Header row
  const headerParts = escapedHeaders.map((h, c) => h.padEnd(colWidths[c], ' '));
  const headerLine = `| ${headerParts.join(' | ')} |`;

  // Delimiter row
  const delimParts = data.alignments.map((align, c) =>
    formatDelimiterCell(align || 'left', colWidths[c])
  );
  const delimLine = `| ${delimParts.join(' | ')} |`;

  // Data rows
  const rowLines = escapedRows.map((row) => {
    const parts = row.map((cell, c) => cell.padEnd(colWidths[c], ' '));
    return `| ${parts.join(' | ')} |`;
  });

  return [headerLine, delimLine, ...rowLines].join('\n');
}

export function updateCell(
  data: TableData,
  rowIndex: number,
  colIndex: number,
  value: string
): TableData {
  if (colIndex < 0 || colIndex >= data.headers.length) return data;

  if (rowIndex === -1) {
    const newHeaders = [...data.headers];
    newHeaders[colIndex] = value;
    return { ...data, headers: newHeaders };
  }

  if (rowIndex < 0 || rowIndex >= data.rows.length) return data;

  const newRows = data.rows.map((row, r) => {
    if (r !== rowIndex) return row;
    const updatedRow = [...row];
    updatedRow[colIndex] = value;
    return updatedRow;
  });

  return { ...data, rows: newRows };
}

export function addRow(data: TableData, atIndex?: number): TableData {
  const colCount = data.headers.length;
  const newRow: string[] = new Array(colCount).fill('');
  const newRows = [...data.rows];

  if (atIndex === undefined || atIndex < 0 || atIndex >= newRows.length) {
    newRows.push(newRow);
  } else {
    newRows.splice(atIndex, 0, newRow);
  }

  return { ...data, rows: newRows };
}

export function deleteRow(data: TableData, rowIndex: number): TableData {
  if (rowIndex < 0 || rowIndex >= data.rows.length) return data;
  const newRows = data.rows.filter((_, r) => r !== rowIndex);
  return { ...data, rows: newRows };
}

export function addColumn(data: TableData, atIndex?: number, headerName?: string): TableData {
  const newColCount = data.headers.length + 1;
  const name = headerName || `Col ${newColCount}`;
  const insertIndex =
    atIndex === undefined || atIndex < 0 || atIndex > data.headers.length
      ? data.headers.length
      : atIndex;

  const newHeaders = [...data.headers];
  newHeaders.splice(insertIndex, 0, name);

  const newAlignments = [...data.alignments];
  newAlignments.splice(insertIndex, 0, 'left');

  const newRows = data.rows.map((row) => {
    const updatedRow = [...row];
    updatedRow.splice(insertIndex, 0, '');
    return updatedRow;
  });

  return {
    headers: newHeaders,
    alignments: newAlignments,
    rows: newRows,
  };
}

export function deleteColumn(data: TableData, colIndex: number): TableData {
  if (data.headers.length <= 1) return data; // Keep at least one column
  if (colIndex < 0 || colIndex >= data.headers.length) return data;

  const newHeaders = data.headers.filter((_, c) => c !== colIndex);
  const newAlignments = data.alignments.filter((_, c) => c !== colIndex);
  const newRows = data.rows.map((row) => row.filter((_, c) => c !== colIndex));

  return {
    headers: newHeaders,
    alignments: newAlignments,
    rows: newRows,
  };
}

export function setColumnAlignment(
  data: TableData,
  colIndex: number,
  align: 'left' | 'center' | 'right'
): TableData {
  if (colIndex < 0 || colIndex >= data.headers.length) return data;
  const newAlignments = [...data.alignments];
  newAlignments[colIndex] = align;
  return { ...data, alignments: newAlignments };
}


