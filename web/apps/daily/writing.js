// @ts-check
import { tt } from '../../platform/shell/i18n.js';
import { frontis, signFoot, go } from '../../platform/shell/nav.js';
import { mdRender } from '../../platform/shell/md-edit.js';
import { toast, errText } from '../../platform/shell/toast.js';
import { MODES, LANGUAGES, TONES, LENGTHS, REPLIES, writingRequest, completeWriting } from './writing-model.js';

/** @type {import('./writing-model').WritingInput} */
const input = {mode:'translate',language:'en',tone:'neutral',length:'brief',reply:'acknowledge',text:''};
let result='', partial='', error='', busy=false, cancelled=false;
/** Snapshot ties output and save metadata to the request which actually produced it. */
let resultTitle='';
/** @type {import('../../platform/runtime/types').AiStream|undefined} */ let stream;
/** @param {unknown} value */
const esc = value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/** @param {string} mode */
export function openWriting(mode) { if(!busy && MODES.some(m=>m.id===mode)){input.mode=mode;result='';partial='';error='';}renderWriting();go('tools'); }

export function renderWriting() {
  const host=document.querySelector('#page-tools');if(!host)return;
  const supported=window.SeekerRT?.available('textGeneration')===true;
  /** @param {string} id @param {string} label @param {{id:string,zh:string,en:string}[]} choices @param {string} selected */
  const select=(id,label,choices,selected)=>`<label style="display:grid;gap:6px;">${label}<select class="input" id="${id}" ${busy?'disabled':''}>${choices.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${tt(c.zh,c.en)}</option>`).join('')}</select></label>`;
  host.innerHTML=frontis('TOOLS',tt('处理一段文字','Work on a piece of text'))
    +`<div class="sec" style="display:flex;flex-wrap:wrap;gap:8px;">${MODES.map(m=>`<button class="btn ${m.id===input.mode?'btn-accent':''}" data-writing-mode="${m.id}" aria-pressed="${m.id===input.mode}" ${busy?'disabled':''}>${tt(m.zh,m.en)}</button>`).join('')}</div>`
    +`<div class="sec"><div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">${input.mode==='translate'?select('writingLanguage',tt('翻译成','Translate into'),LANGUAGES,input.language):''}${['polish','reply'].includes(input.mode)?select('writingTone',tt('语气','Tone'),TONES,input.tone):''}${input.mode==='summarize'?select('writingLength',tt('摘要长度','Summary length'),LENGTHS,input.length):''}${input.mode==='reply'?select('writingReply',tt('回复意图','Reply intent'),REPLIES,input.reply):''}</div>
      <label for="writingInput">${input.mode==='reply'?tt('对方的消息','Message to reply to'):tt('原文','Source text')}</label><textarea class="input" id="writingInput" rows="10" style="width:100%;margin:8px 0;resize:vertical;" ${busy?'readonly':''} placeholder="${tt('在这里粘贴文字…','Paste text here…')}">${esc(input.text)}</textarea>
      <p style="font-size:12px;color:var(--ink-3);line-height:1.8;">${supported?tt('开始后，仅把上面的文字和所选处理方式发送给当前模型。最多 12,000 字符。','Starting sends only the text above and your selected operation to the current model. Limit: 12,000 characters.'):tt('网页版暂不支持独立写作工具。请在桌面版连接模型后使用；笔记和浏览器聊天仍可用。','Dedicated writing tools require a connected model in the desktop app. Notes and browser chat remain available.')}</p>
      <button class="btn btn-accent" id="writingRun" ${busy||!supported?'disabled':''}>${busy?tt('处理中…','Working…'):tt('开始处理','Start')}</button> ${busy?`<button class="btn" id="writingCancel">${tt('取消','Cancel')}</button>`:`<button class="btn" data-go="settings">${tt('模型设置','Model settings')}</button>`}
    </div><div class="sec" id="writingOutput"></div>`+signFoot();
  host.querySelectorAll('[data-writing-mode]').forEach(el=>{const b=/** @type {HTMLButtonElement} */(el);b.onclick=()=>openWriting(b.dataset.writingMode||'');});
  const text=/** @type {HTMLTextAreaElement} */(host.querySelector('#writingInput'));text.oninput=()=>{input.text=text.value;};
  for(const [id,key] of [['writingLanguage','language'],['writingTone','tone'],['writingLength','length'],['writingReply','reply']]) {
    const el=/** @type {HTMLSelectElement|null} */(host.querySelector('#'+id));if(el)el.onchange=()=>{input[/** @type {'language'|'tone'|'length'|'reply'} */(key)]=el.value;};
  }
  const run=/** @type {HTMLButtonElement} */(host.querySelector('#writingRun'));run.onclick=()=>{runWriting();};
  const cancel=/** @type {HTMLButtonElement|null} */(host.querySelector('#writingCancel'));if(cancel)cancel.onclick=()=>{cancelled=true;stream?.cancel();cancel.disabled=true;cancel.textContent=tt('正在取消…','Cancelling…');};
  renderOutput();
}

function renderOutput() {
  const host=document.querySelector('#writingOutput');if(!host)return;
  host.innerHTML=`<h3>${tt('处理结果','Result')}</h3>`+(error?`<p role="alert" style="line-height:1.8;">${esc(error)}</p><button class="btn" id="writingRetry">${tt('重试','Retry')}</button>`:'')
    +(busy?`<p role="status">${tt('正在生成，完成后可保存。','Generating. You can save when it is complete.')}</p>`:'')
    +(result||partial?`<div class="md-body" id="writingResult">${mdRender(result||partial)}</div>`:`<p style="color:var(--ink-3);">${tt('结果会显示在这里。','The result will appear here.')}</p>`)
    +(result&&!busy?`<div style="display:flex;gap:8px;margin-top:20px;"><button class="btn" id="writingCopy">${tt('复制','Copy')}</button><button class="btn" id="writingAgain">${tt('重新生成','Generate again')}</button><button class="btn btn-accent" id="writingSave" ${window.SeekerShell.canSaveNote()?'':'disabled'}>${tt('保存笔记','Save note')}</button></div>${window.SeekerShell.canSaveNote()?'':`<p>${tt('请在应用管理启用资料库以保存笔记。','Enable Library in Apps to save notes.')}</p>`}`:'');
  const retry=/** @type {HTMLButtonElement|null} */(host.querySelector('#writingRetry'));if(retry)retry.onclick=()=>{runWriting();};
  const again=/** @type {HTMLButtonElement|null} */(host.querySelector('#writingAgain'));if(again)again.onclick=()=>{runWriting();};
  const copy=/** @type {HTMLButtonElement|null} */(host.querySelector('#writingCopy'));if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(result);toast(tt('已复制','Copied'));}catch(e){toast(errText(e));}};
  const save=/** @type {HTMLButtonElement|null} */(host.querySelector('#writingSave'));if(save)save.onclick=async()=>{save.disabled=true;try{await window.SeekerShell.saveNote({text:result,title:resultTitle});toast(tt('已保存到资料库','Saved to Library'));}catch(e){toast(errText(e));}finally{save.disabled=!window.SeekerShell.canSaveNote();}};
}

async function runWriting() {
  if(busy)return;
  if(!window.SeekerRT.available('textGeneration'))return;
  let req;
  try{req=writingRequest({...input});}catch(e){error=e instanceof Error?e.message:String(e);renderOutput();return;}
  const mode=MODES.find(m=>m.id===input.mode);
  resultTitle=tt(mode?.zh||'文字处理',mode?.en||'Writing')+' · '+input.text.split('\n')[0].slice(0,40);
  busy=true;cancelled=false;result='';partial='';error='';renderWriting();
  try{
    stream=window.SeekerRT.ai.generate(req,{onToken:token=>{if(!cancelled){partial+=token;renderOutput();}}});
    const done=await stream.done;
    if(cancelled)throw new Error(tt('已取消，输入已保留','Cancelled; your input is kept'));
    result=completeWriting(done);
  }catch(e){error=e instanceof Error?e.message:String(e);}finally{partial='';stream=undefined;busy=false;renderWriting();}
}
window.addEventListener('seeker-rt-ready',renderWriting);
