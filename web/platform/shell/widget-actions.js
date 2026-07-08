// @ts-nocheck —— 批9b:widget-action 回流处理从 index.html inline 抽出为 module(逻辑零改动)。读 toast/tt/JOBS/jobsPersistOn/renderJobs/renderOverview/SeekerGuardrail/SeekerRT/SeekerWidgets 仍运行时全局(待批10 转 import 再 @ts-check)。
/** 平台 · widget-action 回流(#2 W3 · 原 index.html inline 抽出 · 批9b)。
 *  红线(§4-3/§4-4 逐字保留):widgetId 由平台按端口归属传入(不信任 iframe 自报);payload 仅当数据;
 *  破坏性动作一律 platform/guardrail 预览+确认+可撤销;安全动作 toast 前 action `<` 转义(来自不可信 iframe)。
 *  wgtAction 无外部消费者(grep 证仅本文件 rt-ready 监听器引用)→ module-private、不 export 不上桥(同 hydrateProfile 先例);
 *  监听器 module-eval 注册、仍先于末位 dispatch(批A dispatch 拆末位)。
 *  §1 归属债(pre-existing,随 CACT_ALLOWED 契约化账一并清):delete-job 分支硬编码 jobseek 符号(JOBS/renderJobs/renderOverview/jobsPersistOn)——未来经 SeekerShell 契约分发 per-app widget action。 */

/* ===== #2 W3:widget-action 回流处理(domain)。破坏性一律过 platform/guardrail。 =====
   widgetId 由平台按端口归属传入(不信任 iframe 自报);payload 仅当数据。 */
async function wgtAction(widgetId, action, payload){
  payload = payload || {};
  const destructive = /^(delete|clear|remove|reset|wipe)/i.test(String(action));
  if(!destructive){
    /* 安全动作:当「用户意图」致意(接 Agent 为后续 domain 决策)。 */
    try{ if(typeof toast==='function') toast((tt('组件请求:','Widget: '))+String(action).replace(/</g,'&lt;')); }catch(_e){} /* action 来自不可信 iframe(§4 Untrusted);toast 经 el(innerHTML)→ 进 DOM 前 <-转义 */
    return;
  }
  const G=window.SeekerGuardrail; if(!G) return;
  if(action==='delete-job' && payload.id!=null && jobsPersistOn()){
    let snap=null;
    /* 预览显示可读目标(公司 · 岗位)而非裸 id —— 威胁 T5 的「预览」腿(#4 §⑥);未命中回退 #id。 */
    const _job=JOBS.find(x=>String(x.id)===String(payload.id));
    const _label=_job?(_job.co+(_job.role?(' · '+String(_job.role).split('·')[0].trim()):'')):('#'+payload.id);
    await G.confirmDestructive({
      title:tt('删除岗位?','Delete job?'), detail:tt('将删除岗位:','Will delete job: ')+_label,
      source:'widget '+widgetId, confirmLabel:tt('删除','Delete'),
      onConfirm:async()=>{ snap=await window.SeekerRT.db.remove('jobs',String(payload.id)); JOBS.length=0; JOBS.push(...await window.SeekerRT.db.list('jobs')); try{renderJobs();renderOverview();}catch(_e){} },
      onUndo:async()=>{ if(snap) await window.SeekerRT.db.upsert('jobs',snap); JOBS.length=0; JOBS.push(...await window.SeekerRT.db.list('jobs')); try{renderJobs();renderOverview();}catch(_e){} },
      undoText:tt('已删除岗位','Job deleted'),
    });
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
