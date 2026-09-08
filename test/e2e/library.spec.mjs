import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openLibrary(page) {
  await page.addInitScript(() => localStorage.setItem('jh-onboarded', 'done'));
  await page.goto('/');
  await page.locator('.nav-item[data-id="notes"]').click();
}

test('普通保存笔记即使配置了 AI 也只保存本地', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(() => {
    window.__TAURI__ = {};
    window.enrichCalls = 0;
    window.SeekerRT.ai.extract = async () => { window.enrichCalls++; return '{"title":"AI changed"}'; };
  });
  await page.locator('#anAdd').click();
  await page.locator('#anText').fill('private local note');
  await page.locator('#anSave').click();
  await expect(page.locator('#anSave')).toHaveCount(0);
  expect(await page.evaluate(() => window.enrichCalls)).toBe(0);
  await page.reload();
  await page.locator('.nav-item[data-id="notes"]').click();
  await expect(page.locator('#page-notes')).toContainText('private local note');
});

test('笔记保存失败时保留编辑内容，界面不报告成功', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(() => {
    const upsert = window.SeekerRT.db.upsert;
    window.SeekerRT.db.upsert = (c, r) => c === 'assets_notes' ? Promise.reject(new Error('disk full test')) : upsert(c, r);
  });
  await page.locator('#anAdd').click();
  await page.locator('#anText').fill('unsaved content');
  await page.locator('#anSave').click();
  await expect(page.locator('#anText')).toHaveValue('unsaved content');
  await expect(page.locator('#toasts')).toContainText('disk full test');
  expect(await page.evaluate(() => window.SeekerRT.db.list('assets_notes'))).toEqual([]);
});

test('删除事务回滚必须拒绝，笔记仍存在', async ({ page }) => {
  await openLibrary(page);
  const result = await page.evaluate(async () => {
    await window.SeekerRT.db.upsert('assets_notes', { id: 'abort-delete', text: 'keep me', updated: 1 });
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (id) {
      const request = del.call(this, id);
      if (this.name === 'assets_notes' && id === 'abort-delete') request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
    try {
      const succeeded = await window.SeekerRT.db.remove('assets_notes', 'abort-delete').then(() => true, () => false);
      return { succeeded, stored: await window.SeekerRT.db.get('assets_notes', 'abort-delete') };
    } finally { IDBObjectStore.prototype.delete = del; }
  });
  expect(result.succeeded).toBe(false);
  expect(result.stored.text).toBe('keep me');
});

test('无模型时资料库创建、筛选、编辑、导出、删除撤销与重启保留均可用', async ({ page }) => {
  await openLibrary(page);
  await page.locator('#anAdd').click();
  await page.locator('#anTitle').fill('周会记录');
  await page.locator('#anText').fill('本周完成了资料整理。\n\n下周继续核对来源。');
  await page.locator('#anTags').fill('工作, 周会');
  await page.locator('#anSource').fill('https://example.com/source');
  await page.locator('#anFavorite').check();
  await page.locator('#anSave').click();
  await expect(page.locator('#anSave')).toHaveCount(0);
  await page.locator('#anQ').fill('example.com');
  await expect(page.locator('[data-note]')).toHaveCount(1);
  await page.locator('#anFavorites').click();
  await page.locator('#anTag').selectOption('周会');
  await page.locator('[data-anedit]').click();
  await page.locator('#anText').fill('修订版周会记录 🍊');
  await page.locator('#anSave').click();
  await expect(page.locator('#anSave')).toHaveCount(0);
  const downloadEvent=page.waitForEvent('download');
  await page.locator('[data-export]').click();
  const download=await downloadEvent;
  const md=await readFile(await download.path(),'utf8');
  expect(md).toContain('修订版周会记录 🍊');
  expect(md).toContain('https://example.com/source');
  expect(md).toContain('#工作 #周会');
  await page.locator('[data-andel]').click();
  await expect(page.locator('[data-note]')).toHaveCount(0);
  await page.locator('.toast-undo').click();
  await expect(page.locator('[data-note]')).toHaveCount(1);
  await page.reload();
  await page.locator('.nav-item[data-id="notes"]').click();
  await expect(page.locator('[data-note]')).toContainText('修订版周会记录 🍊');
  await expect(page.locator('[data-favorite]')).toHaveAttribute('aria-pressed','true');
});

test('删除失败保持列表，撤销失败不报成功；来源拒绝可执行链接',async({page})=>{
  await openLibrary(page);
  await page.locator('#anAdd').click();
  await page.locator('#anText').fill('local note');
  await page.locator('#anSource').fill('javascript:alert(1)');
  await page.locator('#anSave').click();
  await expect(page.locator('#anText')).toHaveValue('local note');
  await expect(page.locator('#toasts')).toContainText('HTTP');
  await page.locator('#anSource').fill('');
  await page.locator('#anSave').click();
  await expect(page.locator('#anSave')).toHaveCount(0);
  await page.evaluate(()=>{window.savedRemove=window.SeekerRT.db.remove;window.SeekerRT.db.remove=async()=>{throw new Error('delete blocked');};});
  await page.locator('[data-andel]').click();
  await expect(page.locator('[data-note]')).toHaveCount(1);
  await expect(page.locator('#toasts')).toContainText('delete blocked');
  await page.evaluate(()=>{window.SeekerRT.db.remove=window.savedRemove;});
  await page.locator('[data-andel]').click();
  await expect(page.locator('[data-note]')).toHaveCount(0);
  await page.evaluate(()=>{window.SeekerRT.db.upsert=async()=>{throw new Error('restore blocked');};});
  await page.locator('.toast-undo').click();
  await expect(page.locator('#toasts')).toContainText('restore blocked');
  await expect(page.locator('[data-note]')).toHaveCount(0);
  await expect(page.locator('#toasts')).not.toContainText('已撤销');
});

test('显式 AI 整理只发送所选正文，期间编辑的笔记不会被旧结果覆盖',async({page})=>{
  await openLibrary(page);
  await page.locator('#anAdd').click();
  await page.locator('#anText').fill('selected original');
  await page.locator('#anSave').click();
  await expect(page.locator('#anSave')).toHaveCount(0);
  await page.evaluate(()=>{
    const available=window.SeekerRT.available;
    window.SeekerRT.available=f=>f==='textGeneration'||available(f);
    window.SeekerRT.ai.generate=req=>{window.organizeRequest=req;return {cancel(){},done:new Promise(resolve=>{window.completeOrganize=()=>resolve({text:'{"title":"Stale title","tags":["old"],"summary":"Stale summary"}',stopReason:'stop'});})};};
    window.dispatchEvent(new Event('seeker-library-changed'));
  });
  await page.locator('[data-anai]').click();
  await expect(page.locator('#anOrganize')).toBeVisible();
  expect(await page.evaluate(()=>window.organizeRequest)).toBeUndefined();
  await page.locator('#anOrganize').click();
  const request=await page.evaluate(()=>window.organizeRequest);
  expect(request.untrusted).toBe('selected original');
  expect(request.instruction).not.toContain('selected original');
  await page.locator('[data-anedit]').click();
  await page.locator('#anText').fill('new user edit');
  await page.locator('#anSave').click();
  await expect(page.locator('#anSave')).toHaveCount(0);
  await page.evaluate(()=>window.completeOrganize());
  await expect(page.locator('#toasts')).toContainText('笔记已有新修改');
  await expect(page.locator('[data-note]')).toContainText('new user edit');
  await expect(page.locator('[data-note]')).not.toContainText('Stale title');
});
