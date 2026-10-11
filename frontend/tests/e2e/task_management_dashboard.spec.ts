import { test, expect } from '@playwright/test';

test.describe('Phase 6, Step 6.3: Task Management Dashboard & Real-Time Event Fanout', () => {
  let adminToken = '';
  let testerToken = '';
  let testDocId = '';
  const docTitle = 'Step 6.3 Tasks Spec';

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate test_admin
    const adminRes = await request.post('http://127.0.0.1:8080/api/v1/auth/login', {
      data: { username: 'test_admin', password: 'password123' },
    });
    expect(adminRes.ok()).toBeTruthy();
    const adminJson = await adminRes.json();
    adminToken = adminJson.token;

    // 2. Authenticate ws_tester
    const testerRes = await request.post('http://127.0.0.1:8080/api/v1/auth/login', {
      data: { username: 'ws_tester', password: 'password123' },
    });
    expect(testerRes.ok()).toBeTruthy();
    const testerJson = await testerRes.json();
    testerToken = testerJson.token;

    // 3. Create a fresh test document
    const docPath = `tasks_e2e_${Date.now()}.md`;
    const docRes = await request.post('http://127.0.0.1:8080/api/v1/documents', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        path: docPath,
        title: docTitle,
        content: '# Sprint Tasks\n\n- [ ] Initial task setup\n- [x] Pre-flight checks',
      },
    });
    expect(docRes.ok()).toBeTruthy();
    const docJson = await docRes.json();
    testDocId = docJson.id;
  });

  test('Status criteria: Post a task via REST endpoint; task card appears immediately in Review Sidebar via WebSocket opcode 0x02 without refresh', async ({
    browser,
    request,
  }) => {
    // Setup browser session for Admin
    const context = await browser.newContext({
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
    const page = await context.newPage();

    // Navigate to document editor
    await page.goto(`http://127.0.0.1:4173/documents/${testDocId}`);
    await page.waitForSelector('.tiptap', { timeout: 15000 });

    // Wait for live collaborative connection
    await expect(page.getByText('Collab Live')).toBeVisible({ timeout: 15000 });

    // Open Review Sidebar
    const reviewToggle = page.locator('[data-testid="toggle-reviews-btn"]').first();
    await reviewToggle.click();
    await expect(page.locator('[data-testid="review-sidebar"]')).toBeVisible({ timeout: 5000 });

    // Switch to Tasks filter in sidebar
    await page.locator('[data-testid="filter-tasks-btn"]').click();

    // Verify task count before external mutation
    const initialTasksCount = await page.locator('[data-testid="task-card"]').count();

    // Send external REST POST request to create a task (simulating external LLM / background webhook)
    const taskDesc = `Verify WebSocket 0x02 real-time fanout ${Date.now()}`;
    const postTaskRes = await request.post(`http://127.0.0.1:8080/api/v1/documents/${testDocId}/tasks`, {
      headers: {
        Authorization: `Bearer ${testerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        description: taskDesc,
      },
    });
    expect(postTaskRes.ok()).toBeTruthy();
    const createdTask = await postTaskRes.json();
    expect(createdTask.id).toBeTruthy();

    // Verification: Task card must appear immediately in the browser Review Sidebar via WebSocket opcode 0x02 without page reload!
    const newTaskCard = page.locator('[data-testid="task-card"]', { hasText: taskDesc });
    await expect(newTaskCard).toBeVisible({ timeout: 10000 });

    // Verify task card contains unchecked checkbox
    const taskCheckbox = newTaskCard.locator('[data-testid="task-checkbox"]');
    await expect(taskCheckbox).not.toBeChecked();

    // Verify real-time fanout of TASK_TOGGLED via REST PATCH
    const patchRes = await request.patch(`http://127.0.0.1:8080/api/v1/tasks/${createdTask.id}`, {
      headers: {
        Authorization: `Bearer ${testerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        is_completed: true,
      },
    });
    expect(patchRes.ok()).toBeTruthy();

    // Observe connected browser updates checkbox state immediately via WebSocket 0x02
    await expect(taskCheckbox).toBeChecked({ timeout: 5000 });

    await context.close();
  });

  test('Centralized Task Dashboard: aggregates tasks, supports tab filtering, search, and toggle completion', async ({
    browser,
    request,
  }) => {
    // Create distinct open and completed tasks
    const openDesc = `Dashboard Open Task ${Date.now()}`;
    const completedDesc = `Dashboard Completed Task ${Date.now()}`;

    const r1 = await request.post(`http://127.0.0.1:8080/api/v1/documents/${testDocId}/tasks`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { description: openDesc },
    });
    expect(r1.ok()).toBeTruthy();

    const r2 = await request.post(`http://127.0.0.1:8080/api/v1/documents/${testDocId}/tasks`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { description: completedDesc },
    });
    expect(r2.ok()).toBeTruthy();
    const task2 = await r2.json();

    // Mark task2 complete
    const r2Patch = await request.patch(`http://127.0.0.1:8080/api/v1/tasks/${task2.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { is_completed: true },
    });
    expect(r2Patch.ok()).toBeTruthy();

    // Open browser session for Admin
    const context = await browser.newContext({
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
    const page = await context.newPage();

    // Navigate to /tasks
    await page.goto('http://127.0.0.1:4173/tasks');
    await page.waitForSelector('[data-testid="task-dashboard-page"]', { timeout: 15000 });

    // Verify metrics cards are rendered
    await expect(page.locator('[data-testid="metric-total-tasks"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-open-tasks"]')).toBeVisible();
    await expect(page.locator('[data-testid="metric-completed-tasks"]')).toBeVisible();

    // Verify tasks are present
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: openDesc })).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: completedDesc })).toBeVisible();

    // Test tab: Incomplete
    await page.locator('[data-testid="tab-open-tasks"]').click();
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: openDesc })).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: completedDesc })).not.toBeVisible();

    // Test tab: Completed
    await page.locator('[data-testid="tab-completed-tasks"]').click();
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: completedDesc })).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: openDesc })).not.toBeVisible();

    // Test search filter
    await page.locator('[data-testid="tab-all-tasks"]').click();
    const searchInput = page.locator('[data-testid="task-search-input"]');
    await searchInput.fill(openDesc);
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: openDesc })).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-task-item"]', { hasText: completedDesc })).not.toBeVisible();
    await searchInput.fill('');

    // Toggle task completion from the dashboard directly
    const openItem = page.locator('[data-testid="dashboard-task-item"]', { hasText: openDesc });
    const checkbox = openItem.locator('[data-testid="dashboard-task-checkbox"]');
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();

    // Verify immediate (<100ms) UI state update
    await expect(checkbox).toBeChecked();

    // Verify navigation link to document
    const docLink = page.locator('[data-testid="open-document-link"]').first();
    await expect(docLink).toBeVisible();

    await context.close();
  });

  test('Review comment with inline markdown tasks and linked action items shortcut', async ({
    browser,
    request,
  }) => {
    // Create a comment with inline markdown checklist
    const commentContent = "Please review the following checklist:\n- [ ] Add auth unit tests\n- [x] Configure DB connection pool";
    const commentRes = await request.post(`http://127.0.0.1:8080/api/v1/documents/${testDocId}/comments`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        content: commentContent,
        anchor: {
          type: 'dual',
          quote: { exact: 'Sprint Tasks', prefix: '# ', suffix: '\n' },
          offset: 0,
          length: 12,
        },
      },
    });
    expect(commentRes.ok()).toBeTruthy();
    const commentJson = await commentRes.json();
    const commentId = commentJson.id;

    // Attach a linked task to this comment
    const linkedTaskDesc = `Resolve blocking PR for comment ${Date.now()}`;
    const linkedTaskRes = await request.post(`http://127.0.0.1:8080/api/v1/documents/${testDocId}/tasks`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        description: linkedTaskDesc,
        comment_id: commentId,
      },
    });
    expect(linkedTaskRes.ok()).toBeTruthy();
    const linkedTaskJson = await linkedTaskRes.json();

    // Open browser session for Admin
    const context = await browser.newContext({
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
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:4173/documents/${testDocId}`);
    await page.waitForSelector('.tiptap', { timeout: 15000 });

    // Wait for live collaborative connection
    await expect(page.getByText('Collab Live')).toBeVisible({ timeout: 15000 });

    // Open review sidebar and select Comments filter
    const reviewToggle = page.locator('[data-testid="toggle-reviews-btn"]').first();
    await reviewToggle.click();
    await expect(page.locator('[data-testid="review-sidebar"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="filter-comments-btn"]').click();

    // Verify comment card renders inline markdown task items
    const commentCard = page.locator('[data-testid="comment-card"]', { hasText: 'Please review the following checklist' });
    await expect(commentCard).toBeVisible();
    await expect(commentCard.locator('[data-testid="comment-inline-task"]')).toHaveCount(2);

    // Verify linked action item task is displayed inside the comment card
    const linkedTaskSection = commentCard.locator('[data-testid="comment-linked-tasks"]');
    await expect(linkedTaskSection).toBeVisible();
    await expect(linkedTaskSection.locator('[data-testid="task-card"]', { hasText: linkedTaskDesc })).toBeVisible();

    // Toggle linked task completed
    const linkedCheckbox = linkedTaskSection.locator('[data-testid="task-checkbox"]');
    await linkedCheckbox.click();
    await expect(linkedCheckbox).toBeChecked();

    // 1-click shortcut to resolve thread appears
    const resolveThreadBtn = commentCard.locator('[data-testid="resolve-thread-all-tasks-btn"]');
    await expect(resolveThreadBtn).toBeVisible();
    await resolveThreadBtn.click();

    // Verify comment status changes to RESOLVED
    await expect(commentCard.locator('[data-testid="comment-status-badge"]')).toHaveText('RESOLVED');

    await context.close();
  });
});
