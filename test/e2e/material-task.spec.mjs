import { test,expect } from '@playwright/test';

async function setup(page){
  await page.addInitScript(()=>{localStorage.setItem('jh-onboarded','done');localStorage.setItem('seeker-apps',JSON.stringify({enabled:{jobseek:false,assets:true},order:[],aiGrant:{}}));});
  await page.goto('/');
  await page.evaluate(async()=>{
    const rt=window.SeekerRT,available=rt.available;rt.available=f=>f==='agentExecution'||available(f);
    await rt.db.upsert('assets_notes',{id:'a',title:'Alpha source',text:'Alpha costs 120. Starts in May.',updated:1});
    await rt.db.upsert('assets_notes',{id:'b',title:'Private unselected',text:'DO NOT INCLUDE THIS',updated:1});
    window.taskDrafts=[];window.taskActions=[];
    rt.agent.createTask=async draft=>{
      window.taskDrafts.push(draft);if(window.failCreate)throw new Error('snapshot save failure');
      const sources=await Promise.all(draft.inputs.materials.map(async(c,i)=>{const row=await rt.db.get(c.kind==='note'?'assets_notes':'assets_documents',c.id);return {id:'s'+(i+1),kind:c.kind,recordId:c.id,title:row.title,sourceUrl:'',updated:row.updated,characters:[...row.text].length,fragments:[{id:'f1',text:row.text,page:null}]};}));
      const task={id:'material_task',workflowId:draft.workflowId,title:draft.title,goal:draft.goal,status:'draft',inputs:{language:draft.inputs.language,snapshot:{goal:draft.goal,language:draft.inputs.language,sources,hash:'fixture'}},capabilityScope:{effects:['read_only','local_create']},updatedAt:Date.now()};await rt.db.upsert('platform_agent_tasks',task);return task;
    };
    rt.agent.subscribe=async fn=>{window.taskEvent=fn;return ()=>{};};
    const setState=async status=>{const task=await rt.db.get('platform_agent_tasks','material_task');await rt.db.upsert('platform_agent_tasks',{...task,status});await rt.db.upsert('platform_agent_runs',{id:'material_run',taskId:task.id,status,createdAt:1});};
    rt.agent.start=async()=>{window.taskActions.push('start');await setState('running');return {id:'material_run'};};
    for(const [action,status] of [['pause','paused'],['resume','running'],['cancel','cancelled']])rt.agent[action]=async()=>{window.taskActions.push(action);await setState(status);};
    rt.agent.readArtifact=async id=>{window.previewed=id;return '# Material report\n\nAlpha costs 120. [s1/f1]';};
    rt.agent.exportArtifact=async id=>{window.exported=id;return '/fixture/verified-copy.md';};
    window.completeMaterial=async()=>{await setState('succeeded');for(const [kind,name,mime] of [['material_report_md','material-report.md','text/markdown'],['material_report_docx','material-report.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document']])await rt.db.upsert('platform_agent_artifacts',{id:kind,kind,name,mime,taskId:'material_task',runId:'material_run',verified:true,validationStatus:'verified',size:200,sha256:'0123456789'});window.taskEvent?.({});};
  });
  await page.locator('.nav-item[data-id="tasks"]').click();
  await page.locator('#topActions').getByRole('button',{name:/新建任务/}).click();
  await expect(page.locator('#taskWorkflow')).toHaveValue('material_report');
  await page.locator('#materialTaskGoal').fill('Summarize the selected source and list gaps.');
  await page.locator('.agent-task-choice').filter({hasText:'Alpha source'}).locator('input').check();
}

test('public Tasks works with jobseek disabled, freezes explicit choices and preserves failed form input',async({page})=>{
  await setup(page);
  expect(await page.locator('#taskWorkflow option').count()).toBe(1);
  await page.evaluate(()=>{window.failCreate=true;});await page.locator('[data-agent-create]').click();
  await expect(page.locator('#toasts')).toContainText('snapshot save failure');await expect(page.locator('#materialTaskGoal')).toHaveValue('Summarize the selected source and list gaps.');
  await page.evaluate(()=>window.taskEvent?.({}));await expect(page.locator('.agent-task-choice').filter({hasText:'Alpha source'}).locator('input')).toBeChecked();
  await page.evaluate(()=>{window.failCreate=false;});await page.locator('[data-agent-create]').click();
  await expect(page.locator('.agent-task-detail')).toContainText('本次资料快照');await expect(page.locator('.agent-task-detail')).toContainText('Alpha source');
  await expect(page.locator('.agent-task-detail')).not.toContainText('DO NOT INCLUDE THIS');
  expect((await page.evaluate(()=>window.taskDrafts.at(-1))).inputs.materials).toEqual([{kind:'note',id:'a',updated:1}]);
  expect(await page.evaluate(()=>window.taskActions)).toEqual([]);
  await page.reload();await page.locator('.nav-item[data-id="tasks"]').click();
  await expect(page.locator('.agent-task-detail')).toContainText('Alpha source');await expect(page.locator('[data-agent-action="start"]')).toHaveCount(0);
});

test('material task controls pause, resume and cancel according to persisted state',async({page})=>{
  await setup(page);await page.locator('[data-agent-create]').click();await page.locator('[data-agent-action="start"]').click();
  await page.locator('[data-agent-action="pause"]').click();await expect(page.locator('.agent-task-detail > .agent-task-heading')).toContainText('已暂停');
  await page.locator('[data-agent-action="resume"]').click();await page.locator('[data-agent-action="cancel"]').click();
  await expect(page.locator('.agent-task-detail > .agent-task-heading')).toContainText('已取消');
  expect(await page.evaluate(()=>window.taskActions)).toEqual(['start','pause','resume','cancel']);
});

test('completed report can be previewed, explicitly saved as a note, exported and found from Home',async({page})=>{
  await setup(page);await page.locator('[data-agent-create]').click();await page.locator('[data-agent-action="start"]').click();await page.evaluate(()=>window.completeMaterial());
  await expect(page.locator('.agent-artifact.is-verified')).toHaveCount(2);
  await page.locator('[data-agent-preview]').click();await expect(page.locator('[data-agent-preview-host]')).toContainText('Alpha costs 120.');
  await page.locator('[data-agent-save]').click();await expect(page.locator('#toasts')).toContainText('已另存笔记');
  expect(await page.evaluate(async()=>(await window.SeekerRT.db.list('assets_notes')).some(n=>n.text.includes('# Material report')))).toBe(true);
  await page.locator('[data-agent-export="material_report_md"]').click();expect(await page.evaluate(()=>window.exported)).toBe('material_report_md');
  await page.locator('.nav-item[data-id="home"]').click();await expect(page.locator('#homeTasks')).toContainText('资料整理报告');
  await page.locator('#homeTasks button').click();await expect(page.locator('.agent-task-detail')).toContainText('资料整理报告');
});
