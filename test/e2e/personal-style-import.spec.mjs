import {test,expect} from '@playwright/test';

const bad={id:'cr_bad_style',kind:'style',title:'损坏样式',deleted:false};
const good={id:'cr_good_style',kind:'style',title:'正常柔和',deleted:false,projectId:'',content:{},source:{},style:{preset:'soft'},revision:1,createdAt:10,updatedAt:10,history:[]};
async function open(page,rows=[bad,good]){
  await page.addInitScript(()=>{if(window!==window.top)return;localStorage.setItem('jh-onboarded','done');localStorage.setItem('jh-demonote','off');});
  await page.goto('/');await expect(page.locator('#homeInput')).toBeVisible();
  await page.locator('[data-id="settings"]').click();await page.locator('[data-stab="data"]').click();
  // Exercise the real file input, FileReader and backup import transaction.
  await page.locator('#dataImportFile').setInputFiles({name:'styles.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'seeker-backup',formatVersion:2,collections:{platform_creations:rows}}))});
  await expect(page.locator('.toast').filter({hasText:'已导入'})).toBeVisible();
  await page.locator('[data-stab="creations"]').click();
}
const row=(page,id)=>page.locator(`[data-personal-style="${id}"]`);

test('异常文件导入后样式设置和复用仍可用，损坏记录不可应用但可移除撤销',async({page})=>{
  const variants=[bad,...[null,[],42,'soft'].map((style,i)=>({...good,id:'cr_bad_shape_'+i,title:'异常结构 '+i,style})),{...good,id:'cr_bad_revision',title:'缺少版本',revision:undefined},{...good,id:'cr_bad_history',history:[null]},{...good,id:'cr_bad_title',title:{text:'异常标题'}}];
  await open(page,[...variants,good]);
  await expect(page.locator('#creationDefaultSave')).toBeVisible();
  for(const item of variants){
    await expect(row(page,item.id)).toContainText('样式数据损坏');
    await expect(row(page,item.id).getByRole('button',{name:'保存名称',exact:true})).toBeDisabled();
    await expect(page.locator(`#creationDefaultStyle option[value="${item.id}"]`)).toHaveJSProperty('disabled',true);
  }
  await page.locator('#creationDefaultStyle').selectOption(good.id);await page.locator('#creationDefaultSave').click();await expect(page.locator('#creationDefaultStatus')).toContainText('已保存');
  const preference=await page.evaluate(()=>localStorage.getItem('seeker-creation-style'));
  // A forced stale selection still cannot apply corrupt data.
  await page.locator('#creationDefaultStyle').evaluate((select,id)=>{select.value=id;},bad.id);
  await page.locator('#creationDefaultSave').click();await expect(page.locator('#creationDefaultStatus')).toContainText('样式数据损坏');
  expect(await page.evaluate(()=>localStorage.getItem('seeker-creation-style'))).toBe(preference);
  await row(page,bad.id).getByRole('button',{name:'移除样式',exact:true}).click();await expect(row(page,bad.id)).toHaveCount(0);
  expect(await page.evaluate(id=>window.SeekerRT.db.get('platform_creations',id),bad.id)).toEqual({...bad,deleted:true});
  await page.locator('.toast-undo').last().click();await expect(row(page,bad.id)).toBeVisible();
  expect(await page.evaluate(id=>window.SeekerRT.db.get('platform_creations',id),bad.id)).toEqual(bad);
  await page.locator('[data-id="creations"]').click();await page.getByRole('button',{name:'+ 新建知识卡片',exact:true}).click();
  await expect(page.locator('#creationPreset')).toHaveValue('soft');
  for(const item of variants)await expect(page.locator(`#creationPersonalStyle option[value="${item.id}"]`)).toHaveJSProperty('disabled',true);
  await page.locator('#creationPreset').selectOption('dark');await page.locator('#creationPersonalStyle').selectOption(good.id);await expect(page.locator('#creationPreset')).toHaveValue('soft');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('#creationSaveStatus')).toHaveText('已保存到本机');
  await page.reload();await page.locator('[data-id="settings"]').click();await page.locator('[data-stab="creations"]').click();
  await expect(row(page,bad.id)).toContainText('样式数据损坏');await expect(page.locator('#creationDefaultSave')).toBeEnabled();
});

test('损坏样式移除与撤销等待事务提交，失败不丢记录或假报成功',async({page})=>{
  await open(page);
  await expect(row(page,bad.id)).toBeVisible();
  await page.evaluate(()=>{
    window.abortStyleWrite=true;const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(this.name==='platform_creations'&&window.abortStyleWrite)request.addEventListener('success',()=>this.transaction.abort());return request;};
  });
  await row(page,bad.id).getByRole('button',{name:'移除样式',exact:true}).click();
  await expect(page.locator('#creationDefaultStatus')).not.toBeEmpty();await expect(row(page,bad.id)).toBeVisible();await expect(page.locator('.toast-undo')).toHaveCount(0);
  expect(await page.evaluate(id=>window.SeekerRT.db.get('platform_creations',id),bad.id)).toEqual(bad);
  await page.evaluate(()=>window.abortStyleWrite=false);await row(page,bad.id).getByRole('button',{name:'移除样式',exact:true}).click();await expect(row(page,bad.id)).toHaveCount(0);
  await page.evaluate(()=>window.abortStyleWrite=true);await page.locator('.toast-undo').last().click();
  await expect(page.locator('.toast').filter({hasText:'事务已回滚'})).toBeVisible();await expect(page.locator('.toast').filter({hasText:'已撤销'})).toHaveCount(0);
  expect(await page.evaluate(id=>window.SeekerRT.db.get('platform_creations',id),bad.id)).toEqual({...bad,deleted:true});
});

test('损坏样式移除与撤销拒绝旧快照，不影响后来修复的记录或其他作品',async({page})=>{
  await open(page);
  const result=await page.evaluate(async({bad,good})=>{
    const rt=window.SeekerRT;const removed=await rt.creations.setStyleDeleted(bad,true);
    const repaired={...good,id:bad.id,title:'后来修好的样式'};
    await rt.db.import(JSON.stringify({collections:{platform_creations:[repaired]}}));
    const stale=await Promise.allSettled([rt.creations.setStyleDeleted(removed,false),rt.creations.setStyleDeleted(bad,true)]);
    const other={...good,id:'cr_other_kind',kind:'card'};await rt.db.import(JSON.stringify({collections:{platform_creations:[other]}}));
    const outside=await rt.creations.setStyleDeleted(other,true).then(()=>false,()=>true);
    return {stale:stale.map(r=>r.status),outside,after:await rt.db.get('platform_creations',bad.id),other:await rt.db.get('platform_creations',other.id),repaired};
  },{bad,good});
  expect(result.stale).toEqual(['rejected','rejected']);expect(result.outside).toBe(true);expect(result.after).toEqual(result.repaired);expect(result.other.deleted).toBe(false);
});
