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
    if(src instanceof HTMLInputElement && dst instanceof HTMLInputElement){dst.setAttribute('value',src.value);if(src.checked)dst.setAttribute('checked','');else dst.removeAttribute('checked');}
    if(src instanceof HTMLTextAreaElement)dst.textContent=src.value;
    if(src instanceof HTMLOptionElement){if(src.selected)dst.setAttribute('selected','');else dst.removeAttribute('selected');}
    if(src instanceof HTMLCanvasElement){const image=document.createElement('img');image.src=src.toDataURL('image/png');image.style.cssText=/** @type {HTMLElement} */(dst).style.cssText;image.width=src.clientWidth;image.height=src.clientHeight;dst.replaceWith(image);}
  }
  for(const script of root.querySelectorAll('script,iframe,object,embed,link,base,meta'))script.remove();
  for(const element of root.querySelectorAll('*'))for(const attr of [...element.attributes])if(attr.name.toLowerCase().startsWith('on'))element.removeAttribute(attr.name);
  const styles=[...document.querySelectorAll('style')].map(s=>s.outerHTML).join('');
  const html='<style>:root{'+document.documentElement.style.cssText+'}</style>'+styles+root.outerHTML;
  if(new TextEncoder().encode(html).length>2_000_000)throw new Error('作品过大 / Creation is too large');
  return {html,width:document.documentElement.clientWidth};
}
