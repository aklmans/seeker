import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function open(page){
  await page.addInitScript(()=>{if(window!==window.top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');localStorage.setItem('jh-theme','light');});
  await page.goto('/');await expect(page.locator('#homeInput')).toBeVisible();
}
const html='<h2>价格实验</h2><div class="sw-layout"><section class="sw-chart"><svg viewBox="0 0 200 120" aria-label="价格图"><path d="M10 100L190 10" stroke="var(--chart-1)"/></svg></section><section class="sw-controls"><label class="sw-field" for="price">价格 <output id="value">50</output><input id="price" type="range" min="0" max="100" value="50"></label><button id="reset">恢复初始参数</button></section></div><script>const input=document.getElementById("price"),value=document.getElementById("value");input.oninput=()=>value.textContent=input.value;document.getElementById("reset").onclick=()=>{input.value=50;input.oninput()};window.addEventListener("seeker:themechange",()=>document.body.dataset.themeEvent="yes");</script>';

test('新 Widget 跟随主题且不重置交互，保存重开、快照和显式独立样式均有效',async({page})=>{
  await open(page);
  const id=await page.evaluate(async html=>{const {renderAndSaveWidget}=await import('/platform/creations/chat.js');const result=renderAndSaveWidget({id:'w_theme',title:'价格实验',html},{});document.body.appendChild(result.card);return result.saved;},html);
  const frame=page.frameLocator('.widget-card iframe');
  await expect(frame.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await frame.locator('#price').fill('72');await expect(frame.locator('#value')).toHaveText('72');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await expect(frame.locator('body')).toHaveCSS('background-color','rgb(35, 35, 35)');
  await expect(frame.locator('html')).toHaveCSS('color-scheme','dark');
  await expect(frame.locator('body')).toHaveAttribute('data-theme-event','yes');
  await expect(frame.locator('#value')).toHaveText('72');
  const snapshot=await page.evaluate(async()=>{const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');return requestWidgetSnapshot(document.querySelector('.widget-card'));});
  // Render the captured styles, proving hot theme values survive the cascade on export.
  await page.evaluate(html=>{const f=document.createElement('iframe');f.id='snapshotCheck';f.sandbox='';f.srcdoc=html;document.body.appendChild(f);},snapshot.html);
  await expect(page.frameLocator('#snapshotCheck').locator('body')).toHaveCSS('background-color','rgb(35, 35, 35)');
  await page.reload();await page.evaluate(async id=>(await import('/platform/creations/page.js')).openCreation(id),id);
  await expect(page.locator('#creationPreset')).toHaveValue('auto');
  await page.locator('#creationPreset').selectOption('soft');await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.locator('#creationSaveStatus')).toHaveText('已保存到本机');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await expect(page.frameLocator('#creationPreview iframe').locator('body')).toHaveCSS('background-color','rgb(245, 240, 247)');
  await page.locator('#creationPreset').selectOption('auto');await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.locator('#creationSaveStatus')).toHaveText('已保存到本机');
  await expect(page.frameLocator('#creationPreview iframe').locator('body')).toHaveCSS('background-color','rgb(35, 35, 35)');
});

test('无头 HTML 采用统一控件、响应布局和可见键盘焦点',async({page})=>{
  await open(page);
  await page.evaluate(async html=>{const {renderWidget}=await import('/platform/capability/widgets/render.js');const card=renderWidget({id:'w_controls',html,title:'控件'});card.style.maxWidth='100%';document.body.appendChild(card);},html);
  const frame=page.frameLocator('.widget-card iframe');
  await expect(frame.locator('button')).toHaveCSS('min-height','36px');
  await expect(frame.locator('input')).toHaveCSS('padding-left','0px');
  await frame.locator('input').focus();await frame.locator('input').press('ArrowRight');await expect(frame.locator('#value')).toHaveText('51');
  await expect(frame.locator('input')).toHaveCSS('outline-style','solid');
  await page.setViewportSize({width:540,height:800});
  await expect(frame.locator('.sw-layout')).toHaveCSS('display','grid');
  expect(await frame.locator('body').evaluate(b=>b.scrollWidth<=b.ownerDocument.documentElement.clientWidth)).toBe(true);
  await frame.getByRole('button',{name:'恢复初始参数'}).click();await expect(frame.locator('#value')).toHaveText('50');
});

test('供需图初始绘制、边界计算、主题配色与重置可复现',async({page})=>{
  await open(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const source=await readFile(new URL('./fixtures/supply-demand.html',import.meta.url),'utf8');
  await page.evaluate(async html=>{const {renderWidget}=await import('/platform/capability/widgets/render.js');document.body.appendChild(renderWidget({id:'w_economics',html,title:'供需实验'}));},source);
  const frame=page.frameLocator('.widget-card iframe');
  await expect(frame.locator('[data-curve]')).toHaveCount(2);await expect(frame.locator('#peq')).toHaveText('50.0');
  await frame.getByLabel('当前价格').fill('80');await expect(frame.locator('#qd')).toHaveText('20.0');await expect(frame.locator('#qs')).toHaveText('80.0');await expect(frame.locator('#status')).toContainText('过剩');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await expect(frame.locator('[data-curve=demand]')).toHaveCSS('stroke','rgb(136, 175, 196)');
  await frame.getByLabel('需求变化',{exact:false}).fill('30');await frame.getByLabel('供给变化',{exact:false}).fill('-20');await frame.getByLabel('需求价格敏感度').fill('6');await frame.getByLabel('供给价格敏感度').fill('6');
  await expect(frame.locator('#peq')).toHaveText('125.0');await expect(frame.locator('#qeq')).toHaveText('55.0');
  await frame.getByRole('button',{name:'恢复初始参数'}).click();await expect(frame.locator('#peq')).toHaveText('50.0');await expect(frame.locator('#pv')).toHaveText('50');
  await expect(page.locator('.widget-error')).toHaveCount(0);expect(errors).toEqual([]);
});

test('脚本错误有可诊断的恢复入口且不突破沙箱',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{const {renderWidget}=await import('/platform/capability/widgets/render.js');document.body.appendChild(renderWidget({id:'w_error',html:'<p>仍可阅读</p><script>const Y=v=10-v;</script>',title:'错误例'}));});
  await expect(page.locator('.widget-error')).toContainText('部分内容未能显示');
  // WebKit intentionally redacts details for scripts in an opaque origin.
  await page.getByText('错误详情',{exact:true}).click();await expect(page.locator('.widget-error pre')).toContainText(/v|Script error/);
  await expect(page.locator('.widget-card iframe')).toHaveAttribute('sandbox','allow-scripts');
  await page.getByRole('button',{name:'重新加载（重置交互）'}).click();await expect(page.locator('.widget-error')).toHaveCount(1);
  await expect(page.frameLocator('.widget-card iframe').getByText('仍可阅读')).toBeVisible();
});

test('主题 SVG 曲线和滑块当前状态进入真实 PNG 导出',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{const {renderWidget}=await import('/platform/capability/widgets/render.js');document.body.appendChild(renderWidget({id:'w_export',title:'导出',html:'<svg width="300" height="180" viewBox="0 0 300 180"><path d="M20 150L280 20" stroke="var(--chart-1)" stroke-width="5" fill="none"/></svg><label for="r">价格</label><input id="r" type="range" min="0" max="100" value="80">'}));});
  await expect(page.frameLocator('.widget-card iframe').locator('svg path')).toBeVisible();
  const result=await page.evaluate(async()=>{
    const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js'),{captureSnapshot}=await import('/platform/creations/export.js');
    const snapshot=await requestWidgetSnapshot(document.querySelector('.widget-card')),capture=await captureSnapshot(snapshot);
    const img=new Image();img.src=capture.png;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    const pixels=ctx.getImageData(0,0,Math.min(650,img.width),Math.min(400,img.height)).data;let blue=0;
    for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-71)<5&&Math.abs(pixels[i+1]-110)<5&&Math.abs(pixels[i+2]-135)<5)blue++;
    return {blue,html:snapshot.html};
  });
  expect(result.blue).toBeGreaterThan(1000);
  expect(result.html).toContain('data-widget-range="80"');
});

test('导出只保留当前展开的说明，折叠正文不会出现在快照中',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{const {renderWidget}=await import('/platform/capability/widgets/render.js');document.body.appendChild(renderWidget({id:'w_details',title:'说明',html:'<details><summary>计算说明</summary><p>ONLY_WHEN_OPEN</p></details>'}));});
  const snapshot=()=>page.evaluate(async()=>{const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');return requestWidgetSnapshot(document.querySelector('.widget-card'));});
  await expect(page.frameLocator('.widget-card iframe').getByText('计算说明')).toBeVisible();
  expect((await snapshot()).html).not.toContain('ONLY_WHEN_OPEN');
  await page.frameLocator('.widget-card iframe').getByText('计算说明').click();expect((await snapshot()).html).toContain('ONLY_WHEN_OPEN');
});
