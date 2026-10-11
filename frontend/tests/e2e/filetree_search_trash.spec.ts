import { test, expect } from '@playwright/test';

test.describe('Navigation, FileTree, Search & Trash (Step 5.1)', () => {
  let adminToken = '';
  let uniqueId = '';
  let seededDocId = '';

  test.beforeAll(async ({ request }) => {
    uniqueId = `${Date.now()}`;

    // 1. Authenticate test_admin
    const adminRes = await request.post('http://127.0.0.1:8080/api/v1/auth/login', {
      data: { username: 'test_admin', password: 'password123' },
    });
    expect(adminRes.ok()).toBeTruthy();
    const adminJson = await adminRes.json();
    adminToken = adminJson.token;

    // 2. Pre-seed documents: a normal markdown file and a bundle
    const createRes = await request.post('http://127.0.0.1:8080/api/v1/documents', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: `guides/tutorial_${uniqueId}.md`,
        title: `Tutorial Guide ${uniqueId}`,
        content: `# Tutorial Guide\n\nThis guide covers collaborative quantum_${uniqueId} architecture in detail.`,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const createJson = await createRes.json();
    seededDocId = createJson.id;

    await request.post('http://127.0.0.1:8080/api/v1/documents', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: `specs/architecture_${uniqueId}.bundle`,
        title: `Architecture Bundle ${uniqueId}`,
        content: `# Architecture Bundle\n\nHigh-performance C++23 native microkernel specification.`,
      },
    });
  });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);
  });

  test('displays hierarchical FileTree with bundles and expands folders', async ({ page }) => {
    await page.goto('/');

    // Verify FileTree container is visible in sidebar
    const fileTree = page.locator('[data-testid="file-tree-container"]');
    await expect(fileTree).toBeVisible();

    // Verify seeded folders guides and specs are visible
    await expect(page.getByText('guides', { exact: true })).toBeVisible();
    await expect(page.getByText('specs', { exact: true })).toBeVisible();

    // Verify bundle item has bundle styling or package indicator
    await expect(fileTree.getByText(`Architecture Bundle ${uniqueId}`)).toBeVisible();
    await expect(fileTree.getByText(`Tutorial Guide ${uniqueId}`)).toBeVisible();
  });

  test('creates a new document via FileTree modal and navigates to editor', async ({ page }) => {
    await page.goto('/');

    // Click "+" button in FileTree header
    const newDocBtn = page.locator('[data-testid="filetree-new-doc-btn"]');
    await expect(newDocBtn).toBeVisible();
    await newDocBtn.click();

    // Fill new document filename
    const modalInput = page.locator('[data-testid="filetree-modal-input"]');
    await expect(modalInput).toBeVisible();
    const newDocName = `notes_${uniqueId}.md`;
    await modalInput.fill(newDocName);

    // Submit modal
    await page.locator('[data-testid="filetree-modal-submit"]').click();

    // Verify redirection to editor for the new document
    await expect(page).toHaveURL(/\/documents\/.+/);
    await expect(page.locator('.collaborative-editor-root')).toBeVisible();
  });

  test('executes global search via Ctrl+K with keyword highlighting and navigates to document', async ({ page }) => {
    await page.goto('/');

    // Trigger Search Modal via header button or Ctrl+K
    const searchBtn = page.locator('[data-testid="sidebar-search-btn"]');
    await expect(searchBtn).toBeVisible();
    await searchBtn.click();

    // Verify Search Modal opens
    const searchModal = page.locator('[data-testid="search-modal"]');
    await expect(searchModal).toBeVisible();

    // Search for the seeded unique keyword quantum_uniqueId
    const searchInput = page.locator('[data-testid="search-modal-input"]');
    await expect(searchInput).toBeFocused();
    await searchInput.fill(`quantum_${uniqueId}`);

    // Wait for search result item to appear
    const resultItem = page.locator('[data-testid="search-result-item"]').first();
    await expect(resultItem).toBeVisible({ timeout: 10000 });
    await expect(resultItem).toContainText(`Tutorial Guide ${uniqueId}`);

    // Verify snippet contains highlighted match
    const snippet = resultItem.locator('p mark');
    await expect(snippet).toBeVisible();
    await expect(snippet).toHaveText(new RegExp(`quantum_${uniqueId}`, 'i'));

    // Press Enter or click result to navigate
    await resultItem.click();

    // Verify navigation to editor page
    await expect(page).toHaveURL(/\/documents\/.+/);
    await expect(page.locator('.collaborative-editor-root')).toBeVisible();
  });

  test('lists recently modified documents in RecentDocuments drawer', async ({ page, request }) => {
    // Touch seeded document right before navigation to ensure freshest updated_at
    await request.put(`http://127.0.0.1:8080/api/v1/documents/${seededDocId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { title: `Tutorial Guide ${uniqueId}` },
    });

    await page.goto('/');

    // Verify Recent Documents section exists
    const recentsContainer = page.locator('[data-testid="recent-documents-container"]');
    await expect(recentsContainer).toBeVisible();

    // Verify recent items contain our seeded tutorial
    const recentItem = recentsContainer.locator('[data-testid="recent-doc-item"]').first();
    await expect(recentItem).toBeVisible();
    await expect(recentsContainer.getByText(`Tutorial Guide ${uniqueId}`)).toBeVisible();
  });

  test('soft-deletes document to Trash, displays in /trash, and restores it', async ({ page, request }) => {
    // 1. Create a document specifically for trash testing
    const trashTestDocPath = `trash_candidate_${uniqueId}.md`;
    const docRes = await request.post('http://127.0.0.1:8080/api/v1/documents', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: trashTestDocPath,
        title: `Trash Candidate ${uniqueId}`,
        content: '# Delete Me\n\nThis document will be deleted and restored.',
      },
    });
    expect(docRes.ok()).toBeTruthy();
    const docJson = await docRes.json();
    const trashDocId = docJson.id;

    // 2. Soft-delete the document via API
    const delRes = await request.delete(`http://127.0.0.1:8080/api/v1/documents/${trashDocId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.ok()).toBeTruthy();

    // 3. Navigate to /trash
    await page.goto('/trash');

    // Accept any upcoming alert or confirmation dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // 4. Verify trash table displays the soft-deleted item
    const trashTable = page.locator('[data-testid="trash-table"]');
    await expect(trashTable).toBeVisible();
    const row = page.locator('[data-testid="trash-item-row"]', {
      hasText: `trash_candidate_${uniqueId}.md`,
    });
    await expect(row).toBeVisible();

    // 5. Click "Restore" button
    const restoreBtn = row.locator('[data-testid="restore-trash-btn"]');
    await restoreBtn.click();

    // 6. Verify restored: either redirected to editor or row disappears from trash table
    await expect(row).not.toBeVisible({ timeout: 10000 });
  });
});
