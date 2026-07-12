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
}
/* 过渡 window 兼容桥:INIT-module 调 initShell()(deferred,晚于本 module)→ 按全局名调不变;改 import 后摘。纯函数(无模块态)。 */
