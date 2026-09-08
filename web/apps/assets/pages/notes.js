// @ts-check
/** Local library. Saving never starts AI; knowledge ingestion requires its own explicit grant. */
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { errText, toast, toastUndo } from '../../../platform/shell/toast.js';
import { openModal, closeModal } from '../../../platform/shell/modal.js';
import { frontis, signFoot } from '../../../platform/shell/nav.js';
import { mdField, wireMdField, mdRender } from '../../../platform/shell/md-edit.js';
import { enrichNoteText } from '../enrich.js';
import { loadNotes, listNotes, saveNote, updateNote, removeNote, restoreNote, noteTitle, noteMarkdown } from '../note-store.js';

const filter = {q:'', tag:'', favorite:false};
let loadError = '';
/** @type {Set<string>} */ const organizing = new Set();
/** @param {unknown} value */
const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

export function renderNotes() {
  const host = $('#page-notes'); if (!host) return;
  const all = listNotes(), q = filter.q.trim().toLowerCase();
  const rows = all.filter(n=>(!filter.favorite || n.favorite) && (!filter.tag || n.tags?.includes(filter.tag)) && (!q || (noteTitle(n)+' '+n.text+' '+(n.tags||[]).join(' ')+' '+(n.sourceUrl||'')).toLowerCase().includes(q)));
  const tags = [...new Set(all.flatMap(n=>n.tags||[]))].slice(0,20);
  host.innerHTML = frontis('LIBRARY',tt('资料库','Library'))
    + `<div class="sec"><p style="color:var(--ink-3);line-height:1.8;">${tt('记录想法、保存回答和摘录。不连接模型也能编辑、搜索和导出。普通保存只在本地完成。','Keep ideas, answers and excerpts. Edit, search and export without a model. Saving stays on this device.')}</p><button class="btn btn-accent" id="anAdd">${tt('+ 新建笔记','+ New note')}</button></div>`
    + (loadError?`<div class="sec" role="alert">${esc(loadError)} <button class="btn" id="anReload">${tt('重新加载','Reload')}</button></div>`:'')
    + `<div class="sec" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;"><input class="input" id="anQ" style="max-width:280px;" value="${esc(filter.q)}" placeholder="${tt('搜索标题、内容、标签和来源','Search title, text, tags and source')}"><button class="btn ${filter.favorite?'btn-accent':''}" id="anFavorites" aria-pressed="${filter.favorite}">${tt('收藏','Favorites')}</button><select class="input" id="anTag" style="width:auto;max-width:180px;" aria-label="${tt('标签筛选','Filter by tag')}"><option value="">${tt('全部标签','All tags')}</option>${tags.map(t=>`<option ${t===filter.tag?'selected':''} value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>`
    + (rows.length?rows.map(n=>`<article class="sec" data-note="${esc(n.id)}">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;"><h3 style="margin:0;flex:1;">${esc(noteTitle(n))}</h3><button class="btn-text" data-favorite="${esc(n.id)}" aria-pressed="${n.favorite===true}">${n.favorite?tt('取消收藏','Unfavorite'):tt('收藏','Favorite')}</button><span class="mono" style="font-size:10px;color:var(--ink-3);">${new Date(n.updated||0).toLocaleDateString()}</span></div>
      ${n.tags?.length?`<p style="font-size:12px;color:var(--ink-3);">${n.tags.map(t=>'#'+esc(t)).join(' ')}</p>`:''}
      ${n.sourceUrl?`<p style="font-size:12px;overflow-wrap:anywhere;">${tt('来源：','Source: ')}<button class="btn-text" data-source="${esc(n.id)}">${esc(n.sourceUrl)}</button></p>`:''}
      ${n.summary?`<p style="color:var(--ink-3);">${tt('AI 摘要：','AI summary: ')}${esc(n.summary)}</p>`:''}
      <div class="md-body" style="max-height:220px;overflow:auto;margin:14px 0;">${mdRender(n.text)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;"><button class="btn" data-anedit="${esc(n.id)}">${tt('编辑','Edit')}</button><button class="btn" data-export="${esc(n.id)}">${tt('导出 Markdown','Export Markdown')}</button><button class="btn" data-anai="${esc(n.id)}" ${organizing.has(n.id)?'disabled':''}>${organizing.has(n.id)?tt('整理中…','Organizing…'):tt('AI 整理','Organize with AI')}</button>${window.SeekerRT?.platform==='desktop'?`<button class="btn" data-knowledge="${esc(n.id)}">${tt('加入知识库','Add to knowledge')}</button>`:''}<button class="btn-text" data-andel="${esc(n.id)}">${tt('删除','Delete')}</button></div></article>`).join(''):`<div class="sec"><p>${all.length?tt('没有匹配的笔记。','No matching notes.'):tt('还没有资料，先记下一个想法吧。','Your library is empty. Start with an idea.')}</p></div>`)+signFoot();
  /** @param {string} selector @param {()=>void} fn */
  const click = (selector,fn)=>{const el=/** @type {HTMLElement|null} */(host.querySelector(selector));if(el)el.onclick=fn;};
  click('#anAdd',()=>openNoteModal(''));
  click('#anReload',()=>{reloadNotes();});
  click('#anFavorites',()=>{filter.favorite=!filter.favorite;renderNotes();});
  const search=/** @type {HTMLInputElement} */($('#anQ'));
  search.oninput=()=>{const cursor=search.selectionStart;filter.q=search.value;renderNotes();const next=/** @type {HTMLInputElement} */($('#anQ'));next.focus();next.setSelectionRange(cursor,cursor);};
  const tag=/** @type {HTMLSelectElement} */($('#anTag'));tag.onchange=()=>{filter.tag=tag.value;renderNotes();};
  /** @param {string} attr @param {(n:import('../note-store').Note)=>any} action */
  const wire=(attr,action)=>{ $$(`#page-notes [data-${attr}]`).forEach(el=>{
    const b=/** @type {HTMLButtonElement} */(el);
    b.onclick=async()=>{const n=listNotes().find(n=>n.id===b.getAttribute('data-'+attr));if(!n)return;b.disabled=true;try{await action(n);}catch(e){toast(errText(e));}finally{b.disabled=false;}};
  });};
  wire('anedit',n=>openNoteModal(n.id));
  wire('favorite',n=>updateNote(n.id,{favorite:!n.favorite}));
  wire('export',async n=>{const path=await window.SeekerRT.render.markdown(noteTitle(n),noteMarkdown(n));toast((window.SeekerRT.platform==='desktop'?tt('已导出到：','Exported to: '):tt('已交给浏览器下载：','Download started: '))+esc(path));});
  wire('source',n=>window.SeekerRT.web.open(n.sourceUrl||''));
  wire('anai',n=>openOrganizeModal(n));
  wire('knowledge',n=>openKnowledgeModal(n));
  wire('andel',async n=>{const snap=await removeNote(n.id);toastUndo(tt('已删除笔记','Note deleted'),()=>restoreNote(snap));});
}

/** @param {string} id */
export function openNoteModal(id) {
  const n=listNotes().find(n=>n.id===id);
  const modal=openModal(`<div class="modal-head"><div><p class="eyebrow">— NOTE</p><h2>${n?tt('编辑笔记','Edit note'):tt('新建笔记','New note')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div><div class="modal-body">
    <label>${tt('标题','Title')}<input class="input" id="anTitle" maxlength="160" value="${esc(n?.title||'')}"></label>
    ${mdField({id:'anText',value:n?.text||'',placeholder:tt('写下想法或粘贴摘录…','Write an idea or paste an excerpt…'),rows:8})}
    <label>${tt('标签（逗号分隔）','Tags (comma separated)')}<input class="input" id="anTags" value="${esc((n?.tags||[]).join(', '))}"></label>
    <label>${tt('来源链接（可选）','Source link (optional)')}<input class="input" id="anSource" value="${esc(n?.sourceUrl||'')}" placeholder="https://"></label>
    <label style="display:block;margin-top:14px;"><input type="checkbox" id="anFavorite" ${n?.favorite?'checked':''}> ${tt('收藏','Favorite')}</label>
    <p style="color:var(--ink-3);font-size:12px;">${tt('只保存在本地，不会自动发送给 AI。','Saved locally. This does not automatically send content to AI.')}</p></div><div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="anSave">${tt('保存','Save')}</button></div>`);
  wireMdField(modal);
  const save=/** @type {HTMLButtonElement} */($('#anSave'));
  save.onclick=async()=>{
    const value=(/** @type {string} */id)=>(/** @type {HTMLInputElement} */($('#'+id))).value;
    const draft={text:value('anText'),title:value('anTitle'),tags:value('anTags').split(/[,，]/),sourceUrl:value('anSource'),favorite:(/** @type {HTMLInputElement} */($('#anFavorite'))).checked};
    save.disabled=true;
    try {
      if(n)await updateNote(n.id,{...draft,...(draft.text!==n.text?{ai:false,summary:'',kind:''}:{})},n.updated);else await saveNote(draft);
      if(modal?.isConnected)closeModal();toast(tt('已保存','Saved'));
    } catch(e){toast(errText(e));} finally {save.disabled=false;}
  };
}

/** Only the selected note goes to the configured model. Never auto-enrich on save. @param {import('../note-store').Note} n */
function openOrganizeModal(n) {
  if(!window.SeekerRT.available('textGeneration')){toast(tt('AI 整理需桌面版和已连接的模型','AI organization needs the desktop app and a connected model'));return;}
  openModal(`<div class="modal-head"><h2>${tt('整理这条笔记','Organize this note')}</h2><button class="x">${IC.x}</button></div><div class="modal-body"><p>${tt('将把这条笔记的正文发送给当前模型，生成标题、标签和摘要。正文保持原样。','Send this note’s text to the current model to generate a title, tags and summary. The original text is kept.')}</p><p>${esc(noteTitle(n))}</p></div><div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="anOrganize">${tt('开始整理','Organize')}</button></div>`);
  const go=/** @type {HTMLButtonElement} */($('#anOrganize'));go.onclick=async()=>{
    go.disabled=true;closeModal();organizing.add(n.id);renderNotes();
    try{const result=await enrichNoteText(n.text);if(!result)throw new Error(tt('未能整理，请检查模型后重试','Could not organize. Check the model and retry.'));await updateNote(n.id,{...result,ai:true},n.updated);toast(tt('已整理','Organized'));}
    catch(e){toast(errText(e));}finally{organizing.delete(n.id);renderNotes();}
  };
}

/** Knowledge ingestion widens future recall and requires its own explicit consent. @param {import('../note-store').Note} n */
async function openKnowledgeModal(n) {
  const docs=await window.SeekerRT.docs.list();
  if(n.docId && docs.some(d=>d.docId===n.docId)){toast(tt('这条笔记已在知识库中','This note is already in knowledge'));return;}
  openModal(`<div class="modal-head"><h2>${tt('加入知识库','Add to knowledge')}</h2><button class="x">${IC.x}</button></div><div class="modal-body"><p>${esc(noteTitle(n))}</p><p>${tt('这会扩大 AI 可读范围：笔记默认仅在本地，加入知识库后可被后续对话自动检索，内容会发送给配置的嵌入模型。原笔记保留。可在能力中心 → 知识库删除以撤回。','This widens AI access: notes stay local by default; knowledge can be recalled automatically in future chats. Content is sent to your configured embedding model. The original note is kept. Remove the copy in Capabilities → Knowledge to withdraw access.')}</p></div><div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="anKbGo">${tt('加入','Add')}</button></div>`);
  const go=/** @type {HTMLButtonElement} */($('#anKbGo'));go.onclick=async()=>{
    go.disabled=true;
    try{
      const result=await window.SeekerRT.docs.add(noteTitle(n),n.text);
      if(!result?.docId)throw new Error(tt('未能加入知识库','Could not add to knowledge'));
      try{await updateNote(n.id,{docId:result.docId});}
      catch(e){
        // Undo only the copy created by this action, so a failed link does not silently widen recall.
        try{const rollback=await window.SeekerRT.docs.remove(result.docId);if(!rollback.deleted)throw new Error('copy not removed');}
        catch{throw new Error(tt('知识库副本已创建，但笔记关联和回滚均失败。请在能力中心检查并移除副本，再重试。','Knowledge copy created, but linking and rollback failed. Check and remove that copy in Capabilities before retrying.'));}
        throw new Error(tt('关联保存失败，刚创建的知识库副本已撤回：','Link could not be saved; the new knowledge copy was removed: ')+String(e));
      }
      closeModal();toast(tt('已加入知识库','Added to knowledge'));
    }catch(e){toast(errText(e));}finally{go.disabled=false;}
  };
}

export async function reloadNotes() {try{await loadNotes(true);loadError='';}catch(e){loadError=tt('资料库加载失败：','Library could not load: ')+String(e);}renderNotes();}
window.addEventListener('seeker-rt-ready',()=>{reloadNotes();});
window.addEventListener('seeker-library-changed',renderNotes);
