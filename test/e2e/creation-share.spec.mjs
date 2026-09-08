import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function open(page,html='<h1>阅读安排</h1><p>三天读完一本书。</p>'){
  await page.addInitScript(()=>{if(window!==top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');});await page.goto('/');
  await page.evaluate(async html=>{await window.SeekerRT.creations.save({id:'cr_share',kind:'widget',title:'阅读分享',content:{html},style:{preset:'soft'},source:{type:'note',title:'我的阅读笔记'},projectId:'',deleted:false},0);await(await import('/platform/creations/page.js')).openCreation('cr_share');},html);
}
test('图片横竖比例和可选附加文字生成真实 PNG，快速切换不会导出旧预览',async({page})=>{
  await open(page);await page.getByRole('button',{name:'导出 / 分享',exact:true}).click();await expect(page.locator('#creationExportImage')).toBeVisible({timeout:15000});await expect(page.locator('#creationExportByline')).toHaveValue('');await expect(page.locator('#creationExportSource')).toHaveValue('我的阅读笔记');await expect(page.locator('#creationExportShowSource')).not.toBeChecked();
  await page.locator('#creationExportRatio').selectOption('wide');await page.locator('#creationExportShowTitle').check();await page.locator('#creationExportTitle').fill('一个周末的阅读计划');await page.locator('#creationExportShowSource').check();await page.locator('#creationExportShowByline').check();await page.locator('#creationExportByline').fill('小林');await expect(page.locator('#creationExportStatus')).toHaveText('1600 × 900 px');
  expect(await page.locator('.creation-export-canvas').evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 PNG',exact:true}).click();const png=await readFile(await(await download).path());expect(png.readUInt32BE(16)).toBe(1600);expect(png.readUInt32BE(20)).toBe(900);
  await page.locator('#creationExportRatio').selectOption('story');await page.locator('#creationExportRatio').selectOption('square');await expect(page.locator('#creationExportStatus')).toHaveText('1600 × 1600 px');expect(await page.locator('#creationExportImage').evaluate(img=>img.naturalHeight)).toBe(1600);
});
test('下载的离线 HTML 保留交互，来源/署名按选择输出，无法触及父页或外网',async({page,context})=>{
  await open(page,'<button id="counter" onclick="this.textContent=42">计算</button><span id="guard"></span><script>try{parent.document.body.dataset.escaped="yes"}catch(e){document.getElementById("guard").textContent="隔离运行"}fetch("https://evil.invalid/data").catch(()=>{});</script><iframe src="https://evil.invalid/frame"></iframe>');
  await page.getByRole('button',{name:'导出 / 分享',exact:true}).click();await page.locator('#creationExportShowByline').check();await page.locator('#creationExportByline').fill('小林');const event=page.waitForEvent('download');await page.getByRole('button',{name:'保存离线交互 HTML',exact:true}).click();const html=await readFile(await(await event).path(),'utf8');expect(html).toContain('小林');expect(html).not.toContain('我的阅读笔记');
  const viewer=await context.newPage(),attempts=[];viewer.on('request',r=>{if(r.url().includes('evil.invalid'))attempts.push(r.url());});await viewer.route('**/offline-fixture.html',route=>route.fulfill({status:200,contentType:'text/html',body:html}));await viewer.goto('/offline-fixture.html');
  const frame=viewer.frameLocator('body > iframe');await expect(frame.locator('#guard')).toHaveText('隔离运行');await frame.getByRole('button',{name:'计算'}).click();await expect(frame.getByRole('button',{name:'42'})).toBeVisible();expect(await viewer.evaluate(()=>document.body.dataset.escaped)).toBeUndefined();expect(await viewer.locator('body > iframe').getAttribute('sandbox')).toBe('allow-scripts');expect(attempts).toEqual([]);
  await viewer.reload();await expect(frame.getByRole('button',{name:'计算'})).toBeVisible();await viewer.close();
});
test('刚输入的新正文立即导出时必须包含最新长内容',async({page})=>{
  await open(page);await page.evaluate(async()=>{await window.SeekerRT.creations.save({id:'cr_latest',kind:'card',title:'最新草稿',content:{text:'短正文'},style:{},source:{},projectId:'',deleted:false},0);await(await import('/platform/creations/page.js')).openCreation('cr_latest');});
  await expect(page.frameLocator('#creationPreview iframe').locator('article')).toContainText('短正文');
  await page.evaluate(()=>{const input=document.querySelector('#creationText');input.value=Array.from({length:40},(_,i)=>'第 '+i+' 行：刚刚输入的新正文必须完整导出。').join('\n');input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('#creationActions button')].find(b=>b.textContent==='导出 / 分享').click();});
  await expect(page.locator('#creationExportImage')).toBeVisible({timeout:15000});expect(await page.locator('#creationExportImage').evaluate(img=>img.naturalHeight)).toBeGreaterThan(1800);
});
test('英文窄窗口保留分享选项与作品内容',async({page})=>{
  await page.setViewportSize({width:780,height:900});await open(page);await page.getByRole('button',{name:'中',exact:true}).click();await page.getByRole('button',{name:'Export / Share',exact:true}).click();await expect(page.getByRole('combobox',{name:'Image ratio',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Byline text',exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'Save interactive HTML',exact:true})).toBeVisible();await expect(page.locator('#creationExportImage')).toBeVisible({timeout:15000});expect(await page.locator('.modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
test('作品弹窗表单保留内边距、统一控件高度，长预览不挤出导出按钮',async({page})=>{
  await page.setViewportSize({width:1280,height:900});await open(page,Array.from({length:40},(_,i)=>'<p>第 '+i+' 行阅读笔记，保留长内容。</p>').join(''));
  await page.getByRole('button',{name:'导出 / 分享',exact:true}).click();await expect(page.locator('#creationExportImage')).toBeVisible({timeout:15000});
  const modal=await page.locator('.modal').boundingBox(),ratio=await page.locator('#creationExportRatio').boundingBox(),title=await page.locator('#creationExportTitle').boundingBox();
  expect(ratio.x-modal.x).toBeGreaterThanOrEqual(20);expect(ratio.height).toBeGreaterThanOrEqual(38);expect(Math.abs(ratio.height-title.height)).toBeLessThanOrEqual(2);
  const save=await page.getByRole('button',{name:'保存 PNG',exact:true}).boundingBox();expect(save.y+save.height).toBeLessThanOrEqual(900);
  await expect(page.locator('#creationExportTitle')).toBeDisabled();await page.locator('#creationExportShowTitle').check();await expect(page.locator('#creationExportTitle')).toBeEnabled();
  await page.locator('.modal .x').click();await page.getByRole('button',{name:'保存到我的样式',exact:true}).click();await page.locator('#personalStyleName').fill('纸上阅读');
  const padding=await page.locator('#personalStyleName').evaluate(el=>{const field=el.getBoundingClientRect(),modal=el.closest('.modal').getBoundingClientRect();return {left:field.left-modal.left,right:modal.right-field.right};});expect(padding.left).toBeGreaterThanOrEqual(20);expect(padding.right).toBeGreaterThanOrEqual(20);
});
