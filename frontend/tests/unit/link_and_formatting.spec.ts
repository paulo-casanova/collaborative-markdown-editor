import { describe, it, expect } from 'vitest';
import { Text, EditorState } from '@codemirror/state';
import { buildLivePreviewDecorations } from '../../src/components/editor/codemirror/livePreviewPlugin';
import {
  stripHeadingNumberPrefix,
  slugifyHeading,
  matchesHeadingTarget,
  validateLinkTarget,
  updateKnownWorkspaceNodes,
} from '../../src/utils/linkValidator';
import {
  getWorkspaceFileUrl,
  resolveWorkspaceRelativePath,
  updateWorkspaceNodesCache,
} from '../../src/api/documents';
import {
  computeOrderedListRenumberingChanges,
  computeHeaderNumberingChanges,
} from '../../src/components/editor/CollaborativeEditor';
import { parsePillSyntax, resolvePillStyle } from '../../src/utils/pillUtils';
import { parseMarkdownToHtml } from '../../src/utils/markdownToHtml';
import { renderMarkdown } from '../../src/pages/ReaderPage';

describe('Link Validator and Header Numbering Utils', () => {
  it('strips hierarchical heading numbers while keeping non-section digits intact', () => {
    expect(stripHeadingNumberPrefix('3. Whatever')).toBe('Whatever');
    expect(stripHeadingNumberPrefix('1.2. Getting Started')).toBe('Getting Started');
    expect(stripHeadingNumberPrefix('1.2.3. Sub Section')).toBe('Sub Section');
    expect(stripHeadingNumberPrefix('1.2 Sub Section')).toBe('Sub Section');
    expect(stripHeadingNumberPrefix('123 Numbers and Symbols')).toBe('123 Numbers and Symbols');
    expect(stripHeadingNumberPrefix('Plain Title')).toBe('Plain Title');
  });

  it('matches heading targets whether reference has numbers or not', () => {
    expect(matchesHeadingTarget('3. Whatever', 'Whatever')).toBe(true);
    expect(matchesHeadingTarget('3. Whatever', '#Whatever')).toBe(true);
    expect(matchesHeadingTarget('3. Whatever', '#3. Whatever')).toBe(true);
    expect(matchesHeadingTarget('1.2. Getting Started', 'getting-started')).toBe(true);
    expect(matchesHeadingTarget('Plain Title', '#plain-title')).toBe(true);
    expect(matchesHeadingTarget('Plain Title', '#unrelated')).toBe(false);
  });

  it('validates local heading links against current document content', () => {
    const docMarkdown = `# 1. Overview
Welcome.

## 1.1. Architecture
System details.

### Deep Dive
Deep details.`;

    // Valid heading reference without section number
    const res1 = validateLinkTarget('#Overview', docMarkdown);
    expect(res1.valid).toBe(true);

    const res2 = validateLinkTarget('#Architecture', docMarkdown);
    expect(res2.valid).toBe(true);

    const res3 = validateLinkTarget('#deep-dive', docMarkdown);
    expect(res3.valid).toBe(true);

    // Invalid missing heading
    const res4 = validateLinkTarget('#NonExistent', docMarkdown);
    expect(res4.valid).toBe(false);
    expect(res4.reason).toContain('does not exist');
  });

  it('validates external URLs as valid', () => {
    expect(validateLinkTarget('https://example.com').valid).toBe(true);
    expect(validateLinkTarget('http://localhost:3000').valid).toBe(true);
    expect(validateLinkTarget('mailto:test@example.com').valid).toBe(true);
  });

  it('renumbers ordered lists when item is removed or inserted', () => {
    const lines = [
      '1. First item',
      '2. Second item',
      '4. Fourth item', // Notice 3 was removed/skipped
      '5. Fifth item',
    ];
    const doc = Text.of(lines);

    const changes = computeOrderedListRenumberingChanges(doc);
    expect(changes.length).toBe(2);
    expect(changes[0].insert).toBe('3');
    expect(changes[1].insert).toBe('4');
  });

  it('renumbers headers hierarchically when header numbering is computed', () => {
    const lines = [
      '# Introduction',
      'Content',
      '## Getting Started',
      'Content',
      '### Details',
      '# Next Chapter',
    ];
    const doc = Text.of(lines);

    const changes = computeHeaderNumberingChanges(doc, true);
    expect(changes.length).toBe(4);
    expect(changes[0].insert).toBe('1. ');
    expect(changes[1].insert).toBe('1.1. ');
    expect(changes[2].insert).toBe('1.1.1. ');
    expect(changes[3].insert).toBe('2. ');
  });

  it('resolves relative workspace paths correctly', () => {
    expect(resolveWorkspaceRelativePath('uk.jpg', 'specs/Test File Modified.md')).toBe('specs/uk.jpg');
    expect(resolveWorkspaceRelativePath('./uk.jpg', 'specs/Test File Modified.md')).toBe('specs/uk.jpg');
    expect(resolveWorkspaceRelativePath('../assets/uk.jpg', 'specs/deep/Test.md')).toBe('specs/assets/uk.jpg');
    expect(resolveWorkspaceRelativePath('/specs/uk.jpg', 'specs/Test File.md')).toBe('specs/uk.jpg');
    expect(resolveWorkspaceRelativePath('uk.jpg')).toBe('uk.jpg');
  });

  it('resolves getWorkspaceFileUrl with currentDocPath and workspace cache', () => {
    updateWorkspaceNodesCache([
      {
        path: 'specs/uk.jpg',
        name: 'uk.jpg',
        is_directory: false,
        size_bytes: 96943,
        updated_at: '2026-10-16T00:00:00Z',
      },
    ]);

    // When relative path from document is used
    const urlFromDoc = getWorkspaceFileUrl('uk.jpg', 'specs/Test File Modified.md');
    expect(urlFromDoc).toContain('path=specs%2Fuk.jpg');

    // When leading slash is used
    const urlWithSlash = getWorkspaceFileUrl('/specs/uk.jpg');
    expect(urlWithSlash).toContain('path=specs%2Fuk.jpg');

    // When only basename is used, should resolve to cached workspace path
    const urlFromBasename = getWorkspaceFileUrl('uk.jpg');
    expect(urlFromBasename).toContain('path=specs%2Fuk.jpg');
  });

  it('validates relative image and file links via validateLinkTarget', () => {
    updateKnownWorkspaceNodes([
      {
        path: 'specs/uk.jpg',
        name: 'uk.jpg',
        is_directory: false,
        size_bytes: 96943,
        updated_at: '2026-10-16T00:00:00Z',
      },
    ]);

    const res = validateLinkTarget('uk.jpg', undefined, 'specs/Test File Modified.md');
    expect(res.valid).toBe(true);

    const missingRes = validateLinkTarget('nonexistent.png', undefined, 'specs/Test File Modified.md');
    expect(missingRes.valid).toBe(false);
  });

  it('parses custom pills syntax [pill:color|label], [pill:label], [status:done], and [priority:p0]', () => {
    // Standard colored pill
    const p1 = parsePillSyntax('[pill:green|Approved]');
    expect(p1).not.toBeNull();
    expect(p1?.color).toBe('green');
    expect(p1?.label).toBe('Approved');
    expect(p1?.isCustomHex).toBe(false);

    // Default neutral pill
    const p2 = parsePillSyntax('[pill:Draft]');
    expect(p2).not.toBeNull();
    expect(p2?.color).toBe('slate');
    expect(p2?.label).toBe('Draft');

    // Custom hex color pill
    const p3 = parsePillSyntax('[pill:#7c3aed|Enterprise VIP]');
    expect(p3).not.toBeNull();
    expect(p3?.color).toBe('#7c3aed');
    expect(p3?.label).toBe('Enterprise VIP');
    expect(p3?.isCustomHex).toBe(true);

    // Semantic status shortcut
    const pStatus = parsePillSyntax('[status:in-progress]');
    expect(pStatus?.color).toBe('amber');
    expect(pStatus?.label).toBe('In Progress');

    // Semantic priority shortcut
    const pPriority = parsePillSyntax('[priority:p0]');
    expect(pPriority?.color).toBe('rose');
    expect(pPriority?.label).toBe('P0');

    // Invalid non-pill text
    expect(parsePillSyntax('not a pill')).toBeNull();
    expect(parsePillSyntax('[link](http://example.com)')).toBeNull();
  });

  it('resolves pill color styles and theme tokens accurately', () => {
    const green = resolvePillStyle('green');
    expect(green.bgClass).toContain('bg-emerald-500');
    expect(green.dotColor).toBe('#10b981');

    const amber = resolvePillStyle('amber');
    expect(amber.bgClass).toContain('bg-amber-500');
    expect(amber.dotColor).toBe('#f59e0b');

    const rose = resolvePillStyle('rose');
    expect(rose.bgClass).toContain('bg-rose-500');
    expect(rose.dotColor).toBe('#f43f5e');

    const slate = resolvePillStyle('slate');
    expect(slate.bgClass).toContain('bg-cme-bg-subtle');
  });

  it('converts markdown containing custom pills to semantic HTML', () => {
    const md = 'Status: [pill:green|Approved] and [pill:amber|In Progress] and [status:done]';
    const html = parseMarkdownToHtml(md);
    expect(html).toContain('<span class="cme-pill cme-pill-green" data-color="green">Approved</span>');
    expect(html).toContain('<span class="cme-pill cme-pill-amber" data-color="amber">In Progress</span>');
    expect(html).toContain('<span class="cme-pill cme-pill-green" data-color="green">Done</span>');
  });

  describe('Markdown Inline Formatting (Bold & Italic)', () => {
    it('parses underscore and asterisk italic: _foo_ and *bar*', () => {
      const html1 = parseMarkdownToHtml('This is _foo_ italic.');
      expect(html1).toContain('This is <em>foo</em> italic.');

      const html2 = parseMarkdownToHtml('This is *bar* italic.');
      expect(html2).toContain('This is <em>bar</em> italic.');
    });

    it('parses underscore and asterisk bold: __foo__ and **bar**', () => {
      const html1 = parseMarkdownToHtml('This is __foo__ bold.');
      expect(html1).toContain('This is <strong>foo</strong> bold.');

      const html2 = parseMarkdownToHtml('This is **bar** bold.');
      expect(html2).toContain('This is <strong>bar</strong> bold.');
    });

    it('parses bold + italic combinations: ___foo___ and ***bar***', () => {
      const html1 = parseMarkdownToHtml('This is ___foo___ bold italic.');
      expect(html1).toContain('<strong><em>foo</em></strong>');

      const html2 = parseMarkdownToHtml('This is ***bar*** bold italic.');
      expect(html2).toContain('<strong><em>bar</em></strong>');
    });

    it('does not parse intra-word underscores as emphasis (preserves snake_case)', () => {
      const html = parseMarkdownToHtml('Variable snake_case_name and MAX_BUFFER_SIZE should not italicize.');
      expect(html).not.toContain('<em>');
      expect(html).toContain('snake_case_name');
      expect(html).toContain('MAX_BUFFER_SIZE');
    });

    it('parses underscores surrounded by punctuation or parentheses', () => {
      const html = parseMarkdownToHtml('Parenthesized (_italic_) and quoted "_italic_".');
      expect(html).toContain('(<em>italic</em>)');
      expect(html).toContain('"<em>italic</em>"');
    });
  });

  describe('Blockquotes with Multi-Paragraphs', () => {
    it('renders blockquote paragraphs separated by empty quote lines (> \\n >)', () => {
      const md = '> First paragraph line 1\n> First paragraph line 2\n>\n> Second paragraph line 1';
      const html = parseMarkdownToHtml(md);
      expect(html).toContain('<blockquote><p>First paragraph line 1 First paragraph line 2</p><p>Second paragraph line 1</p></blockquote>');
    });

    it('renders blockquote paragraphs separated by blank lines (> \\n \\n >)', () => {
      const md = '> First paragraph\n\n> Second paragraph';
      const html = parseMarkdownToHtml(md);
      expect(html).toContain('<blockquote><p>First paragraph</p><p>Second paragraph</p></blockquote>');
    });

    it('renders single-paragraph blockquote without splitting lines into multiple <p>', () => {
      const md = '> Line 1\n> Line 2\n> Line 3';
      const html = parseMarkdownToHtml(md);
      expect(html).toContain('<blockquote><p>Line 1 Line 2 Line 3</p></blockquote>');
    });
  });

  describe('Fenced Code Blocks & Empty Verbatim', () => {
    it('parses empty backtick code blocks correctly without dropping or swallowing text', () => {
      const md = '```\n```\n\nSome text\n\n```js\n```';
      const html = parseMarkdownToHtml(md);
      expect(html).toContain('<pre><code class="language-plaintext"></code></pre>');
      expect(html).toContain('<p>Some text</p>');
      expect(html).toContain('<pre><code class="language-js"></code></pre>');
    });

    it('parses empty tilde code blocks correctly', () => {
      const md = '~~~\n~~~\n\n~~~python\n~~~';
      const html = parseMarkdownToHtml(md);
      expect(html).toContain('<pre><code class="language-plaintext"></code></pre>');
      expect(html).toContain('<pre><code class="language-python"></code></pre>');
    });

    it('parses code blocks with indentation (up to 3 spaces)', () => {
      const md = '   ```ts\nconst x = 1;\n   ```';
      const html = parseMarkdownToHtml(md);
      expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
    });
  });

  describe('ReaderPage renderMarkdown (React elements)', () => {
    it('renders multi-paragraph blockquotes with separate <p> elements', () => {
      const md = '> First paragraph\n>\n> Second paragraph';
      const elements = renderMarkdown(md) as any[];
      expect(elements.length).toBe(1);
      const bq = elements[0];
      expect(bq.type).toBe('blockquote');
      expect(bq.props.className).toContain('space-y-2');
      const paragraphs = bq.props.children;
      expect(Array.isArray(paragraphs)).toBe(true);
      expect(paragraphs.length).toBe(2);
      expect(paragraphs[0].type).toBe('p');
      expect(paragraphs[1].type).toBe('p');
    });

    it('renders empty code block without crash and with 1 line gutter in ReaderPage', () => {
      const md = '```\n```\n\n```python\n```\n\n~~~\n~~~';
      const elements = renderMarkdown(md) as any[];
      expect(elements.length).toBe(3);
      for (const el of elements) {
        expect(el.props.className).toContain('rounded-xl');
      }
    });

    it('renders tables with custom pills, wikilinks, and markdown links inside cells', () => {
      const md = [
        '| Name | Status | WikiLink | External |',
        '| :--- | :---: | :--- | ---: |',
        '| Project A | [pill:green|Approved] | [[Architecture/Overview|Specs]] | [Guide](https://example.com) |',
        '| Project B | [status:in-progress] | [[Roadmap]] | [Link](https://cme.dev) |',
      ].join('\n');

      const elements = renderMarkdown(md) as any[];
      expect(elements.length).toBe(1);
      const tableWrapper = elements[0];
      expect(tableWrapper.props.className).toContain('cme-table-block-node');
      const table = tableWrapper.props.children;
      expect(table.type).toBe('table');
      const [thead, tbody] = table.props.children;
      expect(thead.type).toBe('thead');
      expect(tbody.type).toBe('tbody');

      // Thead headers
      const thList = thead.props.children.props.children;
      expect(thList.length).toBe(4);

      // Tbody rows
      const rows = tbody.props.children;
      expect(rows.length).toBe(2);
      const row1Cells = rows[0].props.children;
      expect(row1Cells.length).toBe(4);
    });
  });

  describe('Table Parsing & Row Splitting (tableUtils)', () => {
    it('splits table cells while protecting pipes in pills and wikilinks', async () => {
      const { splitTableRow, parseTableAlignments, isTableDelimiterRow } = await import('../../src/utils/tableUtils');

      // Basic split
      expect(splitTableRow('| Col 1 | Col 2 | Col 3 |')).toEqual(['Col 1', 'Col 2', 'Col 3']);
      expect(splitTableRow('Col 1 | Col 2 | Col 3')).toEqual(['Col 1', 'Col 2', 'Col 3']);

      // Escaped pipe
      expect(splitTableRow('| Cell with \\| pipe | Next |')).toEqual(['Cell with | pipe', 'Next']);

      // Inline code with pipe
      expect(splitTableRow('| `cmd | grep` | Output |')).toEqual(['`cmd | grep`', 'Output']);

      // Custom pill with pipe
      expect(splitTableRow('| Task 1 | [pill:green|Done] | Notes |')).toEqual(['Task 1', '[pill:green|Done]', 'Notes']);
      expect(splitTableRow('| [pill:#7c3aed|VIP Member] | Active |')).toEqual(['[pill:#7c3aed|VIP Member]', 'Active']);

      // WikiLink with alias pipe
      expect(splitTableRow('| Page | [[Docs/Architecture|System Architecture]] | Verified |')).toEqual([
        'Page',
        '[[Docs/Architecture|System Architecture]]',
        'Verified',
      ]);

      // Alignments
      expect(parseTableAlignments('| :--- | :---: | ---: |')).toEqual(['left', 'center', 'right']);
      expect(parseTableAlignments('--- | :---: | ---')).toEqual(['left', 'center', 'left']);

      // Delimiter row check
      expect(isTableDelimiterRow('| :--- | :---: | ---: |')).toBe(true);
      expect(isTableDelimiterRow('| not | delimiter |')).toBe(false);
      expect(isTableDelimiterRow('plain text')).toBe(false);
    });

    it('renders HTML tables with pills and links in parseMarkdownToHtml', () => {
      const md = [
        '| Task | Status | Doc | Ref |',
        '| :--- | :---: | :--- | ---: |',
        '| Build Core | [pill:green|Passed] | [[Build/Guide|Build Docs]] | [Repo](https://github.com/repo) |',
        '| Test Suite | [status:done] | [[Tests]] | [CI](https://ci.dev) |',
      ].join('\n');

      const html = parseMarkdownToHtml(md);
      expect(html).toContain('<table><thead><tr>');
      expect(html).toContain('<th>Task</th>');
      expect(html).toContain('<th align="center" style="text-align: center;">Status</th>');
      expect(html).toContain('<span class="cme-pill cme-pill-green" data-color="green">Passed</span>');
      expect(html).toContain('<span class="cme-pill cme-pill-green" data-color="green">Done</span>');
      expect(html).toContain('<a class="wiki-link" data-target="Build/Guide">Build Docs</a>');
      expect(html).toContain('<a class="wiki-link" data-target="Tests">Tests</a>');
      expect(html).toContain('<a href="https://github.com/repo" target="_blank" rel="noopener noreferrer">Repo</a>');
      expect(html).toContain('</tbody></table>');
    });

    it('parses, formats, and manipulates tables (addRow, deleteRow, addColumn, deleteColumn, setAlignment, updateCell, moveColumn, moveRow)', async () => {
      const {
        parseMarkdownTable,
        formatMarkdownTable,
        addRow,
        deleteRow,
        addColumn,
        deleteColumn,
        setColumnAlignment,
        updateCell,
        moveColumn,
        moveRow,
      } = await import('../../src/utils/tableUtils');

      const raw = [
        '| Name | Status | Score |',
        '| :--- | :---: | ---: |',
        '| Alice | [pill:green|Active] | 95 |',
        '| Bob | [pill:amber|Idle] | 80 |',
      ].join('\n');

      const table = parseMarkdownTable(raw);
      expect(table).not.toBeNull();
      expect(table!.headers).toEqual(['Name', 'Status', 'Score']);
      expect(table!.alignments).toEqual(['left', 'center', 'right']);
      expect(table!.rows).toHaveLength(2);
      expect(table!.rows[0]).toEqual(['Alice', '[pill:green|Active]', '95']);
      expect(table!.rows[1]).toEqual(['Bob', '[pill:amber|Idle]', '80']);

      // 1. updateCell
      const updatedCellBody = updateCell(table!, 0, 2, '98');
      expect(updatedCellBody.rows[0][2]).toBe('98');

      const updatedCellHeader = updateCell(table!, -1, 0, 'User Name');
      expect(updatedCellHeader.headers[0]).toBe('User Name');

      // 2. addRow (append)
      const withNewRow = addRow(table!);
      expect(withNewRow.rows).toHaveLength(3);
      expect(withNewRow.rows[2]).toEqual(['', '', '']);

      // addRow (insert at index 1)
      const withInsertedRow = addRow(table!, 1);
      expect(withInsertedRow.rows).toHaveLength(3);
      expect(withInsertedRow.rows[1]).toEqual(['', '', '']);
      expect(withInsertedRow.rows[2][0]).toBe('Bob');

      // 3. deleteRow
      const afterDeleteRow = deleteRow(table!, 0);
      expect(afterDeleteRow.rows).toHaveLength(1);
      expect(afterDeleteRow.rows[0][0]).toBe('Bob');

      // 4. addColumn (append)
      const withNewCol = addColumn(table!, undefined, 'Notes');
      expect(withNewCol.headers).toEqual(['Name', 'Status', 'Score', 'Notes']);
      expect(withNewCol.alignments).toEqual(['left', 'center', 'right', 'left']);
      expect(withNewCol.rows[0]).toEqual(['Alice', '[pill:green|Active]', '95', '']);

      // addColumn (insert at index 1)
      const withInsertedCol = addColumn(table!, 1, 'Role');
      expect(withInsertedCol.headers).toEqual(['Name', 'Role', 'Status', 'Score']);
      expect(withInsertedCol.alignments).toEqual(['left', 'left', 'center', 'right']);
      expect(withInsertedCol.rows[0]).toEqual(['Alice', '', '[pill:green|Active]', '95']);

      // 5. deleteColumn
      const afterDeleteCol = deleteColumn(table!, 1);
      expect(afterDeleteCol.headers).toEqual(['Name', 'Score']);
      expect(afterDeleteCol.alignments).toEqual(['left', 'right']);
      expect(afterDeleteCol.rows[0]).toEqual(['Alice', '95']);

      // deleteColumn does not delete the last remaining column
      const singleColTable = deleteColumn(afterDeleteCol, 1);
      expect(singleColTable.headers).toEqual(['Name']);
      const cannotDeleteLast = deleteColumn(singleColTable, 0);
      expect(cannotDeleteLast.headers).toEqual(['Name']);

      // 6. setColumnAlignment
      const realigned = setColumnAlignment(table!, 0, 'center');
      expect(realigned.alignments[0]).toBe('center');

      // 7. formatMarkdownTable formatting with padded columns
      const formatted = formatMarkdownTable(realigned);
      expect(formatted).toContain('| Name  | Status              | Score |');
      expect(formatted).toContain('| :---: | :-----------------: | ----: |');
      expect(formatted).toContain('| Alice | [pill:green|Active] | 95    |');

      // Escapes unescaped pipes in cell values
      const withRawPipe = updateCell(table!, 0, 0, 'Alice | Senior');
      const formattedPipe = formatMarkdownTable(withRawPipe);
      expect(formattedPipe).toContain('Alice \\| Senior');

      // 8. moveColumn
      // Move column 0 right -> ['Status', 'Name', 'Score']
      const colMovedRight = moveColumn(table!, 0, 'right');
      expect(colMovedRight.headers).toEqual(['Status', 'Name', 'Score']);
      expect(colMovedRight.alignments).toEqual(['center', 'left', 'right']);
      expect(colMovedRight.rows[0]).toEqual(['[pill:green|Active]', 'Alice', '95']);
      expect(colMovedRight.rows[1]).toEqual(['[pill:amber|Idle]', 'Bob', '80']);

      // Move column 1 left -> back to original
      const colMovedLeft = moveColumn(colMovedRight, 1, 'left');
      expect(colMovedLeft.headers).toEqual(['Name', 'Status', 'Score']);
      expect(colMovedLeft.alignments).toEqual(['left', 'center', 'right']);

      // Boundary checks (move left at 0, move right at last index)
      expect(moveColumn(table!, 0, 'left')).toEqual(table);
      expect(moveColumn(table!, 2, 'right')).toEqual(table);

      // 9. moveRow
      // Move row 0 down -> Bob is first, Alice is second
      const rowMovedDown = moveRow(table!, 0, 'down');
      expect(rowMovedDown.rows[0]).toEqual(['Bob', '[pill:amber|Idle]', '80']);
      expect(rowMovedDown.rows[1]).toEqual(['Alice', '[pill:green|Active]', '95']);

      // Move row 1 up -> back to original
      const rowMovedUp = moveRow(rowMovedDown, 1, 'up');
      expect(rowMovedUp.rows[0]).toEqual(['Alice', '[pill:green|Active]', '95']);
      expect(rowMovedUp.rows[1]).toEqual(['Bob', '[pill:amber|Idle]', '80']);

      // Boundary checks (move up at 0, move down at last row)
      expect(moveRow(table!, 0, 'up')).toEqual(table);
      expect(moveRow(table!, 1, 'down')).toEqual(table);
    });

    it('TableBlockWidget handles eq, ignoreEvent, and setRawTablePos effect', async () => {
      const { TableBlockWidget, setRawTablePos } = await import(
        '../../src/components/editor/codemirror/livePreviewWidgets'
      );

      const raw = [
        '| Header 1 | Header 2 |',
        '| :------- | :------- |',
        '| Cell 1   | Cell 2   |',
      ].join('\n');

      const widget1 = new TableBlockWidget(raw, 0, raw.length, '/test/doc.md');
      const widget2 = new TableBlockWidget(raw, 0, raw.length, '/test/doc.md');
      const widget3 = new TableBlockWidget(raw + '\n| Cell 3 | Cell 4 |', 0, raw.length, '/test/doc.md');

      // 1. ignoreEvent returns true so CodeMirror does not intercept cell/button inputs
      expect(widget1.ignoreEvent({ type: 'click' } as any)).toBe(true);
      expect(widget1.ignoreEvent({ type: 'keydown' } as any)).toBe(true);

      // 2. eq comparison
      expect(widget1.eq(widget2)).toBe(true);
      expect(widget1.eq(widget3)).toBe(false);

      // 3. setRawTablePos effect
      const rawEffect = setRawTablePos.of(15);
      expect(rawEffect.value).toBe(15);
      const resetEffect = setRawTablePos.of(null);
      expect(resetEffect.value).toBeNull();

      // 4. In DOM environment (if present), verifies DOM structure
      if (typeof document !== 'undefined') {
        const { EditorState } = await import('@codemirror/state');
        const { EditorView } = await import('@codemirror/view');
        const state = EditorState.create({ doc: raw });
        const parent = document.createElement('div');
        const view = new EditorView({ state, parent });
        const dom = widget1.toDOM(view);
        expect(dom.className).toContain('cme-table-block-node');
        const headerBar = dom.querySelector('.cme-table-header');
        expect(headerBar).not.toBeNull();
        expect(headerBar?.textContent).toContain('Table (1 rows × 2 cols)');
        view.destroy();
      }
    });
  });

  describe('Inline formatting in Headers, Table Headers, and Table of Contents', () => {
    it('extractHeadingsFromMarkdown preserves rawText for headings with inline formatting', async () => {
      const { extractHeadingsFromMarkdown } = await import('../../src/components/navigation/DocumentOutline');
      const md = [
        '# Header with `code` and **bold** and *italic*',
        '## Subheader with __bold underscore__ and _italic underscore_',
        '### Deep with ***bold italic*** and ___both___',
        '# Plain Header',
      ].join('\n');

      const headings = extractHeadingsFromMarkdown(md, false);
      expect(headings.length).toBe(4);

      // Clean text is preserved for accessibility / tooltips
      expect(headings[0].text).toBe('Header with code and bold and italic');
      // rawText retains formatting
      expect(headings[0].rawText).toBe('Header with `code` and **bold** and *italic*');
      expect(headings[0].id).toBe('header-with-code-and-bold-and-italic');

      expect(headings[1].text).toBe('Subheader with bold underscore and italic underscore');
      expect(headings[1].rawText).toBe('Subheader with __bold underscore__ and _italic underscore_');

      expect(headings[2].text).toBe('Deep with bold italic and both');
      expect(headings[2].rawText).toBe('Deep with ***bold italic*** and ___both___');

      // Plain header does not need rawText
      expect(headings[3].text).toBe('Plain Header');
      expect(headings[3].rawText).toBeUndefined();
    });

    it('renderOutlineFormatted renders formatting tokens as rich React elements', async () => {
      const { renderOutlineFormatted } = await import('../../src/components/navigation/DocumentOutline');
      const formatted = renderOutlineFormatted(
        'Header `inline_fn()` with **bold** and *italic* and ***bold italic*** and ~~strike~~'
      ) as any[];
      expect(Array.isArray(formatted)).toBe(true);

      const types = formatted.map((part) => (typeof part === 'object' && part ? part.type : 'text'));
      expect(types).toContain('code');
      expect(types).toContain('strong');
      expect(types).toContain('em');
      expect(types).toContain('del');

      // Code element
      const codePart = formatted.find((p) => p && p.type === 'code');
      expect(codePart.props.className).toContain('font-mono');
      expect(codePart.props.className).toContain('text-[0.88em]');
      expect(codePart.props.children).toBe('inline_fn()');

      // Bold parts
      const strongParts = formatted.filter((p) => p && p.type === 'strong');
      expect(strongParts.length).toBeGreaterThanOrEqual(2);

      // Plain bold
      const biPart = strongParts.find((p) => p.props.children && p.props.children.type === 'em');
      expect(biPart).toBeDefined();

      const plainBold = strongParts.find((p) => p !== biPart);
      expect(plainBold).toBeDefined();
      expect(plainBold?.props.className).toContain('font-bold');
    });

    it('ReaderPage renderMarkdown renders formatted headings and table headers with bold, code, and italic', () => {
      const md = [
        '# Overview of `my_api()` with **Key Notes** and *Caveats*',
        '',
        '| Header `cmd` | **Bold Header** | *Italic Header* | ***Both*** |',
        '| :--- | :--- | :--- | :--- |',
        '| `print()` | **Active** | *Pending* | ***Urgent*** |',
      ].join('\n');

      const elements = renderMarkdown(md) as any[];
      expect(elements.length).toBe(2);

      // 1. Heading element
      const h1 = elements[0];
      expect(h1.type).toBe('h1');
      // h1.props.children is [numberBadge, <span>{headingContent}</span>]
      const h1Span = h1.props.children[1];
      const headingParts = h1Span.props.children as any[];

      const codePart = headingParts.find((p) => p && p.type === 'code');
      expect(codePart).toBeDefined();
      expect(codePart.props.children).toBe('my_api()');
      expect(codePart.props.className).toContain('font-mono');
      expect(codePart.props.className).toContain('text-[0.88em]');

      const boldPart = headingParts.find((p) => p && p.type === 'strong' && !p.props.children?.type);
      expect(boldPart).toBeDefined();
      expect(boldPart.props.className).toContain('font-black');

      const italicPart = headingParts.find((p) => p && p.type === 'em');
      expect(italicPart).toBeDefined();
      expect(italicPart.props.className).toContain('italic');

      // 2. Table element
      const tableWrapper = elements[1];
      expect(tableWrapper.props.className).toContain('cme-table-block-node');
      const table = tableWrapper.props.children;
      const [thead, tbody] = table.props.children;

      // Table headers
      const thList = thead.props.children.props.children as any[];
      expect(thList.length).toBe(4);

      // TH 0: `cmd`
      const th0Content = thList[0].props.children as any[];
      const th0Code = th0Content.find((p) => p && p.type === 'code');
      expect(th0Code).toBeDefined();
      expect(th0Code.props.children).toBe('cmd');

      // TH 1: **Bold Header**
      const th1Content = thList[1].props.children as any[];
      const th1Bold = th1Content.find((p) => p && p.type === 'strong');
      expect(th1Bold).toBeDefined();
      expect(th1Bold.props.className).toContain('font-black');

      // TH 2: *Italic Header*
      const th2Content = thList[2].props.children as any[];
      const th2Italic = th2Content.find((p) => p && p.type === 'em');
      expect(th2Italic).toBeDefined();
      expect(th2Italic.props.className).toContain('italic');

      // TH 3: ***Both***
      const th3Content = thList[3].props.children as any[];
      const th3Both = th3Content.find((p) => p && p.type === 'strong');
      expect(th3Both).toBeDefined();
      expect(th3Both.props.children.type).toBe('em');

      // Table body cells
      const row0Cells = tbody.props.children[0].props.children as any[];
      expect(row0Cells.length).toBe(4);
      const td0Code = (row0Cells[0].props.children as any[]).find((p) => p && p.type === 'code');
      expect(td0Code).toBeDefined();
      expect(td0Code.props.children).toBe('print()');
    });

    it('ReaderPage renderMarkdown supports underscore emphasis, bold, and backticks in table headers', () => {
      const md = [
        '| `inline_code` | _underscore emphasis_ | __underscore bold__ | ___underscore bold italic___ |',
        '| :--- | :--- | :--- | :--- |',
        '| `val1` | _cell em_ | __cell bold__ | ___cell bi___ |',
      ].join('\n');

      const elements = renderMarkdown(md) as any[];
      expect(elements.length).toBe(1);
      const tableWrapper = elements[0];
      const table = tableWrapper.props.children;
      const [thead] = table.props.children;
      const thList = thead.props.children.props.children as any[];

      // TH 0: `inline_code`
      const th0Content = thList[0].props.children as any[];
      const th0Code = th0Content.find((p) => p && p.type === 'code');
      expect(th0Code).toBeDefined();
      expect(th0Code.props.children).toBe('inline_code');
      expect(th0Code.props.className).toContain('font-mono');

      // TH 1: _underscore_emphasis_
      const th1Content = thList[1].props.children as any[];
      const th1Em = th1Content.find((p) => p && p.type === 'em');
      expect(th1Em).toBeDefined();
      expect(th1Em.props.className).toContain('italic');

      // TH 2: __underscore_bold__
      const th2Content = thList[2].props.children as any[];
      const th2Bold = th2Content.find((p) => p && p.type === 'strong');
      expect(th2Bold).toBeDefined();
      expect(th2Bold.props.className).toContain('font-black');

      // TH 3: ___underscore_bold_italic___
      const th3Content = thList[3].props.children as any[];
      const th3Both = th3Content.find((p) => p && p.type === 'strong');
      expect(th3Both).toBeDefined();
      expect(th3Both.props.children.type).toBe('em');
    });

    it('TableBlockWidget renderCellContent formats table headers with backticks and underscores', async () => {
      const { renderCellContent } = await import('../../src/components/editor/codemirror/livePreviewWidgets');

      const makeMockNode = (tag?: string, textContent?: string) => ({
        tagName: tag ? tag.toUpperCase() : '#TEXT',
        className: '',
        textContent: textContent || '',
        children: [] as any[],
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        appendChild(child: any) {
          this.children.push(child);
          return child;
        },
      });

      const originalDoc = (globalThis as any).document;
      (globalThis as any).document = {
        createElement: (tag: string) => makeMockNode(tag),
        createTextNode: (text: string) => makeMockNode(undefined, text),
      };

      try {
        const dummyView = {} as any;

        // 1. Backtick code in header: `my_column`
        const headerCode = makeMockNode();
        renderCellContent(headerCode as any, '`my_column`', dummyView);
        expect(headerCode.children.length).toBe(1);
        expect(headerCode.children[0].tagName).toBe('CODE');
        expect(headerCode.children[0].className).toContain('font-mono');
        expect(headerCode.children[0].textContent).toBe('my_column');

        // 2. Underscore emphasis in header: _italic header_
        const headerItalic = makeMockNode();
        renderCellContent(headerItalic as any, '_italic header_', dummyView);
        expect(headerItalic.children.length).toBe(1);
        expect(headerItalic.children[0].tagName).toBe('EM');
        expect(headerItalic.children[0].className).toContain('italic');

        // 3. Underscore bold in header: __bold header__
        const headerBold = makeMockNode();
        renderCellContent(headerBold as any, '__bold header__', dummyView);
        expect(headerBold.children.length).toBe(1);
        expect(headerBold.children[0].tagName).toBe('STRONG');
        expect(headerBold.children[0].className).toContain('font-black');

        // 4. Underscore bold-italic in header: ___both header___
        const headerBoth = makeMockNode();
        renderCellContent(headerBoth as any, '___both header___', dummyView);
        expect(headerBoth.children.length).toBe(1);
        expect(headerBoth.children[0].tagName).toBe('STRONG');
        expect(headerBoth.children[0].className).toContain('font-black');
        expect(headerBoth.children[0].children[0].tagName).toBe('EM');
        expect(headerBoth.children[0].children[0].className).toContain('italic');

        // 5. Mixed header: `fn()` with **bold** and _italic_
        const headerMixed = makeMockNode();
        renderCellContent(headerMixed as any, 'Col `fn()` with **bold** and _italic_', dummyView);
        const tags = headerMixed.children.map((c) => c.tagName || '#TEXT');
        expect(tags).toContain('CODE');
        expect(tags).toContain('STRONG');
        expect(tags).toContain('EM');
      } finally {
        (globalThis as any).document = originalDoc;
      }
    });
  });

  describe('Pills in code and nested formatting', () => {
    it('parseMarkdownToHtml preserves pills inside inline code and fenced code blocks without pill conversion', () => {
      const inlineCodeMd = 'Inline `[pill:red|Danger]` and `[status:done]`.';
      const inlineHtml = parseMarkdownToHtml(inlineCodeMd);
      expect(inlineHtml).toContain('<code>[pill:red|Danger]</code>');
      expect(inlineHtml).toContain('<code>[status:done]</code>');
      expect(inlineHtml).not.toContain('cme-pill');

      const fencedMd = '```json\n{"pill": "[pill:red|Danger]"}\n```';
      const fencedHtml = parseMarkdownToHtml(fencedMd);
      expect(fencedHtml).toContain('[pill:red|Danger]');
      expect(fencedHtml).not.toContain('cme-pill');
    });

    it('parseMarkdownToHtml converts nested formatting properly', () => {
      expect(parseMarkdownToHtml('_foo **bar**_')).toBe('<p><em>foo <strong>bar</strong></em></p>');
      expect(parseMarkdownToHtml('**foo _bar_**')).toBe('<p><strong>foo <em>bar</em></strong></p>');
      expect(parseMarkdownToHtml('*foo **bar***')).toBe('<p><em>foo <strong>bar</strong></em></p>');
      expect(parseMarkdownToHtml('**foo *bar***')).toBe('<p><strong>foo <em>bar</em></strong></p>');
      expect(parseMarkdownToHtml('*foo __bar__*')).toBe('<p><em>foo <strong>bar</strong></em></p>');
      expect(parseMarkdownToHtml('__foo *bar*__')).toBe('<p><strong>foo <em>bar</em></strong></p>');
      expect(parseMarkdownToHtml('~~foo **bar**~~')).toBe('<p><s>foo <strong>bar</strong></s></p>');
      expect(parseMarkdownToHtml('*foo ~~bar~~*')).toBe('<p><em>foo <s>bar</s></em></p>');
      expect(parseMarkdownToHtml('**foo ~~bar~~**')).toBe('<p><strong>foo <s>bar</s></strong></p>');
    });

    it('buildLivePreviewDecorations does not create PillWidget for pills inside inline code', () => {
      const doc = '`[pill:red|Danger]` and [pill:green|Active]';
      const state = EditorState.create({ doc });
      const decos = buildLivePreviewDecorations(state);
      const widgets: any[] = [];
      const marks: string[] = [];
      decos.between(0, doc.length, (from, to, value) => {
        if ((value as any).spec?.widget) {
          widgets.push((value as any).spec.widget);
        }
        if ((value as any).spec?.class) {
          marks.push((value as any).spec.class);
        }
      });
      // Exactly one PillWidget for the outer [pill:green|Active], none for the code span
      const pillWidgets = widgets.filter((w) => w.constructor?.name === 'PillWidget');
      expect(pillWidgets.length).toBe(1);
      expect(pillWidgets[0].rawText).toBe('[pill:green|Active]');
    });

    it('buildLivePreviewDecorations handles nested _foo **bar**_ in live preview', () => {
      const doc = '_foo **bar**_\nUnfocused line';
      // Cursor is on line 2 ('Unfocused line') so line 1 is fully rendered in live preview mode
      const state = EditorState.create({ doc, selection: { anchor: doc.length } });
      const decos = buildLivePreviewDecorations(state);
      const marks: { from: number; to: number; cls: string }[] = [];
      decos.between(0, doc.length, (from, to, value) => {
        if ((value as any).spec?.class) {
          marks.push({ from, to, cls: (value as any).spec.class });
        }
      });
      const italicMark = marks.find((m) => m.cls.includes('cme-live-italic'));
      const boldMark = marks.find((m) => m.cls.includes('cme-live-bold'));
      expect(italicMark).toBeDefined();
      expect(boldMark).toBeDefined();
      // Italic covers 1 to 12 ('foo **bar**')
      expect(italicMark?.from).toBe(1);
      expect(italicMark?.to).toBe(12);
      // Bold covers 7 to 10 ('bar')
      expect(boldMark?.from).toBe(7);
      expect(boldMark?.to).toBe(10);
    });

    it('renderCellContent preserves pills inside code and nests formatting inside table cells', async () => {
      const { renderCellContent } = await import('../../src/components/editor/codemirror/livePreviewWidgets');

      const makeMockNode = (tag?: string, textContent?: string) => ({
        tagName: tag ? tag.toUpperCase() : '#TEXT',
        className: '',
        textContent: textContent || '',
        children: [] as any[],
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        appendChild(child: any) {
          this.children.push(child);
          return child;
        },
      });

      const originalDoc = (globalThis as any).document;
      (globalThis as any).document = {
        createElement: (tag: string) => makeMockNode(tag),
        createTextNode: (text: string) => makeMockNode(undefined, text),
      };

      try {
        const dummyView = {} as any;

        // 1. Pill inside code cell: `[pill:red|Danger]`
        const cellWithCodePill = makeMockNode();
        renderCellContent(cellWithCodePill as any, '`[pill:red|Danger]`', dummyView);
        expect(cellWithCodePill.children.length).toBe(1);
        expect(cellWithCodePill.children[0].tagName).toBe('CODE');
        expect(cellWithCodePill.children[0].textContent).toBe('[pill:red|Danger]');

        // 2. Nested formatting in cell: _foo **bar**_
        const cellWithNested = makeMockNode();
        renderCellContent(cellWithNested as any, '_foo **bar**_', dummyView);
        expect(cellWithNested.children.length).toBe(1);
        expect(cellWithNested.children[0].tagName).toBe('EM');
        const emChildren = cellWithNested.children[0].children;
        const boldInside = emChildren.find((c: any) => c.tagName === 'STRONG');
        expect(boldInside).toBeDefined();
      } finally {
        (globalThis as any).document = originalDoc;
      }
    });
  });
});


