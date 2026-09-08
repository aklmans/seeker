// @ts-check
import { tt } from '../../platform/shell/i18n.js';

/** @typedef {import('../../platform/runtime/types').Record & import('../../platform/shell/types').NoteDraft & {id:string, updated:number, docId?:string, kind?:string, summary?:string, ai?:boolean}} Note */
/** @param {import('../../platform/runtime/types').Record} n @returns {Note} */
function normalize(n) {
  return {...n, text:typeof n.text==='string'?n.text:'', updated:typeof n.updated==='number'&&Number.isFinite(n.updated)?n.updated:0,
    title:typeof n.title==='string'?n.title:'', tags:Array.isArray(n.tags)?n.tags.filter(t=>typeof t==='string'):[],
    sourceUrl:typeof n.sourceUrl==='string'?n.sourceUrl:'', favorite:n.favorite===true,
    docId:typeof n.docId==='string'?n.docId:undefined, kind:typeof n.kind==='string'?n.kind:undefined,
    summary:typeof n.summary==='string'?n.summary:undefined, ai:n.ai===true};
}
/** @type {Note[]} */ let notes = [];
/** @type {Promise<void>|undefined} */ let loading;
let loaded = false;
/** All note mutations are serialized, including AI metadata updates and undo. */
let queue = Promise.resolve();
function notify() { window.dispatchEvent(new Event('seeker-library-changed')); }
export async function loadNotes(force = false) {
  if (force) { await queue; loaded = false; }
  if (loaded) return;
  if (!loading) loading = (async()=>{
    const rows = await window.SeekerRT.db.list('assets_notes');
    notes = rows.filter(n=>typeof n.text === 'string').map(normalize);
    loaded = true;
  })().finally(()=>{ loading = undefined; });
  await loading;
}
export function listNotes() { return notes.map(n=>({...n, tags: [...(n.tags || [])]})).sort((a,b)=>b.updated-a.updated); }
/** @template T @param {()=>Promise<T>} operation */
function mutate(operation) { const next = queue.then(operation); queue = next.then(()=>{},()=>{}); return next; }
/** @param {import('../../platform/shell/types').NoteDraft} draft */
function validate(draft) {
  if (!draft.text?.trim()) throw new Error(tt('写点内容再保存','Add some content first'));
  if (draft.text.length > 200000) throw new Error(tt('笔记过长，请拆成几条保存','This note is too long. Split it into smaller notes.'));
  const sourceUrl = draft.sourceUrl?.trim() || '';
  if (sourceUrl) {
    let url; try { url = new URL(sourceUrl); } catch { /* reject below */ }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(tt('来源需填写有效的 HTTP 或 HTTPS 链接','Enter a valid HTTP or HTTPS source link'));
  }
  return { text:draft.text, title:(draft.title || '').trim().slice(0,160), tags:[...new Set((draft.tags || []).filter(t=>typeof t==='string').map(t=>t.trim()).filter(Boolean))].slice(0,20).map(t=>t.slice(0,40)), sourceUrl, favorite:draft.favorite===true };
}
/** @param {import('../../platform/shell/types').NoteDraft} draft @returns {Promise<Note>} */
export function saveNote(draft) {
  const fields = validate(draft);
  return mutate(async()=>{
    await loadNotes();
    const note = {...fields, id:crypto.randomUUID(), updated:Date.now()};
    await window.SeekerRT.db.upsert('assets_notes', note);
    notes.push(note); notify(); return {...note};
  });
}
/** @param {string} id @param {Partial<Note>} patch @param {number} [expectedUpdated] */
export function updateNote(id, patch, expectedUpdated) {
  return mutate(async()=>{
    await loadNotes();
    const i = notes.findIndex(n=>n.id===id);
    if (i<0) throw new Error(tt('笔记已不存在','This note no longer exists'));
    const prev = notes[i];
    if (expectedUpdated !== undefined && prev.updated !== expectedUpdated) throw new Error(tt('笔记已有新修改，请重新打开后再试','This note has changed. Reopen it and try again.'));
    const next = {...prev, ...patch, ...validate({...prev, ...patch}), id, updated:Math.max(Date.now(),prev.updated+1)};
    await window.SeekerRT.db.upsert('assets_notes', next);
    notes[i] = next; notify(); return {...next};
  });
}
/** Delete only after runtime commits; return the actual persisted snapshot for undo. @param {string} id */
export function removeNote(id) {
  return mutate(async()=>{
    await loadNotes();
    const snap = await window.SeekerRT.db.remove('assets_notes',id);
    if (!snap) throw new Error(tt('笔记已不存在，请刷新','Note no longer exists. Refresh the library.'));
    notes = notes.filter(n=>n.id!==id); notify(); return normalize(snap);
  });
}
/** @param {Note} snap */
export function restoreNote(snap) {
  return mutate(async()=>{
    await loadNotes();
    if (await window.SeekerRT.db.get('assets_notes',snap.id)) throw new Error(tt('同一笔记已存在，无法覆盖','This note already exists and cannot be overwritten'));
    await window.SeekerRT.db.upsert('assets_notes',snap);
    notes.push({...snap}); notify(); return true;
  });
}
/** @param {Note} n */
export function noteTitle(n) { return n.title || n.text.split('\n')[0].replace(/^#+\s*/, '').trim().slice(0,60) || tt('未命名笔记','Untitled note'); }
/** @param {Note} n */
export function noteMarkdown(n) {
  return '# '+noteTitle(n)+'\n\n'+(n.sourceUrl?tt('来源：','Source: ')+n.sourceUrl+'\n\n':'')+(n.tags?.length?n.tags.map(t=>'#'+t).join(' ')+'\n\n':'')+n.text+'\n';
}
