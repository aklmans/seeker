// Pinned html2canvas internals avoid its same-origin document cloning iframe.
// This renderer is used only on a separate, script-disabled snapshot, never a live widget.
import {Bounds} from 'html2canvas/dist/lib/css/layout/bounds.js';
import {Context} from 'html2canvas/dist/lib/core/context.js';
import {CacheStorage} from 'html2canvas/dist/lib/core/cache-storage.js';
import {parseTree} from 'html2canvas/dist/lib/dom/node-parser.js';
import {CanvasRenderer} from 'html2canvas/dist/lib/render/canvas/canvas-renderer.js';
import {parseColor} from 'html2canvas/dist/lib/css/types/color.js';
window.captureIsolated=async()=>{
  CacheStorage.setContext(window);
  if(document.readyState!=='complete')await new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await document.fonts.ready;
  await Promise.all([...document.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;setTimeout(resolve,2000)})));
  // Expand internal vertical scroll panes to include long Chinese text and tables.
  for(const el of document.body.querySelectorAll('*')){
    if(el instanceof HTMLElement && el.scrollHeight>el.clientHeight+2 && ['auto','scroll'].includes(getComputedStyle(el).overflowY)){
      el.style.maxHeight='none';el.style.height='auto';el.style.overflowY='visible';
    }
  }
  const width=Math.max(document.documentElement.clientWidth,document.body.scrollWidth);
  const height=Math.ceil(Math.max(document.body.scrollHeight,document.documentElement.scrollHeight,document.body.getBoundingClientRect().height));
  if(width<1||height<1)throw Error('预览尚未完成布局，请重新打开导出 / Preview layout is not ready; reopen export');
  if(width>2400||height>16000||width*height*4>24000000)throw Error('内容超过高清导出限制（'+width+' × '+height+'），请拆分作品 / Split this creation before exporting');
  const context=new Context({logging:false,allowTaint:false,imageTimeout:3000,useCORS:false},new Bounds(0,0,width,height));
  const background=parseColor(context,getComputedStyle(document.body).backgroundColor);
  const tree=parseTree(context,document.body);
  const renderer=new CanvasRenderer(context,{backgroundColor:background,scale:2,x:0,y:0,width,height});
  const canvas=await renderer.render(tree);
  return {png:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
};
