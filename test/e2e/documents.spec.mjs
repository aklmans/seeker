import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function prepare(page,mock=false){
  await page.addInitScript(()=>localStorage.setItem('jh-onboarded','done'));
  await page.goto('/');
  await page.evaluate(async mock=>{
    const source={id:'ld_source',name:'产品资料.txt',format:'txt',size:47,sourceHash:'a'.repeat(64),updated:10,characters:19,fragments:[{id:'f1',text:'方案价格为 120 元，五月开始试用。',page:null}],warnings:[],sourceDataBase64:'c291cmNl'};
    await window.SeekerRT.db.upsert('assets_documents',source);
    await window.SeekerRT.db.upsert('assets_notes',{id:'unselected',text:'PRIVATE UNSELECTED MATERIAL',updated:1});
    if(mock){
      const available=window.SeekerRT.available;window.SeekerRT.available=f=>f==='fileReading'||available(f);
      window.documentRequests=[];
      window.SeekerRT.library.answer=(...args)=>{
        window.documentRequests.push(args);
        if(window.failDocument)return {cancel(){},done:Promise.reject(new Error('引用校验失败 fixture'))};
        if(window.holdDocument){let reject;return {cancel(){reject(new Error('已取消'));},done:new Promise((_,r)=>{reject=r;})};}
        if(window.insufficientDocument)return {cancel(){},done:Promise.resolve({answer:'未找到负责人。',insufficient:true,references:[]})};
        return {cancel(){},done:Promise.resolve({answer:'价格为 120 元。',insufficient:false,references:[{fragmentId:'f1',quote:'价格为 120 元'}]})};
      };
    }
    await (await import('/apps/assets/documents.js')).loadDocuments();
  },mock);
  await page.locator('.nav-item[data-id="notes"]').click();
  await page.locator('[data-library-tab="files"]').click();
}

test('Web shows restored source text, disables desktop actions, and exports complete source Markdown',async({page})=>{
  await prepare(page);
  await expect(page.locator('#fileImport')).toBeDisabled();
  await page.locator('[data-file-open]').click();
  await expect(page.locator('#page-libraryfile')).toBeVisible();
  await expect(page.locator('#fileOriginal')).toContainText('方案价格为 120 元，五月开始试用。');
  await expect(page.locator('#fileAsk')).toBeDisabled();
  await expect(page.locator('#fileSummary')).toBeDisabled();
  const event=page.waitForEvent('download');await page.locator('#fileExportText').click();
  expect(await readFile(await (await event).path(),'utf8')).toContain('方案价格为 120 元，五月开始试用。');
  await page.locator('#fileCreateMind').click();await expect(page.locator('#mindCreateText')).toHaveValue('方案价格为 120 元，五月开始试用。');await page.locator('#mindCreateSave').click();await expect(page.locator('[data-mind-canvas]')).toBeVisible();const creation=(await page.evaluate(()=>window.SeekerRT.db.list('platform_creations')))[0];expect(creation.source).toMatchObject({type:'file',id:'ld_source'});expect(creation.content.root.children[0].text).toBe('方案价格为 120 元，五月开始试用。');
  await page.reload();await page.locator('.nav-item[data-id="notes"]').click();await page.locator('[data-library-tab="files"]').click();
  await expect(page.locator('[data-document]')).toContainText('产品资料.txt');
});

test('selected-document request, source jump, explicit save, retry and cancellation keep the question',async({page})=>{
  await prepare(page,true);await page.locator('[data-file-open]').click();
  await page.locator('#fileQuestion').fill('价格是多少？');await page.locator('#fileAsk').click();
  await expect(page.locator('#fileAnswer')).toContainText('价格为 120 元。');
  expect(await page.evaluate(()=>window.documentRequests[0])).toEqual(['ld_source','question','价格是多少？']);
  await page.locator('[data-reference]').click();await expect(page.locator('#fileOriginal mark')).toHaveText('价格为 120 元');
  await page.locator('#fileSaveAnswer').click();await expect(page.locator('#toasts')).toContainText('已保存到资料库');
  const notes=await page.evaluate(()=>window.SeekerRT.db.list('assets_notes'));
  expect(notes.find(n=>n.id!=='unselected').text).toContain('[f1]\n> 价格为 120 元');
  await page.evaluate(()=>{window.failDocument=true;});await page.locator('#fileAsk').click();
  await expect(page.locator('#fileAnswer')).toContainText('引用校验失败');await expect(page.locator('#fileSaveAnswer')).toHaveCount(0);
  await expect(page.locator('#fileQuestion')).toHaveValue('价格是多少？');
  await page.evaluate(()=>{window.failDocument=false;window.holdDocument=true;});await page.locator('#fileRetry').click();
  await page.locator('#fileCancel').click();await expect(page.locator('#fileAnswer')).toContainText('已取消');
  await expect(page.locator('#fileQuestion')).toHaveValue('价格是多少？');await expect(page.locator('#fileSaveAnswer')).toHaveCount(0);
  await page.evaluate(()=>{window.holdDocument=false;window.insufficientDocument=true;});await page.locator('#fileRetry').click();
  await expect(page.locator('#fileAnswer')).toContainText('这份资料没有足够信息');await expect(page.locator('[data-reference]')).toHaveCount(0);
});

test('document copies survive full backup and undo, and are excluded from redacted exports',async({page})=>{
  await prepare(page);
  const bundle=async redact=>{const event=page.waitForEvent('download');await page.evaluate(r=>window.SeekerRT.db.export(r),redact);return JSON.parse(await readFile(await (await event).path(),'utf8'));};
  const full=await bundle(false),redacted=await bundle(true);
  expect(full.collections.assets_documents[0].sourceDataBase64).toBe('c291cmNl');
  expect(redacted.collections.assets_documents).toEqual([]);
  await page.locator('[data-file-delete]').click();await expect(page.locator('[data-document]')).toHaveCount(0);
  await page.locator('.toast-undo').click();await expect(page.locator('[data-document]')).toHaveCount(1);
  expect(await page.evaluate(()=>window.SeekerRT.db.get('assets_documents','ld_source'))).toEqual(full.collections.assets_documents[0]);
});
