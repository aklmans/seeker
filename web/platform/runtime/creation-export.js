// @ts-check
/** PNG-only input from an isolated renderer. Never accept arbitrary HTML in the parent DOM. */
export async function decodeCreationPNG(/** @type {string} */ dataUrl){
  if(typeof dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)||dataUrl.length>32_000_000)throw Error('Invalid or oversized PNG');
  const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]),c=>c.charCodeAt(0));
  if(bytes.length<24||![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))throw Error('PNG required');
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=header.getUint32(16),h=header.getUint32(20);
  if(!w||!h||w>4800||h>32000||w*h>24_000_000)throw Error('Image dimensions exceed export limits');
  const image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Invalid PNG'));image.src=dataUrl;});
  const {naturalWidth:width,naturalHeight:height}=image;
  if(!width||!height||width>4800||height>32000||width*height>24_000_000)throw Error('Image dimensions exceed export limits');
  return {image,width,height,bytes};
}
/** @param {string} title @param {Blob} blob @param {string} ext */
function download(title,blob,ext){
  const name=title.replace(/[^\p{L}\p{N}_-]/gu,'').slice(0,60)||'Seeker-creation';
  const filename=name+'-'+Date.now()+'.'+ext;const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return filename;
}
/** Single raster page, with a normal PDF cross-reference table. No external library or network.
 * @param {HTMLImageElement} image @param {number} width @param {number} height */
function rasterPDF(image,width,height){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0);
  const jpeg=Uint8Array.from(atob(canvas.toDataURL('image/jpeg',0.95).split(',')[1]),c=>c.charCodeAt(0));canvas.width=canvas.height=0;
  const pageWidth=Math.min(595.28,14400*width/height),pageHeight=pageWidth*height/width;
  const stream=`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  const encode=(/** @type {string} */s)=>new TextEncoder().encode(s);
  const objects=[encode('<< /Type /Catalog /Pages 2 0 R >>'),encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    new Blob([`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,jpeg,'\nendstream']),
    encode(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)];
  /** @type {BlobPart[]} */const parts=['%PDF-1.4\n'];let offset=9;const offsets=[0];
  for(let i=0;i<objects.length;i++){const head=`${i+1} 0 obj\n`,tail='\nendobj\n';offsets.push(offset);parts.push(head,objects[i],tail);offset+=head.length+(objects[i] instanceof Blob?/** @type {Blob} */(objects[i]).size:/** @type {Uint8Array} */(objects[i]).byteLength)+tail.length;}
  parts.push(`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`);
  return new Blob(parts,{type:'application/pdf'});
}
/** @param {string} title @param {string} pngDataUrl @param {'png'|'pdf'} format */
export async function exportCreationImage(title,pngDataUrl,format){
  const {image,width,height,bytes}=await decodeCreationPNG(pngDataUrl);
  if(format!=='png'&&format!=='pdf')throw Error('Unsupported export format');
  return download(title,format==='png'?new Blob([bytes],{type:'image/png'}):rasterPDF(image,width,height),format);
}
/** @param {string} pngDataUrl */
export async function copyCreationImage(pngDataUrl){
  if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('Image clipboard unavailable in this browser');
  const blob=decodeCreationPNG(pngDataUrl).then(r=>new Blob([r.bytes],{type:'image/png'}));
  await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
}
/** SVG exports accept only the platform's inert drawing vocabulary.
 * @param {string} svg */
export function validateCreationSVG(svg){
  if(typeof svg!=='string'||new TextEncoder().encode(svg).length>2_000_000||/<!|<\?/.test(svg))throw Error('Invalid SVG');
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('Invalid SVG');
  const tags=new Set(['svg','g','rect','path','text','tspan']);
  const attrs=new Set(['xmlns','width','height','viewBox','x','y','rx','fill','stroke','stroke-width','stroke-dasharray','font-family','font-size','text-anchor','d','data-mind-node','tabindex','role','aria-label']);
  for(const el of doc.querySelectorAll('*')){
    if(!tags.has(el.tagName))throw Error('Unsupported SVG element');
    for(const a of [...el.attributes]){
      if(!attrs.has(a.name)||(a.name==='xmlns'&&a.value!=='http://www.w3.org/2000/svg')||(['fill','stroke'].includes(a.name)&&a.value!=='none'&&!/^#[0-9a-f]{6}$/i.test(a.value)))throw Error('Unsupported SVG attribute');
    }
  }
  return svg;
}
/** @param {string} title @param {string} svg */
export async function exportCreationSVG(title,svg){return download(title,new Blob([validateCreationSVG(svg)],{type:'image/svg+xml'}),'svg');}
