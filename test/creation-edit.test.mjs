import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparison,timeline} from '../web/platform/creations/structured-model.js';
import {creationHTML} from '../web/platform/creations/content.js';
import {creationEditRequest,applyCreationEdit} from '../web/platform/creations/edit-ai.js';
const draft={id:'cr_ai',kind:'widget',title:'当前作品',content:{html:'<p>私有正文</p>'},style:{preset:'soft'},source:{type:'manual'},projectId:'PRIVATE_WORKSPACE',deleted:false};
test('style AI receives only requested style values; result cannot modify content, defaults or metadata',()=>{
  const req=creationEditRequest('style',draft,'蓝色更柔和一点');assert.ok(!req.untrusted.includes('私有正文'));assert.ok(!req.untrusted.includes('PRIVATE_WORKSPACE'));assert.deepEqual(Object.keys(req).sort(),['instruction','task','untrusted']);
  const next=applyCreationEdit('style',draft,{text:'{"accent":"#315577","radius":18}',stopReason:'stop'});assert.deepEqual(next.content,draft.content);assert.equal(next.projectId,draft.projectId);assert.equal(next.style.accent,'#315577');assert.deepEqual(draft.style,{preset:'soft'});
  for(const bad of [{html:'bad'},{settings:{default:'bad'}},{accent:'url(https://x)'},{radius:800},{font:'Arial; color:red'},{edge:'unknown'}])assert.throws(()=>applyCreationEdit('style',draft,{text:JSON.stringify(bad)}));
  assert.throws(()=>applyCreationEdit('style',draft,{text:'{"accent":"#315577"}',stopReason:'length'}));
});
test('widget AI changes only current HTML and rejects oversized, unfinished or foreign-field results',()=>{
  assert.ok(creationEditRequest('widget',draft,'增加一个按钮').untrusted.includes('私有正文'));
  const next=applyCreationEdit('widget',draft,{text:'{"html":"<button>新按钮</button>"}',stopReason:'stop'});assert.equal(next.content.html,'<button>新按钮</button>');assert.deepEqual(next.style,draft.style);assert.deepEqual(next.source,draft.source);
  for(const bad of [{html:''},{html:'x'.repeat(65537)},{html:'<p>x</p>',style:{}}])assert.throws(()=>applyCreationEdit('widget',draft,{text:JSON.stringify(bad)}));
});
test('tables and timelines retain user fields, reject malformed structures and escape displayed content',()=>{
  const c={columns:['指标','<img onerror=bad>'],rows:[['价格','120 元'],['适合场景','普通家庭']]};assert.deepEqual(comparison(c),c);assert.throws(()=>comparison({...c,rows:[['缺少一列']]}));assert.throws(()=>comparison({...c,columns:['只有一列']}));
  const t={events:[{when:'第一周',title:'<script>bad</script>',detail:'开始调研'}]};assert.deepEqual(timeline(t),t);assert.throws(()=>timeline({events:[{when:'',title:'',detail:''}]}));
  const html=creationHTML({...draft,kind:'comparison',content:c})+creationHTML({...draft,kind:'timeline',content:t});assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('120 元'));
});
