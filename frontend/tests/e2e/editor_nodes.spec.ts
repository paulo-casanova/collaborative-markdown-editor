import { test, expect } from '@playwright/test';

test.describe('Collaborative TipTap Editor Custom NodeViews (Step 4.2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-editor');
    // Wait for the collaborative editor to be visible
    await expect(page.locator('.collaborative-editor-root')).toBeVisible();
  });

  test('renders KaTeX display math block with SVG/DOM formula trees', async ({ page }) => {
    const mathBlock = page.locator('.math-block-node');
    await expect(mathBlock).toBeVisible();

    // Verify KaTeX rendered formula output
    const katexElement = mathBlock.locator('.katex');
    await expect(katexElement).toBeVisible();

    // Verify integral symbol and variable expressions exist in DOM tree
    await expect(mathBlock.locator('.mop, .mord, .msubsup').first()).toBeVisible();

    // Test interactive editing toggle
    const editBtn = mathBlock.getByRole('button', { name: /Edit LaTeX/i });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Verify textarea is displayed
    const textarea = mathBlock.locator('textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('E = mc^2');

    // Click Apply Math
    const applyBtn = mathBlock.getByRole('button', { name: /Apply Math/i });
    await applyBtn.click();

    // Verify updated math renders
    await expect(mathBlock.locator('.katex')).toBeVisible();
  });

  test('renders Mermaid diagram and supports interactive zoom and source toggles', async ({ page }) => {
    const mermaidBlock = page.locator('.mermaid-block-node');
    await expect(mermaidBlock).toBeVisible();

    // Wait for Mermaid async SVG rendering to complete
    const svg = mermaidBlock.locator('.mermaid-svg-container svg');
    await expect(svg).toBeVisible({ timeout: 15000 });

    // Verify diagram contents rendered inside SVG
    const svgText = await svg.textContent();
    expect(svgText).toContain('Start Node');
    expect(svgText).toContain('Finish Node');

    // Test Zoom In control
    const zoomInBtn = mermaidBlock.getByTitle('Zoom In');
    await expect(zoomInBtn).toBeVisible();
    await zoomInBtn.click();
    await expect(mermaidBlock.getByText('115%', { exact: true })).toBeVisible();

    // Test Zoom Reset
    const resetZoomBtn = mermaidBlock.getByTitle('Reset Zoom');
    await resetZoomBtn.click();
    await expect(mermaidBlock.getByText('100%', { exact: true })).toBeVisible();

    // Test toggle to Edit Source
    const editSourceBtn = mermaidBlock.getByRole('button', { name: /Edit Source/i });
    await editSourceBtn.click();

    const textarea = mermaidBlock.locator('textarea');
    await expect(textarea).toBeVisible();
    expect(await textarea.inputValue()).toContain('flowchart TD');

    // Toggle back to Preview
    const previewBtn = mermaidBlock.getByRole('button', { name: /Preview/i });
    await previewBtn.click();
    await expect(mermaidBlock.locator('.mermaid-svg-container svg')).toBeVisible();
  });

  test('renders Obsidian-style [[wiki-links]] and interactive reference popup', async ({ page }) => {
    const wikiLink = page.locator('.wiki-link-node');
    await expect(wikiLink).toBeVisible();

    // Verify display label
    await expect(wikiLink.getByText('Introduction Guide')).toBeVisible();

    // Click to open reference popover
    await wikiLink.click();

    // Verify popover displays target path
    const targetInput = wikiLink.locator('input[placeholder*="guides/intro.md"]');
    await expect(targetInput).toBeVisible();
    expect(await targetInput.inputValue()).toBe('guides/intro.md');

    // Verify "Open File" action exists
    await expect(wikiLink.getByText('Open File')).toBeVisible();
  });

  test('renders syntax-highlighted code block with language selection and copy button', async ({ page }) => {
    const codeBlock = page.locator('.code-block-wrapper');
    await expect(codeBlock).toBeVisible();

    // Verify language selector displays TypeScript
    const select = codeBlock.locator('select');
    await expect(select).toHaveValue('typescript');

    // Verify code text
    const code = codeBlock.locator('pre');
    await expect(code).toContainText('Hello Collaborative Editor');

    // Verify copy button
    const copyBtn = codeBlock.getByRole('button', { name: /Copy/i });
    await expect(copyBtn).toBeVisible();
  });

  test('renders inline KaTeX math ($formula$) formulas with interactive unfolding', async ({ page }) => {
    const inlineMath = page.locator('.cme-inline-math');
    await expect(inlineMath.first()).toBeVisible();

    // Verify KaTeX rendered formula output inside inline math
    const katexEl = inlineMath.first().locator('.katex');
    await expect(katexEl).toBeVisible();

    // Click inline math widget to unfold into raw syntax in-place
    await inlineMath.first().click();

    // Verify raw editor text contains the $E = mc^2$ syntax
    const editor = page.locator('.ProseMirror');
    await expect(editor).toContainText('$E = mc^2$');
  });

  test('renders GFM Markdown tables with headers and rows, and supports click to edit', async ({ page }) => {
    const tableBlock = page.locator('.cme-table-block-node');
    await expect(tableBlock).toBeVisible();

    // Verify rendered table headers
    await expect(tableBlock.getByText('Language')).toBeVisible();
    await expect(tableBlock.getByText('Typing')).toBeVisible();
    await expect(tableBlock.getByText('Performance')).toBeVisible();

    // Verify rendered table row cells
    await expect(tableBlock.getByText('Rust')).toBeVisible();
    await expect(tableBlock.getByText('Python')).toBeVisible();

    // Click table block to unfold to raw Markdown pipe syntax
    await tableBlock.click();

    // Verify raw Markdown pipes appear in the editor
    const editor = page.locator('.ProseMirror');
    await expect(editor).toContainText('| Language |');
  });
});
