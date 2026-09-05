import { expect, test } from '@playwright/test';

const browserErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console.error: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`response ${response.status()}: ${response.url()}`); });
  await page.addInitScript(() => localStorage.setItem('jh-onboarded', 'done'));
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) || []).toEqual([]);
});

test('Web 任务中心明确降级，不伪装能创建或执行', async ({ page }) => {
  const healthRequests = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/health') healthRequests.push(request.url()); });
  await page.goto('/');
  await expect.poll(() => healthRequests.length).toBe(1);
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
      ['platform_agent_events', { id: 'event_e2e', taskId: 'task_e2e', runId: 'run_e2e', type: 'run_succeeded', message: '任务已完成并通过验证', messageEn: 'Task completed and verified', createdAt: now, updatedAt: now }],
    ];
    for (const [collection, record] of records) await window.SeekerRT.db.upsert(collection, record);
    for (const [index, artifact] of [
      ['match_report', 'match-report.md', 'text/markdown'],
      ['tailored_resume', 'tailored-resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['cover_letter', 'cover-letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['interview_checklist', 'interview-checklist.md', 'text/markdown'],
    ].entries()) {
      await window.SeekerRT.db.upsert('platform_agent_artifacts', {
        id: `artifact_e2e_${index}`, taskId: 'task_e2e', runId: 'run_e2e', stepId: 'step_e2e',
        kind: artifact[0], name: artifact[1], mime: artifact[2], size: 1024,
        sha256: `0123456789abcdef${index}`, verified: true, validationStatus: 'verified', path: '/desktop-only/path',
      });
    }
  });

  await page.reload();
  await page.locator('.nav-item[data-id="tasks"]').click();
  const taskPage = page.locator('#page-tasks');
  await expect(taskPage).toContainText('可验收投递包');
  await expect(taskPage).toContainText('验证任务产物');
  await expect(taskPage).toContainText('SHA-256 0123456789');
  await expect(taskPage).toContainText('任务已完成并通过验证');
  const openButtons = taskPage.getByRole('button', { name: /打开文件|Open file/ });
  await expect(openButtons).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await expect(openButtons.nth(index)).toBeDisabled();
  await expect(taskPage.getByRole('button', { name: /预览|Preview/ })).toHaveCount(0);
});

test('只展示当前运行产物，未验证产物失去绿色可信状态且窄分栏为单列', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const now = Date.now();
    for (const [collection, record] of [
      ['jobs', { id: 'job_trust', co: 'Trust Test', role: 'Agent Engineer' }],
      ['platform_agent_tasks', {
        id: 'task_trust', workflowId: 'job_application_package', projectId: 'default', title: '可信状态测试', goal: '只展示当前运行',
        status: 'succeeded', createdBy: 'user', inputs: { jobIds: ['job_trust'], resumeId: 'r__master__', language: 'zh' },
        constraints: [], deliverables: [], successCriteria: [],
        capabilityScope: { collections: ['jobs', 'skills', 'resumes'], tools: [], effects: ['read_only', 'local_create'], maxSteps: 12, maxAttempts: 2 },
        createdAt: now, updatedAt: now,
      }],
      ['platform_agent_runs', { id: 'run_old', taskId: 'task_trust', status: 'succeeded', createdAt: now - 1000, updatedAt: now - 1000 }],
      ['platform_agent_runs', { id: 'run_current', taskId: 'task_trust', status: 'succeeded', createdAt: now, updatedAt: now }],
      ['platform_agent_artifacts', {
        id: 'artifact_old', taskId: 'task_trust', runId: 'run_old', stepId: 'step_old', kind: 'match_report',
        name: 'old-run-must-not-appear.md', mime: 'text/markdown', size: 20, sha256: 'oldhash', verified: true, validationStatus: 'verified',
      }],
      ['platform_agent_artifacts', {
        id: 'artifact_current', taskId: 'task_trust', runId: 'run_current', stepId: 'step_current', kind: 'match_report',
        name: 'current-unverified-artifact-name.md', mime: 'text/markdown', size: 20, sha256: 'newhash', verified: false, validationStatus: 'invalid', validationError: 'SHA-256 mismatch',
      }],
    ]) await window.SeekerRT.db.upsert(collection, record);
  });

  await page.reload();
  await page.locator('.nav-item[data-id="tasks"]').click();
  const taskPage = page.locator('#page-tasks');
  await expect(taskPage).toContainText('current-unverified-artifact-name.md');
  await expect(taskPage).not.toContainText('old-run-must-not-appear.md');
  await expect(taskPage).toContainText(/未验证 \/ 需要处理|Unverified \/ action needed/);
  await expect(taskPage.locator('.agent-artifact')).toHaveClass(/is-unverified/);
  await expect(taskPage.getByRole('button', { name: /打开文件|Open file/ })).toBeDisabled();
  const listStatus = taskPage.locator('[data-agent-task="task_trust"] .agent-task-status');
  await expect(listStatus).toContainText(/已中断|Interrupted/);
  await expect(listStatus).not.toHaveClass(/is-ok/);
  await expect(taskPage.locator('.agent-task-detail > .agent-task-heading .agent-task-status')).toContainText(/已中断|Interrupted/);
  await expect.poll(() => taskPage.locator('.agent-artifact-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length)).toBe(1);
  await expect(taskPage.locator('.agent-artifact h3')).toBeVisible();
});

test('Web 可查看导入的雷达候选与报告，但不伪装搜索、接受或打开文件', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const now = Date.now();
    for (const [collection, record] of [
      ['platform_agent_tasks', {
        id: 'task_radar_e2e', workflowId: 'job_opportunity_radar', projectId: 'default',
        title: '后端机会雷达', goal: '发现并验证目标机会', status: 'succeeded', createdBy: 'user',
        inputs: {
          criteria: { roles: ['Backend Engineer'], locations: ['Remote'], remotePreference: 'remote', requiredSkills: ['Rust'] },
          sources: [{ kind: 'mcp', server: 'search', tool: 'web_search' }], language: 'zh',
        },
        constraints: [], deliverables: [], successCriteria: [],
        capabilityScope: { collections: ['job_opportunities'], tools: [], effects: ['read_only', 'external_read', 'local_create'], maxSteps: 12, maxAttempts: 2 },
        createdAt: now, updatedAt: now,
      }],
      ['platform_agent_runs', { id: 'run_radar_e2e', taskId: 'task_radar_e2e', status: 'succeeded', createdAt: now, updatedAt: now }],
      ['platform_agent_steps', {
        id: 'step_radar_e2e_verify', taskId: 'task_radar_e2e', runId: 'run_radar_e2e', order: 6,
        key: 'verify_radar_report', title: '验证机会报告', tool: 'verify_artifact', effect: 'read_only', status: 'succeeded', attempt: 1,
      }],
      ['platform_agent_artifacts', {
        id: 'artifact_radar_e2e', taskId: 'task_radar_e2e', runId: 'run_radar_e2e', stepId: 'step_radar_e2e_verify',
        kind: 'opportunity_report', name: 'opportunity-report.md', mime: 'text/markdown', size: 512,
        sha256: 'abcdef0123456789', verified: true, validationStatus: 'verified', path: '/desktop-only/opportunity-report.md',
      }],
      ['job_opportunities', {
        id: 'opportunity_e2e', dedupeKey: 'stable-e2e', status: 'new', title: 'Backend Engineer',
        company: 'Acme <Research>', role: 'Backend Engineer', location: 'Remote', remote: 'remote',
        requiredSkills: ['Rust', 'SQL'], summary: 'Build reliable systems', url: 'https://jobs.example.com/1',
        sourceVerified: true, sourceVerifiedAt: now, matchScore: 95, taskId: 'task_radar_e2e', lastRunId: 'run_radar_e2e', firstObservedAt: now, observedAt: now,
      }],
    ]) await window.SeekerRT.db.upsert(collection, record);
  });

  await page.reload();
  await page.locator('.nav-item[data-id="opportunities"]').click();
  const radarPage = page.locator('#page-opportunities');
  await expect(radarPage).toContainText('Acme <Research>');
  await expect(radarPage).toContainText('95.0');
  await expect(radarPage).toContainText(/来源未验证|Source unverified/);
  await expect(radarPage.locator('.radar-card')).toHaveClass(/is-unverified/);
  await expect(radarPage.getByRole('button', { name: /查看来源|Open source/ })).toHaveCount(1);
  await expect(radarPage.getByRole('button', { name: /接受为岗位|Accept as job/ })).toHaveCount(0);
  await expect(radarPage.getByRole('button', { name: /标为已审|Mark reviewed/ })).toHaveCount(0);
  await expect(radarPage.locator('script')).toHaveCount(0);

  await page.locator('#topActions').getByRole('button', { name: /新建雷达|New radar/ }).click();
  await expect(radarPage).toContainText(/网页端只展示从桌面备份导入的机会|web version only displays opportunities imported/);
  await expect(radarPage.locator('[data-radar-create]')).toHaveCount(0);

  await page.locator('.nav-item[data-id="tasks"]').click();
  const taskPage = page.locator('#page-tasks');
  await expect(taskPage).toContainText('后端机会雷达');
  await expect(taskPage).toContainText('opportunity-report.md');
  await expect(taskPage.getByRole('button', { name: /打开文件|Open file/ })).toBeDisabled();
  await expect(taskPage.getByRole('button', { name: /预览|Preview/ })).toHaveCount(0);
});

test('English 界面创建雷达时提交英文报告语言', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jh-lang', 'en'));
  await page.goto('/');
  await page.evaluate(async () => {
    window.SeekerRT.available = () => true;
    window.SeekerRT.mcp.list = async () => [];
    window.SeekerRT.agent.createTask = async (draft) => {
      window.__radarDraft = draft;
      return { id: 'task_english', ...draft, status: 'draft' };
    };
  });
  await page.locator('.nav-item[data-id="opportunities"]').click();
  await page.getByRole('button', { name: /New radar/ }).click();
  await page.locator('[data-radar-roles]').fill('Backend Engineer');
  await page.locator('[data-radar-urls]').fill('https://jobs.example.com/careers');
  await page.locator('[data-radar-schedule]').check();
  await page.locator('[data-radar-kind]').selectOption('weekly');
  await page.locator('[data-radar-dow]').selectOption('3');
  await page.getByRole('button', { name: /Create and review/ }).click();
  await expect.poll(() => page.evaluate(() => window.__radarDraft?.inputs?.language)).toBe('en');
  await expect.poll(() => page.evaluate(async () => (await window.SeekerRT.db.get('platform_schedules', 'sc_task_english'))?.dow)).toBe(3);
});

test('MCP readOnlyHint 仅作提示，必须显式授权且不能创建计划', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    window.SeekerRT.available = () => true;
    window.SeekerRT.mcp.list = async () => [{
      name: 'untrusted-search', connected: true, tools: [{
        name: 'search', description: 'server-declared tool', readOnly: true,
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      }],
    }];
    window.__radarDrafts = [];
    window.SeekerRT.agent.createTask = async (draft) => {
      window.__radarDrafts.push(draft);
      return { id: 'task_mcp', ...draft, status: 'draft' };
    };
  });
  await page.locator('.nav-item[data-id="opportunities"]').click();
  await page.getByRole('button', { name: /新建雷达|New radar/ }).click();
  await page.locator('[data-radar-roles]').fill('Backend Engineer');
  await page.locator('[data-radar-mcp]').check();
  await page.locator('[data-radar-create]').click();
  await expect.poll(() => page.evaluate(() => window.__radarDrafts.length)).toBe(0);

  await page.locator('[data-radar-mcp-authorize]').check();
  await page.locator('[data-radar-schedule]').check();
  await page.locator('[data-radar-create]').click();
  await expect.poll(() => page.evaluate(() => window.__radarDrafts.length)).toBe(0);

  await page.locator('[data-radar-schedule]').uncheck();
  await page.locator('[data-radar-create]').click();
  await expect.poll(() => page.evaluate(() => window.__radarDrafts.length)).toBe(1);
  expect(await page.evaluate(() => window.__radarDrafts[0].inputs.sources[0])).toEqual({
    kind: 'mcp', server: 'untrusted-search', tool: 'search', userApproved: true,
  });
});

test('导入的 MCP 任务先展示精确工具并重新授权，未授权时不能开始', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const task = {
      id: 'task_imported_mcp', projectId: 'default', workflowId: 'job_opportunity_radar',
      title: 'Imported radar', goal: 'Review imported sources', status: 'draft', createdBy: 'user',
      inputs: {
        criteria: { roles: ['Backend Engineer'] },
        sources: [{ kind: 'mcp', server: 'untrusted-search', tool: 'search', authorization: 'user_selected_exact_tool' }],
        language: 'en',
      },
      constraints: [], deliverables: [], successCriteria: [],
      capabilityScope: { collections: ['job_opportunities'], tools: [], effects: ['read_only', 'external_read'], maxSteps: 12, maxAttempts: 2 },
      createdAt: 1, updatedAt: 1,
    };
    await window.SeekerRT.db.import(JSON.stringify({
      format: 'seeker-backup', formatVersion: 2,
      collections: {
        platform_agent_tasks: [{
          ...task, mcpAuthorizationRequired: false, mcpAuthorizationValid: true,
        }],
      },
    }));
  });
  await page.reload();
  await page.evaluate(async () => {
    const listImportedTasks = window.SeekerRT.agent.listTasks;
    window.SeekerRT.available = () => true;
    window.SeekerRT.agent.listTasks = async () => (await listImportedTasks()).map((task) => ({
      ...task,
      mcpAuthorizationRequired: true,
      mcpAuthorizationValid: window.__authorizedMcpTask === task.id,
    }));
    window.SeekerRT.agent.listRuns = async () => [];
    window.SeekerRT.agent.listArtifacts = async () => [];
    window.SeekerRT.agent.authorizeMcp = async (taskId) => {
      window.__authorizedMcpTask = taskId;
      const task = await window.SeekerRT.db.get('platform_agent_tasks', taskId);
      return { ...task, mcpAuthorizationRequired: true, mcpAuthorizationValid: true };
    };
    const { renderTasks } = await import('/apps/jobseek/pages/tasks.js');
    renderTasks();
  });

  await expect.poll(() => page.evaluate(async () => (await window.SeekerRT.db.list('platform_agent_tasks')).length)).toBe(1);
  expect(await page.evaluate(async () => {
    const task = await window.SeekerRT.db.get('platform_agent_tasks', 'task_imported_mcp');
    return {
      hasRequired: Object.hasOwn(task, 'mcpAuthorizationRequired'),
      hasValid: Object.hasOwn(task, 'mcpAuthorizationValid'),
    };
  })).toEqual({ hasRequired: false, hasValid: false });
  await page.locator('.nav-item[data-id="tasks"]').click();
  const taskPage = page.locator('#page-tasks');
  await expect(taskPage).toContainText('MCP · untrusted-search/search');
  await expect(taskPage).toContainText(/MCP 授权需要确认|MCP authorization required/);
  await expect(taskPage.getByRole('button', { name: /开始执行|Start run/ })).toHaveCount(0);
  await taskPage.getByRole('button', { name: /授权上述精确 MCP 工具|Authorize the exact MCP tools above/ }).click();
  await expect.poll(() => page.evaluate(() => window.__authorizedMcpTask)).toBe('task_imported_mcp');
  await expect(taskPage.getByRole('button', { name: /开始执行|Start run/ })).toHaveCount(1);
});

test('schedulerTick 集成：启动受控雷达、跳过活动运行并持久化失败', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const runtime = window.SeekerRT;
    const store = await import('/platform/shell/schedule-store.js');
    const { schedulerTick } = await import('/platform/shell/scheduler.js');
    const now = new Date(2026, 8, 5, 12, 0, 0, 0).getTime();
    const base = { kind: 'daily', time: '09:00', dow: 6, enabled: true, created_at: now - 172_800_000, last_run_at: now - 172_800_000, updated_at: now };
    const task = { id: 'task_sched', workflowId: 'job_opportunity_radar', status: 'draft', inputs: { sources: [{ kind: 'url', url: 'https://jobs.example.com' }] } };
    let mode = 'start';
    const starts = [];
    runtime.agent.getTask = async () => task;
    runtime.agent.listRuns = async () => mode === 'active' ? [{ status: 'running' }] : [];
    runtime.agent.startScheduled = async (taskId) => {
      starts.push(taskId);
      if (mode === 'fail') throw new Error('scheduled start failed');
      return { id: 'run_sched', taskId, status: 'created' };
    };

    await store.saveSchedule({ ...base, id: 'sc_start', agentTaskId: task.id });
    const started = await schedulerTick(now);
    const startedRecord = await runtime.db.get('platform_schedules', 'sc_start');

    mode = 'active';
    await store.saveSchedule({ ...base, id: 'sc_active', agentTaskId: task.id, updated_at: now + 1 });
    const active = await schedulerTick(now);
    const activeRecord = await runtime.db.get('platform_schedules', 'sc_active');

    mode = 'fail';
    await store.saveSchedule({ ...base, id: 'sc_fail', agentTaskId: task.id, updated_at: now + 2 });
    const failed = await schedulerTick(now);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failedRecord = await runtime.db.get('platform_schedules', 'sc_fail');
    return { started, startedRecord, active, activeRecord, failed, failedRecord, starts };
  });

  expect(result.started.status).toBe('agent-started');
  expect(result.startedRecord.last_status).toBe('agent-started');
  expect(result.active.status).toBe('agent-active');
  expect(result.activeRecord.last_status).toBe('agent-active');
  expect(result.failed.status).toBe('error');
  expect(result.failedRecord.last_status).toBe('error');
  expect(result.failedRecord.last_error).toContain('scheduled start failed');
  expect(result.starts).toEqual(['task_sched', 'task_sched']);
});
