// @ts-check
import {tt} from '../shell/i18n.js';
import {frontis,go} from '../shell/nav.js';
import {toast,toastUndo,errText} from '../shell/toast.js';
import {currentProjectId} from '../shell/project-state.js';
import {renderWidget,buildSrcDoc} from '../capability/widgets/render.js';
import {mountMindMapEditor} from './mindmap-editor.js';
import {mountStructuredEditor} from './structured-editor.js';
import {mindMap,outlineToMindMap,mindMapMarkdown} from './mindmap-model.js';
import {mindMapSVG,layoutMindMap} from './mindmap-render.js';
import {openModal,closeModal} from '../shell/modal.js';
import {mindRequest,completedCreationText,parseMindNode} from './ai.js';
import {openMindAI} from './mindmap-ai.js';
import {openCreationEditAI} from './edit-ai-modal.js';
import {creationDraft} from '../runtime/creation-model.js';
import {newCreationId,getCreation,saveCreation} from './store.js';
import {STYLE_PRESETS,normalizeStyle} from './style.js';
import {defaultCreationStyle} from './style-preferences.js';
import {mountPersonalStylePicker,openSaveStyle} from './personal-styles.js';
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
  host.querySelector('#creationNew')?.appendChild(button('+ 新建思维导图','+ New mind map',()=>openCreationComposer(),'btn'));
  host.querySelector('#creationNew')?.append(button('+ 新建对比表','+ New comparison',()=>newStructured('comparison')),button('+ 新建时间线','+ New timeline',()=>newStructured('timeline')));
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
      const kinds={widget:'Widget',mindmap:tt('思维导图','Mind map'),card:tt('知识卡片','Knowledge card'),comparison:tt('对比表','Comparison'),timeline:tt('时间线','Timeline')};
      const meta=document.createElement('small');meta.textContent=(/** @type {any} */(kinds)[String(row.kind)]||tt('作品','Creation'))+' · v'+String(row.revision||'?');b.appendChild(meta);host.appendChild(b);
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
    const saved=await saveCreation({id:newCreationId(),kind:'card',title:tt('新知识卡片','New knowledge card'),content:{text:''},style:defaultCreationStyle(),source:{type:'manual'},projectId:currentProjectId(),deleted:false},0);
    await openCreation(saved.id);
  }catch(e){report(e);}
}
/** @param {'comparison'|'timeline'} kind */
async function newStructured(kind){
  if(!canLeave())return;
  const content=kind==='comparison'?{columns:[tt('比较项目','Criterion'),tt('方案 A','Option A'),tt('方案 B','Option B')],rows:[[tt('适合场景','Best for'),'',''],[tt('需要考虑','Considerations'),'','']]}:{events:[{when:tt('第一步','Step 1'),title:tt('开始','Start'),detail:''}]};
  try{const saved=await saveCreation({id:newCreationId(),kind,title:kind==='comparison'?tt('新对比表','New comparison'):tt('新时间线','New timeline'),content,style:defaultCreationStyle(),source:{type:'manual'},projectId:currentProjectId(),deleted:false},0);await openCreation(saved.id);}catch(e){report(e);}
}
function openNewCreation(){
  if(!canLeave())return;
  const modal=openModal(`<div class="modal-head"><h2>${tt('新建作品','New creation')}</h2><button class="x">×</button></div><div class="creation-toolbar" id="creationKindChoices"></div>`,true);
  const choose=(/** @type {()=>unknown} */fn)=>()=>{closeModal();void fn();};
  modal?.querySelector('#creationKindChoices')?.append(button('知识卡片','Knowledge card',choose(newCard)),button('思维导图','Mind map',choose(()=>openCreationComposer())),button('对比表','Comparison',choose(()=>newStructured('comparison'))),button('时间线','Timeline',choose(()=>newStructured('timeline'))));
}
/** Trusted UI entry shared by selected answers, notes and files. No implicit library reads.
 * @param {{text?:string,title?:string,source?:{[k:string]:unknown}}} [input] */
export function openCreationComposer(input={}){
  if(!canLeave())return;
  const modal=openModal(`<div class="modal-head"><h2>${tt('创建思维导图','Create a mind map')}</h2><button class="x">×</button></div><label class="creation-label">${tt('标题','Title')}<input class="input" id="mindCreateTitle" maxlength="200" value="${esc(input.title||tt('我的导图','My mind map'))}"></label><label class="creation-label">${tt('大纲或选中的文字','Outline or selected text')}<textarea class="input" id="mindCreateText" rows="12" maxlength="30000">${esc(input.text||'')}</textarea></label><p>${tt('每行一个节点；用两个空格缩进表示子节点。支持 Markdown 标题和列表。不调用模型。','One node per line; indent with two spaces for children. Markdown headings and lists are supported. No model call.')}</p><p id="mindCreateStatus" role="status"></p><button class="btn btn-accent" id="mindCreateSave">${tt('从大纲创建','Create from outline')}</button>`,true);
  if(!modal)return;
  const save=/** @type {HTMLButtonElement} */(modal.querySelector('#mindCreateSave'));
  save.onclick=async()=>{save.disabled=true;try{
    const title=/** @type {HTMLInputElement} */(modal.querySelector('#mindCreateTitle')).value;
    const text=/** @type {HTMLTextAreaElement} */(modal.querySelector('#mindCreateText')).value;
    const content=outlineToMindMap(title,text);
    const created=await saveCreation({id:newCreationId(),kind:'mindmap',title,content,style:defaultCreationStyle(),source:input.source||{type:'manual'},projectId:currentProjectId(),deleted:false},0);
    closeModal();await openCreation(created.id);
  }catch(e){const status=modal.querySelector('#mindCreateStatus');if(status)status.textContent=String(e);}finally{save.disabled=false;}};
  const aiButton=button('用 AI 整理成导图','Organize with AI',async()=>{
    /** @type {import('../runtime/types').AiStream|null} */let stream=null;
    const observer=new MutationObserver(()=>{if(!modal.isConnected){stream?.cancel();observer.disconnect();}});
    if(modal.parentElement)observer.observe(modal.parentElement,{childList:true});
    const status=/** @type {HTMLElement} */(modal.querySelector('#mindCreateStatus'));
    const controls=[...modal.querySelectorAll('input,textarea,button:not(.x)')].map(n=>/** @type {HTMLInputElement} */(n));
    try{
      const title=/** @type {HTMLInputElement} */(modal.querySelector('#mindCreateTitle')).value;
      const text=/** @type {HTMLTextAreaElement} */(modal.querySelector('#mindCreateText')).value;
      const req=mindRequest('create',text,title);controls.forEach(c=>c.disabled=true);status.textContent=tt('只发送上方文字，正在生成…','Sending only the text above; generating…');
      stream=window.SeekerRT.ai.generate(req);const result=await stream.done;if(!modal.isConnected)return;
      const content=mindMap({root:parseMindNode(completedCreationText(result)),layout:'bilateral'});
      const created=await saveCreation({id:newCreationId(),kind:'mindmap',title,content,style:defaultCreationStyle(),source:input.source||{type:'selected-text'},projectId:currentProjectId(),deleted:false},0);
      if(modal.isConnected){closeModal();await openCreation(created.id);}
    }catch(e){if(modal.isConnected)status.textContent=String(e);}finally{observer.disconnect();controls.forEach(c=>c.disabled=false);}
  });
  aiButton.id='mindCreateAI';aiButton.disabled=!window.SeekerRT.available('textGeneration');modal.appendChild(aiButton);
  const info=document.createElement('p');info.textContent=aiButton.disabled?tt('AI 整理需要桌面版与已连接的模型；手动大纲在此可用。','AI organization needs the desktop app and a connected model; manual outlines work here.'):tt('AI 整理只发送上方文字给当前模型。原笔记与文件保持原样。','AI organization sends only the text above to the current model. Original notes and files are kept.');modal.appendChild(info);
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
    <div class="creation-toolbar"><label>${tt('我的样式','My styles')} <select class="select" id="creationPersonalStyle"><option>${tt('读取中…','Loading…')}</option></select></label><div id="creationStyleActions"></div></div>
    <div class="creation-style-controls"><label>${tt('风格','Style')}<select class="select" id="creationPreset">${STYLE_PRESETS.map(p=>`<option value="${p.id}">${tt(p.zh,p.en)}</option>`).join('')}</select></label>
    ${[['background','背景','Background'],['foreground','文字','Text'],['accent','强调色','Accent'],['surface','卡片底色','Card background']].map(([k,zh,en])=>`<label>${tt(zh,en)}<input type="color" data-style="${k}" value="${esc(/** @type {any} */(s)[k])}"></label>`).join('')}
    <label>${tt('字体','Font')}<select class="select" data-style="font"><option value="sans">${tt('无衬线','Sans')}</option><option value="serif">${tt('衬线','Serif')}</option><option value="mono">${tt('等宽','Mono')}</option></select></label>
    <label ${record.kind==='mindmap'?'':'hidden'}>${tt('连线','Connectors')}<select class="select" data-style="edge"><option value="curve">${tt('曲线','Curves')}</option><option value="line">${tt('直线','Lines')}</option><option value="sketch">${tt('手绘虚线','Sketch')}</option></select></label>
    ${[['size','字号','Font size',12,28],['spacing','间距','Spacing',8,48],['radius','圆角','Corners',0,32]].map(([k,zh,en,min,max])=>`<label>${tt(String(zh),String(en))}<input class="input" type="number" data-style="${k}" min="${min}" max="${max}" value="${/** @type {any} */(s)[k]}"></label>`).join('')}</div>
    <label class="creation-label" ${record.kind!=='card'?'hidden':''}>${tt('内容','Content')}<textarea class="input" id="creationText" rows="8">${esc(record.content.text||'')}</textarea></label>
    <details ${record.kind==='widget'?'':'hidden'}><summary>${tt('高级：编辑 Widget HTML','Advanced: edit widget HTML')}</summary><p>${tt('自由 Widget 在隔离环境运行。修改 HTML 会重新加载组件；使用版本记录恢复原稿。','Freeform widgets run in isolation. Editing HTML reloads the widget; versions retain earlier drafts.')}</p><textarea class="input" id="creationHTML" rows="12" spellcheck="false">${esc(record.content.html||'')}</textarea></details>
    <div class="creation-toolbar" id="creationSaveActions"></div><div id="creationMindEditor"></div><div id="creationStructuredEditor"></div><div id="creationPreview"></div>
    <details><summary>${tt('修改记录（最近 20 个版本）','Version history (last 20 versions)')}</summary><div id="creationVersions"></div></details>`;
  const title=/** @type {HTMLInputElement} */(host.querySelector('#creationTitle'));
  const text=/** @type {HTMLTextAreaElement} */(host.querySelector('#creationText'));
  const html=/** @type {HTMLTextAreaElement} */(host.querySelector('#creationHTML'));
  const preset=/** @type {HTMLSelectElement} */(host.querySelector('#creationPreset'));preset.value=s.preset;
  /** @type {HTMLSelectElement} */(host.querySelector('[data-style="font"]')).value=s.font;
  /** @type {HTMLSelectElement} */(host.querySelector('[data-style="edge"]')).value=s.edge;
  let style={...s};
  /** @type {ReturnType<typeof mountMindMapEditor>|null} */let mindEditor=null;
  /** @type {ReturnType<typeof mountStructuredEditor>|null} */let structuredEditor=null;
  const draft=()=>({...creationDraft(record),title:title.value,content:mindEditor?mindEditor.value():structuredEditor?structuredEditor.value():record.kind==='widget'?{...record.content,html:html.value}:{...record.content,text:text.value},style});
  const preview=()=>{previewPending=false;if(mindEditor){mindEditor.refresh();return;}const target=host.querySelector('#creationPreview');if(target)try{target.replaceChildren(renderWidget({id:record.id,title:title.value,html:creationHTML(draft()),minHeight:120},{style}));}catch(e){target.textContent=tt('请完成内容后预览：','Complete the content to preview: ')+String(e);}};
  const mark=()=>{dirty=true;const status=host.querySelector('#creationSaveStatus');if(status)status.textContent=tt('有未保存的修改','Unsaved changes');};
  let previewTimer=0,previewPending=false;
  const changed=()=>{mark();previewPending=true;clearTimeout(previewTimer);previewTimer=window.setTimeout(()=>{if(host.isConnected&&epoch===editorEpoch)preview();},250);};
  for(const input of [title,text,html])input.oninput=changed;
  for(const input of host.querySelectorAll('[data-style]')){
    const el=/** @type {HTMLInputElement} */(input);el.oninput=()=>{const key=el.dataset.style||'';style=normalizeStyle({...style,[key]:el.type==='number'?Number(el.value):el.value});changed();};
  }
  const applyStyle=(/** @type {import('./style').CreationStyle} */next)=>{
    style=normalizeStyle(next);preset.value=style.preset;
    for(const input of host.querySelectorAll('[data-style]')){const el=/** @type {HTMLInputElement} */(input);el.value=String(/** @type {any} */(style)[el.dataset.style||'']);}changed();
  };
  preset.onchange=()=>applyStyle(normalizeStyle({preset:preset.value}));
  const personalPicker=/** @type {HTMLSelectElement} */(host.querySelector('#creationPersonalStyle'));
  void mountPersonalStylePicker(personalPicker,applyStyle);
  const refreshStyles=()=>{if(epoch===editorEpoch&&host.isConnected)void mountPersonalStylePicker(personalPicker,applyStyle);else window.removeEventListener('seeker-creations-changed',refreshStyles);};
  window.addEventListener('seeker-creations-changed',refreshStyles);
  host.querySelector('#creationStyleActions')?.append(button('保存到我的样式','Save to My styles',()=>openSaveStyle(style)));
  const editWithAI=(/** @type {'style'|'widget'} */action)=>{try{const original=draft(),stamp=JSON.stringify(original);openCreationEditAI(action,original,()=>epoch===editorEpoch&&JSON.stringify(draft())===stamp,next=>{if(action==='widget'){html.value=String(next.content.html);changed();}else applyStyle(normalizeStyle(next.style));});}catch(e){report(e);}};
  if(window.SeekerRT.available('textGeneration')){
    host.querySelector('#creationStyleActions')?.append(button('用文字调风格','Describe style change',()=>editWithAI('style')));
    if(record.kind==='widget')host.querySelector('#creationSaveActions')?.append(button('AI 修改 Widget','Edit widget with AI',()=>editWithAI('widget')));
  }
  /** Run only against this editor's version, never the mutable global selection. */
  /** @type {Map<HTMLInputElement,boolean>} */const disabledBefore=new Map();
  function lock(/** @type {boolean} */ value){
    busy=value;
    if(value){for(const node of host?.querySelectorAll('input,textarea,select,button')||[]){const control=/** @type {HTMLInputElement} */(node);disabledBefore.set(control,control.disabled);control.disabled=true;}}
    else{for(const [control,disabled] of disabledBefore)if(control.isConnected)control.disabled=disabled;disabledBefore.clear();}
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
    if(previewPending){clearTimeout(previewTimer);preview();}
    const source=String(record.source.title||({note:tt('笔记','Note'),file:tt('本地文件','Local file'),answer:tt('对话回答','Chat answer'),chat:tt('AI 对话','AI chat')}[String(record.source.type)]||''));
    if(mindEditor){try{const map=mindEditor.value(),size=layoutMindMap(map,style);await openExport(null,title.value,{html:buildSrcDoc(mindMapSVG(map,style),style),width:Math.min(1600,size.width+style.spacing*2)},{style,source});}catch(e){report(e);}return;}
    const card=/** @type {HTMLElement|null} */(host.querySelector('#creationPreview .widget-card'));
    if(card)await openExport(card,title.value,undefined,{style,source,...(record.kind==='widget'?{offlineHTML:buildSrcDoc(html.value,style)}:{})});
    else toast(tt('请先完成作品内容，再导出。','Complete the creation content before exporting.'));
  }));
  actions?.append(button('复制作品','Duplicate',async()=>{
    if(!canLeave())return;try{const copy=await saveCreation({...creationDraft(record),id:newCreationId(),title:record.title.slice(0,180)+tt(' · 副本',' · Copy'),deleted:false},0);await openCreation(copy.id);}catch(e){report(e);}
  }),button(record.deleted?'恢复作品':'移除作品',record.deleted?'Restore':'Remove',async()=>{
    if(!canLeave())return;lock(true);
    try{
      const saved=await saveCreation({...creationDraft(record),deleted:!record.deleted},record.revision);current=saved;drawEditor(saved);
      toastUndo(tt('作品状态已更新','Creation updated'),async()=>{const restored=await saveCreation(creationDraft(record),saved.revision);if(current?.id===record.id&&!dirty){current=restored;drawEditor(restored);}return true;});
    }catch(e){report(e);}finally{lock(false);}
  }),button('+ 新建','+ New',openNewCreation));
  actions?.append(button('+ 导图','+ Mind map',()=>openCreationComposer()));
  const versions=host.querySelector('#creationVersions');
  for(const old of [...record.history].reverse()){
    const row=document.createElement('div');row.className='set-row';const label=document.createElement('span');label.textContent='v'+old.revision+' · '+old.title;
    row.append(label,button('恢复此版本','Restore version',async()=>{if(!canLeave())return;lock(true);try{const saved=await saveCreation({...creationDraft(old),id:record.id},record.revision);current=saved;drawEditor(saved);}catch(e){report(e);}finally{lock(false);}}));versions?.appendChild(row);
  }
  if(record.kind==='mindmap'){
    mindEditor=mountMindMapEditor(/** @type {HTMLElement} */(host.querySelector('#creationMindEditor')),mindMap(record.content),()=>style,()=>mark(),window.SeekerRT.available('textGeneration')?(action,id)=>{
      if(!mindEditor)return;try{const original=mindEditor.value(),stamp=JSON.stringify(original);void openMindAI(original,id,action,style,()=>epoch===editorEpoch&&!!mindEditor&&JSON.stringify(mindEditor.value())===stamp,next=>mindEditor?.replace(next));}catch(e){report(e);}
    }:undefined);
    actions?.append(button('导出 Markdown 大纲','Export Markdown outline',async()=>{try{await window.SeekerRT.render.markdown(title.value,mindMapMarkdown(/** @type {NonNullable<typeof mindEditor>} */(mindEditor).value()));toast(tt('大纲已导出','Outline exported'));}catch(e){report(e);}}));
    actions?.append(button('导出 SVG','Export SVG',async()=>{try{await window.SeekerRT.render.creationSVG(title.value,mindMapSVG(/** @type {NonNullable<typeof mindEditor>} */(mindEditor).value(),style));toast(tt('SVG 已导出','SVG exported'));}catch(e){report(e);}}));
  }else{
    if(record.kind==='comparison'||record.kind==='timeline')structuredEditor=mountStructuredEditor(/** @type {HTMLElement} */(host.querySelector('#creationStructuredEditor')),record.kind,record.content,changed);
    preview();
  }
}
window.addEventListener('seeker-creations-changed',()=>{void refreshList();});
window.addEventListener('seeker-rt-ready',()=>{void refreshList();});
