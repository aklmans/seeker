// @ts-nocheck —— 3.y 类型化(首个「有状态原子翻转」刀):classic 全局 → ES module。
//   toast/toastUndo/errText 纯函数 → export + window 兼容桥(dual-publish 安全);
//   ★lastUndo 有状态(toastUndo 内重赋值、Mod+Z 读)→ **不 dual-publish**(window 快照会分裂),
//     改「收进 runLastUndo() 访问器、不外露 mutable 值」+ 同刀原子翻转其唯一消费者(index.html Mod+Z handler)。
//   依赖 $/el(过渡 classic 全局,经共享全局词法环境解析);其余消费者按全局名调 → 逐字节零回归。
import { $, el } from './dom.js';
import { succeeded } from '../outcome.js'; /* 零依赖叶子:与 guardrail 共用同一条判据(第64轮 [建议]) */
let lastUndo=null; /* 最近一次可撤销操作(供 Mod+Z);★模块内私有,不外露 mutable 值(防影子绑定/状态分裂) */
export function toast(msg){
  const t=el(`<div class="toast">${msg}</div>`);
  $('#toasts').appendChild(t);
  setTimeout(()=>{t.style.transition='opacity 300ms';t.style.opacity='0';setTimeout(()=>t.remove(),300);},2800);
}
/** 可撤销 toast。**★撤销结果契约(评审第58轮裁定 · keyed-trash 的硬前置)**:
 *  旧实现 `restoreFn(); toast('已撤销');` —— **不 await、无条件报成功**。现存消费者的 restoreFn 都是
 *  同步闭包快照(不会失败)故当下无活 bug;但 keyed-trash 会给 `memory_undo(token)` 加 TTL ⇒ 撤销会
 *  **合法地失败**(过期),届时「已撤销」即为**谎报**,直接违反 CLAUDE.md §4-3 ★判据(可撤销必须是真的)。
 *
 *  **新契约(opt-in · 现存消费者逐字零回归)** —— 由 `restoreFn` 的解析值决定提示:
 *   · `undefined`(块体箭头 `()=>{…}` 的返回值,即现存全部消费者)→ **成功** → 报「已撤销」;
 *   · 显式 `false` / `0`(如「还原 0 条」「撤销已过期」)→ **失败** → **不报成功**,且此处**静默** ——
 *     **失败因由由 `restoreFn` 自报**(它持有 `tt` 与上下文,能说清是过期还是出错);
 *   · 同步抛错 / Promise reject → 报 `errText(e)`,**不报成功**。
 *
 *  ★为何不在此处写「撤销失败」文案(**两条真理由**,评审第59轮订正了我原先的假理由):
 *   ① **分层**:`toast.js` 是 i18n **之下**的基础原语(`shell-state` 依赖 toast,`i18n` 依赖 `shell-state`),
 *      向上依赖 `i18n` 是**层级倒置**。
 *   ② **职责**:`toast.js` 结构上**不可能知道失败的因由**(过期?后端报错?还原 0 条?)。它若打一句通用的
 *      「撤销失败」,信息量反而低于 `restoreFn` 能给的「该撤销已过期」/「没有可撤销的内容」/`errText`。
 *      **把「报因由」放在唯一知道因由的人手上。**
 *   ⚠ 原注释曾写「引入 `tt` 会成环 ⇒ 违 SCC 不变式」—— **那是假的,已删**:`i18n ⇄ shell-state` 环
 *   **今天就存在**且已被裁定安全(见 i18n.js:4「两侧读全在函数体、零 eager 互读,ESM 语义安全,接受」);
 *   SCC 不变式禁的是**环内顶层急读非函数声明绑定**,而 `tt` 是 hoisted `export function`、只在函数体内调。
 *   ⇒ 此路**结构上通**,只是分层与职责上不该走。**勿以假前提锁死 [建议]2 的 #6 修法。**
 *
 *  ★存量 #6 债(先存,非本刀引入 · 评审第59轮 [建议]2 记债):本模块的 `撤销`(按钮 label)与 `已撤销`
 *  两串是 **CN-only、无 i18n**,是平台基元里的红线 #6 违例。本刀以「不新增 CN-only 串」避开、未扩大。
 *  **出口(保分层、零环、不需 `tt`)**:把两个 label 参数化 —— `toastUndo(msg, restoreFn, {undoLabel, doneLabel})`
 *  带默认值,或由**持有 i18n 的上层**一次性注入 `setToastLabels(...)`。按第52轮 `jobseek.rs` 先例:显式记债 + 留出口。
 *
 *  ⚠ `lastUndo=null` **必须在 await 之前同步执行**,否则 restoreFn 挂起期间 Mod+Z 可二次触发同一撤销。
 *  ⚠ `done` 闸(评审第59轮 [建议]1):`close()` 只置 `opacity:0` 并在 **300ms 后**才 `remove()` ——
 *    透明元素**照样可点**。无闸时 300ms 内双击「撤销」会让 `restoreFn` **跑两次**(闭包消费者 `splice(i,0,snap)`
 *    重复插入;memory 侧则出现「已撤销」与「没有可撤销的内容」并存)。姊妹原语 `guardrail.showUndo:34-36`
 *    早有此闸,此处补齐。 */
export function toastUndo(msg, restoreFn){
  const t=el(`<div class="toast" style="display:flex;align-items:center;gap:14px;">${msg}<button class="toast-undo">撤销</button></div>`);
  $('#toasts').appendChild(t);
  let gone=false; const close=()=>{if(gone)return;gone=true;t.style.transition='opacity 300ms';t.style.opacity='0';setTimeout(()=>t.remove(),300);};
  let done=false;                         /* ★重入闸(同 guardrail.showUndo:34-36):opacity:0 的 toast 仍可点,300ms 内双击会跑两次 restoreFn */
  const doUndo=()=>{
    if(done)return; done=true;            /* 同步置位,先于 close/restoreFn/任何 await */
    close();
    if(lastUndo===doUndo)lastUndo=null;   /* ★同步清除,先于任何 await:防 restoreFn 挂起期间 Mod+Z 二次触发 */
    let r; try{ r=restoreFn(); }catch(e){ toast(errText(e)); return; }   /* 同步抛错 → 报错、不报成功 */
    Promise.resolve(r).then(
      (v)=>{ if(succeeded(v)) toast('已撤销'); },                         /* 失败时静默:因由由 restoreFn 自报 */
      (e)=>{ toast(errText(e)); }                                        /* 异步 reject → 报错、不报成功 */
    );
  };
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
