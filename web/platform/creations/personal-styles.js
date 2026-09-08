// @ts-check
import {tt} from '../shell/i18n.js';
import {closeModal} from '../shell/modal.js';
import {openCreationModal} from './modal.js';
import {toast,toastUndo,errText} from '../shell/toast.js';
import {STYLE_PRESETS,normalizeStyle} from './style.js';
import {creationStylePreference,saveCreationStylePreference} from './style-preferences.js';
import {newCreationId,saveCreation} from './store.js';
import {creationDraft} from '../runtime/creation-model.js';
/** @returns {Promise<import('../runtime/types').CreationRecord[]>} */
export async function personalStyles(){
  const rows=await window.SeekerRT.db.list('platform_creations');
  return /** @type {import('../runtime/types').CreationRecord[]} */(/** @type {unknown} */(rows.filter(r=>r.kind==='style'&&!r.deleted))).sort((a,b)=>b.updatedAt-a.updatedAt);
}
/** Saving a style never changes defaults or another creation. @param {{[k:string]:unknown}} input */
export function openSaveStyle(input){
  const style=normalizeStyle(input);
  const modal=openCreationModal(tt('保存到我的样式','Save to My styles'),`<p>${tt('保存这一套颜色、字体和排版，之后可应用到其他作品。','Save these colors, fonts and layout controls to reuse in other creations.')}</p><label class="creation-label">${tt('样式名称','Style name')}<input class="input" id="personalStyleName" maxlength="100"></label><p id="personalStyleStatus" role="status"></p>`,`<button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="personalStyleSave">${tt('保存样式','Save style')}</button>`);
  if(!modal)return;
  const name=/** @type {HTMLInputElement} */(modal.querySelector('#personalStyleName'));
  const save=/** @type {HTMLButtonElement} */(modal.querySelector('#personalStyleSave'));
  save.onclick=async()=>{save.disabled=true;name.disabled=true;try{
    if(!name.value.trim())throw Error(tt('请填写样式名称','Enter a style name'));
    await saveCreation({id:newCreationId(),kind:'style',title:name.value.trim(),content:{},style,source:{type:'manual-style'},projectId:'',deleted:false},0);
    if(modal.isConnected)closeModal();toast(tt('已保存到我的样式','Saved to My styles'));
  }catch(e){const status=modal.querySelector('#personalStyleStatus');if(status)status.textContent=errText(e);}finally{save.disabled=false;name.disabled=false;}};
}
/** @param {HTMLSelectElement} select @param {(style:import('./style').CreationStyle)=>void} apply */
export async function mountPersonalStylePicker(select,apply){
  try{const rows=await personalStyles();if(!select.isConnected)return;
    select.replaceChildren(new Option(tt('选择我的样式…','Choose a saved style…'),''));
    for(const row of rows)select.add(new Option(row.title,row.id));
    select.onchange=()=>{const row=rows.find(r=>r.id===select.value);if(row){apply(normalizeStyle(row.style));select.value='';}};
  }catch{select.replaceChildren(new Option(tt('样式读取失败，请重新打开','Could not load styles; reopen'),''));}
}
/** Trusted settings surface, with reversible removal and an explicit copied default.
 * @param {HTMLElement|null} host */
export async function renderCreationStyleSettings(host){
  if(!host)return;host.textContent=tt('正在读取样式…','Loading styles…');
  try{
    const rows=await personalStyles();if(!host.isConnected)return;host.replaceChildren();
    const current=creationStylePreference();
    const info=document.createElement('p');info.textContent=tt('默认样式：','Default style: ')+(current.name||tt('极简','Minimal'));host.append(info);
    const help=document.createElement('p');help.textContent=tt('选择后仅影响新作品。默认值是当前样式的副本，移除收藏不会改变它。AI 对话不能修改此设置。','Applies to new creations. The default is a copy; removing a saved style keeps it. AI chat cannot change this setting.');host.append(help);
    const select=document.createElement('select');select.id='creationDefaultStyle';select.className='select';select.setAttribute('aria-label',tt('默认作品样式','Default creation style'));
    select.add(new Option(tt('请选择…','Choose…'),''));
    for(const preset of STYLE_PRESETS)select.add(new Option(tt(preset.zh,preset.en),'preset:'+preset.id));
    for(const row of rows)select.add(new Option(tt('我的样式 · ','My style · ')+row.title,row.id));
    const status=document.createElement('p');status.setAttribute('role','status');status.id='creationDefaultStatus';
    const save=document.createElement('button');save.className='btn btn-accent';save.id='creationDefaultSave';save.textContent=tt('设为新作品默认样式','Set default for new creations');
    save.onclick=()=>{try{
      const preset=STYLE_PRESETS.find(p=>'preset:'+p.id===select.value),row=rows.find(r=>r.id===select.value);
      if(!preset&&!row)throw Error(tt('请先选择样式','Choose a style first'));
      const name=preset?tt(preset.zh,preset.en):/** @type {NonNullable<typeof row>} */(row).title;
      saveCreationStylePreference(name,preset||/** @type {NonNullable<typeof row>} */(row).style);info.textContent=tt('默认样式：','Default style: ')+name;status.textContent=tt('已保存，仅影响之后的新作品','Saved; applies to new creations');
    }catch(e){status.textContent=errText(e);}};
    const toolbar=document.createElement('div');toolbar.className='creation-toolbar';toolbar.append(select,save);host.append(toolbar,status);
    const heading=document.createElement('h3');heading.textContent=tt('我的样式','My styles');host.append(heading);
    if(!rows.length){const empty=document.createElement('p');empty.textContent=tt('在作品编辑页调整风格，再选择“保存到我的样式”。','Adjust a creation, then choose Save to My styles.');host.append(empty);}
    for(const row of rows){
      const line=document.createElement('div');line.className='creation-toolbar';
      const name=document.createElement('input');name.className='input';name.value=row.title;name.maxLength=100;name.setAttribute('aria-label',tt('样式名称','Style name'));
      const rename=document.createElement('button');rename.className='btn';rename.textContent=tt('保存名称','Save name');
      const remove=document.createElement('button');remove.className='btn';remove.textContent=tt('移除样式','Remove style');
      const lock=(/** @type {boolean} */v)=>{name.disabled=v;rename.disabled=v;remove.disabled=v;};
      rename.onclick=async()=>{lock(true);try{await saveCreation({...creationDraft(row),title:name.value.trim()},row.revision);await renderCreationStyleSettings(host);}catch(e){status.textContent=errText(e);}finally{lock(false);}};
      remove.onclick=async()=>{lock(true);try{const removed=await saveCreation({...creationDraft(row),deleted:true},row.revision);await renderCreationStyleSettings(host);toastUndo(tt('样式已移除','Style removed'),async()=>{await saveCreation(creationDraft(row),removed.revision);await renderCreationStyleSettings(host);return true;});}catch(e){status.textContent=errText(e);}finally{lock(false);}};
      line.append(name,rename,remove);host.append(line);
    }
  }catch(e){if(host.isConnected)host.textContent=errText(e);}
}
