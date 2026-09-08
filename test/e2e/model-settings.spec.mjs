import {expect,test} from '@playwright/test';

async function openDesktopSettings(page){
  await page.addInitScript(()=>localStorage.setItem('jh-onboarded','done'));
  await page.goto('/');
  await page.evaluate(()=>{
    const rt=window.SeekerRT;rt.platform='desktop';window.modelCalls=[];
    window.modelConfig={protocol:'openai',embeddingSupported:true,keyRequired:true,baseUrl:'https://custom.example/v1',model:'existing-model',models:['existing-model','another-model'],embedModel:'saved-embedding',keyStatus:'configured',userAgent:'saved-agent'};
    rt.ai.getConfig=async()=>({...window.modelConfig});
    rt.ai.setConfig=async patch=>{window.modelCalls.push({kind:'config',patch});if(window.failConfig)throw new Error('disk unavailable');Object.assign(window.modelConfig,patch);};
    rt.secret.set=async(account,value)=>{window.modelCalls.push({kind:'key',account});if(window.failKey)throw new Error('keychain unavailable');window.lastSavedKey=value;};
    rt.ai.generate=req=>{window.modelCalls.push({kind:'generate',req});return {cancel(){},done:window.failModel?Promise.reject(new Error(window.modelError||'401 unauthorized <img src=x onerror=alert(1)>')):Promise.resolve({text:'OK',stopReason:window.shortReply?'length':'stop'})};};
  });
  await page.locator('#homeModels').click();
  await expect(page.locator('#mdModel')).toHaveValue('existing-model');
}

test('读取旧配置与选择协议不自动覆盖，显式保存后才生效',async({page})=>{
  await openDesktopSettings(page);
  await expect(page.locator('#mdBase')).toHaveValue('https://custom.example/v1');
  await expect(page.locator('#mdKey')).toHaveValue('');
  await expect(page.locator('#mdKey')).toHaveAttribute('placeholder',/已配置/);
  await page.locator('#mdProto').selectOption('gemini');
  await expect(page.locator('#mdBase')).toHaveValue('https://custom.example/v1');
  await expect(page.locator('#mdModel')).toHaveValue('existing-model');
  expect(await page.evaluate(()=>window.modelCalls)).toEqual([]);
  await page.locator('#mdDefaultBase').click();
  await expect(page.locator('#mdBase')).toHaveValue('https://generativelanguage.googleapis.com/v1beta');
  await page.locator('#mdSavedModels').selectOption('another-model');
  await page.locator('#mdSave').click();
  await expect(page.locator('#mdStatus')).toHaveText('配置已保存。');
  expect(await page.evaluate(()=>window.modelCalls)).toEqual([{kind:'config',patch:{protocol:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'another-model',embedModel:'saved-embedding',userAgent:'saved-agent'}}]);
});

test('保存与连接失败保留输入，Key 单独保存，测试请求不带历史和资料',async({page})=>{
  await openDesktopSettings(page);
  await page.locator('#mdModel').fill('chosen-model');await page.locator('#mdKey').fill('fixture-key');
  await page.evaluate(()=>{window.failConfig=true;});
  await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('配置未保存');
  await expect(page.locator('#mdModel')).toHaveValue('chosen-model');await expect(page.locator('#mdKey')).toHaveValue('fixture-key');
  expect(await page.evaluate(()=>window.modelCalls.map(c=>c.kind))).toEqual(['config']);
  await page.evaluate(()=>{window.failConfig=false;window.failKey=true;});await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('连接信息已保存，本次操作未完成');
  await expect(page.locator('#mdKey')).toHaveValue('fixture-key');
  await page.evaluate(()=>{window.failKey=false;window.failModel=true;});await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('模型的访问权限');await expect(page.locator('#mdKey')).toHaveValue('');
  await expect(page.locator('#mdStatus img')).toHaveCount(0);
  const request=await page.evaluate(()=>window.modelCalls.find(c=>c.kind==='generate').req);
  expect(request).toEqual({instruction:'Reply with OK only.',task:'model_connection_test'});
  expect(await page.evaluate(()=>window.modelCalls.filter(c=>c.kind==='config').every(c=>!JSON.stringify(c).includes('fixture-key')))).toBe(true);
  await page.evaluate(()=>{window.modelError='error sending request for url (http://127.0.0.1:4188/v1/chat/completions)';});await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('确认模型服务正在运行');
  await page.evaluate(()=>{window.failModel=false;window.shortReply=true;});await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('未返回完整');
  await page.evaluate(()=>{window.shortReply=false;});await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('连接成功');
});

test('本地协议不写云端 Key，英文窄窗口首页可用且撤销文案双语',async({page})=>{
  await openDesktopSettings(page);
  await page.locator('#mdKey').fill('do-not-save');await page.locator('#mdProto').selectOption('ollama');
  await expect(page.locator('#mdKey')).toBeHidden();await page.locator('#mdDefaultBase').click();await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('连接成功');
  expect(await page.evaluate(()=>window.modelCalls.some(c=>c.kind==='key'))).toBe(false);
  await page.evaluate(()=>{window.modelConfig.keyStatus='empty';});
  await page.locator('[data-stab="basic"]').click();await page.locator('[data-stab="model"]').click();
  await page.locator('#mdProto').selectOption('openai');await page.locator('#mdDefaultBase').click();
  await expect(page.locator('#mdKey')).toHaveValue('');await page.locator('#mdTest').click();
  await expect(page.locator('#mdStatus')).toContainText('连接成功');
  expect(await page.evaluate(()=>window.modelCalls.some(c=>c.kind==='key'))).toBe(false);
  await page.setViewportSize({width:800,height:900});await page.locator('#langBtn').click();
  await page.locator('.nav-item[data-id="home"]').click();
  await expect(page.locator('#homeSend')).toHaveText('Start a chat and send →');
  const dimensions=await page.locator('#homeInput').evaluate(el=>({width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right,viewport:innerWidth}));
  expect(dimensions.width).toBeGreaterThan(350);expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
  await page.evaluate(async()=>{const {toastUndo}=await import('/platform/shell/toast.js');toastUndo('Deleted test note',()=>{window.undoWorked=true;});});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#toasts')).toContainText('Undone');
  expect(await page.evaluate(()=>window.undoWorked)).toBe(true);
});
