import { expect, test } from '@playwright/test';

test('新安装以通用首页开始，求职可按需开启且偏好跨刷新保留', async ({ page }) => {
  await page.goto('/');
  await page.locator('#obGo').click();
  await expect(page.locator('#page-home')).toBeVisible();
  await expect(page.locator('.nav-item[data-id="jobs"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.nav-item[data-id="jobs"]')).toHaveCount(0);
  await page.locator('#appMgrBtn').click();
  await page.locator('[data-appen="jobseek"]').click();
  await page.locator('.modal .x').click();
  await expect(page.locator('.nav-item[data-id="jobs"]')).toBeVisible();
});

test('真实 Web 请求从持久化会话恢复完整上下文，新对话隔离且可重命名', async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => {
    localStorage.setItem('jh-onboarded', 'done');
    localStorage.setItem('jh-democode', 'test-ticket');
  });
  await page.route('**/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    const text = `answer-${requests.length}`;
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ t: text })}\n\ndata: {"done":true}\n\n` });
  });
  await page.goto('/');
  await page.locator('#agentInput').fill('Remember my word: orange');
  await page.locator('#agentSend').click();
  await expect(page.locator('#agentMsgs')).toContainText('answer-1');
  await expect(page.locator('#agentSend')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#agentMsgs')).toContainText('answer-1');
  await page.locator('#agentInput').fill('What word did I say?');
  await page.locator('#agentSend').click();
  await expect(page.locator('#agentMsgs')).toContainText('answer-2');
  expect(requests[1].messages.slice(0, 2)).toEqual([{ role: 'user', content: 'Remember my word: orange' }, { role: 'assistant', content: 'answer-1' }]);
  await expect(page.locator('#agentSend')).toBeEnabled();
  await page.locator('#agentNew').click();
  await expect(page.locator('#agentMsgs')).not.toContainText('orange');
  await page.locator('#agentInput').fill('A separate question');
  await page.locator('#agentSend').click();
  await expect(page.locator('#agentMsgs')).toContainText('answer-3');
  expect(requests[2].messages).toHaveLength(1);
  await expect(page.locator('#agentSend')).toBeEnabled();
  await page.locator('#agentRename').click();
  await page.locator('#conversationName').fill('My writing');
  await page.locator('#conversationSave').click();
  await expect(page.locator('#conversationSave')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#agentConversation option:checked')).toHaveText('My writing');
  const earlier = await page.locator('#agentConversation option').allTextContents();
  expect(earlier).toContain('Remember my word: orange');
});

test('会话写入请求成功后事务回滚，运行时仍必须报告失败', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('jh-onboarded','done'));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      const request=put.apply(this,args);
      if(this.name==='platform_conversations' && args[0].id==='abort-test') request.addEventListener('success',()=>this.transaction.abort());
      return request;
    };
    try {
      const succeeded=await window.SeekerRT.db.upsert('platform_conversations',{id:'abort-test',title:'must not succeed'}).then(()=>true,()=>false);
      const stored=await window.SeekerRT.db.get('platform_conversations','abort-test');
      return {succeeded,stored};
    } finally {IDBObjectStore.prototype.put=put;}
  });
  expect(result).toEqual({succeeded:false,stored:null});
});

test('旧项目历史升级后可找回，未完成提问不混进模型上下文', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jh-onboarded', 'done'));
  await page.goto('/');
  await page.evaluate(async () => {
    for (const row of [
      { id:'old1',surface:'agent',role:'user',text:'legacy question',ts:1 },
      { id:'old2',surface:'agent',role:'ai',text:'legacy answer',ts:2 },
      { id:'old3',surface:'agent',role:'user',text:'unfinished question',ts:3 },
    ]) await window.SeekerRT.db.upsert('messages',row);
  });
  await page.reload();
  await expect(page.locator('#agentMsgs')).toContainText('legacy answer');
  await expect(page.locator('#agentMsgs')).toContainText('unfinished question');
  await expect(page.locator('#agentConversation option:checked')).toHaveText('历史对话');
  await page.locator('#agentNew').click();
  await expect(page.locator('#agentMsgs')).not.toContainText('legacy answer');
  await page.locator('#agentConversation').selectOption('legacy_');
  await expect(page.locator('#agentMsgs')).toContainText('legacy answer');
});

test('流中断不保存假成功，重试只发送本次提问', async ({ page }) => {
  const requests=[];
  await page.addInitScript(()=>{localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-democode','test');});
  await page.route('**/api/chat',async route=>{
    requests.push(route.request().postDataJSON());
    await route.fulfill({contentType:'text/event-stream',body:requests.length===1 ? 'data: {"t":"partial"}\n\n' : 'data: {"t":"complete answer"}\n\ndata: {"done":true}\n\n'});
  });
  await page.goto('/');
  await page.locator('#agentInput').fill('Retry me');
  await page.locator('#agentSend').click();
  await page.getByRole('button',{name:'重试这条消息',exact:true}).click();
  await expect(page.locator('#agentMsgs')).toContainText('complete answer');
  await expect(page.locator('#agentSend')).toBeEnabled();
  expect(requests[1].messages).toHaveLength(1);
  const saved=await page.evaluate(()=>window.SeekerRT.db.list('messages'));
  expect(saved.filter(r=>r.role==='ai').map(r=>r.text)).toEqual(['complete answer']);
});
