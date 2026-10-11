import { test, expect } from '@playwright/test';

test.describe('Table of Contents & Documentation Reader View (Step 5.3)', () => {
  let adminToken = '';
  let docId = '';
  const timestamp = Date.now();
  const docPath = `guides/intro_${timestamp}.md`;
  const docTitle = `CME Documentation Guide ${timestamp}`;

  const docMarkdown = `# ${docTitle}

Welcome to the comprehensive CME reader documentation guide.

## Getting Started

Step-by-step instructions for getting started with the collaborative markdown editor.

$$
E = mc^2
$$

## Architecture Overview

In-depth architectural analysis of the system components.

\`\`\`mermaid
graph TD
  Client --> Server
\`\`\`

### POSIX Storage Layer

Detailed discussion on disk operations and atomic file synchronization.

## Advanced Configuration

Fine-tuning PostgreSQL and collaborative WebSocket parameters.
`;

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate test_admin
    const adminRes = await request.post('http://127.0.0.1:8080/api/v1/auth/login', {
      data: { username: 'test_admin', password: 'password123' },
    });
    expect(adminRes.ok()).toBeTruthy();
    const adminJson = await adminRes.json();
    adminToken = adminJson.token;

    // 2. Pre-seed guide document at guides/intro_<ts>.md
    const docRes = await request.post('http://127.0.0.1:8080/api/v1/documents', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: docPath,
        title: docTitle,
        content: docMarkdown,
      },
    });
    expect(docRes.ok()).toBeTruthy();
    const docJson = await docRes.json();
    docId = docJson.id;
  });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);
  });

  test('navigates to DocReader route by path, renders distraction-free layout with no editor tools', async ({
    page,
  }) => {
    // 1. Navigate to /docs/{path...}
    await page.goto(`/docs/${docPath}`);

    // Verify article loads with heading and content
    const article = page.locator('[data-testid="reader-article"]');
    await expect(article).toBeVisible();
    await expect(article.locator('h1')).toHaveText(docTitle);

    // 2. Verify editing tools and ProseMirror editor are hidden in reader mode
    await expect(page.locator('[data-testid="editor-toolbar"]')).not.toBeVisible();
    await expect(page.locator('.ProseMirror')).not.toBeVisible();

    // 3. Verify Table of Contents renders on the right
    const toc = page.locator('[data-testid="table-of-contents"]');
    await expect(toc).toBeVisible();

    // Verify expected heading entries exist in TOC
    await expect(page.locator('[data-testid="toc-item-getting-started"]')).toBeVisible();
    await expect(page.locator('[data-testid="toc-item-architecture-overview"]')).toBeVisible();
    await expect(page.locator('[data-testid="toc-item-posix-storage-layer"]')).toBeVisible();
    await expect(page.locator('[data-testid="toc-item-advanced-configuration"]')).toBeVisible();
  });

  test('clicks an H2 entry in right-hand TOC and updates active heading status', async ({
    page,
  }) => {
    await page.goto(`/docs/${docPath}`);

    // 1. Verify TOC item for Architecture Overview is present
    const h2TocItem = page.locator('[data-testid="toc-item-architecture-overview"]');
    await expect(h2TocItem).toBeVisible();

    // 2. Click the H2 TOC entry
    await h2TocItem.click();

    // 3. Verify H2 target heading exists in article with matching id
    const targetHeading = page.locator('#architecture-overview');
    await expect(targetHeading).toBeVisible();
    await expect(targetHeading).toHaveText('Architecture Overview');

    // 4. Verify TOC item receives active status
    await expect(h2TocItem).toHaveAttribute('data-active', 'true');
  });

  test('toggles Review Overlay cleanly showing discussions and annotations', async ({ page }) => {
    await page.goto(`/docs/${docPath}`);

    // 1. Review Overlay is initially hidden
    const overlayToggle = page.locator('[data-testid="review-overlay-toggle"]');
    await expect(overlayToggle).toBeVisible();
    await expect(overlayToggle).toContainText('Reviews: OFF');
    await expect(page.locator('[data-testid="review-overlay-panel"]')).not.toBeVisible();

    // 2. Click toggle button to enable Reviews
    await overlayToggle.click();
    await expect(overlayToggle).toContainText('Reviews: ON');

    // 3. Verify Review Overlay panel appears with sections
    const reviewPanel = page.locator('[data-testid="review-overlay-panel"]');
    await expect(reviewPanel).toBeVisible();
    await expect(reviewPanel).toContainText('Review & Feedback Overlay');

    // 4. Click toggle button to hide Reviews
    await overlayToggle.click();
    await expect(overlayToggle).toContainText('Reviews: OFF');
    await expect(reviewPanel).not.toBeVisible();
  });

  test('navigates by UUID and seamlessly switches between Reader view and Collaborative Editor', async ({
    page,
  }) => {
    // 1. Navigate via /docs/:id
    await page.goto(`/docs/${docId}`);
    await expect(page.locator('[data-testid="reader-article"]')).toBeVisible();

    // 2. Click Edit button
    const editBtn = page.locator('[data-testid="switch-to-editor-btn"]');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // 3. Verify URL navigates to /documents/:id
    await expect(page).toHaveURL(`/documents/${docId}`);

    // 4. Verify full editor mounts with ProseMirror
    await expect(page.locator('.ProseMirror')).toBeVisible();

    // 5. Verify Outline toggle inside editor pane
    const outlineToggle = page.locator('[data-testid="editor-outline-toggle"]');
    await expect(outlineToggle).toBeVisible();
    await outlineToggle.click();

    // Verify TOC outline opens inside editor
    await expect(page.locator('[data-testid="table-of-contents"]')).toBeVisible();
    await expect(page.locator('[data-testid="toc-item-getting-started"]')).toBeVisible();
  });
});
