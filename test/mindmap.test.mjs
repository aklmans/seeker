import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mindMap,outlineToMindMap,moveNode,mindMapMarkdown,editMindMap} from '../web/platform/creations/mindmap-model.js';
import {layoutMindMap,mindMapSVG} from '../web/platform/creations/mindmap-render.js';
import {mindRequest,parseMindNode,applyMindResult,completedCreationText} from '../web/platform/creations/ai.js';
const node=(id,text,children=[])=>({id:'n_'+id,text,children,collapsed:false});
const fixture=()=>({root:node('root','阅读', [node('a','读之前',[node('c','先写下问题')]),node('b','读之后')]),layout:'bilateral'});
test('branch moves are immutable and reject cycles, root moves and excessive depth',()=>{
  const initial=fixture(),copy=structuredClone(initial);
  const moved=moveNode(initial,'n_c','n_b');assert.equal(moved.root.children[1].children[0].id,'n_c');assert.deepEqual(initial,copy);
  assert.throws(()=>moveNode(initial,'n_a','n_c'));assert.throws(()=>moveNode(initial,'n_root','n_b'));
  let deep=node('last','末尾');for(let i=0;i<12;i++)deep=node('deep'+i,'分支',[deep]);assert.throws(()=>mindMap({root:deep,layout:'tree'}));
  assert.throws(()=>editMindMap(initial,m=>{m.root.children.push(node('a','重复 ID'));}));assert.deepEqual(initial,copy);
});
test('outline preserves all labels, exported Markdown includes folded children',()=>{
  const map=outlineToMindMap('读书','- 开始\n  - 提问\n  - 查证\n- 结束');
  assert.equal(map.root.children[0].children.length,2);assert.equal(map.root.children[1].text,'结束');
  map.root.children[0].collapsed=true;assert.match(mindMapMarkdown(map),/  - 提问/);
  assert.throws(()=>outlineToMindMap('长节点','中'.repeat(301)));
  assert.throws(()=>outlineToMindMap('太多',Array.from({length:200},()=>'- 节点').join('\n')));
});
test('layout includes long Chinese text without node overlap; SVG labels cannot inject active markup',()=>{
  const map=fixture();map.root.children[0].text='长中文内容'.repeat(20);map.root.children[1].text='<script>alert(1)</script>';
  const {boxes,width,height}=layoutMindMap(map,{size:22});
  assert.equal(boxes.length,4);assert.ok(boxes.every(b=>b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<=height));
  for(const a of boxes)for(const b of boxes)if(a!==b)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  const svg=mindMapSVG(map,{accent:'"><script>bad</script>'});assert.doesNotMatch(svg,/<script|onload=|href=/);assert.match(svg,/&lt;script&gt;/);
  map.root.children[0].collapsed=true;assert.equal(layoutMindMap(map,{}).boxes.length,3);
  map.layout='outline';const outline=layoutMindMap(map,{size:22});assert.equal(outline.edges.length,0);assert.ok(outline.boxes[1].x>outline.boxes[0].x);assert.ok(outline.boxes[2].y>outline.boxes[1].y+outline.boxes[1].height);
});
test('AI receives only a chosen text or branch; applying a branch preserves all other content and strips foreign fields',()=>{
  const map=fixture(),selected=map.root.children[0];const req=mindRequest('expand',selected);
  assert.deepEqual(Object.keys(req).sort(),['instruction','task','untrusted']);assert.ok(req.untrusted.includes('读之前'));assert.ok(!req.untrusted.includes('读之后'));
  const result=parseMindNode(JSON.stringify({text:'建议',children:[{text:'列出问题',children:[],id:'settings'}],style:{background:'evil'},settings:{enabled:true}}));
  assert.ok(result.children[0].id.startsWith('n_'));assert.ok(!('style' in result));assert.ok(!('settings' in result));
  const next=applyMindResult(map,'n_a','expand',result);assert.deepEqual(next.root.children[1],map.root.children[1]);assert.deepEqual(next.root.children[0].children[0],map.root.children[0].children[0]);assert.equal(next.root.children[0].children[1].text,'列出问题');
  const shortened=applyMindResult(map,'n_a','shorten',result);assert.deepEqual(shortened.root.children[1],map.root.children[1]);assert.equal(shortened.root.children[0].text,'建议');assert.equal(shortened.root.children[0].id,'n_a');assert.deepEqual(map,fixture());
  for(const stopReason of ['cancelled','length','error'])assert.throws(()=>completedCreationText({text:'partial',stopReason}));
  assert.throws(()=>parseMindNode('{"text":"x","children":"bad"}'));
});
