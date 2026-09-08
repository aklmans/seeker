// @ts-check
import {requestWidgetSnapshot} from '../capability/widgets/render.js';
import {openModal} from '../shell/modal.js';
import {tt} from '../shell/i18n.js';
import {composePresentation} from './presentation.js';
import {escapeHTML as esc} from './content.js';
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
/** @param {HTMLElement|null} card @param {string} title @param {{html:string,width:number}} [providedSnapshot]
 * @param {{style?:{[k:string]:unknown},source?:string,offlineHTML?:string}} [context] */
export async function openExport(card,title,providedSnapshot,context={}){
  const modal=openModal(`<div class="modal-head"><h2>${tt('导出作品','Export creation')}</h2><button class="x">×</button></div><p>${tt('导出当前画面，保留交互结果。固定比例会缩放完整内容；长内容可选原始比例。请检查预览。','Export the current state. Fixed ratios fit all content; use original ratio for long content. Review the preview.')}</p><div class="creation-export-options"><label>${tt('图片比例','Image ratio')}<select class="select" id="creationExportRatio"><option value="auto">${tt('原始 / 长图','Original / long image')}</option><option value="square">1:1</option><option value="landscape">4:3</option><option value="wide">16:9</option><option value="portrait">3:4</option><option value="story">9:16</option></select></label>
    <div class="creation-export-field"><label><input type="checkbox" id="creationExportShowTitle"> ${tt('附加标题','Add a title')}</label><input class="input" id="creationExportTitle" aria-label="${tt('分享标题','Share title')}" maxlength="200"></div>
    <div class="creation-export-field"><label><input type="checkbox" id="creationExportShowSource"> ${tt('附加来源','Add a source')}</label><input class="input" id="creationExportSource" aria-label="${tt('来源文字','Source text')}" maxlength="300"></div>
    <div class="creation-export-field"><label><input type="checkbox" id="creationExportShowByline"> ${tt('附加署名','Add a byline')}</label><input class="input" id="creationExportByline" aria-label="${tt('署名文字','Byline text')}" maxlength="80"></div></div>
    <p id="creationExportStatus" role="status"></p><img id="creationExportImage" alt="${tt('导出预览','Export preview')}" style="display:none;width:100%;border:.5px solid var(--border)"><div class="creation-toolbar" id="creationExportActions"></div>`,true);
  if(!modal)return;
  const status=/** @type {HTMLElement} */(modal.querySelector('#creationExportStatus'));
  const input=(/** @type {string} */id)=>/** @type {HTMLInputElement} */(modal.querySelector('#'+id));
  input('creationExportTitle').value=title;input('creationExportSource').value=context.source||'';
  const options=()=>({ratio:input('creationExportRatio').value,includeTitle:input('creationExportShowTitle').checked,title:input('creationExportTitle').value,includeSource:input('creationExportShowSource').checked,source:input('creationExportSource').value,includeByline:input('creationExportShowByline').checked,byline:input('creationExportByline').value});
  const image=/** @type {HTMLImageElement} */(modal.querySelector('#creationExportImage')),actions=modal.querySelector('#creationExportActions');
  /** @type {{png:string,width:number,height:number}|null} */let result=null;
  /** @type {HTMLButtonElement[]} */const outputButtons=[];
  const saved=(/** @type {string} */path)=>{status.textContent=window.SeekerRT.platform==='web'?tt('已交给浏览器下载：','Browser download started: ')+path:tt('已保存并校验：','Saved and verified: ')+path;};
  for(const [label,format] of [[tt('保存 PNG','Save PNG'),'png'],[tt('保存长页 PDF','Save long-page PDF'),'pdf']]){
    const button=document.createElement('button');button.className='btn btn-accent';button.textContent=label;button.disabled=true;
    button.onclick=async()=>{if(!result)return;button.disabled=true;try{saved(await window.SeekerRT.render.creationImage(input('creationExportTitle').value||title,result.png,/** @type {'png'|'pdf'} */(format)));}catch(e){status.textContent=String(e);}finally{button.disabled=!result;}};actions?.appendChild(button);outputButtons.push(button);
  }
  const copy=document.createElement('button');copy.className='btn';copy.textContent=tt('复制图片','Copy image');copy.disabled=true;copy.onclick=async()=>{if(!result)return;copy.disabled=true;try{await window.SeekerRT.render.copyCreationImage(result.png);status.textContent=tt('图片已复制到剪贴板','Image copied to clipboard');}catch(e){status.textContent=tt('复制失败，可使用保存 PNG：','Could not copy; use Save PNG: ')+String(e);}finally{copy.disabled=!result;}};actions?.appendChild(copy);outputButtons.push(copy);
  if(context.offlineHTML){
    const offline=document.createElement('button');offline.className='btn';offline.textContent=tt('保存离线交互 HTML','Save interactive HTML');
    offline.onclick=async()=>{offline.disabled=true;try{const p=options();const annotations=[p.includeTitle?p.title:'',p.includeSource?tt('来源：','Source: ')+p.source:'',p.includeByline?tt('署名：','By: ')+p.byline:''].filter(Boolean).map(t=>'<p>'+esc(t)+'</p>').join('');saved(await window.SeekerRT.render.creationOffline(p.title||title,annotations+(context.offlineHTML||'')));}catch(e){status.textContent=String(e);}finally{offline.disabled=false;}};actions?.appendChild(offline);
    const hint=document.createElement('p');hint.textContent=tt('离线文件从原稿开始交互，不保存当前计算状态、不套用图片比例；不连接应用或外网。','Offline files start from the source, without the current calculation state or image ratio. No app or network access.');modal.append(hint);
  }
  let epoch=0;
  /** @type {Promise<{html:string,width:number}>|null} */let snapshotPromise=null;
  /** @type {Map<number,Promise<{png:string,width:number,height:number}>>} */const captures=new Map();
  const update=async()=>{
    const request=++epoch,p=options();result=null;outputButtons.forEach(b=>b.disabled=true);image.style.display='none';status.textContent=tt('正在生成高清预览…','Rendering a high-resolution preview…');
    try{
      if(!snapshotPromise)snapshotPromise=Promise.resolve(providedSnapshot||(card?requestWidgetSnapshot(card):Promise.reject(Error('No export content')))).catch(e=>{snapshotPromise=null;throw e;});
      const snapshot=await snapshotPromise;const width=p.ratio==='auto'?snapshot.width:900;
      let capture=captures.get(width);if(!capture){capture=captureSnapshot(snapshot,width).catch(e=>{captures.delete(width);throw e;});captures.set(width,capture);}
      const composed=await composePresentation(await capture,p,context.style);
      if(request!==epoch||!modal.isConnected)return;result=composed;image.src=result.png;image.style.display='block';status.textContent=`${result.width} × ${result.height} px`;outputButtons.forEach(b=>b.disabled=false);
    }catch(e){if(request===epoch&&modal.isConnected)status.textContent=String(e);}
  };
  for(const control of modal.querySelectorAll('.creation-export-options input,.creation-export-options select'))control.addEventListener('input',()=>{void update();});
  await update();
}
