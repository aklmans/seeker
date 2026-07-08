// @ts-nocheck —— 批9b:壳键盘注册 + 侧栏 chrome 从 index.html inline 抽出为 module(逻辑零改动)。读 $/tt/IC/toast/openModal/closeModal/toggleTheme/go/currentPage/runLastUndo/PAGES/getAppMode/setAppMode/copToggle/copEl/copClose/agentCollapse/cmdIsOpen/cmdClose/openNewJob/openNewAction/SeekerKeys 仍运行时全局(待批10 转 import 再 @ts-check)。
/** 平台 · 壳键盘注册(A 层 · 集中注册;分发模块在 platform/keys/keys.js)+ 侧栏 chrome(原 index.html inline 抽出 · 批9b)。
 *  initKeys 由 INIT-module 运行时调(deferred、晚于本 module eval → 桥就绪);isDesktop 被 shell-state/data-store/settings/copilot-chrome 运行时 typeof 守卫读;
 *  toggleSidebar 被 shell-boot.initShell 运行时接线(#sbCollapse.onclick);syncSbToggleTitle 被 nav.setLang typeof 守卫调。
 *  pageSearchInput/contextNew/keysHelpHTML 仅 initKeys 内消费(grep 证)→ module-private 不 export 不上桥。
 *  §1 归属债(pre-existing,随 CACT_ALLOWED 契约化账一并清):contextNew 硬编码 jobseek openNewJob/openNewAction——未来经 manifest 契约声明 per-page「新建」动作。 */

/* ============ KEYBOARD (A 层 · 集中注册;分发模块在 platform/keys/keys.js) ============ */
import { agentCollapse, cmdClose, cmdIsOpen, copClose, copEl, copToggle, getAppMode, setAppMode } from './copilot-chrome.js';
import { $ } from './dom.js';
import { tt } from './i18n.js';
import { IC } from './icons.js';
import { closeModal, openModal } from './modal.js';
import { currentPage, go, toggleTheme } from './nav.js';
import { PAGES } from './shell-state.js';
import { runLastUndo, toast } from './toast.js';
export function syncSbToggleTitle(){ const col=$('#sbCollapse'); if(col) col.title=(document.body.dataset.sidebar==='rail')?tt('展开侧栏','Expand sidebar'):tt('收起侧栏','Collapse sidebar'); }
export function toggleSidebar(){
  const r=document.body.dataset.sidebar==='rail';
  document.body.dataset.sidebar=r?'':'rail';
  const col=$('#sbCollapse'); if(col)col.textContent=r?'«':'»';
  syncSbToggleTitle();   // 提示词随状态切换(此前一直是「收起侧栏」)
}
export function isDesktop(){return !!(window.__TAURI__);}
function pageSearchInput(id){
  const pg=$('#page-'+id); if(!pg)return null;
  /* 原型真实搜索框是 .iv-search(面试页);其余页为 chip 筛选、无文本框 */
  return pg.querySelector('input[type="search"], input.iv-search, input.search, [data-search] input, input[data-search]');
}
function contextNew(){
  const m={jobs:openNewJob, actions:openNewAction};
  const fn=m[currentPage()]; if(fn)fn(); else toast(tt('当前页没有「新建」动作','Nothing to create on this page'));
}
function keysHelpHTML(){
  const groups=window.SeekerKeys.groups();
  const body=groups.map(g=>`<div class="ks-grp"><div class="ks-gh">${tt(g.group.zh,g.group.en)}</div>`+
    g.items.map(it=>`<div class="ks-row"><span class="ks-lb">${tt(it.label.zh,it.label.en)}</span><span class="kbd">${it.fmt}</span></div>`).join('')+`</div>`).join('');
  return `<div class="modal-head"><div><p class="eyebrow">— SHORTCUTS</p><h2 style="margin-top:5px;">${tt('键盘快捷键','Keyboard shortcuts')}<span class="dot">.</span></h2><div class="sub"><span>Mod = ⌘ / Ctrl</span></div></div><button class="x">${IC.x}</button></div>
    <div class="modal-body"><div class="ks-wrap">${body}</div></div>`;
}
export function initKeys(){
  const K=window.SeekerKeys;
  if(!K){ console.error('[keys] window.SeekerKeys 未加载 —— 快捷键将全部失效;请检查 platform/keys/keys.js 是否被 frontendDist 内嵌并成功加载'); return; }
  const G={glob:{zh:'全局',en:'Global'},navg:{zh:'导航',en:'Navigate'},ctx:{zh:'语境',en:'Contextual'},agent:{zh:'Agent / 命令',en:'Agent / Command'},iv:{zh:'面试陪练',en:'Interview'}};
  K.registerAll([
    {id:'agent', combo:'Mod+K', allowInInput:true, group:G.glob, label:{zh:'唤起 Agent / 问问 AI',en:'Open Agent / Ask AI'}, run:()=>{ if(getAppMode()==='agent'){const ip=$('#agentInput');if(ip)ip.focus();}else copToggle(); }},
    {id:'mode', combo:'Mod+\\', allowInInput:true, group:G.glob, label:{zh:'切换 Agent / 编辑器',en:'Toggle Agent / Editor'}, run:()=>setAppMode(getAppMode()==='agent'?'editor':'agent')},
    {id:'sidebar', combo:'Mod+B', allowInInput:true, group:G.glob, label:{zh:'收起 / 展开侧栏',en:'Toggle sidebar'}, run:toggleSidebar},
    {id:'settings', combo:'Mod+,', allowInInput:true, group:G.glob, label:{zh:'数据设置',en:'Settings'}, run:()=>go('settings')},
    {id:'help', combo:'Mod+/', allowInInput:true, group:G.glob, label:{zh:'快捷键帮助',en:'Shortcut help'}, run:()=>openModal(keysHelpHTML())},
    {id:'theme', combo:'Mod+Shift+D', allowInInput:true, group:G.glob, label:{zh:'切换深 / 浅主题',en:'Toggle theme'}, run:toggleTheme}
  ]);
  PAGES.forEach((p,i)=>{ const n=i+1; if(n<=9) K.register({id:'nav'+n, combo:'Mod+'+n, group:G.navg, label:{zh:p.label,en:p.en}, run:()=>go(p.id)}); });
  K.registerAll([
    {id:'new', combo:'Mod+N', when:isDesktop, group:G.ctx, label:{zh:'新建(随当前页)',en:'New (current page)'}, run:contextNew}, /* 仅桌面:网页让位浏览器 Ctrl/⌘+N(满足设计文档 §三"不抢 Mod+N") */
    {id:'find', combo:'Mod+F', group:G.ctx, when:()=>!!pageSearchInput(currentPage()), label:{zh:'聚焦搜索 / 筛选',en:'Focus search / filter'}, run:()=>{const i=pageSearchInput(currentPage());if(i){i.focus();if(i.select)i.select();}}},
    {id:'undo', combo:'Mod+Z', group:G.ctx, label:{zh:'撤销(可逆操作)',en:'Undo'}, run:()=>{ if(!runLastUndo()) toast(tt('没有可撤销的操作','Nothing to undo')); }} /* 3.y:lastUndo 有状态→经 toast.js 的 runLastUndo() 访问器(不外露 mutable 值),同刀原子翻转 */
  ]);
  /* 信息行:仅进帮助浮层、不分发(输入内已有行为 + M5 语音占位) */
  K.registerAll([
    {id:'i-esc', combo:'', display:'Esc', group:G.ctx, label:{zh:'逐层退出 / 关闭',en:'Exit / close (layered)'}},
    {id:'i-slash', combo:'', display:'/', group:G.agent, label:{zh:'输入框开头唤起命令浮层',en:'Type / for command palette'}},
    {id:'i-enter', combo:'', display:'Enter', group:G.agent, label:{zh:'发送',en:'Send'}},
    {id:'i-shiftenter', combo:'', display:(K.isMac?'⇧ Enter':'Shift+Enter'), group:G.agent, label:{zh:'换行',en:'New line'}},
    {id:'i-updown', combo:'', display:'↑ ↓', group:G.agent, label:{zh:'命令浮层选择 / 空输入调历史',en:'Palette select / recall last'}},
    {id:'i-voice', combo:'Mod+Shift+M', display:K.fmt('Mod+Shift+M'), group:G.iv, label:{zh:'语音作答(M5 上线)',en:'Voice answer (in M5)'}}
  ]);
  /* Esc 逐层链(优先级高→低):命令浮层 → 弹窗/帮助 → Copilot → 收起画布 */
  K.registerEscape(()=>{ if(cmdIsOpen()){cmdClose();return true;} return false; }, 50);
  K.registerEscape(()=>{ const o=$('#overlay'); if(o&&o.classList.contains('open')){closeModal();return true;} return false; }, 40);
  K.registerEscape(()=>{ const c=copEl(); if(c&&c.classList.contains('open')){copClose();return true;} return false; }, 30);
  K.registerEscape(()=>{ if(getAppMode()==='agent'&&document.body.dataset.agent==='split'){agentCollapse();return true;} return false; }, 20);
  K.attach();
}

/* 过渡 window 桥:initKeys(INIT-module 运行时调)/ toggleSidebar(shell-boot.initShell 接线 #sbCollapse)/ syncSbToggleTitle(nav.setLang typeof 守卫)/ isDesktop(shell-state/data-store/settings/copilot-chrome typeof 守卫)——批10 改 import 后摘。pageSearchInput/contextNew/keysHelpHTML 私有。 */
