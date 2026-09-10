// @ts-check
/** Runs ONLY inside an opaque widget frame. Result remains untrusted data.
 * Clone form/canvas state without mutating the live interactive document. */
export function snapshotWidget(){
  const clone=document.body.cloneNode(true);
  const root=/** @type {HTMLElement} */(clone);
  const original=document.body.querySelectorAll('*');
  const copied=root.querySelectorAll('*');
  for(let i=0;i<original.length;i++){
    const src=original[i],dst=copied[i];
    if(src instanceof SVGElement && dst instanceof SVGElement){
      // SVG is serialized into a separate image by the raster renderer. Parent CSS
      // variables and inherited typography do not exist in that image document.
      const css=getComputedStyle(src);
      for(const property of ['color','fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','opacity','font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline']){
        dst.style.setProperty(property,css.getPropertyValue(property));
      }
    }
    if(src instanceof HTMLInputElement && dst instanceof HTMLInputElement){dst.setAttribute('value',src.value);if(src.checked)dst.setAttribute('checked','');else dst.removeAttribute('checked');}
    if(src instanceof HTMLInputElement && src.type==='range'){
      // html2canvas treats native ranges as text fields and cannot capture the
      // pseudo-element thumb. Freeze our standard track and thumb without JS.
      const css=getComputedStyle(src),theme=getComputedStyle(document.documentElement);
      const min=Number(src.min||0),max=Number(src.max||100),value=Number(src.value);
      const ratio=max>min?Math.max(0,Math.min(1,(value-min)/(max-min))):0;
      const slider=document.createElement('span'),track=document.createElement('span'),thumb=document.createElement('span');
      slider.setAttribute('data-widget-range',src.value);slider.setAttribute('role','img');
      slider.setAttribute('aria-label',(src.labels?.[0]?.textContent||src.getAttribute('aria-label')||'')+' '+src.value);
      slider.style.cssText='display:block;position:relative;box-sizing:border-box;width:100%;max-width:100%;height:'+src.clientHeight+'px;grid-column:'+css.gridColumn+';margin:'+css.margin+';';
      const color=(/** @type {string} */key,/** @type {string} */fallback)=>theme.getPropertyValue(key).trim()||fallback;
      track.style.cssText='position:absolute;left:0;right:0;top:calc(50% - 2px);height:4px;border-radius:2px;background:'+color('--border-strong','#c0bfba')+';';
      thumb.style.cssText='position:absolute;left:calc('+ratio*100+'% - '+ratio*16+'px);top:calc(50% - 8px);width:16px;height:16px;box-sizing:border-box;border:2px solid '+color('--bg-elevated','#fff')+';border-radius:50%;background:'+color('--accent','#c95f3d')+';box-shadow:0 0 0 .5px '+color('--border-strong','#c0bfba')+';';
      slider.append(track,thumb);dst.replaceWith(slider);
    }
    if(src instanceof HTMLTextAreaElement)dst.textContent=src.value;
    if(src instanceof HTMLOptionElement){if(src.selected)dst.setAttribute('selected','');else dst.removeAttribute('selected');}
    if(src instanceof HTMLCanvasElement){const image=document.createElement('img');image.src=src.toDataURL('image/png');image.style.cssText=/** @type {HTMLElement} */(dst).style.cssText;image.width=src.clientWidth;image.height=src.clientHeight;dst.replaceWith(image);}
  }
  // The raster parser does not implement details' UA hiding semantics.
  for(const details of root.querySelectorAll('details:not([open])')){
    const summary=details.querySelector(':scope > summary');
    for(const child of [...details.childNodes])if(child!==summary)child.remove();
  }
  for(const script of root.querySelectorAll('script,iframe,object,embed,link,base,meta'))script.remove();
  for(const element of root.querySelectorAll('*'))for(const attr of [...element.attributes])if(attr.name.toLowerCase().startsWith('on'))element.removeAttribute(attr.name);
  const styles=[...document.querySelectorAll('style')].map(s=>s.outerHTML).join('');
  // The live theme is set with inline root properties. Freeze it AFTER authored styles.
  const html=styles+'<style>:root{'+document.documentElement.style.cssText+'}</style>'+root.outerHTML;
  if(new TextEncoder().encode(html).length>2_000_000)throw new Error('作品过大 / Creation is too large');
  return {html,width:document.documentElement.clientWidth};
}
