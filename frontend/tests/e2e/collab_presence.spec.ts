import { test, expect } from '@playwright/test';
import { BACKEND_URL } from './test_config';

test.describe('Real-Time Sync & Cursor Presence Integration (Step 4.3)', () => {
  let adminToken = '';
  let testerToken = '';
  let testDocId = '';

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

    // 3. Create a fresh test document for collaboration
    const docPath = `collab_e2e_${Date.now()}.md`;
    const docRes = await request.post(`${BACKEND_URL}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: docPath,
        title: 'Step 4.3 Collaboration Test',
        content: '# Collaborative Session\n\nWelcome to live editing.',
      },
    });
    expect(docRes.ok()).toBeTruthy();
    const docJson = await docRes.json();
    testDocId = docJson.id;
  });

  test('synchronizes real-time keystrokes between Alice and Bob', async ({ page, context }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);

    await page.goto(`/test-collab?docId=${testDocId}`);

    // Wait for both Alice and Bob to show connected
    await expect(page.locator('[data-testid="alice-pane"]').getByText('connected')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="bob-pane"]').getByText('connected')).toBeVisible({ timeout: 15000 });

    const aliceEditor = page.locator('[data-testid="alice-editor"] .ProseMirror');
    const bobEditor = page.locator('[data-testid="bob-editor"] .ProseMirror');

    // Alice types into her editor
    await aliceEditor.click();
    await aliceEditor.pressSequentially('Hello from Alice live editing! ', { delay: 10 });

    // Verify Bob receives the update in real-time
    await expect(bobEditor).toContainText('Hello from Alice live editing!', { timeout: 5000 });
  });

  test('renders remote cursor presence and collaborator labels', async ({ page, context }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);

    await page.goto(`/test-collab?docId=${testDocId}`);

    await expect(page.locator('[data-testid="alice-pane"]').getByText('connected')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="bob-pane"]').getByText('connected')).toBeVisible({ timeout: 15000 });

    const aliceEditor = page.locator('[data-testid="alice-editor"] .ProseMirror');
    const bobEditor = page.locator('[data-testid="bob-editor"] .ProseMirror');

    // Alice types to establish active cursor & selection
    await aliceEditor.click();
    await aliceEditor.pressSequentially('Alice presence active. ', { delay: 10 });

    // Verify Bob's editor renders Alice's cursor caret and label
    const aliceCursorOnBob = page.locator('[data-testid="bob-editor"] .collaboration-cursor__caret');
    await expect(aliceCursorOnBob.first()).toBeVisible({ timeout: 10000 });

    const aliceLabelOnBob = page.locator('[data-testid="bob-editor"] .collaboration-cursor__label');
    await expect(aliceLabelOnBob.first()).toBeVisible();
    await expect(aliceLabelOnBob.first()).toContainText('Alice');

    // Bob types to establish his active cursor & selection
    await bobEditor.click();
    await bobEditor.pressSequentially('Bob presence active. ', { delay: 10 });

    // Verify Alice's editor renders Bob's cursor caret and label
    const bobCursorOnAlice = page.locator('[data-testid="alice-editor"] .collaboration-cursor__caret');
    await expect(bobCursorOnAlice.first()).toBeVisible({ timeout: 10000 });

    const bobLabelOnAlice = page.locator('[data-testid="alice-editor"] .collaboration-cursor__label');
    await expect(bobLabelOnAlice.first()).toBeVisible();
    await expect(bobLabelOnAlice.first()).toContainText('Bob');
  });

  test('handles network partition, offline edits, and conflict-free CRDT reconnection merge', async ({ page, context }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);

    await page.goto(`/test-collab?docId=${testDocId}`);

    await expect(page.locator('[data-testid="alice-pane"]').getByText('connected')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="bob-pane"]').getByText('connected')).toBeVisible({ timeout: 15000 });

    const aliceToggle = page.locator('[data-testid="alice-toggle-net"]');
    const aliceEditor = page.locator('[data-testid="alice-editor"] .ProseMirror');
    const bobEditor = page.locator('[data-testid="bob-editor"] .ProseMirror');

    // 1. Disconnect Alice from the network
    await aliceToggle.click();
    await expect(page.locator('[data-testid="alice-pane"]').getByText('disconnected')).toBeVisible();

    // 2. Alice types while offline
    await aliceEditor.click();
    await aliceEditor.pressSequentially('[ALICE_OFFLINE_CHANGE] ', { delay: 10 });

    // 3. Bob types concurrently while online
    await bobEditor.click();
    await bobEditor.pressSequentially('[BOB_CONCURRENT_CHANGE] ', { delay: 10 });

    // Verify Bob has NOT received Alice's offline edit yet
    const bobTextWhileAliceOffline = await bobEditor.textContent();
    expect(bobTextWhileAliceOffline).not.toContain('[ALICE_OFFLINE_CHANGE]');

    // 4. Reconnect Alice to the network
    await aliceToggle.click();
    await expect(page.locator('[data-testid="alice-pane"]').getByText('connected')).toBeVisible({ timeout: 10000 });

    // 5. Verify both editors converge conflict-free with both edits
    await expect(aliceEditor).toContainText('[ALICE_OFFLINE_CHANGE]', { timeout: 10000 });
    await expect(aliceEditor).toContainText('[BOB_CONCURRENT_CHANGE]', { timeout: 10000 });

    await expect(bobEditor).toContainText('[ALICE_OFFLINE_CHANGE]', { timeout: 10000 });
    await expect(bobEditor).toContainText('[BOB_CONCURRENT_CHANGE]', { timeout: 10000 });
  });

  test('synchronizes across two independent browser windows on /documents/:id', async ({ browser }) => {
    // Context A (Admin / Alice)
    const contextA = await browser.newContext();
    await contextA.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);
    const pageA = await contextA.newPage();

    // Context B (Tester / Bob)
    const contextB = await browser.newContext();
    await contextB.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, testerToken);
    const pageB = await contextB.newPage();

    try {
      // Both navigate to the document
      await pageA.goto(`/documents/${testDocId}`);
      await pageB.goto(`/documents/${testDocId}`);

      // Verify both load editor and reach Live status
      const editorA = pageA.locator('.collaborative-editor-root .ProseMirror');
      const editorB = pageB.locator('.collaborative-editor-root .ProseMirror');

      await expect(editorA).toBeVisible({ timeout: 15000 });
      await expect(editorB).toBeVisible({ timeout: 15000 });

      // Window A types
      await editorA.click();
      await editorA.pressSequentially('Window A edit: Dual-Window Sync Success! ', { delay: 10 });

      // Window B receives update
      await expect(editorB).toContainText('Window A edit: Dual-Window Sync Success!', { timeout: 10000 });

      // Verify remote cursor presence in Window B
      const cursorOnB = pageB.locator('.ProseMirror .collaboration-cursor__caret');
      await expect(cursorOnB.first()).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
