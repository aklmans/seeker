// @ts-nocheck —— 3.y 步3 中层:壳导航装配 classic 全局 → ES module(export)+ 过渡 window 桥。逻辑逐字节。
/** 平台 · 壳导航/页面框架装配 currentPage/buildNav/syncNavCounts/setLang/rerenderPages/go/renderTopActions/toggleTheme/frontis/signFoot/buildPages。
 *  chrome(updateAgentChrome/updateCopChrome/renderModeSwitch)归序3、留 index.html;setLang/go 运行时调之(函数延迟)。
 *  ★current 有状态(go:current=id 整体重赋值)+ 8 外部消费者 → 封装访问器 currentPage()、**不上 window 桥**(litmus:重赋值+外部消费者,dual-publish 会分裂快照);消费者经 currentPage() 读(同刀原子翻转,同 lastUndo→runLastUndo 先例)。
 *  其余 11 函数 export + 过渡 window 桥(classic/module 消费者按全局名调不变);PAGES/GROUPS/setState/chrome 均函数体内运行时求值(经全局词法/window)→ 载序零回归。 */
import { agentShowCanvas, updateAgentChrome, updateCopChrome } from './copilot-chrome.js';   /* ★Cut 1b:renderModeSwitch 删(模式切换删) */
import { $, $$, el } from './dom.js';
import { L, tt } from './i18n.js';
import { IC } from './icons.js';
import { closeModal } from './modal.js';
import { syncSbToggleTitle } from './shell-keys.js';
import { GROUPS, PAGES, setState } from './shell-state.js';
import { toast } from './toast.js';
let current='overview';                              // 模块私有(唯一写者 go:current=id);★不上 window 桥
export function currentPage(){ return current; }     // 唯一读取通道:每调返回最新 current → 外部消费者从裸 current 改经此、无快照分裂

export function buildNav(){
  const nav=$('#nav'); nav.innerHTML=''; let lastGroup=null;
  PAGES.forEach(p=>{
    if(p.group&&p.group!==lastGroup){ lastGroup=p.group; const g=GROUPS[p.group]; nav.appendChild(el(`<div class="nav-group">${setState.lang==='en'?g.en:g.zh}</div>`)); }
    // 导航徽标:页面条目自带 liveCount 回调(app 贡献真实数据),回退静态 count。
    const liveCount = p.liveCount ? p.liveCount() : p.count;
    const right=liveCount?`<span class="count">${liveCount}</span>`:(p.ai?`<span class="ai-tag">AI</span>`:'');
    const b=el(`<button class="nav-item ${p.id===current?'active':''}" data-id="${p.id}" title="${L(p)}"><span class="nav-ic">${p.icon||''}</span><span class="nav-abbr">${p.abbr}</span><span class="nav-label">${L(p)}</span>${right}</button>`);
    b.onclick=()=>go(p.id);
    nav.appendChild(b);
  });
}
// 导航徽标随真实数据刷新:buildNav 只在 init/切语言时跑,岗位/行动增删后须就地更新计数(否则陈旧、看着像写死)。
export function syncNavCounts(){
  PAGES.forEach(p=>{ if(!p.liveCount) return; const c=$(`.nav-item[data-id="${p.id}"] .count`); if(c) c.textContent=p.liveCount(); });
}
export function setLang(l){
  setState.lang=l; try{localStorage.setItem('jh-lang',l);}catch(e){}
  const lb=$('#langBtn'); if(lb)lb.textContent=l==='en'?'EN':'中';
  buildNav();   /* ★Cut 1b:renderModeSwitch() 删 */
  const p=PAGES.find(x=>x.id===current); if(p)$('#crumb').innerHTML=L(p);
  renderTopActions(current); updateAgentChrome(); updateCopChrome();
  if(typeof syncSbToggleTitle==='function') syncSbToggleTitle();
  rerenderPages();
}
/* tt 已抽壳 → platform/shell/i18n.js(序1-c) */
export function rerenderPages(){PAGES.forEach(p=>{try{if(p.render)p.render();}catch(e){}});}

export function go(id){
  current=id;
  $$('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.id===id));
  const p=PAGES.find(x=>x.id===id);
  $('#crumb').innerHTML=L(p);
  renderTopActions(id);
  $$('.page').forEach(pg=>pg.classList.remove('active'));
  const pg=$('#page-'+id); pg.classList.add('active');
  pg.scrollIntoView?null:null;
  window.scrollTo(0,0);
  document.body.dataset.canvas='page';   // ★AI-Native P0:导航 = 画布回到页面视图(让位给 #content,隐藏 show_widget 画布)
  if(typeof agentShowCanvas==='function') agentShowCanvas();
}
export function renderTopActions(id){
  const host=$('#topActions'); host.innerHTML='';
  // §1 契约化(批11B · pageActions):原硬编码 jobseek 顶栏动作 map(openResumeModal/resumeGenerate/openMarketValue…)逐字迁入 manifest,
  // 平台经 SeekerShell.pageActions(id) 取该页动作 —— 不再裸读 apps 符号。惰性闭包语义不变(fn 点击时解析、与 module 载序解耦);
  // interview/settings 等无动作页 → 契约返回空数组(未命中 map)。
  window.SeekerShell.pageActions(id).forEach(b=>{
    const btn=el(`<button class="btn ${b.a||''}">${b.t}</button>`); btn.onclick=b.fn; host.appendChild(btn);
  });
  // 主题切换器去除:主题已可在「数据设置 · 主题模式」+ 侧栏脚按钮(themeBtn2)+ 快捷键 Mod+Shift+D 三处切换,顶部图标冗余。
}

/* ============ THEME ============ */
export function toggleTheme(){
  const cur=document.documentElement.dataset.theme;
  const next=cur==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;
  try{localStorage.setItem('jh-theme',next);}catch(e){}
  const tb2=$('#themeBtn2'); if(tb2) tb2.innerHTML=next==='dark'?IC.sun:IC.moon;
}
(function initTheme(){
  let t='light'; try{t=localStorage.getItem('jh-theme')||'light';}catch(e){}
  document.documentElement.dataset.theme=t;
})();

/* ============ TOAST ============ */
/* toast/toastUndo/lastUndo 已抽壳 → platform/shell/toast.js(序1-d) */

/* ============ MODAL ============ */
/* focusableIn/openModal/closeModal 已抽壳 → platform/shell/modal.js(序1-e)。
   ★3.y 步3-a 修(第29轮[阻断]):overlay-click-关闭绑定从 classic 顶层(parse-time **裸用 $**)收进 wireOverlay()、由 INIT-module 调 ——
   dom.js 转 deferred module 后,nav(classic@parse-time)早于 dom module → 顶层 $ 未就绪 → 原绑定抛 ReferenceError、监听没挂(overlay 点击不关闭)。
   收进函数 = 执行推迟到 INIT-module(deferred,晚于 dom module)→ $ 就绪(同 cut2 惰性修一类)。 */
export function wireOverlay(){ const o=$('#overlay'); if(o) o.addEventListener('click',e=>{if(e.target.id==='overlay')closeModal();}); }
/* Esc 关弹窗已收编进 SeekerKeys 的 Esc 逐层链(见 initKeys) */

export function frontis(eyebrow,title){
  return `<div class="frontis"><div><p class="eyebrow">— ${eyebrow}</p><h1 class="title">${title}<span class="dot">.</span></h1></div></div>`;
}
export function signFoot(){return `<footer class="sign"><span>JOBHUNT · 2026</span><span>本地优先 · LOCAL-FIRST</span></footer>`;}

export function buildPages(){
  const c=$('#content');
  PAGES.forEach(p=>{
    const pg=el(`<section class="page" id="page-${p.id}"></section>`);
    c.appendChild(pg);
  });
  // 首渲:按注册页循环(app 贡献 render;单页失败不拖垮其他应用的页)。
  PAGES.forEach(p=>{ try{ if(p.render) p.render(); }catch(e){ console.error('[shell] render '+p.id, e); } });
}
/* ★批11A:`[data-go]` 文档级委派 —— 替代 9 处内联 onclick="go('x')" + 复合钮(data-close data-go)。page id 全静态 dev 值,未知 id 行为同旧内联(throw)。 */
document.addEventListener('click', e => { const t = e.target && e.target.closest ? e.target.closest('[data-go]') : null; if (t) go(t.dataset.go); });
/* 过渡 window 兼容桥:classic/module 消费者(index.html INIT/shell-boot/settings/apps 等)按全局名调不变;逐个改 import 后摘。
   ★current 不上桥(有状态,dual-publish 分裂快照)—— 外部经 currentPage() 访问器读。initTheme 是 IIFE(自执行、无导出)。 */
/* ★批10d 账本终态:本行为白名单桥——(d) window-解析强制(内联 onclick·cBtn 串·CACT window[name]·aiErrHTML 的 go)或 §1 平台裸读(契约化批11);其余桥已全摘、消费者已 import。 */
