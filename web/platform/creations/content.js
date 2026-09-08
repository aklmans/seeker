// @ts-check
import {mindMap} from './mindmap-model.js';
import {mindMapSVG} from './mindmap-render.js';
export const escapeHTML=(/** @type {unknown} */ value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
/** @param {import('../runtime/types').CreationDraft} creation */
export function creationHTML(creation){
  if(creation.kind==='widget')return String(creation.content.html||'');
  if(creation.kind==='mindmap')return mindMapSVG(mindMap(creation.content),creation.style);
  return `<article class="card"><h1>${escapeHTML(creation.title)}</h1><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(creation.content.text||'')}</div></article>`;
}
