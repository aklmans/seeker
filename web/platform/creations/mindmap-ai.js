// @ts-check
import {tt} from '../shell/i18n.js';
import {openModal,closeModal} from '../shell/modal.js';
import {mindRequest,completedCreationText,parseMindNode,applyMindResult} from './ai.js';
import {findNode,mindMap} from './mindmap-model.js';
import {mindMapSVG} from './mindmap-render.js';
/** @param {import('./mindmap-model.js').MindMap} original @param {string} id @param {'expand'|'shorten'} action
 * @param {{[k:string]:unknown}} style @param {()=>boolean} isCurrent
 * @param {(map:import('./mindmap-model.js').MindMap)=>void} apply */
export async function openMindAI(original,id,action,style,isCurrent,apply){
  if(!window.SeekerRT.available('textGeneration'))return;
  const selected=findNode(original.root,id);if(!selected)return;
  const modal=openModal(`<div class="modal-head"><h2>${action==='expand'?tt('扩展选中分支','Expand selected branch'):tt('精简选中分支','Shorten selected branch')}</h2><button class="x">×</button></div><p>${tt('只把选中分支发送给当前模型。查看结果后再应用；其他分支保持原样。','Only this branch is sent to the current model. Review before applying; other branches are kept.')}</p><p id="mindAIStatus" role="status"></p><div id="mindAIPreview" style="max-height:400px;overflow:auto"></div><div class="creation-toolbar"><button class="btn" id="mindAICancel">${tt('取消','Cancel')}</button><button class="btn btn-accent" id="mindAIApply" disabled>${tt('应用到当前分支','Apply to this branch')}</button></div>`,true);
  if(!modal)return;
  const status=/** @type {HTMLElement} */(modal.querySelector('#mindAIStatus'));
  const applyButton=/** @type {HTMLButtonElement} */(modal.querySelector('#mindAIApply'));
  /** @type {import('../runtime/types').AiStream|null} */let stream=null;
  let cancelled=false;
  const cancel=()=>{cancelled=true;stream?.cancel();};
  const observer=new MutationObserver(()=>{if(!modal.isConnected){cancel();observer.disconnect();}});
  if(modal.parentElement)observer.observe(modal.parentElement,{childList:true});
  /** @type {HTMLButtonElement} */(modal.querySelector('#mindAICancel')).onclick=()=>{cancel();closeModal();};
  try{
    status.textContent=tt('正在整理选中分支…','Working on this branch…');
    stream=window.SeekerRT.ai.generate(mindRequest(action,selected));
    const result=await stream.done;if(cancelled||!modal.isConnected)return;
    const next=applyMindResult(original,id,action,parseMindNode(completedCreationText(result)));
    const branch=findNode(next.root,id);if(!branch)throw Error('Missing branch');
    const preview=modal.querySelector('#mindAIPreview');if(preview)preview.innerHTML=mindMapSVG(mindMap({root:branch,layout:'tree'}),style);
    status.textContent=tt('请检查归纳是否符合原意。应用后仍可撤销，保存后保留版本。','Check the meaning. Applying is undoable; saving retains a version.');applyButton.disabled=false;
    applyButton.onclick=()=>{try{if(!isCurrent())throw Error(tt('导图已有修改，请重新生成。','The map changed. Generate again.'));apply(next);closeModal();}catch(e){status.textContent=String(e);applyButton.disabled=true;}};
  }catch(e){if(modal.isConnected)status.textContent=String(e);}
  finally{observer.disconnect();}
}
