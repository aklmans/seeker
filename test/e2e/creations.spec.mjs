import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function open(page){await page.addInitScript(()=>{if(window!==window.top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');});await page.goto('/');await expect(page.locator('#homeInput')).toBeVisible();}
const draft={id:'cr_fixture',kind:'widget',title:'互动结果',content:{html:'<h1>中文与数值</h1><button onclick="this.textContent=42">计算</button>'},style:{preset:'soft'},source:{type:'chat'},projectId:'',deleted:false};
test('作品手动编辑、风格、复制、移除撤销、历史版本和重启',async({page})=>{
  await open(page);await page.evaluate(()=>{window.SeekerRT.ai.stream=()=>{throw Error('must not call AI')};});
  await page.locator('[data-id="creations"]').click();await page.getByRole('button',{name:'+ 新建知识卡片',exact:true}).click();
  await page.locator('#creationTitle').fill('午后阅读 <script>');await page.locator('#creationText').fill('第一条：需要保存的正文。\n第二条：中文长段落与标点。');
  await page.locator('#creationPreset').selectOption('dark');await page.locator('[data-style="radius"]').fill('18');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('#creationSaveStatus')).toHaveText('已保存到本机');
  await expect(page.frameLocator('#creationPreview iframe').locator('body')).toHaveCSS('background-color','rgb(30, 37, 48)');
  await expect(page.frameLocator('#creationPreview iframe').locator('h1')).toHaveText('午后阅读 <script>');
  const rows=await page.evaluate(()=>window.SeekerRT.db.list('platform_creations'));expect(rows).toHaveLength(1);expect(rows[0].revision).toBe(2);expect(rows[0].style.radius).toBe(18);
  await page.getByRole('button',{name:'复制作品',exact:true}).click();await expect(page.locator('#creationTitle')).toHaveValue('午后阅读 <script> · 副本');
  await page.getByRole('button',{name:'移除作品',exact:true}).click();await page.locator('.toast-undo').last().click();await expect(page.getByRole('button',{name:'移除作品',exact:true})).toBeVisible();
  await page.reload();await page.locator('[data-id="creations"]').click();await page.locator('.creation-list-item').filter({hasText:'午后阅读 <script>'}).filter({hasNotText:'副本'}).click();
  await expect(page.locator('#creationText')).toHaveValue('第一条：需要保存的正文。\n第二条：中文长段落与标点。');await expect(page.locator('#creationPreset')).toHaveValue('dark');
  await page.getByText('修改记录（最近 20 个版本）',{exact:true}).click();await page.getByRole('button',{name:'恢复此版本',exact:true}).click();await expect(page.locator('#creationTitle')).toHaveValue('新知识卡片');
});
test('同时编辑仅一方提交，事务失败不改变记录，完整备份保全而精简导出排除',async({page})=>{
  await open(page);
  const result=await page.evaluate(async d=>{
    const rt=window.SeekerRT;const a=await rt.creations.save(d,0);
    const attempts=await Promise.allSettled(['甲','乙'].map(title=>rt.creations.save({...d,title},1)));
    const before=await rt.db.get('platform_creations',d.id);
    const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const req=put.apply(this,args);if(this.name==='platform_creations')req.addEventListener('success',()=>this.transaction.abort());return req;};
    const failed=await rt.creations.save({...d,title:'不得落盘'},2).then(()=>false,()=>true);IDBObjectStore.prototype.put=put;
    return {a,attempts:attempts.map(r=>r.status),failed,before,after:await rt.db.get('platform_creations',d.id)};
  },draft);
  expect(result.attempts.sort()).toEqual(['fulfilled','rejected']);expect(result.failed).toBe(true);expect(result.after).toEqual(result.before);
  const download=async redact=>{const done=page.waitForEvent('download');await page.evaluate(redact=>window.SeekerRT.db.export(redact),redact);return JSON.parse(await readFile(await (await done).path(),'utf8'));};
  const full=await download(false),reduced=await download(true);expect(full.collections.platform_creations).toHaveLength(1);expect(reduced.collections.platform_creations).toEqual([]);
  await page.evaluate(async b=>{await window.SeekerRT.db.remove('platform_creations','cr_fixture');await window.SeekerRT.db.import(JSON.stringify(b));},full);
  expect(await page.evaluate(()=>window.SeekerRT.db.get('platform_creations','cr_fixture'))).toEqual(result.before);
});
test('生成 Widget 自动保存且历史重开，沙箱和独立风格跨主题保留',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{
    const rt=window.SeekerRT;rt.ai.chatReady=()=>true;
    rt.ai.stream=(_req,h)=>{const done=(async()=>{h.onWidget({id:'w_1',title:'互动结果',html:'<h1>中文与数值</h1><button onclick="this.textContent=42">计算</button>'});h.onToken('这是一件作品');await h.onDone({text:'这是一件作品'});return {text:'这是一件作品'};})();return {done,cancel(){}};};
  });
  await page.locator('#homeInput').fill('做一个计算组件');await page.locator('#homeSend').click();
  await expect(page.locator('#agentCanvasBody')).toContainText('已保存到我的作品');
  const record=(await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0];expect(record.kind).toBe('widget');
  await expect(page.locator('#agentMsgs [data-creation-id]')).toBeVisible();await expect(page.locator('#agentSend')).toBeEnabled();
  await page.reload();await page.getByRole('button',{name:'打开对话',exact:true}).click();
  await page.locator('#agentMsgs [data-creation-id]').click();await expect(page.locator('#creationTitle')).toHaveValue('互动结果');
  const iframe=page.locator('#creationPreview iframe');await expect(iframe).toHaveAttribute('sandbox','allow-scripts');
  const frame=page.frameLocator('#creationPreview iframe');await frame.getByRole('button',{name:'计算'}).click();await expect(frame.getByRole('button',{name:'42'})).toBeVisible();
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await expect(frame.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
});
test('保存进行中锁定表单，失败保留用户草稿且不报告成功',async({page})=>{
  await open(page);await page.evaluate(async d=>{await window.SeekerRT.creations.save(d,0);await(await import('/platform/creations/page.js')).openCreation(d.id);},draft);
  await page.locator('#creationTitle').fill('不应丢失的草稿');
  await page.evaluate(()=>{window.SeekerRT.creations.save=()=>new Promise((_,reject)=>{window.rejectCreationSave=reject;});});
  await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('#creationTitle')).toBeDisabled();
  await page.evaluate(()=>window.rejectCreationSave(Error('磁盘不可写')));await expect(page.locator('#creationTitle')).toBeEnabled();await expect(page.locator('#creationTitle')).toHaveValue('不应丢失的草稿');await expect(page.locator('#creationSaveStatus')).toHaveText('有未保存的修改');
});

test('当前交互状态与长中文内容导出 PNG/PDF，快照不获得脚本和网络权限',async({page})=>{
  await open(page);
  await page.evaluate(async d=>{d.content.html='<h1>中文阅读清单</h1><button onclick="this.textContent=42">计算</button><input value="旧值"><div style="height:100px;overflow:auto">'+Array.from({length:30},(_,i)=>'<p>第 '+i+' 条：需要完整呈现的中文长段落，不应在末尾裁切。</p>').join('')+'</div>';await window.SeekerRT.creations.save(d,0);await(await import('/platform/creations/page.js')).openCreation(d.id);},draft);
  const frame=page.frameLocator('#creationPreview iframe');await frame.getByRole('button',{name:'计算'}).click();await frame.locator('input').fill('当前输入');
  const snapshot=await page.evaluate(async()=>{const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');return requestWidgetSnapshot(document.querySelector('#creationPreview .widget-card'));});
  expect(snapshot.html).toContain('>42</button>');expect(snapshot.html).toContain('value="当前输入"');expect(snapshot.html).toContain('第 29 条');
  await page.getByRole('button',{name:'导出 / 分享',exact:true}).click();await expect(page.locator('#creationExportImage')).toBeVisible({timeout:15000});
  const dimensions=await page.locator('#creationExportImage').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));expect(dimensions.height).toBeGreaterThan(1800);
  const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'保存 PNG',exact:true}).click();const png=await readFile(await(await pngDownload).path());expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(png.readUInt32BE(20)).toBe(dimensions.height);
  const pdfDownload=page.waitForEvent('download');await page.getByRole('button',{name:'保存 PDF',exact:true}).click();const pdf=await readFile(await(await pdfDownload).path());expect(pdf.subarray(0,8).toString()).toBe('%PDF-1.4');expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  await page.locator('.modal .x').click();await expect(frame.getByRole('button',{name:'42'})).toBeVisible();await expect(frame.locator('input')).toHaveValue('当前输入');
  const attempted=[];page.on('request',req=>{if(req.url().includes('evil.invalid'))attempted.push(req.url());});
  const safe=await page.evaluate(async()=>{window.exportEscaped=false;const {captureSnapshot}=await import('/platform/creations/export.js');const result=await captureSnapshot({html:'<script>parent.exportEscaped=true;fetch("https://evil.invalid")</script><meta http-equiv="refresh" content="0;url=https://evil.invalid"><h1>Safe preview</h1><img src="https://evil.invalid/image" onerror="parent.exportEscaped=true">',width:500});return {escaped:window.exportEscaped,width:result.width};});
  expect(safe.escaped).toBe(false);expect(safe.width).toBe(1000);expect(attempted).toEqual([]);
});
