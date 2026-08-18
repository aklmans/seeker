import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // 本组验证数据/设置主链，不重复测试首次欢迎卡；保留业务 onboarding 未选择态('done' !== '1')。
  await page.addInitScript(() => localStorage.setItem('jh-onboarded', 'done'));
});

test('通过 UI 新增岗位后刷新仍由 IndexedDB 恢复', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav-item[data-id="jobs"]').click();
  await page.getByRole('button', { name: /录入岗位|Add job/ }).click();
  await page.locator('#njManualToggle').click();
  await page.locator('#njCo').fill('Codex Web Test');
  await page.locator('#njRole').fill('Persistence Engineer');
  await page.locator('#saveJob').click();

  await expect(page.locator('#page-jobs tr[data-job]')).toContainText('Codex Web Test');
  await expect(page.locator('.nav-item[data-id="jobs"] .count')).toHaveText('1/20');

  await page.reload();
  await page.locator('.nav-item[data-id="jobs"]').click();
  await expect(page.locator('#page-jobs tr[data-job]')).toContainText('Persistence Engineer');
  await expect(page.locator('.nav-item[data-id="jobs"] .count')).toHaveText('1/20');
});

test('Web 设置页展示真实数据能力与四种协议预设', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav-item[data-id="settings"]').click();
  await page.locator('[data-stab="data"]').click();

  await expect(page.locator('#dataExport')).toBeVisible();
  await expect(page.locator('#dataExportRedacted')).toBeVisible();
  await expect(page.locator('#dataImport')).toBeVisible();
  await expect(page.locator('#page-settings')).toContainText(/仅桌面端支持|Desktop only/);

  await page.locator('[data-stab="model"]').click();
  await expect(page.locator('#mdProto option')).toHaveCount(4);
  await expect(page.locator('#mdEmbed')).toBeDisabled();

  await page.locator('#mdProto').selectOption('gemini');
  await expect(page.locator('#mdBase')).toHaveValue('https://generativelanguage.googleapis.com/v1beta');
  await expect(page.locator('#mdEmbed')).toBeEnabled();
  await expect(page.locator('#mdEmbed')).toHaveValue('gemini-embedding-001');
});
