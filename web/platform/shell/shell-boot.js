// @ts-nocheck —— 3.y 步3 中层:壳启动 initShell classic 全局 → ES module(export)+ 过渡 window 桥。逻辑逐字节。
/** 平台 · 壳启动 initShell:拖放守卫 + 侧栏/Agent 栏宽度恢复 + 语言恢复 + hydrateSettings + 侧栏收展/拖拽接线 + setLang。
 *  依赖 $/setLang(平台)+ setState/hydrateSettings/toggleSidebar(过渡 classic 全局,经全局词法/window);INIT-module 运行时调 initShell()。 */
import { agentCollapse } from './copilot-chrome.js'; // 移动端 AGENT 浮球:分屏一键回居中对话(≤768px 才可见)
import { $ } from './dom.js';
import { openModal, closeModal } from './modal.js'; // Web 演示访问码小模态(桌面路径不触达)
import { setLang } from './nav.js';
import { startScheduler } from './scheduler.js'; // ★Scheduled SC1:壳级分钟 tick(仅 app 开着时;fire 经 runSkill 红线全继承)
import { toggleSidebar } from './shell-keys.js';
import { hydrateSettings, setState } from './shell-state.js';
export function initShell(){
  startScheduler(); // 幂等;tick 在 store 水合(seeker-rt-ready)前空转 no-op
  // 拖放守卫:tauri.conf dragDropEnabled:false 后 webview 自己处理拖放;文件拖到拖放区之外时,默认会让 webview 导航去打开文件 → 全局拦掉(仅文件)。AI 录入区 #aiDrop 自己的 drop 仍照常摄入。
  ['dragover','drop'].forEach(evn=>document.addEventListener(evn, e=>{ if(e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes('Files')) e.preventDefault(); }));
  try{const w=localStorage.getItem('jh-sbw'); if(w)document.documentElement.style.setProperty('--sb-w',w+'px');}catch(e){}
  try{const aw=localStorage.getItem('jh-agentw'); if(aw)document.documentElement.style.setProperty('--agent-w',aw+'px');}catch(e){} // Agent 右栏宽度(画布)恢复
  try{const lg=localStorage.getItem('jh-lang'); if(lg)setState.lang=lg;}catch(e){}
  hydrateSettings(); // 目标/权重/外观偏好 从 localStorage 恢复(profile 走 rt.profile,见 hydrateProfile)
  const col=$('#sbCollapse'); if(col)col.onclick=toggleSidebar;
  const exp=$('#sbExpand'); if(exp)exp.onclick=()=>{document.body.dataset.sidebar='';if(col)col.textContent='«';};
  const lang=$('#langBtn'); if(lang){lang.textContent=setState.lang==='en'?'EN':'中';lang.onclick=()=>setLang(setState.lang==='en'?'zh':'en');}
  const rz=$('#sbResize'); if(rz)rz.onmousedown=(e)=>{
    e.preventDefault(); const sx=e.clientX; const sb=$('#sidebar'); const sw=sb?sb.offsetWidth:212;
    const mv=(ev)=>{const w=Math.max(180,Math.min(360,sw+(ev.clientX-sx)));document.documentElement.style.setProperty('--sb-w',w+'px');};
    const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);try{localStorage.setItem('jh-sbw',($('#sidebar')||{}).offsetWidth||212);}catch(e){}};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  };
  // Agent split 模式:拖分隔条调 agent-chat 宽度 → 右侧画布取其余(镜像侧栏拖拽,持久化 jh-agentw)。
  const arz=$('#agentResize'); if(arz)arz.onmousedown=(e)=>{
    e.preventDefault(); arz.classList.add('dragging'); const sx=e.clientX; const ac=$('#agentChat'); const aw=ac?ac.offsetWidth:420;
    const mv=(ev)=>{const w=Math.max(300,Math.min(820,aw+(ev.clientX-sx)));document.documentElement.style.setProperty('--agent-w',w+'px');};
    const up=()=>{arz.classList.remove('dragging');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);try{localStorage.setItem('jh-agentw',($('#agentChat')||{}).offsetWidth||420);}catch(e){}};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  };
  setLang(setState.lang);
  webDemoNote(); // Web 演示版标注(桌面端无此条)
  mobileNavInit(); // 移动端抽屉/浮球接线(桌面上这些元素 display:none,onclick 挂着也永不触达)
}

/* ---- 移动端(≤768px)导航抽屉 + AGENT 返回浮球 ----
   纯接线:显隐全由 CSS 媒体查询管;此处只翻 body[data-mnav] 状态与转发 agentCollapse。
   抽屉内任何按钮点击(导航/应用管理/主题/语言)即收抽屉 —— 单手动线,免二次关闭。 */
function mobileNavInit(){
  const mnav=$('#mnavBtn');
  if(mnav) /** @type {HTMLElement} */ (mnav).onclick=()=>{ document.body.dataset.mnav = document.body.dataset.mnav==='open' ? '' : 'open'; };
  const scrim=$('#mScrim');
  if(scrim) /** @type {HTMLElement} */ (scrim).onclick=()=>{ document.body.dataset.mnav=''; };
  const sb=$('#sidebar');
  if(sb) sb.addEventListener('click',(e)=>{
    const t=/** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target : null);
    if(t && t.closest('button') && window.matchMedia('(max-width:768px)').matches) document.body.dataset.mnav='';
  });
  const mab=$('#mAgentBack');
  if(mab) /** @type {HTMLElement} */ (mab).onclick=()=>{ document.body.dataset.mnav=''; agentCollapse(); };
}

/* ---- Web 演示版标注 ----
   网页运行时(无 __TAURI__)= IndexedDB + 降级回复:无密钥、无 Rust 能力(真实 AI 工具循环/记忆/连接器/钥匙串均桌面端)。
   对访客诚实标注「这是演示」,并给下载出口;可关(记 localStorage,不反复打扰 —— 反焦虑)。
   文案与链接平台自持硬编码(§4-4 纪律);仅 web 注入 ⇒ 桌面零变化。 */
function webDemoNote(){
  if(/** @type {any} */ (globalThis).__TAURI__) return;               // 桌面端不出现
  try{ if(localStorage.getItem('jh-demonote')==='off') return; }catch(_e){}
  const n=document.createElement('div');
  n.className='demo-note'; // 移动端媒体查询靠此类覆盖(换行/字号/圆角,见 index.html 移动块)
  // 顶栏中央空档(面包屑与页首 CTA 之间)—— 固定 bottom 会压住 Agent 输入框(截图实测),故置顶。
  n.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--bg-elevated);border:0.5px solid var(--border-strong);border-radius:99px;font-size:12px;color:var(--ink-2);box-shadow:0 4px 18px rgba(0,0,0,.08);max-width:min(86vw,680px);line-height:1.6;white-space:nowrap;';
  const zh=(setState.lang||'zh')!=='en';
  const link='<a href="https://github.com/aklmans/seeker/releases" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;border-bottom:0.5px solid var(--accent-soft);white-space:nowrap;">'+(zh?'下载桌面版':'Download')+'</a>';
  const body=document.createElement('span');
  n.appendChild(body);
  const x=document.createElement('button');
  x.textContent='×';
  x.setAttribute('aria-label', zh?'关闭':'Dismiss');
  x.style.cssText='border:none;background:transparent;color:var(--ink-mute);font-size:14px;cursor:pointer;padding:0 2px;line-height:1;';
  x.onclick=()=>{ n.remove(); try{ localStorage.setItem('jh-demonote','off'); }catch(_e){} };
  n.appendChild(x);
  document.body.appendChild(n);
  // 文案三态:无代理(Pages)/ 有代理未填码 / 已接真模型。探活是异步的 → 先渲基础态,结果到再升级。
  const ai=/** @type {any} */ (window).SeekerRT && /** @type {any} */ (window).SeekerRT.ai;
  let demoProxyProbe=false;   // 先于 render 声明(render 闭包引用它;声明滞后会 TDZ)
  const render=()=>{
    const ready=!!(ai && typeof ai.chatReady==='function' && ai.chatReady());
    const proxy=demoProxyProbe || ready; // ready 蕴含代理在
    if(ready){
      body.innerHTML=(zh?'Web 演示 —— <b>已接真模型</b>(限量额度);记忆 / 连接器仍在桌面端。':'Web demo — <b>live model on</b> (limited quota); memory / connectors live in the desktop app.')+' '+link;
    }else if(proxy){
      body.innerHTML=(zh?'Web <b>演示版</b> —— 数据只存你的浏览器。':'Web <b>demo</b> — data stays in your browser.')+' '
        +'<a href="#" data-democode style="color:var(--accent);text-decoration:none;border-bottom:0.5px solid var(--accent-soft);white-space:nowrap;">'+(zh?'输入访问码,和真模型聊':'Enter access code for live chat')+'</a> · '+link;
      const a=body.querySelector('[data-democode]');
      if(a) /** @type {HTMLElement} */ (a).onclick=(e)=>{ e.preventDefault(); demoCodeModal(zh, render); };
    }else{
      body.innerHTML=(zh?'Web <b>演示版</b> —— 数据只存你的浏览器;真实 AI / 记忆 / 连接器在桌面端。':'Web <b>demo</b> — data stays in your browser; real AI / memory / connectors live in the desktop app.')+' '+link;
    }
  };
  render();
  // 探针:同 runtime 的探活路径(相对 api/health);成功且未填码 → 升级出「输入访问码」入口。
  try{ fetch('api/health').then(r=>{ if(r&&r.ok){ demoProxyProbe=true; render(); } }).catch(()=>{}); }catch(_e){}
  // 401 清码回滚:runtime 清掉无效码后广播 → 顶栏从「已接真模型」乐观态退回「输入访问码」入口(不留假状态)。
  window.addEventListener('seeker-demo-code-cleared', render);
}

/** 访问码小模态(Web 演示专用):写入 runtime(localStorage),确定后闸门即开(逐次求值,无需刷新)。 */
function demoCodeModal(zh, onSet){
  const ai=/** @type {any} */ (window).SeekerRT && /** @type {any} */ (window).SeekerRT.ai;
  if(!ai || typeof ai.setChatCode!=='function') return;
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— WEB DEMO</p><h2 style="margin-top:5px;">${zh?'输入访问码':'Access code'}<span class="dot">.</span></h2></div><button class="x">×</button></div>
    <div class="modal-body">
      <p style="font-size:12.5px;color:var(--ink-3);line-height:1.8;margin-bottom:10px;">${zh?'访问码由作者发给朋友试用(它只是演示门票,不是密钥)。填一次即可,本页记住。':'Access codes are handed out by the author for friends to try. It is a demo ticket, not a secret key.'}</p>
      <input class="input" id="demoCodeInp" style="width:100%;font-family:var(--font-mono);" placeholder="${zh?'如:seeker-xxxx':'e.g. seeker-xxxx'}">
    </div>
    <div class="modal-foot"><button class="btn" data-close>${zh?'取消':'Cancel'}</button><button class="btn btn-accent" id="demoCodeOk">${zh?'接入':'Connect'}</button></div>`);
  const ok=m.querySelector('#demoCodeOk');
  if(ok) /** @type {HTMLElement} */ (ok).onclick=()=>{
    const v=(/** @type {HTMLInputElement|null} */ (m.querySelector('#demoCodeInp'))||{value:''}).value.trim();
    if(!v) return;
    ai.setChatCode(v);
    closeModal();
    if(typeof onSet==='function') onSet();
  };
}
/* 过渡 window 兼容桥:INIT-module 调 initShell()(deferred,晚于本 module)→ 按全局名调不变;改 import 后摘。纯函数(无模块态)。 */
