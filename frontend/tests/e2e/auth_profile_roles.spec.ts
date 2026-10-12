import { test, expect } from '@playwright/test';
import { BACKEND_URL } from './test_config';

test.describe('User Authentication, Profile Identity & Admin Roles', () => {
  let adminToken = '';
  let memberToken = '';

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate as system admin
    const adminRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
      data: { username: 'test_admin', password: 'password123' },
    });
    expect(adminRes.ok()).toBeTruthy();
    const adminJson = await adminRes.json();
    adminToken = adminJson.token;

    // 2. Authenticate as regular non-admin member
    const memberRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
      data: { username: 'bob_auth_test', password: 'password123' },
    });
    expect(memberRes.ok()).toBeTruthy();
    const memberJson = await memberRes.json();
    memberToken = memberJson.token;
  });

  test('admin session renders non-empty display name, Admin pill badge, and Admin Console sidebar link', async ({ context, page }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);

    await page.goto('/');

    // 1. Header Profile Pill: verify display name and Admin badge are visible
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Verify non-empty display name appears in header
    await expect(header.getByText('Super Admin')).toBeVisible();

    // Verify Admin badge pill in header is visible
    await expect(header.getByText('Admin', { exact: true })).toBeVisible();

    // 2. Sidebar: verify Admin Console link is visible for admin
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Admin Console')).toBeVisible();

    // 3. Settings page: verify Username, Display Name, and System Administrator role
    await page.goto('/settings');
    const main = page.locator('main');
    await expect(main.getByText('Account & Identity')).toBeVisible();
    await expect(main.getByText('@test_admin')).toBeVisible();
    await expect(main.getByText('Super Admin')).toBeVisible();
    await expect(main.getByText('System Administrator', { exact: true })).toBeVisible();
  });

  test('non-admin member session renders Member badge and hides Admin Console link', async ({ context, page }) => {
    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, memberToken);

    await page.goto('/');

    // 1. Header Profile Pill: verify member display name appears without Admin badge
    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.getByText('Bob Tester')).toBeVisible();
    await expect(header.getByText('Admin', { exact: true })).not.toBeVisible();

    // 2. Sidebar: Admin Console must NOT be visible for regular member
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Admin Console')).not.toBeVisible();

    // 3. Settings page: verify Member badge
    await page.goto('/settings');
    const main = page.locator('main');
    await expect(main.getByText('@bob_auth_test')).toBeVisible();
    await expect(main.getByText('Bob Tester')).toBeVisible();
    await expect(main.getByText('Member', { exact: true })).toBeVisible();
    await expect(main.getByText('System Administrator', { exact: true })).not.toBeVisible();
  });
});
