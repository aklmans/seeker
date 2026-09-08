import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function open(page){
  await page.addInitScript(()=>{localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');});
  await page.goto('/');await expect(page.locator('#homeInput')).toBeVisible();
}
const nav=(page,id)=>page.locator('.nav-item[data-id="'+id+'"]');

test('旧安装求职默认关闭，主动开启后重启保留且不删除业务记录',async({page})=>{
  await page.addInitScript(()=>{if(!sessionStorage.getItem('fixture')){localStorage.setItem('seeker-apps',JSON.stringify({enabled:{jobseek:true}}));sessionStorage.setItem('fixture','1');}});
  await open(page);
  expect(await page.evaluate(()=>window.SeekerShell.enabled('jobseek'))).toBe(false);
  await page.evaluate(()=>window.SeekerRT.db.upsert('jobs',{id:'retained-job',company:'Keep this company'}));
  await nav(page,'workspaces').click();await page.locator('[data-workspace-app="jobseek"]').click();
  await expect(page.locator('[data-workspace-app="jobseek"]')).toHaveAttribute('aria-pressed','true');
  await page.reload();await nav(page,'workspaces').click();
  await expect(page.locator('[data-workspace-app="jobseek"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-workspace-app="jobseek"]').click();
  expect(await page.evaluate(()=>window.SeekerRT.db.list('jobs'))).toContainEqual(expect.objectContaining({id:'retained-job'}));
  await nav(page,'settings').click();await page.locator('[data-stab="data"]').click();
  await expect(page.locator('#dataSummary')).toContainText('已关闭，数据保留');
});

test('工作空间创建切换、会话隔离、偏好重启与归档恢复',async({page})=>{
  await open(page);await nav(page,'workspaces').click();await page.locator('#pjAdd').click();
  await page.locator('#pjName').fill('阅读 <script> 标签');await page.locator('#pjInstr').fill('用简单例子解释');await page.locator('#pjSave').click();
  await expect(page.locator('#workspaceCurrent option')).toHaveCount(2);
  const id=await page.locator('#workspaceCurrent option').last().getAttribute('value');
  await page.locator('#workspaceCurrent').selectOption(id);
  await page.evaluate(async id=>{
    for(const c of [{id:'here',projectId:id,title:'本空间的对话'},{id:'elsewhere',projectId:'',title:'其他空间的对话'}])await window.SeekerRT.db.upsert('platform_conversations',c);
    await (await import('/platform/shell/conversation-store.js')).hydrateConversations();
  },id);
  await page.locator('#workspaceName').fill('我的日常');await page.locator('#workspaceStart').selectOption('workspaces');await page.locator('#workspaceTasks').uncheck();await page.locator('#workspaceSave').click();
  await expect(page.locator('#workspaceStatus')).toContainText('偏好已保存');
  await nav(page,'home').click();await expect(page.locator('#homeConversations')).toContainText('本空间的对话');await expect(page.locator('#homeConversations')).not.toContainText('其他空间');await expect(page.locator('#homeTasks')).toBeHidden();
  await page.reload();await expect(page.locator('#page-workspaces')).toHaveClass(/active/);await expect(page.locator('#workspaceName')).toHaveValue('我的日常');await expect(page.locator('#workspaceCurrent')).toHaveValue(id);
  await page.locator('[data-pjarch="'+id+'"]').click();await expect(page.locator('#workspaceCurrent')).toHaveValue('');
  await nav(page,'home').click();await expect(page.locator('#homeConversations')).toContainText('其他空间的对话');
  await nav(page,'workspaces').click();await page.locator('[data-pjarch="'+id+'"]').click();await expect(page.locator('#workspaceCurrent option')).toHaveCount(2);
  expect((await page.evaluate(()=>window.SeekerRT.db.list('platform_conversations'))).length).toBe(2);
});

test('真实外观设置与空白个人信息，保存失败不更新真实数据',async({page})=>{
  await open(page);await nav(page,'settings').click();await page.emulateMedia({colorScheme:'light'});
  await page.locator('[data-theme="system"]').click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('[data-fs="16"]').click();await expect(page.locator('body')).toHaveCSS('font-size','16px');
  await page.locator('[data-density="compact"]').click();await expect(page.locator('html')).toHaveAttribute('data-density','compact');
  await page.locator('[data-stab="profile"]').click();await expect(page.locator('[data-pf="phone"]')).toHaveValue('');await expect(page.locator('[data-pf="intent"]')).toHaveCount(0);
  await page.evaluate(()=>{window.SeekerRT.profile.set=async()=>{throw Error('disk unavailable');};});
  await page.locator('[data-pf="name"]').fill('Unsaved name');await page.locator('[data-pf="phone"]').focus();
  await expect(page.locator('#toasts')).toContainText('未能保存');
  expect(await page.evaluate(()=>window.SeekerRT.profile.getAll())).toEqual({});
});

test('会话范围可核对，清除失败保留记录，真实备份可恢复空间偏好和消息',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{
    for(const id of ['here','elsewhere']){
      await window.SeekerRT.db.upsert('platform_conversations',{id,title:id,projectId:id==='here'?'':'p2'});
      await window.SeekerRT.db.upsert('messages',{id,text:id,role:'user',projectId:id==='here'?'':'p2',conversationId:id,ts:1});
    }
    localStorage.setItem('seeker-workspace',JSON.stringify({name:'可恢复空间',startPage:'home'}));
    window.originalClear=window.SeekerRT.db.clear;
    window.SeekerRT.db.clear=async()=>{throw Error('backup unavailable');};
  });
  await nav(page,'settings').click();await page.locator('[data-stab="data"]').click();await page.locator('#mgrHistory').click();
  await expect(page.locator('#histBody')).toContainText('here');await expect(page.locator('#histBody')).not.toContainText('elsewhere');
  await page.locator('#historyScope').selectOption('all');await expect(page.locator('#histBody')).toContainText('elsewhere');
  await page.locator('#histClear').click();await page.locator('.gr-overlay').getByRole('button',{name:'备份并清除',exact:true}).click();
  await expect(page.locator('#toasts')).toContainText('清除失败');
  expect((await page.evaluate(()=>window.SeekerRT.db.list('messages'))).length).toBe(2);
  await page.evaluate(()=>{window.SeekerRT.db.clear=window.originalClear;});
  const download=page.waitForEvent('download');
  await page.locator('#histClear').click();await page.locator('.gr-overlay').getByRole('button',{name:'备份并清除',exact:true}).click();
  const file=await download;const backup=await readFile(await file.path(),'utf8');
  await expect(page.locator('#histBody')).toContainText('0 条消息');
  expect((await page.evaluate(()=>window.SeekerRT.db.list('platform_conversations'))).length).toBe(0);
  await page.locator('.modal [data-close]').click();
  await page.evaluate(()=>localStorage.setItem('seeker-workspace','{}'));
  await page.locator('#dataImportFile').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await expect(page.locator('#toasts')).toContainText('已导入');
  expect((await page.evaluate(()=>window.SeekerRT.db.list('messages'))).length).toBe(2);
  await nav(page,'workspaces').click();await expect(page.locator('#workspaceName')).toHaveValue('可恢复空间');
});
