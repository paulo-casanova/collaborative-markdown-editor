import { test, expect } from '@playwright/test';
import { BACKEND_URL } from './test_config';

test.describe('Phase 6, Step 6.2: Threaded Comments & Inline Suggestions UI', () => {
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

    // 3. Create a fresh test document for review discussions
    const docPath = `review_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.md`;
    const docRes = await request.post(`${BACKEND_URL}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: docPath,
        title: 'Step 6.2 Review System Test',
        content: '# Technical Review\n\nLive editing session.',
      },
    });
    expect(docRes.ok()).toBeTruthy();
    const docJson = await docRes.json();
    testDocId = docJson.id;
  });

  test('Status criteria: proposes edit in Session 1, accepts in Session 2, verifies converged text and ACCEPTED status in both sessions', async ({
    browser,
  }) => {
    // Session 1: User 1 (Admin / Alice)
    const context1 = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: 'http://127.0.0.1:4173',
            localStorage: [{ name: 'cme_auth_token', value: adminToken }],
          },
        ],
      },
    });
    const page1 = await context1.newPage();

    // Session 2: User 2 (Tester / Bob)
    const context2 = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: 'http://127.0.0.1:4173',
            localStorage: [{ name: 'cme_auth_token', value: testerToken }],
          },
        ],
      },
    });
    const page2 = await context2.newPage();

    try {
      page1.on('console', (msg) => console.log('PAGE1 LOG:', msg.text()));
      page1.on('pageerror', (err) => console.log('PAGE1 ERR:', err));
      page1.on('response', (res) => {
        if (!res.ok()) console.log('HTTP FAIL:', res.status(), res.url());
      });
      page2.on('console', (msg) => console.log('PAGE2 LOG:', msg.text()));
      page2.on('pageerror', (err) => console.log('PAGE2 ERR:', err));
      page2.on('response', (res) => {
        if (!res.ok()) console.log('PAGE2 HTTP FAIL:', res.status(), res.url());
      });

      // 1. Both sessions open the document
      await page1.goto(`/documents/${testDocId}`);
      await page2.goto(`/documents/${testDocId}`);

      const editor1 = page1.locator('.collaborative-editor-root .ProseMirror');
      const editor2 = page2.locator('.collaborative-editor-root .ProseMirror');

      await expect(editor1).toBeVisible({ timeout: 15000 });
      await expect(editor2).toBeVisible({ timeout: 15000 });

      // Wait for both sessions to connect to the live collaborative room
      console.log('TEST STEP: waiting for Collab Live');
      await expect(page1.getByText('Collab Live')).toBeVisible({ timeout: 15000 });
      await expect(page2.getByText('Collab Live')).toBeVisible({ timeout: 15000 });
      console.log('TEST STEP: Collab Live ready on both pages');

      // Session 1 types the text to ensure collaborative synchronization
      console.log('TEST STEP: Session 1 clicking editor1');
      await editor1.click({ force: true });
      console.log('TEST STEP: Session 1 typing text');
      await editor1.pressSequentially(
        'We implement real-time reviews using Conflict-free Replicated Data Types rather than operational transformation.\n',
        { delay: 10 }
      );
      console.log('TEST STEP: Session 1 finished typing');

      // Verify Session 2 receives text via real-time WebSocket collab sync
      console.log('TEST STEP: waiting for editor2 to receive text');
      await expect(editor2).toContainText('Conflict-free Replicated Data Types', { timeout: 10000 });
      console.log('TEST STEP: editor2 received synced text');

      // 2. Open ReviewSidebar in both sessions
      const toggleReviews1 = page1.locator('[data-testid="toggle-reviews-btn"]').first();
      await toggleReviews1.click();
      await expect(page1.locator('[data-testid="review-sidebar"]')).toBeVisible({ timeout: 5000 });

      const toggleReviews2 = page2.locator('[data-testid="toggle-reviews-btn"]').first();
      await toggleReviews2.click();
      await expect(page2.locator('[data-testid="review-sidebar"]')).toBeVisible({ timeout: 5000 });
      console.log('TEST STEP: review sidebar opened on both pages');

      // 3. In Session 1: Highlight target sentence and trigger "Suggest Edit"
      const targetPhrase = 'Conflict-free Replicated Data Types';
      await page1.evaluate((phrase) => {
        const editorEl = document.querySelector('.collaborative-editor-root .ProseMirror');
        const editor = (editorEl as any)?.__tiptapEditor;
        if (editor) {
          editor.state.doc.descendants((node: any, pos: number) => {
            if (node.isText && node.text && node.text.includes(phrase)) {
              const start = pos + node.text.indexOf(phrase);
              editor.commands.setTextSelection({ from: start, to: start + phrase.length });
              return false;
            }
          });
        }
      }, targetPhrase);
      console.log('TEST STEP: selected text in editor1');

      // Click "Suggest Edit"
      const suggestBtn = page1
        .locator('[data-testid="suggest-edit-btn"], [data-testid="toolbar-suggest-edit-btn"]')
        .first();
      await expect(suggestBtn).toBeVisible({ timeout: 5000 });
      await suggestBtn.click();
      console.log('TEST STEP: clicked suggest edit button');

      // 4. Modal opens: enter proposed replacement and submit
      const modal = page1.locator('[data-testid="suggestion-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      const replacementInput = page1.locator('[data-testid="suggestion-replacement-input"]');
      await replacementInput.fill('High-Performance CRDT Engine');

      const submitSuggBtn = page1.locator('[data-testid="submit-suggestion-btn"]');
      await submitSuggBtn.click();
      await expect(modal).not.toBeVisible({ timeout: 5000 });
      console.log('TEST STEP: suggestion submitted');

      // 5. In Session 1: Verify suggestion card displays PENDING and diff
      const suggCard1 = page1.locator('[data-testid="suggestion-card"]').first();
      await expect(suggCard1).toBeVisible({ timeout: 10000 });
      await expect(suggCard1.locator('[data-testid="suggestion-status-badge"]')).toContainText('PENDING');
      await expect(suggCard1.locator('[data-testid="diff-original"]')).toContainText(targetPhrase);
      await expect(suggCard1.locator('[data-testid="diff-suggested"]')).toContainText('High-Performance CRDT Engine');
      console.log('TEST STEP: suggestion card verified in session 1');

      // 6. In Session 2: Verify suggestion card appears with PENDING status
      const suggCard2 = page2.locator('[data-testid="suggestion-card"]').first();
      await expect(suggCard2).toBeVisible({ timeout: 10000 });
      await expect(suggCard2.locator('[data-testid="suggestion-status-badge"]')).toContainText('PENDING');
      console.log('TEST STEP: suggestion card verified in session 2');

      // 7. Session 2 accepts the suggestion!
      const acceptBtn2 = suggCard2.locator('[data-testid="accept-suggestion-btn"]');
      await expect(acceptBtn2).toBeVisible({ timeout: 5000 });
      await acceptBtn2.click();
      console.log('TEST STEP: session 2 clicked accept');

      // 8. Verify Session 2 updates: card shows ACCEPTED, text updates with replacement
      await expect(suggCard2.locator('[data-testid="suggestion-status-badge"]')).toContainText('ACCEPTED', {
        timeout: 10000,
      });
      await expect(editor2).toContainText('High-Performance CRDT Engine', { timeout: 10000 });
      await expect(editor2).not.toContainText('Conflict-free Replicated Data Types');

      // 9. Verify Session 1 updates in real time: card shows ACCEPTED, text updates with replacement
      await expect(suggCard1.locator('[data-testid="suggestion-status-badge"]')).toContainText('ACCEPTED', {
        timeout: 10000,
      });
      await expect(editor1).toContainText('High-Performance CRDT Engine', { timeout: 10000 });
      await expect(editor1).not.toContainText('Conflict-free Replicated Data Types');
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('creates threaded comments, posts replies with @mention, and resolves discussion', async ({
    browser,
  }) => {
    const context1 = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: 'http://127.0.0.1:4173',
            localStorage: [{ name: 'cme_auth_token', value: adminToken }],
          },
        ],
      },
    });
    const page1 = await context1.newPage();

    const context2 = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: 'http://127.0.0.1:4173',
            localStorage: [{ name: 'cme_auth_token', value: testerToken }],
          },
        ],
      },
    });
    const page2 = await context2.newPage();

    try {
      await page1.goto(`/documents/${testDocId}`);
      await page2.goto(`/documents/${testDocId}`);

      const editor1 = page1.locator('.collaborative-editor-root .ProseMirror');
      await expect(editor1).toBeVisible({ timeout: 15000 });

      // Wait for both sessions to connect to the live collaborative room
      await expect(page1.getByText('Collab Live')).toBeVisible({ timeout: 15000 });
      await expect(page2.getByText('Collab Live')).toBeVisible({ timeout: 15000 });

      // Session 1 types a section
      await editor1.click();
      await editor1.pressSequentially('Section 2 covers performance and resilience.\n', { delay: 10 });

      // Open reviews in both
      await page1.locator('[data-testid="toggle-reviews-btn"]').first().click();
      await page2.locator('[data-testid="toggle-reviews-btn"]').first().click();

      // Session 1 selects "Section 2" and adds a comment
      await page1.evaluate((phrase) => {
        const editorEl = document.querySelector('.collaborative-editor-root .ProseMirror');
        const editor = (editorEl as any)?.__tiptapEditor;
        if (editor) {
          editor.state.doc.descendants((node: any, pos: number) => {
            if (node.isText && node.text && node.text.includes(phrase)) {
              const start = pos + node.text.indexOf(phrase);
              editor.commands.setTextSelection({ from: start, to: start + phrase.length });
              return false;
            }
          });
        }
      }, 'Section 2');

      const commentBtn = page1
        .locator('[data-testid="add-comment-btn"], [data-testid="toolbar-add-comment-btn"]')
        .first();
      await expect(commentBtn).toBeVisible({ timeout: 5000 });
      await commentBtn.click();

      const commentModal = page1.locator('[data-testid="comment-modal"]');
      await expect(commentModal).toBeVisible({ timeout: 5000 });
      await page1.locator('[data-testid="new-comment-input"]').fill('Could we add more details to Section 2?');
      await page1.locator('[data-testid="submit-comment-btn"]').click();
      await expect(commentModal).not.toBeVisible({ timeout: 5000 });

      // Verify comment card appears in Session 1
      const commentCard1 = page1.locator('[data-testid="comment-card"]').first();
      await expect(commentCard1).toBeVisible({ timeout: 10000 });
      await expect(commentCard1.locator('[data-testid="comment-status-badge"]')).toContainText('OPEN');
      await expect(commentCard1).toContainText('Could we add more details to Section 2?');

      // Verify comment card appears in Session 2
      const commentCard2 = page2.locator('[data-testid="comment-card"]').first();
      await expect(commentCard2).toBeVisible({ timeout: 10000 });

      // Session 2 posts a reply with @mention
      const replyToggleBtn = commentCard2.locator('[data-testid="toggle-reply-form-btn"]');
      await replyToggleBtn.click();

      const replyInput = commentCard2.locator('[data-testid="reply-input"]');
      await expect(replyInput).toBeVisible({ timeout: 5000 });
      await replyInput.fill('@test_admin Absolutely, adding benchmarks now.');
      await commentCard2.locator('[data-testid="submit-reply-btn"]').click();

      // Reply renders in Session 2
      await expect(commentCard2).toContainText('@test_admin Absolutely, adding benchmarks now.', { timeout: 10000 });

      // Reply renders in Session 1
      await expect(commentCard1).toContainText('@test_admin Absolutely, adding benchmarks now.', { timeout: 10000 });

      // Session 1 resolves thread
      const resolveBtn1 = commentCard1.locator('[data-testid="resolve-comment-btn"]');
      await resolveBtn1.click();

      // Comment marked as RESOLVED in Session 1
      await expect(commentCard1.locator('[data-testid="comment-status-badge"]')).toContainText('RESOLVED', {
        timeout: 10000,
      });

      // Comment marked as RESOLVED in Session 2
      await expect(commentCard2.locator('[data-testid="comment-status-badge"]')).toContainText('RESOLVED', {
        timeout: 10000,
      });
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
