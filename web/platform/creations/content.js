// @ts-check
import {mindMap} from './mindmap-model.js';
import {mindMapSVG} from './mindmap-render.js';
import {comparison,timeline} from './structured-model.js';
export const escapeHTML=(/** @type {unknown} */ value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
/** @param {import('../runtime/types').CreationDraft} creation */
export function creationHTML(creation){
  if(creation.kind==='widget')return String(creation.content.html||'');
  if(creation.kind==='mindmap')return mindMapSVG(mindMap(creation.content),creation.style);
  if(creation.kind==='comparison'){
    const c=comparison(creation.content);return `<article class="card"><h1>${escapeHTML(creation.title)}</h1><table><thead><tr>${c.columns.map(col=>'<th style="text-transform:none;letter-spacing:0">'+escapeHTML(col)+'</th>').join('')}</tr></thead><tbody>${c.rows.map(row=>'<tr>'+row.map(cell=>'<td style="white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top">'+escapeHTML(cell)+'</td>').join('')+'</tr>').join('')}</tbody></table></article>`;
  }
  if(creation.kind==='timeline'){
    const c=timeline(creation.content);return `<article class="card"><h1>${escapeHTML(creation.title)}</h1><ol style="list-style:none;padding-left:12px">${c.events.map(e=>`<li style="border-left:2px solid var(--accent);padding:0 0 var(--creation-gap) var(--creation-gap);margin:0"><p style="color:var(--accent)">${escapeHTML(e.when)}</p><h2>${escapeHTML(e.title)}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(e.detail)}</div></li>`).join('')}</ol></article>`;
  }
  return `<article class="card"><h1>${escapeHTML(creation.title)}</h1><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(creation.content.text||'')}</div></article>`;
}
