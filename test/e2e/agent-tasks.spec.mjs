import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jh-onboarded', 'done'));
});

test('Web 任务中心明确降级，不伪装能创建或执行', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav-item[data-id="tasks"]').click();

  await expect(page.locator('#page-tasks')).toContainText(/桌面任务记录|Desktop task records/);
  await expect(page.locator('#page-tasks [data-agent-create]')).toHaveCount(0);

  await page.locator('#topActions').getByRole('button', { name: /新建任务|New task/ }).click();
  await expect(page.locator('#page-tasks')).toContainText(/请在桌面版创建任务|Create tasks in the desktop app/);
  await expect(page.locator('#page-tasks [data-agent-create]')).toHaveCount(0);
});

test('导入的任务记录可查看步骤、校验摘要与审计事件', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const now = Date.now();
    const records = [
      ['jobs', { id: 'job_e2e', co: 'Seeker Test', role: 'Agent Engineer' }],
      ['platform_agent_tasks', {
        id: 'task_e2e', workflowId: 'job_application_package', projectId: 'default',
        title: '可验收投递包', goal: '生成四项真实产物', status: 'succeeded', createdBy: 'user',
        inputs: { jobIds: ['job_e2e'], resumeId: 'r__master__', language: 'zh' },
        constraints: [], deliverables: [], successCriteria: [],
        capabilityScope: { collections: ['jobs', 'skills', 'resumes'], tools: [], effects: ['read_only', 'local_create'], maxSteps: 12, maxAttempts: 2 },
        createdAt: now, updatedAt: now,
      }],
      ['platform_agent_runs', { id: 'run_e2e', taskId: 'task_e2e', status: 'succeeded', createdAt: now, updatedAt: now }],
      ['platform_agent_steps', { id: 'step_e2e', taskId: 'task_e2e', runId: 'run_e2e', order: 0, title: '验证任务产物', tool: 'verify_artifact', effect: 'read_only', status: 'succeeded', attempt: 1 }],
      ['platform_agent_artifacts', { id: 'artifact_e2e', taskId: 'task_e2e', runId: 'run_e2e', stepId: 'step_e2e', kind: 'match_report', name: 'match-report.md', mime: 'text/markdown', size: 1024, sha256: '0123456789abcdef', verified: true, path: '/desktop-only/path' }],
      ['platform_agent_events', { id: 'event_e2e', taskId: 'task_e2e', runId: 'run_e2e', type: 'run_succeeded', message: '任务已完成并通过验证', messageEn: 'Task completed and verified', createdAt: now, updatedAt: now }],
    ];
    for (const [collection, record] of records) await window.SeekerRT.db.upsert(collection, record);
  });

  await page.reload();
  await page.locator('.nav-item[data-id="tasks"]').click();
  const taskPage = page.locator('#page-tasks');
  await expect(taskPage).toContainText('可验收投递包');
  await expect(taskPage).toContainText('验证任务产物');
  await expect(taskPage).toContainText('SHA-256 0123456789');
  await expect(taskPage).toContainText('任务已完成并通过验证');
  await expect(taskPage.getByRole('button', { name: /打开文件|Open file/ })).toBeDisabled();
  await expect(taskPage.getByRole('button', { name: /预览|Preview/ })).toHaveCount(0);
});
