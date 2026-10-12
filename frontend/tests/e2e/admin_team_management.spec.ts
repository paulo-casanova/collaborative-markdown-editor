import { test, expect } from '@playwright/test';

test.describe('Admin Console: Team Management, Member Assignment & DAG Hierarchies', () => {
  let adminToken = '';

  test.beforeAll(async ({ request }) => {
    const adminRes = await request.post('http://127.0.0.1:8080/api/v1/auth/login', {
      data: { username: 'test_admin', password: 'password123' },
    });
    expect(adminRes.ok()).toBeTruthy();
    const adminJson = await adminRes.json();
    adminToken = adminJson.token;
  });

  test('creates teams, edits details, assigns/toggles member roles, links DAG parent, tests cycle error, and deletes teams', async ({
    context,
    page,
  }) => {
    const ts = Date.now();
    const archTeamName = `Architecture Council ${ts}`;
    const alphaTeamName = `Alpha Core Devs ${ts}`;

    // Automatically accept window.confirm dialogs
    page.on('dialog', (dialog) => dialog.accept());

    await context.addInitScript((tok) => {
      localStorage.setItem('cme_auth_token', tok);
    }, adminToken);

    await page.goto('/admin');

    // 1. Check Metrics Grid
    await expect(page.getByText('System Administration')).toBeVisible();
    await expect(page.getByText('Registered Users')).toBeVisible();
    await expect(page.getByText('Teams in DAG')).toBeVisible();
    await expect(page.getByText('DAG Cycle Check')).toBeVisible();

    // 2. Create Team 1: Architecture Council
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('e.g. backend-eng, docs-team').fill(archTeamName);
    await page.getByPlaceholder('Purpose and scope of this team...').fill('Cross-functional architecture governance');
    await page.locator('form').getByRole('button', { name: 'Create Team' }).click();

    // Close modal for Architecture Council
    const modal = page.locator('div.fixed.inset-0');
    await expect(modal).toBeVisible();
    await expect(modal.getByText(archTeamName)).toBeVisible();
    await modal.locator('button:has(svg.lucide-x)').first().click();

    // 3. Create Team 2: Alpha Core Devs
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('e.g. backend-eng, docs-team').fill(alphaTeamName);
    await page.getByPlaceholder('Purpose and scope of this team...').fill('Core platform engineering team');
    await page.locator('form').getByRole('button', { name: 'Create Team' }).click();

    // Modal is now open for Alpha Core Devs
    await expect(modal).toBeVisible();
    await expect(modal.getByText(alphaTeamName)).toBeVisible();

    // 4. Assign Member: bob_auth_test as Member
    const userSelect = modal.getByLabel('Select User to Assign');
    await expect(userSelect).toBeVisible();
    await userSelect.selectOption({ label: 'Bob Tester (@bob_auth_test)' });

    const roleSelect = modal.getByLabel('Select Team Role');
    await roleSelect.selectOption('member');

    await modal.getByRole('button', { name: 'Assign User' }).click();

    // Verify Bob appears in the members list with Member badge
    await expect(modal.getByText('@bob_auth_test')).toBeVisible();
    await expect(modal.getByText('Member', { exact: true })).toBeVisible();

    // 5. Promote Bob to Lead
    const promoteBtn = modal.getByRole('button', { name: 'Promote' });
    await expect(promoteBtn).toBeVisible();
    await promoteBtn.click();

    // Verify Bob's badge updates to Team Lead
    await expect(modal.getByText('Team Lead', { exact: true })).toBeVisible();

    // Demote back to Member
    const demoteBtn = modal.getByRole('button', { name: 'Demote' });
    await expect(demoteBtn).toBeVisible();
    await demoteBtn.click();
    await expect(modal.getByText('Member', { exact: true })).toBeVisible();

    // 6. Link Architecture Council as DAG Parent of Alpha Core Devs
    await modal.getByRole('button', { name: 'Parent Teams (DAG)' }).click();
    const parentSelect = modal.getByLabel('Select Parent Team');
    await expect(parentSelect).toBeVisible();
    await parentSelect.selectOption({ label: archTeamName });

    await modal.getByRole('button', { name: 'Link Parent' }).click();

    // Verify Architecture Council is listed under Inherited Parent Teams
    await expect(modal.getByText(archTeamName)).toBeVisible();
    await expect(modal.getByText('DAG Parent')).toBeVisible();

    // Close modal for Alpha Core Devs
    await modal.locator('button:has(svg.lucide-x)').first().click();

    // 7. Test DAG Cycle Prevention:
    // Open Architecture Council modal
    const archRow = page.locator('div.divide-y > div').filter({ hasText: archTeamName });
    await expect(archRow).toBeVisible();
    await archRow.getByRole('button', { name: 'Manage Team' }).click();

    // Go to Parent Teams tab and try to link Alpha Core Devs as parent
    await modal.getByRole('button', { name: 'Parent Teams (DAG)' }).click();
    const archParentSelect = modal.getByLabel('Select Parent Team');
    await archParentSelect.selectOption({ label: alphaTeamName });
    await modal.getByRole('button', { name: 'Link Parent' }).click();

    // Cycle check error banner must be displayed!
    await expect(modal.getByText(/Circular DAG inheritance/i)).toBeVisible();

    // Close Architecture Council modal
    await modal.locator('button:has(svg.lucide-x)').first().click();

    // 8. Test Details & Settings: edit description of Alpha Core Devs
    const alphaRow = page.locator('div.divide-y > div').filter({ hasText: alphaTeamName });
    await alphaRow.getByRole('button', { name: 'Manage Team' }).click();
    await modal.getByRole('button', { name: 'Details & Settings' }).click();

    const editDesc = modal.locator('textarea');
    await editDesc.fill('Updated platform engineering description');
    await modal.getByRole('button', { name: 'Save Changes' }).click();
    await expect(modal.getByText('Team details updated successfully!')).toBeVisible();

    // 9. Remove Bob from Alpha Core Devs
    await modal.getByRole('button', { name: 'Members' }).click();
    const removeMemberBtn = modal.locator('button[title="Remove member"]');
    await removeMemberBtn.click();
    await expect(modal.getByText('@bob_auth_test')).not.toBeVisible();

    // 10. Delete Alpha Core Devs team
    await modal.getByRole('button', { name: 'Details & Settings' }).click();
    await modal.getByRole('button', { name: 'Delete Team' }).click();
    await expect(page.locator('div.divide-y > div').filter({ hasText: alphaTeamName })).not.toBeVisible();

    // 11. Delete Architecture Council team
    await archRow.getByRole('button', { name: 'Manage Team' }).click();
    await modal.getByRole('button', { name: 'Details & Settings' }).click();
    await modal.getByRole('button', { name: 'Delete Team' }).click();
    await expect(page.locator('div.divide-y > div').filter({ hasText: archTeamName })).not.toBeVisible();
  });
});
