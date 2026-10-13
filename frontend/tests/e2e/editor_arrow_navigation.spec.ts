import { test, expect } from '@playwright/test';
import { BACKEND_URL } from './test_config';
import fs from 'fs';

test('Smooth sequential vertical arrow navigation across headings, widgets, and lines without jumping', async ({ page, request, context }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  // 1. Authenticate test_admin
  const adminRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
    data: { username: 'test_admin', password: 'password123' },
  });
  expect(adminRes.ok()).toBeTruthy();
  const adminJson = await adminRes.json();
  const token = adminJson.token;

  await context.addInitScript((tok) => {
    localStorage.setItem('cme_auth_token', tok);
  }, token);

  const fixtureContent = fs.readFileSync('/home/pasc/cme/storage_data/content/specs/Test File Modified.md', 'utf8');

  // 2. Create document
  const docPath = `specs/Test_File_Modified_${Date.now()}.md`;
  const docRes = await request.post(`${BACKEND_URL}/api/v1/documents`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      path: docPath,
      title: 'Test File Modified',
      content: fixtureContent,
    },
  });
  expect(docRes.ok()).toBeTruthy();
  const docJson = await docRes.json();
  const docId = docJson.id;

  // 3. Open editor
  await page.goto(`/documents/${docId}`);
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // Wait for editor to initialize
  await page.waitForTimeout(1000);

  // Focus editor at position 0
  await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    if (view) {
      view.dispatch({ selection: { anchor: 0 } });
      view.focus();
    }
  });

  // Focus editor
  await page.locator('.cm-content').click();

  // Explicitly place cursor on Line 17 (pos 172)
  await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    if (view) {
      view.dispatch({ selection: { anchor: 172 } });
      view.focus();
    }
  });

  // Verify initial position is line 17
  const startLine = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(startLine).toBe(17);

  // Press ArrowDown 1: should land on Line 18 (### Test File)
  await page.keyboard.press('ArrowDown');
  const lineAfterPress1 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    const head = view.state.selection.main.head;
    const l = view.state.doc.lineAt(head);
    return { line: l.number, text: l.text, pos: head };
  });
  console.log('After press 1 (from line 17):', lineAfterPress1);
  expect(lineAfterPress1.line).toBe(18);

  // Press ArrowDown 2: should land on Line 19 (This is a file with some **bold** text.)
  await page.keyboard.press('ArrowDown');
  const lineAfterPress2 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    const head = view.state.selection.main.head;
    const l = view.state.doc.lineAt(head);
    return { line: l.number, text: l.text, pos: head };
  });
  console.log('After press 2 (from line 18):', lineAfterPress2);
  expect(lineAfterPress2.line).toBe(19);

  // Press ArrowDown 3: should land on Line 20 (empty line)
  await page.keyboard.press('ArrowDown');
  const lineAfterPress3 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    const head = view.state.selection.main.head;
    const l = view.state.doc.lineAt(head);
    return { line: l.number, text: l.text, pos: head };
  });
  console.log('After press 3 (from line 19):', lineAfterPress3);
  expect(lineAfterPress3.line).toBe(20);

  // Press ArrowDown 4: should land on Line 21 (We can also add a horiozntal rule to split.)
  await page.keyboard.press('ArrowDown');
  const lineAfterPress4 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    const head = view.state.selection.main.head;
    const l = view.state.doc.lineAt(head);
    return { line: l.number, text: l.text, pos: head };
  });
  console.log('After press 4 (from line 20):', lineAfterPress4);
  expect(lineAfterPress4.line).toBe(21);

  // Press ArrowDown 5: should land on Line 23 (And a table:)
  await page.keyboard.press('ArrowDown');
  const lineAfterPress5 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    const head = view.state.selection.main.head;
    const l = view.state.doc.lineAt(head);
    return { line: l.number, text: l.text, pos: head };
  });
  console.log('After press 5 (from line 21):', lineAfterPress5);
  expect(lineAfterPress5.line).toBe(23);

  // Press ArrowDown 6: should land on Line 24 (blank line below table title)
  await page.keyboard.press('ArrowDown');
  const lineAfterPress6 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    const head = view.state.selection.main.head;
    const l = view.state.doc.lineAt(head);
    return { line: l.number, text: l.text, pos: head };
  });
  console.log('After press 6 (from line 23):', lineAfterPress6);
  expect(lineAfterPress6.line).toBe(24);

  // Now test navigating upwards (ArrowUp) sequentially back to Line 17
  await page.keyboard.press('ArrowUp');
  const up1 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(up1).toBe(23);

  await page.keyboard.press('ArrowUp');
  const up2 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(up2).toBe(21);

  await page.keyboard.press('ArrowUp');
  const up3 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(up3).toBe(20);

  await page.keyboard.press('ArrowUp');
  const up4 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(up4).toBe(19);

  await page.keyboard.press('ArrowUp');
  const up5 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(up5).toBe(18);

  await page.keyboard.press('ArrowUp');
  const up6 = await page.evaluate(() => {
    const editorEl = document.querySelector('.cm-editor') as any;
    const view = editorEl?.__tiptapEditor?.getView();
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(up6).toBe(17);
});
