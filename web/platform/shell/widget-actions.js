// @ts-nocheck —— 批9b:widget-action 回流处理从 index.html inline 抽出为 module。平台依赖已 import;跨层契约全局 SeekerShell/SeekerGuardrail/SeekerRT/SeekerWidgets 保持 window。
/** 平台 · widget-action 回流(#2 W3 · 原 index.html inline 抽出 · 批9b)。
 *  红线(§4-3/§4-4 逐字保留):widgetId 由平台按端口归属传入(不信任 iframe 自报);payload 仅当数据;
 *  破坏性动作一律 platform/guardrail 预览+确认+可撤销;安全动作 toast 前 action `<` 转义(来自不可信 iframe)。
 *  wgtAction 无外部消费者(grep 证仅本文件 rt-ready 监听器引用)→ module-private、不 export 不上桥(同 hydrateProfile 先例);
 *  监听器 module-eval 注册、仍先于末位 dispatch(批A dispatch 拆末位)。
 *  ★§1 归属债已清(批11B · widgetActions):原 delete-job 分支硬编码 jobseek 符号(JOBS/renderJobs/renderOverview/jobsPersistOn),
 *  现整段回迁 apps/jobseek/logic/widget-actions-jobseek.js,平台只留「通用 destructive 闸 + guardrail 调用」并经 SeekerShell.widgetActions 取规格。
 *  ★契约的红线不变式:契约只收**规格数据**、不收「已执行」;`source` 由平台注入且置于 spread 之后 ⇒ 应用不能伪造来源、不能绕过护栏。 */

/* ===== #2 W3:widget-action 回流处理(domain)。破坏性一律过 platform/guardrail。 =====
   widgetId 由平台按端口归属传入(不信任 iframe 自报);payload 仅当数据。 */
import { tt } from './i18n.js';
import { toast } from './toast.js';
async function wgtAction(widgetId, action, payload){
  payload = payload || {};
  const destructive = /^(delete|clear|remove|reset|wipe)/i.test(String(action));
  if(!destructive){
    /* 安全动作:当「用户意图」致意(接 Agent 为后续 domain 决策)。 */
    try{ if(typeof toast==='function') toast((tt('组件请求:','Widget: '))+String(action).replace(/</g,'&lt;')); }catch(_e){} /* action 来自不可信 iframe(§4 Untrusted);toast 经 el(innerHTML)→ 进 DOM 前 <-转义 */
    return;
  }
  const G=window.SeekerGuardrail; if(!G) return;   /* ★fail-closed:无护栏 → 不执行,也不问应用(契约在闸之后才咨询) */
  /* §1 契约化(批11B · widgetActions):per-app 破坏性动作规格由应用声明,平台不识任何 app 符号。
     ★红线:平台只拿「规格」、不拿「执行」—— 一律由此处 confirmDestructive 驱动(预览+确认+可撤销);
     `source` 由平台按端口归属的 widgetId 生成并**置于 spread 之后** ⇒ 应用即便声明 source 也被覆盖,无法伪造来源。 */
  const spec=window.SeekerShell.widgetActions(action, payload);
  if(spec){
    await G.confirmDestructive({ ...spec, source:'widget '+widgetId });
    return;
  }
  /* 通用破坏性(含演示):一律先预览+确认,确认后才执行 + 可撤销。 */
  await G.confirmDestructive({
    title:tt('确认操作','Confirm action'), detail:(tt('组件请求执行:','Widget requests: '))+action,
    source:'widget '+widgetId, confirmLabel:tt('执行','Run'),
    onConfirm:()=>{ window.__wgtExecuted={widgetId:widgetId, action:action}; },
    onUndo:()=>{ window.__wgtExecuted=null; },
    undoText:tt('已执行','Done')+' · '+action,
  });
}
window.addEventListener('seeker-rt-ready', ()=>{ if(window.SeekerWidgets) window.SeekerWidgets.onAction=wgtAction; });
