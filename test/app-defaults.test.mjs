import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/platform/shell/registry.js',import.meta.url),'utf8');
function boot(store={},fail=false){
  const window={SeekerRT:{db:{list:async()=>[{id:'existing-job'}]}}};
  new Function('window','localStorage',source)(window,{getItem:k=>store[k]??null,setItem:(k,v)=>{if(fail)throw Error('quota');store[k]=v;}});
  const shell=window.SeekerShell;
  shell.register({id:'jobseek',defaultEnabled:false,collections:['jobs'],aiReadable:'default-on',pages:[]});
  shell.register({id:'daily',collections:[],pages:[]});
  return shell;
}
test('求职默认关闭，不因旧安装、已有数据或旧自动开启记录而启用',async()=>{
  for(const store of [{},{'jh-onboarded':'done'},{'jh-seeded-jobs':'1'},{'seeker-apps':JSON.stringify({enabled:{jobseek:true}})}]){
    const shell=boot(store);
    assert.equal(shell.enabled('jobseek'),false);
    assert.equal(shell.enabled('daily'),true);
    assert.deepEqual(shell.aiReadableCollections(),[]);
    await shell.initializeDefaults();
    assert.equal(boot(store).enabled('jobseek'),false);
  }
});
test('用户主动开启与关闭持久保留，写入失败不假装已启用',async()=>{
  const store={};const shell=boot(store);await shell.initializeDefaults();
  shell.setEnabled('jobseek',true);
  assert.equal(boot(store).enabled('jobseek'),true);
  assert.deepEqual(shell.aiReadableCollections(),['jobs']);
  shell.setEnabled('jobseek',false);
  assert.equal(boot(store).enabled('jobseek'),false);
  const broken=boot({},true);
  assert.throws(()=>broken.setEnabled('jobseek',true),/quota/);
  assert.equal(broken.enabled('jobseek'),false);
});
