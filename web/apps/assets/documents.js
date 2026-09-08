// @ts-check
import { tt } from '../../platform/shell/i18n.js';
import { go, frontis, signFoot } from '../../platform/shell/nav.js';
import { mdRender } from '../../platform/shell/md-edit.js';
import { toast, toastUndo, errText } from '../../platform/shell/toast.js';
import { saveNote } from './note-store.js';

/** @type {import('../../platform/runtime/types').LibraryDocumentInfo[]} */ let documents=[];
/** @type {import('../../platform/runtime/types').LibraryDocument|undefined} */ let selected;
/** @type {import('../../platform/runtime/types').LibraryAnswer|undefined} */ let answer;
/** @type {ReturnType<import('../../platform/runtime/types').LibraryApi['answer']>|undefined} */ let request;
let importing=false,query='',question='',answerError='',listError='',lastMode='summary';
/** @type {string[]} */ let importResults=[];
/** @param {unknown} value */
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function notify(){window.dispatchEvent(new Event('seeker-library-changed'));}
export async function loadDocuments(){try{documents=await window.SeekerRT.library.list();listError='';}catch(e){listError=String(e);}notify();}
export function recentDocuments(){return documents.filter(d=>!d.invalid).slice(0,6).map(d=>({id:d.id,title:d.name,updated:d.updated,open:()=>{openDocument(d.id).catch(e=>toast(errText(e)));}}));}

/** @param {Element} host */
export function renderDocumentList(host){
  const supported=window.SeekerRT?.available('fileReading')===true;
  const rows=documents.filter(d=>d.name.toLowerCase().includes(query.trim().toLowerCase()));
  host.insertAdjacentHTML('beforeend',`<div class="sec" id="fileDrop"><p style="color:var(--ink-3);line-height:1.8;">${supported?tt('拖入文件或点击导入。支持 TXT、Markdown、文字型 PDF 和 DOCX；每份最多 10 MB、30,000 字符。解析在本机完成，不调用 AI。','Drop files or choose Import. Supports TXT, Markdown, text PDF and DOCX; up to 10 MB and 30,000 characters each. Parsing stays on this device and does not call AI.'):tt('网页版可阅读备份中的已解析正文。导入和文件问答需使用桌面版。','The Web app can preview extracted text from backups. File import and Q&A require the desktop app.')}</p><button class="btn btn-accent" id="fileImport" ${!supported||importing?'disabled':''}>${importing?tt('正在导入…','Importing…'):tt('导入文件','Import files')}</button><input id="filePicker" type="file" multiple accept=".txt,.md,.pdf,.docx" hidden><p style="font-size:12px;color:var(--ink-3);">${tt('原文件保持原样。已导入的原始文件和提取正文保存在本地，并包含在完整备份中。','Your original files stay unchanged. Imported originals and extracted text are stored locally and included in full backups.')}</p>${importResults.map(m=>`<p role="status">${esc(m)}</p>`).join('')}</div>`
    +(listError?`<div class="sec" role="alert">${esc(listError)} <button class="btn" id="fileReload">${tt('重新加载','Reload')}</button></div>`:'')
    +`<div class="sec"><input class="input" id="fileSearch" value="${esc(query)}" placeholder="${tt('搜索文件名','Search filenames')}"></div>`
    +(rows.length?rows.map(d=>`<article class="sec" data-document="${esc(d.id)}"><h3 style="overflow-wrap:anywhere;">${esc(d.name)}</h3><p style="font-size:12px;color:var(--ink-3);">${d.invalid?tt('记录无法读取，可重新导入原文件。','This record cannot be read. Import the original file again.'):esc(d.format.toUpperCase())+' · '+d.characters.toLocaleString()+tt(' 字符 · ',' characters · ')+d.fragmentCount+tt(' 个片段',' fragments')}</p><div style="display:flex;gap:8px;"><button class="btn" data-file-open="${esc(d.id)}" ${d.invalid?'disabled':''}>${tt('阅读','Read')}</button><button class="btn-text" data-file-delete="${esc(d.id)}">${tt('删除','Delete')}</button></div></article>`).join(''):`<div class="sec"><p>${documents.length?tt('没有匹配的文件。','No matching files.'):tt('还没有导入文件。','No files imported yet.')}</p></div>`)+signFoot());
  const picker=/** @type {HTMLInputElement} */(host.querySelector('#filePicker'));
  const add=/** @type {HTMLButtonElement} */(host.querySelector('#fileImport'));add.onclick=()=>picker.click();
  picker.onchange=()=>{if(picker.files)importFiles([...picker.files]);};
  const drop=/** @type {HTMLElement} */(host.querySelector('#fileDrop'));
  drop.ondragover=e=>{e.preventDefault();};drop.ondrop=e=>{e.preventDefault();if(supported&&e.dataTransfer)importFiles([...e.dataTransfer.files]);};
  const search=/** @type {HTMLInputElement} */(host.querySelector('#fileSearch'));search.oninput=()=>{const cursor=search.selectionStart;query=search.value;notify();const next=/** @type {HTMLInputElement|null} */(document.querySelector('#fileSearch'));next?.focus();next?.setSelectionRange(cursor,cursor);};
  const reload=/** @type {HTMLButtonElement|null} */(host.querySelector('#fileReload'));if(reload)reload.onclick=()=>{loadDocuments();};
  host.querySelectorAll('[data-file-open]').forEach(el=>{const b=/** @type {HTMLButtonElement} */(el);b.onclick=()=>{openDocument(b.dataset.fileOpen||'').catch(e=>toast(errText(e)));};});
  host.querySelectorAll('[data-file-delete]').forEach(el=>{const b=/** @type {HTMLButtonElement} */(el);b.onclick=async()=>{
    const id=b.dataset.fileDelete||'',info=documents.find(d=>d.id===id);b.disabled=true;
    try{
      const snapshot=await window.SeekerRT.db.remove('assets_documents',id);if(!snapshot)throw new Error(tt('资料已不存在','Document no longer exists'));
      documents=documents.filter(d=>d.id!==id);notify();
      toastUndo(tt('已删除资料及本地副本','Document and local copy deleted'),async()=>{
        if(await window.SeekerRT.db.get('assets_documents',id))throw new Error(tt('同一资料已存在，无法覆盖','This document already exists and cannot be overwritten'));
        await window.SeekerRT.db.upsert('assets_documents',snapshot);if(info)documents.unshift(info);notify();return true;
      });
    }catch(e){toast(errText(e));}finally{b.disabled=false;}
  };});
}

/** @param {File[]} files */
async function importFiles(files){
  if(importing||!window.SeekerRT.available('fileReading'))return;
  if(!files.length||files.length>5){toast(tt('一次请选择 1–5 份文件','Choose 1–5 files at a time'));return;}
  importing=true;importResults=[];notify();
  for(const file of files){
    try{
      if(file.size>10485760||!file.size)throw new Error(tt('文件为空或超过 10 MB','Empty file or file exceeds 10 MB'));
      if(!/\.(txt|md|pdf|docx)$/i.test(file.name))throw new Error(tt('暂不支持这种文件类型','This file type is not supported'));
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const doc=await window.SeekerRT.library.importFile(file.name,btoa(binary));
      const {fragments,warnings,...info}=doc;documents.unshift(info);
      importResults.push(tt('已导入：','Imported: ')+file.name+' · '+doc.characters+tt(' 字符',' characters'));
    }catch(e){importResults.push(file.name+' · '+(e instanceof Error?e.message:String(e)));}
    notify();
  }
  importing=false;notify();
}

/** @param {string} id */
export async function openDocument(id){
  if(request){toast(tt('请先取消当前问答，或等它完成','Cancel the current question or wait for it to finish'));return;}
  const doc=await window.SeekerRT.library.get(id);
  selected=doc;question='';answer=undefined;answerError='';
  window.dispatchEvent(new Event('seeker-show-library-files'));
  renderDocumentReader();go('libraryfile');
}

export function renderDocumentReader(){
  const host=document.querySelector('#page-libraryfile');if(!host)return;
  const doc=selected;
  if(!doc){host.innerHTML=frontis('READ',tt('阅读文件','Read a file'))+`<div class="sec"><button class="btn" data-go="notes">${tt('从资料库选择文件','Choose a file from Library')}</button></div>`;return;}
  const supported=window.SeekerRT.available('fileReading');
  host.innerHTML=frontis('READ',esc(doc.name))+`<div class="sec"><button class="btn" data-go="notes">${tt('返回资料库','Back to Library')}</button> <button class="btn" id="fileCreateMind">${tt('创建思维导图','Create mind map')}</button> <button class="btn" id="fileExportText">${tt('导出正文 Markdown','Export text as Markdown')}</button><p style="color:var(--ink-3);">${doc.characters.toLocaleString()+tt(' 字符 · ',' characters · ')+doc.fragments.length+tt(' 个片段',' fragments')}</p>${doc.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}${doc.originalIncluded?'':`<p>${tt('这条备份未包含原始文件，已保存的正文仍可阅读。','This backup has no original file. Its saved text is still readable.')}</p>`}</div>`
    +`<div class="sec"><h3>${tt('原文片段','Source fragments')}</h3><div id="fileOriginal" style="max-height:360px;overflow:auto;border:0.5px solid var(--border);padding:16px;">${doc.fragments.map(f=>`<div id="file-fragment-${esc(f.id)}" style="padding-bottom:18px;"><p class="mono" style="font-size:11px;color:var(--ink-3);">${esc(f.id)}${f.page?' · '+tt('第 '+f.page+' 页','Page '+f.page):''}</p><div style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;" data-fragment-text="${esc(f.id)}">${esc(f.text)}</div></div>`).join('')}</div></div>`
    +`<div class="sec"><h3>${tt('根据这份文件回答','Ask about this file')}</h3><p style="font-size:12px;color:var(--ink-3);line-height:1.8;">${supported?tt('仅把这份文件的提取正文和本次问题发送给当前模型。点击引用可以核对原文。','Only this file’s extracted text and your question go to the current model. Click references to check the source.'):tt('文件总结与问答需桌面版和已连接的模型。','File summary and Q&A require the desktop app and a connected model.')}</p><textarea class="input" id="fileQuestion" rows="3" style="width:100%;" ${request?'readonly':''} placeholder="${tt('想从这份文件了解什么？','What would you like to know about this file?')}">${esc(question)}</textarea><div style="display:flex;gap:8px;margin-top:12px;"><button class="btn" id="fileSummary" ${!supported||request?'disabled':''}>${tt('总结文件','Summarize file')}</button><button class="btn btn-accent" id="fileAsk" ${!supported||request?'disabled':''}>${tt('提问','Ask')}</button>${request?`<button class="btn" id="fileCancel">${tt('取消','Cancel')}</button>`:''}</div></div>`
    +`<div class="sec" id="fileAnswer">${request?`<p role="status">${tt('正在阅读并生成回答…','Reading and preparing an answer…')}</p>`:''}${answerError?`<p role="alert">${esc(answerError)}</p><button class="btn" id="fileRetry">${tt('重试','Retry')}</button>`:''}${answer?`<div class="md-body">${mdRender(answer.answer)}</div><p style="font-size:12px;color:var(--ink-3);">${tt('引用已核对原文；模型归纳仍需你判断。','Quotations match the source; model interpretations still need your review.')}</p>${answer.references.map((r,i)=>`<button class="btn-text" data-reference="${i}" style="display:block;text-align:left;margin:10px 0;">[${esc(r.fragmentId)}] ${esc(r.quote)}</button>`).join('')}<button class="btn" id="fileSaveAnswer">${tt('保存回答为笔记','Save answer as note')}</button>`:''}</div>`+signFoot();
  const input=/** @type {HTMLTextAreaElement} */(host.querySelector('#fileQuestion'));input.oninput=()=>{question=input.value;};
  /** @param {string} id @param {()=>void} action */
  const click=(id,action)=>{const b=/** @type {HTMLButtonElement|null} */(host.querySelector('#'+id));if(b)b.onclick=action;};
  click('fileCreateMind',()=>window.SeekerShell.createFromText({text:doc.fragments.map(f=>f.text).join('\n\n'),title:doc.name,source:{type:'file',id:doc.id,updatedAt:doc.updated}}));
  click('fileSummary',()=>{runAnswer('summary');});click('fileAsk',()=>{runAnswer('question');});
  click('fileRetry',()=>{runAnswer(/** @type {'summary'|'question'} */(lastMode));});
  click('fileCancel',()=>{request?.cancel();});
  click('fileExportText',()=>{window.SeekerRT.render.markdown(doc.name,'# '+doc.name+'\n\n'+doc.fragments.map(f=>f.text).join('')).then(path=>toast((window.SeekerRT.platform==='desktop'?tt('已导出：','Exported: '):tt('已交给浏览器下载：','Download started: '))+esc(path))).catch(e=>toast(errText(e)));});
  if(answer?.insufficient)host.querySelector('#fileAnswer')?.insertAdjacentHTML('afterbegin',`<p role="status">${tt('这份资料没有足够信息回答本次问题。','This document does not contain enough information to answer this question.')}</p>`);
  host.querySelectorAll('[data-reference]').forEach(el=>{const b=/** @type {HTMLButtonElement} */(el);b.onclick=()=>{
    const reference=answer?.references[Number(b.dataset.reference)];if(!reference)return;
    const fragment=doc.fragments.find(f=>f.id===reference.fragmentId);if(!fragment)return;
    const at=fragment.text.indexOf(reference.quote);if(at<0)return;
    const node=host.querySelector(`[data-fragment-text="${fragment.id}"]`);if(node)node.innerHTML=esc(fragment.text.slice(0,at))+'<mark>'+esc(reference.quote)+'</mark>'+esc(fragment.text.slice(at+reference.quote.length));
    node?.scrollIntoView({block:'center',behavior:'smooth'});
  };});
  const save=/** @type {HTMLButtonElement|null} */(host.querySelector('#fileSaveAnswer'));if(save)save.onclick=async()=>{
    if(!answer)return;save.disabled=true;
    try{await saveNote({title:doc.name+' · '+tt('阅读笔记','Reading note'),text:answer.answer+'\n\n'+tt('来源：','Source: ')+doc.name+'\n\n'+answer.references.map(r=>'['+r.fragmentId+']\n> '+r.quote.replace(/\n/g,'\n> ')).join('\n\n')});toast(tt('已保存到资料库','Saved to Library'));}
    catch(e){toast(errText(e));save.disabled=false;}
  };
}

/** @param {'summary'|'question'} mode */
async function runAnswer(mode){
  if(!selected||request||!window.SeekerRT.available('fileReading'))return;
  if(mode==='question'&&!question.trim()){toast(tt('请先输入问题','Enter a question first'));return;}
  lastMode=mode;answer=undefined;answerError='';
  try{request=window.SeekerRT.library.answer(selected.id,mode,question);renderDocumentReader();answer=await request.done;}
  catch(e){answerError=e instanceof Error?e.message:String(e);}
  finally{request=undefined;renderDocumentReader();}
}
window.addEventListener('seeker-rt-ready',()=>{loadDocuments();});
