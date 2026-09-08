// @ts-check
export const escapeHTML=(/** @type {unknown} */ value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
/** @param {import('../runtime/types').CreationDraft} creation */
export function creationHTML(creation){
  if(creation.kind==='widget')return String(creation.content.html||'');
  return `<article class="card"><h1>${escapeHTML(creation.title)}</h1><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(creation.content.text||'')}</div></article>`;
}
