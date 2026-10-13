import { test, expect } from '@playwright/test';
import { BACKEND_URL } from './test_config';
import fs from 'fs';
import path from 'path';

const STORAGE_ROOT = process.env.TEST_STORAGE_DIR || '/tmp/cme_e2e_storage';
const CONTENT_DIR = path.join(STORAGE_ROOT, 'content');

test.describe('End-to-End User Journey Simulator', () => {
  let adminToken = '';
  let testerToken = '';

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate test_admin
    const adminRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
      data: { username: 'test_admin', password: 'password123' },
    });
    expect(adminRes.ok()).toBeTruthy();
    const adminJson = await adminRes.json();
    adminToken = adminJson.token;

    // 2. Authenticate ws_tester
    const testerRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
      data: { username: 'ws_tester', password: 'password123' },
    });
    expect(testerRes.ok()).toBeTruthy();
    const testerJson = await testerRes.json();
    testerToken = testerJson.token;
  });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);
  });

  test('Journey 1: Document Authoring, Live Preview Formatting, Source Unfolding & Zero-Duplication Reopen', async ({ page }) => {
    const timestamp = Date.now();
    const fileName = `author_journey_${timestamp}.md`;
    const docTitle = `author_journey_${timestamp}`;

    // 1. Open Workspace Home
    await page.goto('/');
    const fileTree = page.locator('[data-testid="file-tree-container"]');
    await expect(fileTree).toBeVisible();

    // 2. Create document via FileTree UI modal
    const newDocBtn = page.locator('[data-testid="filetree-new-doc-btn"]');
    await expect(newDocBtn).toBeVisible();
    await newDocBtn.click();

    const modalInput = page.locator('[data-testid="filetree-modal-input"]');
    await expect(modalInput).toBeVisible();
    await modalInput.fill(fileName);
    await page.locator('[data-testid="filetree-modal-submit"]').click();

    // 3. Verify navigation to the new document in workspace
    await page.waitForURL(/\/documents\/.+/);
    const primaryPane = page.locator('[data-testid="primary-editor-pane"]');
    await expect(primaryPane).toBeVisible();
    await expect(primaryPane.getByRole('heading', { name: docTitle })).toBeVisible();

    // 4. Locate CodeMirror Live Preview editor
    const cmContent = page.locator('.collaborative-editor-root .cm-content');
    await expect(cmContent).toBeVisible();

    // Clear initial template content and type rich markdown
    await cmContent.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');

    const richMarkdown = [
      '# Executive Project Report',
      '',
      'Inline formula: $E = mc^2$ embedded inside sentence.',
      '',
      '$$\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$',
      '',
      '| Milestone | Status | ETA |',
      '|---|---|---|',
      '| Engine Core | Done | Oct 2026 |',
      '| Live Sync | In Progress | Nov 2026 |',
      '',
      '```python',
      'def calculate_total(items):',
      '    return sum(items)',
      '```',
      '',
      '```',
      'Generic untyped log line output',
      '```',
      '',
      'Final summary paragraph.',
    ].join('\n');

    await page.keyboard.insertText(richMarkdown);

    // 5. Assert Live Preview Rendering Decorations
    // 5a. H1 Heading decoration
    await expect(page.locator('.cme-live-h1')).toBeVisible();
    await expect(page.locator('.cme-live-h1')).toContainText('Executive Project Report');

    // 5b. Inline KaTeX formula
    const inlineMath = page.locator('.cme-inline-math');
    await expect(inlineMath.first()).toBeVisible();
    await expect(inlineMath.first().locator('.katex')).toBeVisible();

    // 5c. Block KaTeX display math
    const mathBlock = page.locator('.math-block-node');
    await expect(mathBlock.first()).toBeVisible();
    await expect(mathBlock.first().locator('.katex')).toBeVisible();

    // 5d. GFM Table
    const tableBlock = page.locator('.cme-table-block-node');
    await expect(tableBlock.first()).toBeVisible();
    await expect(tableBlock.getByText('Milestone')).toBeVisible();
    await expect(tableBlock.getByText('Engine Core')).toBeVisible();
    await expect(tableBlock.getByText('Oct 2026')).toBeVisible();

    // 5e. Code Blocks: Python (with syntax highlight and line numbers) & untyped (none)
    const codeBlocks = page.locator('.code-block-wrapper');
    await expect(codeBlocks.first()).toBeVisible();

    // Python code block
    const pyBlock = codeBlocks.first();
    await expect(pyBlock.locator('select')).toHaveValue('python');
    await expect(pyBlock.locator('.hljs-keyword').first()).toContainText('def');
    await expect(pyBlock.locator('.line-numbers-gutter')).toContainText('1');

    // Untyped code block
    const untypedBlock = codeBlocks.nth(1);
    await expect(untypedBlock.locator('select')).toHaveValue('');
    await expect(untypedBlock.locator('select option:checked')).toHaveText('none');

    // 6. Test Interactive In-Place Unfolding
    // Unfold inline math
    await inlineMath.first().click();
    await expect(cmContent).toContainText('$E = mc^2$');

    // Click outside to re-fold
    await cmContent.locator('.cme-live-h1').click();
    await expect(page.locator('.cme-inline-math').first().locator('.katex')).toBeVisible();

    // 7. Verify Document Close & Zero-Duplication Reopen
    // Extract document ID from current URL
    const url = page.url();
    const docId = url.split('/documents/')[1].split('?')[0];
    const diskFilePath = path.join(CONTENT_DIR, fileName);

    // Wait for debounced persistence worker flush to write to disk
    await expect.poll(() => {
      if (!fs.existsSync(diskFilePath)) return '';
      return fs.readFileSync(diskFilePath, 'utf-8');
    }, { timeout: 12000, intervals: [500] }).toContain('# Executive Project Report');

    // Close document tab
    const tabCloseBtn = page.locator(`[data-testid="close-tab-${docId}"]`);
    await tabCloseBtn.click({ force: true });

    // Reopen document from FileTree
    const treeDocItem = fileTree.getByText(docTitle);
    await expect(treeDocItem).toBeVisible();
    await treeDocItem.click();

    // Wait for document to reopen
    await page.waitForURL(new RegExp(`/documents/${docId}`));
    await expect(primaryPane.getByRole('heading', { name: docTitle })).toBeVisible();
    await expect(cmContent).toBeVisible();

    // Assert NO duplicated content
    const fullEditorText = await cmContent.textContent();
    const headingMatches = (fullEditorText?.match(/Executive Project Report/g) || []).length;
    expect(headingMatches).toBe(1);

    const inlineMatches = (fullEditorText?.match(/E = mc\^2/g) || []).length;
    // Widget or raw text might contain it once
    expect(inlineMatches).toBeLessThanOrEqual(2);

    // 8. Assert Physical File on POSIX Disk Storage
    expect(fs.existsSync(diskFilePath)).toBeTruthy();
    const diskContent = fs.readFileSync(diskFilePath, 'utf-8');
    expect(diskContent).toContain('# Executive Project Report');
    expect(diskContent).toContain('$E = mc^2$');
    expect(diskContent).toContain('| Milestone | Status | ETA |');
    expect(diskContent).toContain('def calculate_total(items):');

    // Verify disk content is NOT duplicated
    const diskHeadingCount = (diskContent.match(/# Executive Project Report/g) || []).length;
    expect(diskHeadingCount).toBe(1);
  });

  test('Journey 2: Document Renaming Synchronization across FileTree, Tabs, Header, and Disk', async ({ page }) => {
    const timestamp = Date.now();
    const initialFileName = `lifecycle_${timestamp}.md`;
    const initialTitle = `lifecycle_${timestamp}`;
    const treeRenamedFileName = `tree_renamed_${timestamp}.md`;
    const treeRenamedTitle = `tree_renamed_${timestamp}`;
    const headerRenamedFileName = `header_renamed_${timestamp}.md`;
    const headerRenamedTitle = `header_renamed_${timestamp}`;

    // 1. Create document
    await page.goto('/');
    const fileTree = page.locator('[data-testid="file-tree-container"]');
    await expect(fileTree).toBeVisible();

    const newDocBtn = page.locator('[data-testid="filetree-new-doc-btn"]');
    await newDocBtn.click();
    const modalInput = page.locator('[data-testid="filetree-modal-input"]');
    await modalInput.fill(initialFileName);
    await page.locator('[data-testid="filetree-modal-submit"]').click();

    await page.waitForURL(/\/documents\/.+/);
    const docId = page.url().split('/documents/')[1].split('?')[0];

    const primaryPane = page.locator('[data-testid="primary-editor-pane"]');
    const tab = page.locator(`[data-testid="workspace-tab-${docId}"]`);

    await expect(primaryPane.getByRole('heading', { name: initialTitle })).toBeVisible();
    await expect(tab).toContainText(initialTitle);

    // 2. Step 2A: Rename via FileTree Context Menu
    const treeItem = fileTree.getByText(initialTitle);
    await expect(treeItem).toBeVisible();
    await treeItem.click({ button: 'right' });

    const renameOption = page.locator('[data-testid="filetree-rename-btn"]');
    await expect(renameOption).toBeVisible();
    await renameOption.click();

    await expect(modalInput).toBeVisible();
    await modalInput.fill(treeRenamedFileName);
    await page.locator('[data-testid="filetree-modal-submit"]').click();

    // Verify all UI components synchronized with the new name
    await expect(fileTree.getByText(treeRenamedTitle)).toBeVisible({ timeout: 5000 });
    await expect(tab).toContainText(treeRenamedTitle);
    await expect(primaryPane.getByRole('heading', { name: treeRenamedTitle })).toBeVisible();
    await expect(primaryPane.getByText(treeRenamedFileName)).toBeVisible();

    // Verify POSIX disk files: new file exists, old file is gone
    const oldDiskFile = path.join(CONTENT_DIR, initialFileName);
    const newDiskFile = path.join(CONTENT_DIR, treeRenamedFileName);
    expect(fs.existsSync(newDiskFile)).toBeTruthy();
    expect(fs.existsSync(oldDiskFile)).toBeFalsy();

    // 3. Step 2B: Rename via Primary Editor Header Inline Edit
    const renameHeaderBtn = page.locator('[data-testid="editor-title-rename-btn"]');
    await renameHeaderBtn.click();

    const renameHeaderInput = page.locator('[data-testid="editor-title-rename-input"]');
    await expect(renameHeaderInput).toBeVisible();
    await renameHeaderInput.fill(headerRenamedTitle);
    await renameHeaderInput.press('Enter');

    // Verify all UI components synchronized
    await expect(primaryPane.getByRole('heading', { name: headerRenamedTitle })).toBeVisible({ timeout: 5000 });
    await expect(tab).toContainText(headerRenamedTitle);
    await expect(fileTree.getByText(headerRenamedTitle)).toBeVisible();
    await expect(primaryPane.getByText(headerRenamedFileName)).toBeVisible();

    // Verify POSIX disk files
    const finalDiskFile = path.join(CONTENT_DIR, headerRenamedFileName);
    expect(fs.existsSync(finalDiskFile)).toBeTruthy();
    expect(fs.existsSync(newDiskFile)).toBeFalsy();
  });

  test('Journey 3: Real-Time Multi-User Collaboration in the Real Workspace', async ({ browser }) => {
    const timestamp = Date.now();
    const fileName = `collab_journey_${timestamp}.md`;

    // 1. Context 1: Alice (test_admin)
    const contextA = await browser.newContext();
    await contextA.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);
    const pageA = await contextA.newPage();

    // 2. Context 2: Bob (ws_tester)
    const contextB = await browser.newContext();
    await contextB.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, testerToken);
    const pageB = await contextB.newPage();

    // 3. Alice creates document in workspace
    await pageA.goto('/');
    const newDocBtn = pageA.locator('[data-testid="filetree-new-doc-btn"]');
    await newDocBtn.click();
    await pageA.locator('[data-testid="filetree-modal-input"]').fill(fileName);
    await pageA.locator('[data-testid="filetree-modal-submit"]').click();
    await pageA.waitForURL(/\/documents\/.+/);

    const docUrl = pageA.url();
    const cmContentA = pageA.locator('.collaborative-editor-root .cm-content');
    await expect(cmContentA).toBeVisible();

    // 4. Bob opens the exact same workspace document
    await pageB.goto(docUrl);
    const cmContentB = pageB.locator('.collaborative-editor-root .cm-content');
    await expect(cmContentB).toBeVisible();

    // Clear initial template on Alice's side
    await cmContentA.click();
    await pageA.keyboard.press('ControlOrMeta+A');
    await pageA.keyboard.press('Backspace');

    // 5. Alice writes paragraph A
    const aliceText = 'Note written collaboratively by Alice in Context A.';
    await pageA.keyboard.insertText(aliceText + '\n\n');

    // Verify Bob receives Alice's text in real-time
    await expect(cmContentB).toContainText(aliceText, { timeout: 10000 });

    // 6. Bob appends paragraph B
    const bobText = 'Response appended in real-time by Bob in Context B.';
    await cmContentB.click();
    // Move cursor to end
    await pageB.keyboard.press('ControlOrMeta+End');
    await pageB.keyboard.insertText(bobText + '\n\n');

    // Verify Alice receives Bob's text in real-time
    await expect(cmContentA).toContainText(bobText, { timeout: 10000 });

    // 7. Reload Alice's page and verify zero-loss and zero-duplication
    await pageA.reload();
    await expect(cmContentA).toBeVisible();
    await expect(cmContentA).toContainText(aliceText);
    await expect(cmContentA).toContainText(bobText);

    const reloadedText = await cmContentA.textContent();
    const aliceCount = (reloadedText?.match(/by Alice in Context A/g) || []).length;
    const bobCount = (reloadedText?.match(/by Bob in Context B/g) || []).length;
    expect(aliceCount).toBe(1);
    expect(bobCount).toBe(1);

    await contextA.close();
    await contextB.close();
  });

  test('Journey 4: Tab Management, Table of Contents Outline & Split-Pane Workspace', async ({ page }) => {
    const timestamp = Date.now();
    const docAName = `tab_a_${timestamp}.md`;
    const docBName = `tab_b_${timestamp}.md`;

    await page.goto('/');

    // 1. Create Doc A
    await page.locator('[data-testid="filetree-new-doc-btn"]').click();
    await page.locator('[data-testid="filetree-modal-input"]').fill(docAName);
    await page.locator('[data-testid="filetree-modal-submit"]').click();
    await page.waitForURL(/\/documents\/.+/);
    const docAId = page.url().split('/documents/')[1].split('?')[0];

    // 2. Create Doc B
    await page.locator('[data-testid="filetree-new-doc-btn"]').click();
    await page.locator('[data-testid="filetree-modal-input"]').fill(docBName);
    await page.locator('[data-testid="filetree-modal-submit"]').click();
    await page.waitForURL((url) => url.pathname.includes('/documents/') && !url.pathname.includes(docAId));
    const docBId = page.url().split('/documents/')[1].split('?')[0];

    // Verify both tabs exist in TabBar
    const tabA = page.locator(`[data-testid="workspace-tab-${docAId}"]`);
    const tabB = page.locator(`[data-testid="workspace-tab-${docBId}"]`);
    await expect(tabA).toBeVisible();
    await expect(tabB).toBeVisible();

    // 3. Switch between tabs
    await tabA.click();
    await expect(page).toHaveURL(new RegExp(`/documents/${docAId}`));
    await expect(page.locator('[data-testid="primary-editor-pane"]')).toContainText(`tab_a_${timestamp}`);

    await tabB.click();
    await expect(page).toHaveURL(new RegExp(`/documents/${docBId}`));
    await expect(page.locator('[data-testid="primary-editor-pane"]')).toContainText(`tab_b_${timestamp}`);

    // 4. Split-Pane Workspace: Vertical split
    const splitBtn = page.locator('[data-testid="split-vertical-btn"]');
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();

    // Verify dual-pane split container appears
    const splitContainer = page.locator('[data-testid="split-view-container"]');
    await expect(splitContainer).toBeVisible();

    const primaryPane = page.locator('[data-testid="primary-editor-pane"]');
    const secondaryPane = page.locator('[data-testid="secondary-editor-pane"]');
    await expect(primaryPane).toBeVisible();
    await expect(secondaryPane).toBeVisible();

    // 5. Toggle Document Outline Table of Contents
    const outlineToggle = primaryPane.locator('[data-testid="editor-outline-toggle"]');
    await expect(outlineToggle).toBeVisible();
    await outlineToggle.click();

    const outlineSidebar = primaryPane.locator('[data-testid="editor-outline-sidebar"]');
    await expect(outlineSidebar).toBeVisible();
    await expect(outlineSidebar.getByText('Table of Contents').first()).toBeVisible();

    // Close outline
    await outlineToggle.click();
    await expect(outlineSidebar).not.toBeVisible();
  });
});
