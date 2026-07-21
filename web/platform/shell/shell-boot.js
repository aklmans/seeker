// @ts-nocheck —— 3.y 步3 中层:壳启动 initShell classic 全局 → ES module(export)+ 过渡 window 桥。逻辑逐字节。
/** 平台 · 壳启动 initShell:拖放守卫 + 侧栏/Agent 栏宽度恢复 + 语言恢复 + hydrateSettings + 侧栏收展/拖拽接线 + setLang。
 *  依赖 $/setLang(平台)+ setState/hydrateSettings/toggleSidebar(过渡 classic 全局,经全局词法/window);INIT-module 运行时调 initShell()。 */
import { $ } from './dom.js';
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
}

/* ---- Web 演示版标注 ----
   网页运行时(无 __TAURI__)= IndexedDB + 降级回复:无密钥、无 Rust 能力(真实 AI 工具循环/记忆/连接器/钥匙串均桌面端)。
   对访客诚实标注「这是演示」,并给下载出口;可关(记 localStorage,不反复打扰 —— 反焦虑)。
   文案与链接平台自持硬编码(§4-4 纪律);仅 web 注入 ⇒ 桌面零变化。 */
function webDemoNote(){
  if(/** @type {any} */ (globalThis).__TAURI__) return;               // 桌面端不出现
  try{ if(localStorage.getItem('jh-demonote')==='off') return; }catch(_e){}
  const n=document.createElement('div');
  // 顶栏中央空档(面包屑与页首 CTA 之间)—— 固定 bottom 会压住 Agent 输入框(截图实测),故置顶。
  n.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--bg-elevated);border:0.5px solid var(--border-strong);border-radius:99px;font-size:12px;color:var(--ink-2);box-shadow:0 4px 18px rgba(0,0,0,.08);max-width:min(86vw,620px);line-height:1.6;white-space:nowrap;';
  const zh=(setState.lang||'zh')!=='en';
  n.innerHTML=(zh
      ? 'Web <b>演示版</b> —— 数据只存你的浏览器;真实 AI / 记忆 / 连接器在桌面端。'
      : 'Web <b>demo</b> — data stays in your browser; real AI / memory / connectors live in the desktop app.')
    +' <a href="https://github.com/aklmans/seeker/releases" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;border-bottom:0.5px solid var(--accent-soft);white-space:nowrap;">'
    +(zh?'下载桌面版':'Download')+'</a>';
  const x=document.createElement('button');
  x.textContent='×';
  x.setAttribute('aria-label', zh?'关闭':'Dismiss');
  x.style.cssText='border:none;background:transparent;color:var(--ink-mute);font-size:14px;cursor:pointer;padding:0 2px;line-height:1;';
  x.onclick=()=>{ n.remove(); try{ localStorage.setItem('jh-demonote','off'); }catch(_e){} };
  n.appendChild(x);
  document.body.appendChild(n);
}
/* 过渡 window 兼容桥:INIT-module 调 initShell()(deferred,晚于本 module)→ 按全局名调不变;改 import 后摘。纯函数(无模块态)。 */
