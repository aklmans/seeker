// @ts-nocheck —— 3.y 类型化首刀(spike):classic 全局 → 真 ES module(export)+ 过渡 window 桥。
//   仍 @ts-nocheck:依赖 $/el/tt 尚是 classic 全局(经共享的全局词法环境,module 内 bare 引用可解析);
//   待 $/el/tt 也转 module 后本文件改 `import {$,el,tt}` + @ts-check、并从下方桥摘除(monolith-globals 账本逐条销)。
/** 平台 · 模态 focusableIn/openModal/closeModal(+焦点陷阱状态)。依赖 $/el/tt(过渡态全局);overlay click 绑定留 index.html。 */
import { $, el } from './dom.js';
import { tt } from './i18n.js';
export function focusableIn(m){ return [...m.querySelectorAll('button,[href],input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(e=>!e.disabled && e.offsetParent!==null); }
let _modalPrevFocus=null, _modalTrap=null;
export function openModal(html, wide){
  $('#modalHost').innerHTML='';
  const m=el(`<div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true">${html}</div>`);
  $('#modalHost').appendChild(m);
  $('#overlay').classList.add('open');
  const xb=$('.x',m); if(xb){ xb.onclick=closeModal; xb.setAttribute('aria-label', tt('关闭','Close')); }
  // a11y 焦点管理:记住来源焦点 → 聚焦模态首个有意义元素 → Tab 困在模态内(不逃到背景)。
  _modalPrevFocus=document.activeElement;
  const f=focusableIn(m); if(f.length) setTimeout(()=>{ try{ (f.find(e=>!e.classList.contains('x'))||f[0]).focus(); }catch(_e){} },0);
  _modalTrap=(e)=>{
    if(e.key!=='Tab') return;
    const items=focusableIn(m); if(!items.length) return;
    const first=items[0], last=items[items.length-1];
    if(!m.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
    else if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', _modalTrap, true);
  return m;
}
export function closeModal(){
  $('#overlay').classList.remove('open'); $('#modalHost').innerHTML='';
  if(_modalTrap){ document.removeEventListener('keydown', _modalTrap, true); _modalTrap=null; }
  if(_modalPrevFocus && _modalPrevFocus.focus){ try{ _modalPrevFocus.focus(); }catch(_e){} } _modalPrevFocus=null;
}
/* ★批11A:`[data-close]` 文档级委派 —— 替代 14 处内联 onclick="closeModal()"(内联属性按 window 解析=账本残留因)。
   语义逐字等价:点击关模态;复合钮(data-close + data-go)由本委派与 nav 的 data-go 委派各自触发
   (modal tag@863 早于 nav@865 → 监听先注册先跑 = 先关后跳,同原 closeModal();go(...) 序)。 */
document.addEventListener('click', e => { const t = e.target && e.target.closest ? e.target.closest('[data-close]') : null; if (t) closeModal(); });
/* ★批11A:closeModal 桥删——14 处内联 onclick 全改 [data-close] 委派、零 window 消费者(INIT/jobseek 消费者 10d 已 import)。 */
