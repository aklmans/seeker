import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextCreation,creationDraft} from '../web/platform/runtime/creation-model.js';
import {normalizeStyle,styleCSS} from '../web/platform/creations/style.js';
import {creationHTML} from '../web/platform/creations/content.js';
const draft=()=>({id:'cr_test',kind:'widget',title:'作品',content:{html:'<h1>中文</h1>'},style:{},source:{},projectId:'',deleted:false});
test('creation versions reject stale saves and retain reversible deletion without recursive history',()=>{
  const initial=nextCreation(draft(),0,null,100);
  const second=nextCreation({...draft(),title:'改名'},1,initial,200);
  assert.throws(()=>nextCreation(draft(),1,second),/changed/);
  assert.equal(second.history[0].title,'作品');
  const deleted=nextCreation({...second,deleted:true},2,second,300);
  const restored=nextCreation(second,3,deleted,400);
  assert.equal(restored.deleted,false);assert.equal(restored.createdAt,100);
  let latest=restored;for(let i=0;i<30;i++)latest=nextCreation(draft(),latest.revision,latest);
  assert.equal(latest.history.length,20);assert.ok(latest.history.every(r=>!('history' in r)));
});
test('creation data is bounded and style text cannot inject markup or network CSS',()=>{
  assert.throws(()=>creationDraft({...draft(),content:{html:'中'.repeat(30000)}}));
  for(const bad of [null,[],{...draft(),id:'../../x'},{...draft(),kind:'settings'}])assert.throws(()=>creationDraft(bad));
  const malicious={background:'red;} </style><script>fetch("https://evil.test")</script>',font:'url(https://evil.test)',radius:Infinity,spacing:9999};
  const css=styleCSS(malicious);assert.doesNotMatch(css,/<script|https:|url\(/);assert.equal(normalizeStyle(malicious).spacing,48);
  const html=creationHTML({...draft(),kind:'card',title:'<img src=x onerror=alert(1)>',content:{text:'<script>bad</script>'}});
  assert.doesNotMatch(html,/<script|<img/);assert.match(html,/&lt;script&gt;/);
});
