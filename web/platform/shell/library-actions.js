// @ts-check
import { tt } from './i18n.js';
import { toast, errText } from './toast.js';
/** Trusted user action attached after rendering; model text is a plain value, never an action name.
 * @param {HTMLElement} host @param {string} text */
export function appendSaveAnswer(host,text) {
  if(!text?.trim())return;
  const button=document.createElement('button');button.className='btn-text';button.style.cssText='display:block;margin-top:12px;font-size:12px;';button.textContent=tt('保存为笔记','Save as note');
  button.onclick=async()=>{
    if(!window.SeekerShell.canSaveNote()){toast(tt('请在应用管理启用资料库','Enable Library in Apps first'));return;}
    button.disabled=true;
    try{await window.SeekerShell.saveNote({text,title:tt('对话摘录','Conversation excerpt')});button.textContent=tt('已保存到资料库','Saved to Library');toast(tt('已保存到资料库','Saved to Library'));}
    catch(e){toast(errText(e));button.disabled=false;}
  };
  host.appendChild(button);
  const create=document.createElement('button');create.className='btn-text';create.style.cssText='display:block;margin-top:8px;font-size:12px;';create.textContent=tt('整理成思维导图','Create a mind map');
  create.onclick=()=>window.SeekerShell.createFromText({text,title:tt('对话导图','Conversation mind map'),source:{type:'answer'}});host.appendChild(create);
}
