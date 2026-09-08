import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function open(page){await page.addInitScript(()=>{if(window!==window.top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');});await page.goto('/');await page.locator('[data-id="creations"]').click();await page.getByRole('button',{name:'+ 新建思维导图',exact:true}).click();await page.locator('#mindCreateTitle').fill('准备一次旅行');await page.locator('#mindCreateText').fill('- 行前\n  - 检查证件\n- 行程\n  - 预订住宿');await page.locator('#mindCreateSave').click();await expect(page.locator('[data-mind-canvas]')).toBeVisible();}
test('手动导图编辑、拖动、折叠、视图和样式保留，Markdown 包含折叠内容',async({page})=>{
  await open(page);await expect(page.locator('[data-mind-canvas] [data-mind-node]')).toHaveCount(5);
  await page.locator('[data-mind-node][aria-label="行前"]').click();await page.locator('[data-mind-text]').fill('出发之前');
  await page.locator('[data-mind-add="child"]').click();await page.locator('[data-mind-text]').fill('检查天气');
  await page.locator('[data-mind-node][aria-label="检查天气"]').dragTo(page.locator('[data-mind-node][aria-label="行程"]'));
  await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('#creationSaveStatus')).toHaveText('已保存到本机');
  let row=(await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0];expect(row.content.root.children[1].children.map(n=>n.text)).toContain('检查天气');expect(row.content.root.children[0].text).toBe('出发之前');
  await page.locator('[data-mind-node][aria-label="行程"]').click();await page.locator('[data-mind-fold]').click();await expect(page.locator('[data-mind-canvas] [data-mind-node]')).toHaveCount(4);
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Markdown 大纲',exact:true}).click();const text=await readFile(await(await downloaded).path(),'utf8');expect(text).toContain('  - 检查天气');expect(text).toContain('  - 预订住宿');
  const svgDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出 SVG',exact:true}).click();const svg=await readFile(await(await svgDownload).path(),'utf8');expect(svg).toContain('<svg xmlns=');expect(svg).not.toContain('<script');expect(svg).toContain('出发之前');
  await page.locator('[data-mind-view]').selectOption('outline');await expect(page.locator('.mind-outline')).toBeVisible();await page.locator('#creationPreset').selectOption('soft');await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.locator('#creationSaveStatus')).toHaveText('已保存到本机');await page.reload();await page.locator('[data-id="creations"]').click();await page.locator('.creation-list-item').click();await expect(page.locator('[data-mind-view]')).toHaveValue('outline');await expect(page.locator('#creationPreset')).toHaveValue('soft');
  await page.locator('[data-mind-view]').selectOption('tree');await expect(page.locator('[data-mind-canvas] svg')).toBeVisible();
  await page.getByRole('button',{name:'导出 / 分享',exact:true}).click();await expect(page.locator('#creationExportImage')).toBeVisible({timeout:15000});const dimensions=await page.locator('#creationExportImage').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));expect(dimensions.width).toBeGreaterThan(500);expect(dimensions.height).toBeGreaterThan(100);
});

test('从笔记创建只发送选中正文，AI 扩展需审阅且仅改变选中分支',async({page})=>{
  await page.addInitScript(()=>{if(window!==top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');});await page.goto('/');
  await page.evaluate(async()=>{
    const rt=window.SeekerRT,available=rt.available;rt.available=f=>f==='textGeneration'||available(f);window.mindRequests=[];
    const outputs=[{text:'阅读计划',children:[{text:'读之前',children:[]},{text:'读之后私有细节',children:[]}]},{text:'建议',children:[{text:'先列出问题',children:[]},{text:'记录预期',children:[]}]}];
    rt.ai.generate=req=>{window.mindRequests.push(req);return {done:Promise.resolve({text:JSON.stringify(outputs.shift()),stopReason:'stop'}),cancel(){}};};
    await window.SeekerShell.saveNote({title:'选中的阅读笔记',text:'先提问，再阅读，最后复盘。'});await window.SeekerShell.saveNote({title:'另一条私有笔记',text:'OTHER_NOTE_SHOULD_NOT_LEAVE'});
  });
  await page.locator('[data-id="notes"]').click();await page.locator('[data-note]').filter({hasText:'选中的阅读笔记'}).getByRole('button',{name:'创建思维导图',exact:true}).click();await expect(page.locator('#mindCreateText')).toHaveValue('先提问，再阅读，最后复盘。');await page.locator('#mindCreateAI').click();await expect(page.locator('[data-mind-canvas]')).toBeVisible();
  const first=(await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0];expect(first.source.type).toBe('note');expect((await page.evaluate(()=>window.mindRequests))[0].untrusted).not.toContain('OTHER_NOTE_SHOULD_NOT_LEAVE');
  await page.locator('[data-mind-node][aria-label="读之前"]').click();await page.locator('[data-mind-ai="expand"]').click();await expect(page.locator('#mindAIApply')).toBeEnabled();await expect(page.locator('[data-mind-canvas] [data-mind-node]')).toHaveCount(3);
  const reqs=await page.evaluate(()=>window.mindRequests);expect(reqs[1].untrusted).toContain('读之前');expect(reqs[1].untrusted).not.toContain('读之后私有细节');
  await page.locator('#mindAIApply').click();await expect(page.locator('[data-mind-canvas] [data-mind-node]')).toHaveCount(5);expect((await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0].revision).toBe(1);
  await page.getByRole('button',{name:'保存修改',exact:true}).click();const final=(await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0];expect(final.content.root.children[1]).toEqual(first.content.root.children[1]);expect(final.content.root.children[0].children).toHaveLength(2);
});
test('分支删除可撤销、空节点不能保存、保存后根节点仍不可删除',async({page})=>{
  await open(page);await page.locator('[data-mind-node][aria-label="行前"]').click();await page.locator('[data-mind-remove]').click();await expect(page.locator('[data-mind-canvas] [data-mind-node]')).toHaveCount(3);await page.locator('[data-mind-undo]').click();await expect(page.locator('[data-mind-canvas] [data-mind-node]')).toHaveCount(5);
  await page.locator('[data-mind-text]').fill('');await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('.toast').last()).toContainText('节点文字不能为空');expect((await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0].revision).toBe(1);
  await page.locator('[data-mind-text]').fill('修改中心主题');await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('#creationSaveStatus')).toHaveText('已保存到本机');await expect(page.locator('[data-mind-remove]')).toBeDisabled();
});

test('AI 取消与无效结果不修改导图，预览过期也不能覆盖新编辑',async({page})=>{
  await open(page);await page.evaluate(async()=>{const rt=window.SeekerRT,available=rt.available;rt.available=f=>f==='textGeneration'||available(f);await(await import('/platform/creations/page.js')).openCreation((await rt.db.list('platform_creations'))[0].id);});
  await page.evaluate(()=>{window.mindCancelled=false;window.SeekerRT.ai.generate=()=>({done:new Promise(resolve=>window.resolveMind=resolve),cancel(){window.mindCancelled=true;}});});
  await page.locator('[data-mind-ai="shorten"]').click();await page.locator('#mindAICancel').click();expect(await page.evaluate(()=>window.mindCancelled)).toBe(true);await page.evaluate(()=>window.resolveMind({text:'{"text":"不得应用","children":[]}',stopReason:'stop'}));await expect(page.locator('[data-mind-text]')).toHaveValue('准备一次旅行');
  await page.evaluate(()=>{window.SeekerRT.ai.generate=()=>({done:Promise.resolve({text:'{"text":"缺少子节点"}',stopReason:'stop'}),cancel(){}});});await page.locator('[data-mind-ai="shorten"]').click();await expect(page.locator('#mindAIStatus')).toContainText('导图结构无效');await expect(page.locator('#mindAIApply')).toBeDisabled();await page.locator('#mindAICancel').click();
  await page.evaluate(()=>{window.SeekerRT.ai.generate=()=>({done:Promise.resolve({text:'{"text":"精简主题","children":[]}',stopReason:'stop'}),cancel(){}});});await page.locator('[data-mind-ai="shorten"]').click();await expect(page.locator('#mindAIApply')).toBeEnabled();
  await page.locator('[data-mind-text]').evaluate(el=>{el.value='预览后产生的新编辑';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#mindAIApply').click();await expect(page.locator('#mindAIStatus')).toContainText('导图已有修改');await expect(page.locator('[data-mind-text]')).toHaveValue('预览后产生的新编辑');expect((await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0].revision).toBe(1);
});

test('回答入口只带入这一条回答，手动创建不调用模型',async({page})=>{
  await page.addInitScript(()=>{if(window!==top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');});await page.goto('/');
  await page.evaluate(()=>{const rt=window.SeekerRT;rt.ai.chatReady=()=>true;rt.ai.stream=(_req,h)=>{const done=(async()=>{h.onToken('先列清单，再安排行程。');await h.onDone({text:'先列清单，再安排行程。'});return {text:'先列清单，再安排行程。'};})();return {done,cancel(){}};};rt.ai.generate=()=>{throw Error('Manual create must not use AI');};});
  await page.locator('#homeInput').fill('怎么准备出行');await page.locator('#homeSend').click();await page.getByRole('button',{name:'整理成思维导图',exact:true}).click();await expect(page.locator('#mindCreateText')).toHaveValue('先列清单，再安排行程。');await page.locator('#mindCreateSave').click();await expect(page.locator('[data-mind-canvas]')).toBeVisible();const row=(await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0];expect(row.source.type).toBe('answer');expect(row.content.root.children[0].text).toBe('先列清单，再安排行程。');
});
