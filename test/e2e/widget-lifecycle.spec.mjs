import {test,expect} from '@playwright/test';

async function open(page){
  await page.addInitScript(()=>{if(window!==window.top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');localStorage.setItem('jh-theme','light');});
  await page.goto('/');await expect(page.locator('#homeInput')).toBeVisible();
  await page.evaluate(async()=>{
    const NativeChannel=window.MessageChannel;
    window.widgetChannels=[];
    // Observe real ports without exposing the production registry to tests.
    window.MessageChannel=class extends NativeChannel{
      constructor(){
        super();const record={port:this.port1,closed:0};window.widgetChannels.push(record);
        const close=this.port1.close.bind(this.port1),post=this.port1.postMessage.bind(this.port1);
        this.port1.close=()=>{record.closed++;close();};
        this.port1.postMessage=(...args)=>{if(window.holdWidgetSnapshots&&args[0]?.type==='widget-snapshot')return;post(...args);};
      }
    };
    const {renderWidget,requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');
    window.mountTestWidget=async(id,style)=>{
      const container=document.createElement('section');container.id=id;
      const card=renderWidget({id,title:id,html:'<p>可导出的正文</p>'},{style});
      container.append(card);document.body.append(container);
      await requestWidgetSnapshot(card);return window.widgetChannels.length;
    };
  });
}

for(const [name,style,background] of [
  ['跟随主题',{theme:'auto'},'rgb(35, 35, 35)'],
  ['独立样式',{preset:'soft'},'rgb(245, 240, 247)'],
])test(`卡片移除立即关闭端口和等待中的导出，其他卡片不受影响 · ${name}`,async({page})=>{
  await open(page);
  expect(await page.evaluate(style=>window.mountTestWidget('retained',style),style)).toBe(1);
  expect(await page.evaluate(style=>window.mountTestWidget('removed',style),style)).toBe(2);
  const removed=await page.evaluate(async()=>{
    const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');
    const card=document.querySelector('#removed .widget-card');window.removedTestCard=card;
    window.holdWidgetSnapshots=true;
    window.pendingWidgetExport='pending';
    void requestWidgetSnapshot(card).then(()=>window.pendingWidgetExport='resolved',e=>window.pendingWidgetExport=e.message);
    document.querySelector('#removed').remove();
    // MutationObserver cleanup must complete in this turn, without a theme change or an 8 s timeout.
    await new Promise(resolve=>setTimeout(resolve,0));
    return {closed:window.widgetChannels.map(c=>c.closed),pending:window.pendingWidgetExport,handler:window.widgetChannels[1].port.onmessage===null};
  });
  expect(removed.closed).toEqual([0,1]);expect(removed.pending).toContain('组件已关闭');expect(removed.handler).toBe(true);
  expect(await page.evaluate(async()=>{
    const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');
    return Promise.race([requestWidgetSnapshot(window.removedTestCard).then(()=> 'resolved',e=>e.message),new Promise(r=>setTimeout(()=>r('still waiting'),100))]);
  })).toContain('组件已关闭');
  await page.evaluate(()=>{window.holdWidgetSnapshots=false;document.documentElement.dataset.theme='dark';});
  await expect(page.frameLocator('#retained iframe').locator('body')).toHaveCSS('background-color',background);
  expect(await page.evaluate(async()=>{
    const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');
    return (await requestWidgetSnapshot(document.querySelector('#retained .widget-card'))).html;
  })).toContain('可导出的正文');
  expect(await page.evaluate(async()=>{
    document.querySelector('#retained .widget-card').remove();
    await new Promise(resolve=>setTimeout(resolve,0));return window.widgetChannels.map(c=>c.closed);
  })).toEqual([1,1]);
  // Starting again after the last card closes must restore lifecycle and theme observation.
  expect(await page.evaluate(style=>window.mountTestWidget('later',style),style)).toBe(3);
  expect(await page.evaluate(async()=>{document.querySelector('#later').remove();await new Promise(r=>setTimeout(r,0));return window.widgetChannels.map(c=>c.closed);})).toEqual([1,1,1]);
});

test('Widget 重载关闭旧端口并取消旧导出，新通道仍可导出',async({page})=>{
  await open(page);await page.evaluate(()=>window.mountTestWidget('reload',{theme:'auto'}));
  await page.evaluate(async()=>{
    const {requestWidgetSnapshot}=await import('/platform/capability/widgets/render.js');
    window.holdWidgetSnapshots=true;window.pendingWidgetExport='pending';
    void requestWidgetSnapshot(document.querySelector('#reload .widget-card')).then(()=>window.pendingWidgetExport='resolved',e=>window.pendingWidgetExport=e.message);
    const frame=document.querySelector('#reload iframe');frame.srcdoc=frame.srcdoc;
  });
  await expect.poll(()=>page.evaluate(()=>window.widgetChannels.map(c=>c.closed))).toEqual([1,0]);
  expect(await page.evaluate(()=>window.pendingWidgetExport)).toContain('组件已重新加载');
  expect(await page.evaluate(async()=>{
    window.holdWidgetSnapshots=false;
    return (await(await import('/platform/capability/widgets/render.js')).requestWidgetSnapshot(document.querySelector('#reload .widget-card'))).html;
  })).toContain('可导出的正文');
});
