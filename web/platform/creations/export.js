// @ts-check
import {requestWidgetSnapshot} from '../capability/widgets/render.js';
import {openModal} from '../shell/modal.js';
import {tt} from '../shell/i18n.js';
/** @type {Promise<string>|null} */let renderer=null;
async function rendererSource(){
  if(!renderer)renderer=fetch(new URL('../../vendor/widget-capture.txt',import.meta.url)).then(r=>{if(!r.ok)throw Error('Export renderer unavailable');return r.text();}).catch(e=>{renderer=null;throw e;});
  return renderer;
}
/** Separate opaque iframe: untrusted snapshot cannot execute scripts; only a fresh nonce authorizes our renderer.
 * @param {{html:string,width:number}} snapshot @param {number} [width]
 * @returns {Promise<{png:string,width:number,height:number}>} */
export async function captureSnapshot(snapshot,width=snapshot.width){
  if(typeof snapshot.html!=='string'||new TextEncoder().encode(snapshot.html).length>2_000_000)throw Error('Invalid snapshot');
  const code=await rendererSource();
  const inert=document.createElement('template');inert.innerHTML=snapshot.html;
  for(const el of inert.content.querySelectorAll('script,iframe,object,embed,link,base,meta'))el.remove();
  for(const el of inert.content.querySelectorAll('*'))for(const attr of [...el.attributes])if(attr.name.toLowerCase().startsWith('on'))el.removeAttribute(attr.name);
  for(const el of inert.content.querySelectorAll('[src],[srcset],[href],[xlink\\:href]')){
    el.removeAttribute('srcset');
    for(const key of ['src','href','xlink:href']){const value=el.getAttribute(key);if(value&&!value.startsWith('#')&&!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(value))el.removeAttribute(key);}
  }
  const safeSnapshot=inert.innerHTML;
  const nonce=crypto.randomUUID().replaceAll('-','');
  const requestId=crypto.randomUUID();
  const frame=document.createElement('iframe');frame.sandbox.add('allow-scripts');frame.referrerPolicy='no-referrer';
  frame.style.cssText=`position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;width:${Math.max(320,Math.min(1600,Math.round(width)))}px;height:1px;border:0;`;
  frame.title=tt('正在生成导出预览','Rendering export preview');
  const csp=`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; base-uri 'none'; form-action 'none'`;
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);frame.remove();};
    const timer=setTimeout(()=>{cleanup();reject(Error(tt('导出超时，请简化或拆分作品后重试','Export timed out. Simplify or split this creation.')));},15000);
    const receive=(/** @type {MessageEvent} */e)=>{
      if(e.source!==frame.contentWindow||e.data?.requestId!==requestId)return;
      const r=e.data.result;cleanup();
      if(r&&typeof r.png==='string'&&r.png.startsWith('data:image/png;base64,')&&r.png.length<=32_000_000&&Number.isSafeInteger(r.width)&&Number.isSafeInteger(r.height)&&r.width>0&&r.height>0&&r.width*r.height<=24_000_000)resolve(r);
      else reject(Error(tt('无法生成此作品的预览：','Could not render this creation: ')+String(e.data.error||'')));
    };
    window.addEventListener('message',receive);
    frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${safeSnapshot}<script nonce="${nonce}">${code.replace(/<\/script/gi,'<\\/script')};window.captureIsolated().then(result=>parent.postMessage({requestId:${JSON.stringify(requestId)},result},'*')).catch(error=>parent.postMessage({requestId:${JSON.stringify(requestId)},error:String(error)},'*'));</script></body></html>`;
    document.body.appendChild(frame);
  });
}
/** @param {HTMLElement} card @param {string} title */
export async function openExport(card,title){
  const modal=openModal(`<div class="modal-head"><h2>${tt('导出作品','Export creation')}</h2><button class="x">×</button></div><p>${tt('导出当前画面，保留交互结果。复杂特效可能与原稿不同，请检查预览。','Export the current state. Complex effects may differ; review the preview.')}</p><p id="creationExportStatus" role="status"></p><img id="creationExportImage" alt="${tt('导出预览','Export preview')}" style="display:none;width:100%;border:.5px solid var(--border)"><div class="creation-toolbar" id="creationExportActions"></div>`,true);
  if(!modal)return;
  const status=/** @type {HTMLElement} */(modal.querySelector('#creationExportStatus'));
  status.textContent=tt('正在读取当前状态并生成高清预览…','Capturing the current state and rendering a high-resolution preview…');
  try{
    const snapshot=await requestWidgetSnapshot(card);
    const result=await captureSnapshot(snapshot);if(!modal.isConnected)return;
    const image=/** @type {HTMLImageElement} */(modal.querySelector('#creationExportImage'));image.src=result.png;image.style.display='block';
    status.textContent=`${result.width} × ${result.height} px`;
    const actions=modal.querySelector('#creationExportActions');
    for(const [label,format] of [[tt('保存 PNG','Save PNG'),'png'],[tt('保存长页 PDF','Save long-page PDF'),'pdf']]){
      const button=document.createElement('button');button.className='btn btn-accent';button.textContent=label;
      button.onclick=async()=>{button.disabled=true;try{const path=await window.SeekerRT.render.creationImage(title,result.png,/** @type {'png'|'pdf'} */(format));status.textContent=window.SeekerRT.platform==='web'?tt('已交给浏览器下载：','Browser download started: ')+path:tt('已保存并校验：','Saved and verified: ')+path;}catch(e){status.textContent=String(e);}finally{button.disabled=false;}};actions?.appendChild(button);
    }
    const copy=document.createElement('button');copy.className='btn';copy.textContent=tt('复制图片','Copy image');copy.onclick=async()=>{copy.disabled=true;try{await window.SeekerRT.render.copyCreationImage(result.png);status.textContent=tt('图片已复制到剪贴板','Image copied to clipboard');}catch(e){status.textContent=tt('复制失败，可使用保存 PNG：','Could not copy; use Save PNG: ')+String(e);}finally{copy.disabled=false;}};actions?.appendChild(copy);
  }catch(e){if(modal.isConnected)status.textContent=String(e);}
}
