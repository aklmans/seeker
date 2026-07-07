// @ts-nocheck —— 抽壳序1-g 过渡:导航装配,运行时依赖 PAGES/GROUPS/setState/chrome(后定义);类型化留 3.y;逻辑零改动。
/** 平台 · 壳导航/页面框架装配 current/buildNav/syncNavCounts/setLang/rerenderPages/go/renderTopActions/toggleTheme/frontis/signFoot/buildPages。
 *  chrome(updateAgentChrome/updateCopChrome/renderModeSwitch)归序3、留 index.html;setLang/go 运行时调之(函数延迟)。
 *  挂全局 + 载序前置(在消费者前;引用的 PAGES/setState/chrome 均函数体内运行时求值)→ 抽壳零回归(约束⑤)。 */
let current='overview';

function buildNav(){
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
function syncNavCounts(){
  PAGES.forEach(p=>{ if(!p.liveCount) return; const c=$(`.nav-item[data-id="${p.id}"] .count`); if(c) c.textContent=p.liveCount(); });
}
function setLang(l){
  setState.lang=l; try{localStorage.setItem('jh-lang',l);}catch(e){}
  const lb=$('#langBtn'); if(lb)lb.textContent=l==='en'?'EN':'中';
  buildNav(); renderModeSwitch();
  const p=PAGES.find(x=>x.id===current); if(p)$('#crumb').innerHTML=L(p);
  renderTopActions(current); updateAgentChrome(); updateCopChrome();
  if(typeof syncSbToggleTitle==='function') syncSbToggleTitle();
  rerenderPages();
}
/* tt 已抽壳 → platform/shell/i18n.js(序1-c) */
function rerenderPages(){PAGES.forEach(p=>{try{if(p.render)p.render();}catch(e){}});}

function go(id){
  current=id;
  $$('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.id===id));
  const p=PAGES.find(x=>x.id===id);
  $('#crumb').innerHTML=L(p);
  renderTopActions(id);
  $$('.page').forEach(pg=>pg.classList.remove('active'));
  const pg=$('#page-'+id); pg.classList.add('active');
  pg.scrollIntoView?null:null;
  window.scrollTo(0,0);
  if(typeof agentShowCanvas==='function') agentShowCanvas();
}
function renderTopActions(id){
  const host=$('#topActions'); host.innerHTML='';
  const map={
    overview:[{t:tt('智能匹配','Smart match'), a:'btn-accent', fn:()=>go('match')}],
    // 3.y:handler 一律**惰性闭包**(点击时解析),与 module 载序解耦 —— openResumeModal 等已/将 ESM 化为 deferred module bridge,
    //       renderTopActions 在 INIT(initShell→setLang)早于 body module 载入时构建此 map,裸引用会 ReferenceError(cut2 潜伏、步1 暴露)。
    match:[{t:tt('我的简历','My resume'), fn:()=>openResumeModal()}],
    resumes:[{t:tt('+ 生成针对性简历','+ Tailored resume'), a:'btn-accent', fn:()=>resumeGenerate(resumeState.jobId, renderResumes)}],
    jobs:[{t:tt('+ 录入岗位','+ Add job'), a:'btn-accent', fn:()=>openNewJob()}],   // 「筛选」按钮删除:筛选器本就常驻在页面下方(城市/状态),顶部按钮只 toast 提示=冗余
    analysis:[{t:tt('导出报告','Export report'), fn:()=>toast(tt('已导出分析报告 (mock)','Analysis report exported (mock)'))}],
    skills:[{t:tt('市场价值报告','Market value'), fn:()=>openMarketValue()}],
    actions:[{t:tt('+ 添加行动','+ Add action'), fn:()=>openNewAction()}],
    interview:[],
    settings:[]
  };
  (map[id]||[]).forEach(b=>{
    const btn=el(`<button class="btn ${b.a||''}">${b.t}</button>`); btn.onclick=b.fn; host.appendChild(btn);
  });
  // 主题切换器去除:主题已可在「数据设置 · 主题模式」+ 侧栏脚按钮(themeBtn2)+ 快捷键 Mod+Shift+D 三处切换,顶部图标冗余。
}

/* ============ THEME ============ */
function toggleTheme(){
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
function wireOverlay(){ const o=$('#overlay'); if(o) o.addEventListener('click',e=>{if(e.target.id==='overlay')closeModal();}); }
/* Esc 关弹窗已收编进 SeekerKeys 的 Esc 逐层链(见 initKeys) */

function frontis(eyebrow,title){
  return `<div class="frontis"><div><p class="eyebrow">— ${eyebrow}</p><h1 class="title">${title}<span class="dot">.</span></h1></div></div>`;
}
function signFoot(){return `<footer class="sign"><span>JOBHUNT · 2026</span><span>本地优先 · LOCAL-FIRST</span></footer>`;}

function buildPages(){
  const c=$('#content');
  PAGES.forEach(p=>{
    const pg=el(`<section class="page" id="page-${p.id}"></section>`);
    c.appendChild(pg);
  });
  // 首渲:按注册页循环(app 贡献 render;单页失败不拖垮其他应用的页)。
  PAGES.forEach(p=>{ try{ if(p.render) p.render(); }catch(e){ console.error('[shell] render '+p.id, e); } });
}
