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
/* 过渡 window 桥(抽壳约束⑤延续):classic 消费者(index.html INIT + jobseek 11 文件)按全局名调不变 → 零回归;逐个转 import 后摘桥。 */
/* ★批10d 账本终态:本行为白名单桥——(d) window-解析强制(内联 onclick·cBtn 串·CACT window[name]·aiErrHTML 的 go)或 §1 平台裸读(契约化批11);其余桥已全摘、消费者已 import。 */
window.closeModal=closeModal;
