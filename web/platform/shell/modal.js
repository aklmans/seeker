// @ts-nocheck —— 抽壳序1-e 过渡:引用 $/el 结果(Element|null)+ document 事件,类型化留 3.y;逻辑零改动。
/** 平台 · 模态 focusableIn/openModal/closeModal(+焦点陷阱状态 _modalPrevFocus/_modalTrap)。
 *  依赖 $/el/tt;overlay click 绑定(立即执行)留 index.html。挂全局 + 载序前置零回归(约束⑤)。 */
/** 模态内可聚焦元素(可见、未禁用)。 */
function focusableIn(m){ return [...m.querySelectorAll('button,[href],input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(e=>!e.disabled && e.offsetParent!==null); }
let _modalPrevFocus=null, _modalTrap=null;
function openModal(html, wide){
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
function closeModal(){
  $('#overlay').classList.remove('open'); $('#modalHost').innerHTML='';
  if(_modalTrap){ document.removeEventListener('keydown', _modalTrap, true); _modalTrap=null; }
  if(_modalPrevFocus && _modalPrevFocus.focus){ try{ _modalPrevFocus.focus(); }catch(_e){} } _modalPrevFocus=null;
}
