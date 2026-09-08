// @ts-check
import {tt} from '../shell/i18n.js';
import {frontis,go} from '../shell/nav.js';
import {toast,toastUndo,errText} from '../shell/toast.js';
import {currentProjectId} from '../shell/project-state.js';
import {renderWidget} from '../capability/widgets/render.js';
import {creationDraft} from '../runtime/creation-model.js';
import {newCreationId,getCreation,saveCreation} from './store.js';
import {STYLE_PRESETS,normalizeStyle} from './style.js';
import {creationHTML,escapeHTML as esc} from './content.js';
import {openExport} from './export.js';

/** @typedef {import('../runtime/types').CreationRecord} Creation */
/** @type {Creation|null} */
let current=null;
let dirty=false, busy=false, loaded=false;
let listEpoch=0, editorEpoch=0, openEpoch=0;
/** @param {string} zh @param {string} en @param {()=>unknown} fn @param {string} [className] */
function button(zh,en,fn,className='btn'){
  const b=document.createElement('button');b.className=className;b.textContent=tt(zh,en);b.onclick=()=>{void fn();};return b;
}
function report(/** @type {unknown} */error){toast(errText(error));}
export function renderCreations(){
  const host=document.getElementById('page-creations');if(!host)return;
  // Reassembly or language changes must not discard a user's unsaved draft.
  if(dirty&&host.querySelector('#creationEditor'))return;
  host.innerHTML=frontis('MY CREATIONS',tt('我的作品','My creations'))+`<p style="color:var(--ink-2)">${tt('保存可继续编辑的作品。作品保存在本机，可查看全部空间；手动编辑和换风格不调用 AI。','Keep creations you can continue editing. Stored on this device, visible across workspaces. Manual edits and styles use no AI.')}</p>
    <div class="creation-layout"><aside><div class="creation-list-tools"><input class="input" id="creationSearch" placeholder="${tt('搜索作品','Search creations')}" aria-label="${tt('搜索作品','Search creations')}"><label><input type="checkbox" id="creationTrash"> ${tt('已移除','Removed')}</label></div><div id="creationList"></div></aside><main id="creationEditor"><p>${tt('选择一件作品，或新建知识卡片。聊天中的 Widget 会自动保存在这里。','Choose a creation or start a knowledge card. Chat widgets are saved here automatically.')}</p><div id="creationNew"></div></main></div>`;
  host.querySelector('#creationNew')?.appendChild(button('+ 新建知识卡片','+ New knowledge card',newCard,'btn btn-accent'));
  /** @type {HTMLInputElement} */(host.querySelector('#creationSearch')).oninput=()=>{void refreshList();};
  /** @type {HTMLInputElement} */(host.querySelector('#creationTrash')).onchange=()=>{void refreshList();};
  loaded=true;void refreshList();if(current)drawEditor(current);
}
export async function refreshList(){
  const host=document.getElementById('creationList');if(!host||!window.SeekerRT)return;
  const epoch=++listEpoch;
  try{
    const rows=await window.SeekerRT.db.list('platform_creations');if(epoch!==listEpoch||!host.isConnected)return;
    const search=(/** @type {HTMLInputElement|null} */(document.getElementById('creationSearch')))?.value.toLowerCase()||'';
    const removed=(/** @type {HTMLInputElement|null} */(document.getElementById('creationTrash')))?.checked||false;
    host.replaceChildren();
    const visible=rows.filter(r=>r.kind!=='style'&&!!r.deleted===removed&&String(r.title||'').toLowerCase().includes(search)).sort((a,b)=>Number(b.updatedAt)-Number(a.updatedAt));
    for(const row of visible){
      const b=button(String(row.title||tt('无标题','Untitled')),String(row.title||'Untitled'),()=>openCreation(row.id),'creation-list-item');
      if(current?.id===row.id)b.setAttribute('aria-current','true');
      const meta=document.createElement('small');meta.textContent=String(row.kind||'')+' · v'+String(row.revision||'?');b.appendChild(meta);host.appendChild(b);
    }
    if(!visible.length)host.textContent=tt('这里还没有作品。','No creations here yet.');
  }catch(e){if(epoch===listEpoch)host.textContent=tt('读取失败，请重试：','Could not load: ')+String(e);}
}
function canLeave(){if(busy){toast(tt('正在保存，请稍候','Saving; please wait'));return false;}if(dirty){toast(tt('请先保存当前修改，或点“放弃修改”。','Save the current changes or choose Discard changes.'));return false;}return true;}
export async function openCreation(/** @type {string} */id){
  if(!canLeave())return;
  const epoch=++openEpoch;
  try{
    const found=await getCreation(id);if(epoch!==openEpoch||!canLeave())return;if(!found){toast(tt('这件作品不存在，可能已从备份中移除。','Creation not found. It may have been removed from a backup.'));return;}
    current=found;go('creations');if(!loaded)renderCreations();drawEditor(found);void refreshList();
  }catch(e){report(e);}
}
export async function newCard(){
  if(!canLeave())return;
  try{
    const saved=await saveCreation({id:newCreationId(),kind:'card',title:tt('新知识卡片','New knowledge card'),content:{text:''},style:normalizeStyle(),source:{type:'manual'},projectId:currentProjectId(),deleted:false},0);
    await openCreation(saved.id);
  }catch(e){report(e);}
}
/** @param {Creation} record */
function drawEditor(record){
  const host=document.getElementById('creationEditor');if(!host)return;
  const epoch=++editorEpoch;
  dirty=false;
  const s=normalizeStyle(record.style);
  host.innerHTML=`<div class="creation-toolbar"><span class="eyebrow">v${record.revision}</span><div id="creationActions"></div></div>
    <label class="creation-label">${tt('作品名称','Creation title')}<input class="input" id="creationTitle" maxlength="200" value="${esc(record.title)}"></label>
    <p id="creationSaveStatus" role="status">${tt('已保存到本机','Saved on this device')}</p>
    <div class="creation-style-controls"><label>${tt('风格','Style')}<select class="select" id="creationPreset">${STYLE_PRESETS.map(p=>`<option value="${p.id}">${tt(p.zh,p.en)}</option>`).join('')}</select></label>
    ${[['background','背景','Background'],['foreground','文字','Text'],['accent','强调色','Accent'],['surface','卡片底色','Card background']].map(([k,zh,en])=>`<label>${tt(zh,en)}<input type="color" data-style="${k}" value="${esc(/** @type {any} */(s)[k])}"></label>`).join('')}
    <label>${tt('字体','Font')}<select class="select" data-style="font"><option value="sans">${tt('无衬线','Sans')}</option><option value="serif">${tt('衬线','Serif')}</option><option value="mono">${tt('等宽','Mono')}</option></select></label>
    ${[['size','字号','Font size',12,28],['spacing','间距','Spacing',8,48],['radius','圆角','Corners',0,32]].map(([k,zh,en,min,max])=>`<label>${tt(String(zh),String(en))}<input class="input" type="number" data-style="${k}" min="${min}" max="${max}" value="${/** @type {any} */(s)[k]}"></label>`).join('')}</div>
    <label class="creation-label" ${record.kind==='widget'?'hidden':''}>${tt('内容','Content')}<textarea class="input" id="creationText" rows="8">${esc(record.content.text||'')}</textarea></label>
    <details ${record.kind==='widget'?'':'hidden'}><summary>${tt('高级：编辑 Widget HTML','Advanced: edit widget HTML')}</summary><p>${tt('自由 Widget 在隔离环境运行。修改 HTML 会重新加载组件；使用版本记录恢复原稿。','Freeform widgets run in isolation. Editing HTML reloads the widget; versions retain earlier drafts.')}</p><textarea class="input" id="creationHTML" rows="12" spellcheck="false">${esc(record.content.html||'')}</textarea></details>
    <div class="creation-toolbar" id="creationSaveActions"></div><div id="creationPreview"></div>
    <details><summary>${tt('修改记录（最近 20 个版本）','Version history (last 20 versions)')}</summary><div id="creationVersions"></div></details>`;
  const title=/** @type {HTMLInputElement} */(host.querySelector('#creationTitle'));
  const text=/** @type {HTMLTextAreaElement} */(host.querySelector('#creationText'));
  const html=/** @type {HTMLTextAreaElement} */(host.querySelector('#creationHTML'));
  const preset=/** @type {HTMLSelectElement} */(host.querySelector('#creationPreset'));preset.value=s.preset;
  /** @type {HTMLSelectElement} */(host.querySelector('[data-style="font"]')).value=s.font;
  let style={...s};
  const draft=()=>({...creationDraft(record),title:title.value,content:record.kind==='widget'?{...record.content,html:html.value}:{...record.content,text:text.value},style});
  const preview=()=>{const target=host.querySelector('#creationPreview');if(target)target.replaceChildren(renderWidget({id:record.id,title:title.value,html:creationHTML(draft()),minHeight:120},{style}));};
  const mark=()=>{dirty=true;const status=host.querySelector('#creationSaveStatus');if(status)status.textContent=tt('有未保存的修改','Unsaved changes');};
  let previewTimer=0;
  const changed=()=>{mark();clearTimeout(previewTimer);previewTimer=window.setTimeout(()=>{if(host.isConnected&&epoch===editorEpoch)preview();},250);};
  for(const input of [title,text,html])input.oninput=changed;
  for(const input of host.querySelectorAll('[data-style]')){
    const el=/** @type {HTMLInputElement} */(input);el.oninput=()=>{const key=el.dataset.style||'';style=normalizeStyle({...style,[key]:el.type==='number'?Number(el.value):el.value});changed();};
  }
  preset.onchange=()=>{
    style=normalizeStyle({preset:preset.value});
    for(const input of host.querySelectorAll('[data-style]')){const el=/** @type {HTMLInputElement} */(input);el.value=String(/** @type {any} */(style)[el.dataset.style||'']);}changed();
  };
  /** Run only against this editor's version, never the mutable global selection. */
  function lock(/** @type {boolean} */ value){
    busy=value;
    for(const control of host?.querySelectorAll('input,textarea,select,button')||[]) /** @type {HTMLInputElement} */(control).disabled=value;
  }
  async function saveDraft(){
    if(busy)return;lock(true);
    try{const saved=await saveCreation(draft(),record.revision);current=saved;dirty=false;drawEditor(saved);}
    catch(e){report(e);}finally{lock(false);}
  }
  const saveButton=button('保存修改','Save changes',saveDraft,'btn btn-accent');
  host.querySelector('#creationSaveActions')?.append(saveButton,button('放弃修改','Discard changes',()=>{if(!busy){dirty=false;drawEditor(record);}}));
  const actions=host.querySelector('#creationActions');
  actions?.append(button('导出 / 分享','Export / Share',async()=>{
    const card=/** @type {HTMLElement|null} */(host.querySelector('#creationPreview .widget-card'));
    if(card)await openExport(card,title.value);
  }));
  actions?.append(button('复制作品','Duplicate',async()=>{
    if(!canLeave())return;try{const copy=await saveCreation({...creationDraft(record),id:newCreationId(),title:record.title.slice(0,180)+tt(' · 副本',' · Copy'),deleted:false},0);await openCreation(copy.id);}catch(e){report(e);}
  }),button(record.deleted?'恢复作品':'移除作品',record.deleted?'Restore':'Remove',async()=>{
    if(!canLeave())return;lock(true);
    try{
      const saved=await saveCreation({...creationDraft(record),deleted:!record.deleted},record.revision);current=saved;drawEditor(saved);
      toastUndo(tt('作品状态已更新','Creation updated'),async()=>{const restored=await saveCreation(creationDraft(record),saved.revision);if(current?.id===record.id&&!dirty){current=restored;drawEditor(restored);}return true;});
    }catch(e){report(e);}finally{lock(false);}
  }),button('+ 新建','+ New',newCard));
  const versions=host.querySelector('#creationVersions');
  for(const old of [...record.history].reverse()){
    const row=document.createElement('div');row.className='set-row';const label=document.createElement('span');label.textContent='v'+old.revision+' · '+old.title;
    row.append(label,button('恢复此版本','Restore version',async()=>{if(!canLeave())return;lock(true);try{const saved=await saveCreation({...creationDraft(old),id:record.id},record.revision);current=saved;drawEditor(saved);}catch(e){report(e);}finally{lock(false);}}));versions?.appendChild(row);
  }
  preview();
}
window.addEventListener('seeker-creations-changed',()=>{void refreshList();});
window.addEventListener('seeker-rt-ready',()=>{void refreshList();});
