// @ts-nocheck —— 3.y 类型化(首个「有状态原子翻转」刀):classic 全局 → ES module。
//   toast/toastUndo/errText 纯函数 → export + window 兼容桥(dual-publish 安全);
//   ★lastUndo 有状态(toastUndo 内重赋值、Mod+Z 读)→ **不 dual-publish**(window 快照会分裂),
//     改「收进 runLastUndo() 访问器、不外露 mutable 值」+ 同刀原子翻转其唯一消费者(index.html Mod+Z handler)。
//   依赖 $/el(过渡 classic 全局,经共享全局词法环境解析);其余消费者按全局名调 → 逐字节零回归。
import { $, el } from './dom.js';
let lastUndo=null; /* 最近一次可撤销操作(供 Mod+Z);★模块内私有,不外露 mutable 值(防影子绑定/状态分裂) */
export function toast(msg){
  const t=el(`<div class="toast">${msg}</div>`);
  $('#toasts').appendChild(t);
  setTimeout(()=>{t.style.transition='opacity 300ms';t.style.opacity='0';setTimeout(()=>t.remove(),300);},2800);
}
export function toastUndo(msg, restoreFn){
  const t=el(`<div class="toast" style="display:flex;align-items:center;gap:14px;">${msg}<button class="toast-undo">撤销</button></div>`);
  $('#toasts').appendChild(t);
  let gone=false; const close=()=>{if(gone)return;gone=true;t.style.transition='opacity 300ms';t.style.opacity='0';setTimeout(()=>t.remove(),300);};
  const doUndo=()=>{close();restoreFn();toast('已撤销');if(lastUndo===doUndo)lastUndo=null;};
  lastUndo=doUndo;                       /* 登记为「最近可撤销」,Mod+Z 触发 */
  $('.toast-undo',t).onclick=doUndo;
  setTimeout(()=>{close();if(lastUndo===doUndo)lastUndo=null;},6500);
}
/** Mod+Z 撤销访问器(3.y:lastUndo 有状态 → 只调不外露 mutable 值,防跨模块状态分裂)。有登记则执行、返回 true;否则 false。 */
export function runLastUndo(){ if(lastUndo){ lastUndo(); return true; } return false; }
/** 错误消息进 toast(→el/innerHTML)前转义 —— §4-4:e.message 可含 rt.mcp/rt.ai 端点返回的外部内容(第25轮[应改])。
 *  返回转义后文本(文本上下文,& < > 足够);纯错误 toast(errText(e)),带前缀 toast(prefix+errText(e))。自持不依赖 cEsc(基础层)。 */
export function errText(e){ return String((e&&e.message)||e).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
/* 过渡 window 兼容桥:toast/toastUndo/errText/runLastUndo 纯函数(runLastUndo 只调不外露 lastUndo)→ dual-publish 安全;
   classic 消费者(index.html Mod+Z 已同刀翻 runLastUndo + 15 文件 toast 等)按全局名调不变。★lastUndo 本身不上桥(有状态,防分裂)。 */
/* ★批10d 账本终态:本行为白名单桥——(d) window-解析强制(内联 onclick·cBtn 串·CACT window[name]·aiErrHTML 的 go)或 §1 平台裸读(契约化批11);其余桥已全摘、消费者已 import。 */
window.toast=toast; 