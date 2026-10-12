import { test, expect } from '@playwright/test';
import { BACKEND_URL } from './test_config';

test.describe('Multi-Document TabBar & Split-View Workspace (Step 5.2)', () => {
  let adminToken = '';
  let docAId = '';
  let docBId = '';
  let docATitle = '';
  let docBTitle = '';

  test.beforeAll(async ({ request }) => {
    const timestamp = Date.now();
    docATitle = `Doc Alpha ${timestamp}`;
    docBTitle = `Doc Beta ${timestamp}`;

    // 1. Authenticate test_admin
    const adminRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
      data: { username: 'test_admin', password: 'password123' },
    });
    expect(adminRes.ok()).toBeTruthy();
    const adminJson = await adminRes.json();
    adminToken = adminJson.token;

    // 2. Pre-seed Document A
    const resA = await request.post(`${BACKEND_URL}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: `workspace/doc_a_${timestamp}.md`,
        title: docATitle,
        content: `# ${docATitle}\n\nPrimary specification content for pane A.`,
      },
    });
    expect(resA.ok()).toBeTruthy();
    const jsonA = await resA.json();
    docAId = jsonA.id;

    // 3. Pre-seed Document B
    const resB = await request.post(`${BACKEND_URL}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: `workspace/doc_b_${timestamp}.md`,
        title: docBTitle,
        content: `# ${docBTitle}\n\nSecondary reference content for pane B.`,
      },
    });
    expect(resB.ok()).toBeTruthy();
    const jsonB = await resB.json();
    docBId = jsonB.id;
  });

  test.beforeEach(async ({ context, page }) => {
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));
    page.on('console', (msg) => console.log('CONSOLE:', msg.text()));

    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);
  });

  test('manages multiple open tabs and switches active document on click', async ({ page }) => {
    // 1. Open Document A
    await page.goto(`/documents/${docAId}`);
    const tabbar = page.locator('[data-testid="workspace-tabbar"]');
    await expect(tabbar).toBeVisible();

    // Verify Tab A is rendered and active
    const tabA = page.locator(`[data-testid="workspace-tab-${docAId}"]`);
    await expect(tabA).toBeVisible();
    await expect(tabA).toContainText(docATitle);

    // 2. Open Document B
    await page.goto(`/documents/${docBId}`);
    const tabB = page.locator(`[data-testid="workspace-tab-${docBId}"]`);
    await expect(tabB).toBeVisible();
    await expect(tabB).toContainText(docBTitle);

    // Verify both tabs are in the TabBar
    await expect(tabA).toBeVisible();
    await expect(tabB).toBeVisible();

    // 3. Click Tab A to switch back
    await tabA.click();
    await expect(page).toHaveURL(`/documents/${docAId}`);
    await expect(page.locator(`[data-testid="primary-editor-pane"] h1`)).toHaveText(docATitle);
  });

  test('opens dual-pane Split View, edits concurrently, and restores state on reload', async ({ page }) => {
    // 1. Load Document A and Document B into tabs
    await page.goto(`/documents/${docAId}`);
    await expect(page.locator(`[data-testid="workspace-tab-${docAId}"]`)).toBeVisible();
    await page.goto(`/documents/${docBId}`);
    await expect(page.locator(`[data-testid="workspace-tab-${docBId}"]`)).toBeVisible();

    // 2. Click Split Right (Vertical Split) button in TabBar
    const splitVerticalBtn = page.locator('[data-testid="split-vertical-btn"]');
    await expect(splitVerticalBtn).toBeVisible();
    await splitVerticalBtn.click();

    // 3. Verify dual-pane split container appears
    const splitContainer = page.locator('[data-testid="split-view-container"]');
    await expect(splitContainer).toBeVisible();

    const primaryPane = page.locator('[data-testid="primary-editor-pane"]');
    const secondaryPane = page.locator('[data-testid="secondary-editor-pane"]');

    await expect(primaryPane).toBeVisible();
    await expect(secondaryPane).toBeVisible();

    // Verify primary and secondary panes render their respective documents
    await expect(primaryPane.locator('h1')).toHaveText(docBTitle);
    await expect(secondaryPane.locator('h1')).toHaveText(docATitle);

    // Verify both collaborative editors are mounted side-by-side
    const primaryEditor = primaryPane.locator('.ProseMirror');
    const secondaryEditor = secondaryPane.locator('.ProseMirror');
    await expect(primaryEditor).toBeVisible();
    await expect(secondaryEditor).toBeVisible();

    // Verify splitter handle is present
    await expect(page.locator('[data-testid="vertical-splitter"]')).toBeVisible();

    // 4. Test state persistence across page refresh
    await page.reload();

    // Verify split layout is restored from localStorage
    await expect(splitContainer).toBeVisible();
    await expect(primaryPane).toBeVisible();
    await expect(secondaryPane).toBeVisible();
    await expect(primaryPane.locator('h1')).toHaveText(docBTitle);
    await expect(secondaryPane.locator('h1')).toHaveText(docATitle);
  });

  test('toggles horizontal split mode and closes split pane', async ({ page }) => {
    // 1. Load Document A and Document B into tabs
    await page.goto(`/documents/${docAId}`);
    await expect(page.locator(`[data-testid="workspace-tab-${docAId}"]`)).toBeVisible();
    await page.goto(`/documents/${docBId}`);
    await expect(page.locator(`[data-testid="workspace-tab-${docBId}"]`)).toBeVisible();

    // 2. Toggle Horizontal Split (top-and-bottom)
    const splitHorizontalBtn = page.locator('[data-testid="split-horizontal-btn"]');
    await splitHorizontalBtn.click();

    await expect(page.locator('[data-testid="split-view-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="horizontal-splitter"]')).toBeVisible();

    // 3. Close the split view using close-split-btn
    const closeSplitBtn = page.locator('[data-testid="close-split-btn"]');
    await expect(closeSplitBtn).toBeVisible();
    await closeSplitBtn.click();

    // 4. Verify split view unmounts and single pane view is restored
    await expect(page.locator('[data-testid="split-view-container"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="primary-editor-pane"]')).toBeVisible();
  });

  test('closes tab and switches to neighbor tab or workspace', async ({ page }) => {
    // 1. Load Document A and Document B
    await page.goto(`/documents/${docAId}`);
    await expect(page.locator(`[data-testid="workspace-tab-${docAId}"]`)).toBeVisible();
    await page.goto(`/documents/${docBId}`);
    await expect(page.locator(`[data-testid="workspace-tab-${docBId}"]`)).toBeVisible();

    // 2. Click close button on Tab B
    const closeTabBBtn = page.locator(`[data-testid="close-tab-${docBId}"]`);
    await closeTabBBtn.click();

    // 3. Verify Tab B is removed and page navigates back to Tab A
    await expect(page.locator(`[data-testid="workspace-tab-${docBId}"]`)).not.toBeVisible();
    await expect(page.locator(`[data-testid="workspace-tab-${docAId}"]`)).toBeVisible();
    await expect(page).toHaveURL(`/documents/${docAId}`);
  });
});
