// @ts-check
const esc=(/** @type {string} */s)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
/** Platform-owned outer file; untrusted source exists only in an escaped, opaque srcdoc.
 * @param {string} title @param {string} html */
export function offlineDocument(title,html){
  if(typeof title!=='string'||[...title].length>200||typeof html!=='string'||!html.trim()||new TextEncoder().encode(html).length>262144)throw Error('离线作品内容过长或无效 / Invalid or oversized offline creation');
  const inner=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">`+html;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src about:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>${esc(title)}</title><style>body{margin:0;background:#f6f4ef;color:#252525;font:14px system-ui,sans-serif}header{padding:16px 24px}h1{font-size:20px;margin:0 0 8px}p{margin:0;line-height:1.5}iframe{display:block;width:100%;height:calc(100vh - 120px);min-height:480px;border:0;background:white}</style></head><body><header><h1>${esc(title)}</h1><p>离线交互查看 · 不连接应用或外网，重新打开从原稿开始。<br>Offline viewer · No app or network access. Reopening starts from the original source.</p></header><iframe title="离线作品 / Offline creation" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${esc(inner)}"></iframe></body></html>`;
}
