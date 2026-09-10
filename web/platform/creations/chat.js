// @ts-check
import {tt} from '../shell/i18n.js';
import {renderWidget,buildSrcDoc} from '../capability/widgets/render.js';
import {defaultWidgetStyle} from './style-preferences.js';
import {saveGeneratedWidget} from './store.js';
import {openCreation} from './page.js';
import {openExport} from './export.js';
/** Saved history stores only an owned creation ID, never executable parent actions.
 * @param {HTMLElement} host @param {unknown} id */
export function appendCreationLink(host,id){
  if(typeof id!=='string'||!/^cr_[a-zA-Z0-9_-]{1,80}$/.test(id))return;
  const button=document.createElement('button');button.className='btn';button.textContent=tt('打开已保存作品','Open saved creation');
  button.dataset.creationId=id;button.onclick=()=>{void openCreation(id);};host.appendChild(button);
}
/** @param {import('../runtime/types').WidgetPayload} widget @param {{conversationId?:string,projectId?:string,turnId?:string}} scope */
export function renderAndSaveWidget(widget,scope){
  const style=defaultWidgetStyle(),card=renderWidget(widget,{style});
  const bar=document.createElement('div');bar.className='creation-toolbar';card.appendChild(bar);
  const status=document.createElement('span');status.setAttribute('role','status');bar.appendChild(status);
  const exportButton=document.createElement('button');exportButton.className='btn';exportButton.textContent=tt('导出 / 分享','Export / Share');exportButton.onclick=()=>{void openExport(card,widget.title,undefined,{style,source:tt('AI 对话','AI chat'),offlineHTML:buildSrcDoc(widget.html,style)});};bar.appendChild(exportButton);
  /** @type {Promise<string|null>|null} */let inFlight=null;
  const retry=document.createElement('button');retry.className='btn';retry.textContent=tt('重试保存','Retry saving');retry.hidden=true;bar.appendChild(retry);
  function save(){
    if(inFlight)return inFlight;
    status.textContent=tt('正在保存作品…','Saving creation…');retry.hidden=true;
    inFlight=saveGeneratedWidget(widget,scope,style).then(saved=>{status.textContent=tt('已保存到我的作品','Saved to My creations');appendCreationLink(bar,saved.id);return saved.id;})
      .catch(()=>{status.textContent=tt('保存失败。请重试后再离开此页面。','Save failed. Retry before leaving this page.');retry.hidden=false;inFlight=null;return null;});
    return inFlight;
  }
  retry.onclick=()=>{void save();};
  return {card,saved:save()};
}
