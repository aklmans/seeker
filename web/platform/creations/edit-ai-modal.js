// @ts-check
import {tt} from '../shell/i18n.js';
import {closeModal} from '../shell/modal.js';
import {openCreationModal} from './modal.js';
import {creationEditRequest,applyCreationEdit} from './edit-ai.js';
import {creationHTML} from './content.js';
import {buildSrcDoc} from '../capability/widgets/render.js';
/** Preview has no parent action port. Apply callback only receives the permitted content/style patch.
 * @param {'style'|'widget'} action @param {import('../runtime/types').CreationDraft} original
 * @param {()=>boolean} isCurrent @param {(next:import('../runtime/types').CreationDraft)=>void} apply */
export function openCreationEditAI(action,original,isCurrent,apply){
  if(!window.SeekerRT.available('textGeneration'))return;
  const modal=openCreationModal(action==='style'?tt('用文字调整作品风格','Describe a style change'):tt('用 AI 修改 Widget','Edit widget with AI'),`<p>${action==='style'?tt('只发送当前风格和修改要求，正文保持原样。默认样式与其他作品不受影响。','Only the current style and your request are sent. Content, defaults and other creations are kept.'):tt('发送这件 Widget 的源码、风格和修改要求。先检查交互结果，应用后仍需保存；可以恢复旧版本。','Sends this widget’s source, style and your request. Review interactions before applying, then save. Earlier versions remain recoverable.')}</p><label class="creation-label">${tt('希望怎样修改','Requested change')}<textarea class="input" id="creationAIRequest" maxlength="2000" rows="3"></textarea></label><button class="btn btn-accent" id="creationAIGenerate">${tt('生成预览','Generate preview')}</button><p id="creationAIStatus" role="status"></p><div id="creationAIPreview"></div>`,`<button class="btn" id="creationAICancel">${tt('取消','Cancel')}</button><button class="btn btn-accent" id="creationAIApply" disabled>${tt('应用到当前作品','Apply to this creation')}</button>`,true);
  if(!modal)return;
  const request=/** @type {HTMLTextAreaElement} */(modal.querySelector('#creationAIRequest'));
  const generate=/** @type {HTMLButtonElement} */(modal.querySelector('#creationAIGenerate'));
  const accept=/** @type {HTMLButtonElement} */(modal.querySelector('#creationAIApply'));
  const status=/** @type {HTMLElement} */(modal.querySelector('#creationAIStatus'));
  const preview=/** @type {HTMLElement} */(modal.querySelector('#creationAIPreview'));
  /** @type {import('../runtime/types').AiStream|null} */let stream=null;
  /** @type {import('../runtime/types').CreationDraft|null} */let proposed=null;
  let cancelled=false;
  const cancel=()=>{cancelled=true;stream?.cancel();};
  const observer=new MutationObserver(()=>{if(!modal.isConnected){cancel();observer.disconnect();}});
  if(modal.parentElement)observer.observe(modal.parentElement,{childList:true});
  /** @type {HTMLButtonElement} */(modal.querySelector('#creationAICancel')).onclick=()=>{cancel();closeModal();};
  request.oninput=()=>{proposed=null;accept.disabled=true;};
  generate.onclick=async()=>{
    generate.disabled=true;request.disabled=true;accept.disabled=true;proposed=null;preview.replaceChildren();
    try{status.textContent=tt('正在生成预览…','Generating preview…');stream=window.SeekerRT.ai.generate(creationEditRequest(action,original,request.value));const result=await stream.done;if(cancelled||!modal.isConnected)return;
      proposed=applyCreationEdit(action,original,result);
      const frame=document.createElement('iframe');frame.sandbox.add('allow-scripts');frame.title=tt('作品修改预览','Creation edit preview');frame.referrerPolicy='no-referrer';frame.style.cssText='width:100%;height:380px;border:.5px solid var(--border);';frame.srcdoc=buildSrcDoc(creationHTML(proposed),proposed.style);preview.append(frame);
      status.textContent=tt('请检查内容、颜色与交互，再应用。','Review the content, colors and interactions before applying.');accept.disabled=false;
    }catch(e){if(modal.isConnected)status.textContent=String(e);}finally{stream=null;generate.disabled=false;request.disabled=false;}
  };
  accept.onclick=()=>{try{if(!proposed)return;if(!isCurrent())throw Error(tt('作品已有修改，请重新打开此操作。','The creation changed. Reopen this operation.'));apply(proposed);observer.disconnect();closeModal();}catch(e){status.textContent=String(e);accept.disabled=true;}};
}
