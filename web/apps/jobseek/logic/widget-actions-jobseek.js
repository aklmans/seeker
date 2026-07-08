// @ts-nocheck —— 与 settings-jobseek.js 同 app 层约定;逻辑逐字迁自 platform/shell/widget-actions.js 的 delete-job 分支(零改动)。app 层 @ts-check 属 3.y 剩余工作。
/** jobseek · widget 破坏性动作规格(经 manifest.widgetActions 契约 · 批11B · §1 契约化 3/4)。
 *
 *  原 platform/shell/widget-actions.js 的 `delete-job` 分支**逐字迁入** —— 该分支硬编码 jobseek 的
 *  JOBS/renderJobs/renderOverview,是 §1「平台不得裸读 apps 符号」的最后 3 处之一。
 *
 *  ★红线(§4-3/§4-4)—— 本模块只**描述**破坏性操作、**不执行**:
 *   - 返回 confirmDestructive 规格;平台(widget-actions.js)拿到后**自己**调 platform/guardrail:预览 + 确认 + 可撤销。
 *     应用无法绕过护栏(契约收数据、不收「已执行」)。
 *   - **不声明 `source`**:来源由平台按端口归属的 widgetId 注入(§4-4 零信任:绝不信 iframe 自报)。
 *   - `action`/`payload` 来自不可信 iframe → 仅当数据:`payload.id` 只经 `String()` 参与 db 查删与 JOBS 比对,绝不拼进 HTML/JS。
 *   - 预览文案 `_label` 显示可读的「公司 · 岗位」(威胁 T5 的「预览」腿 #4 §⑥);guardrail 一律 textContent 渲染 → 无注入面。
 *   - `jobsPersistOn()` 为假(如网页态无 rt)→ 返回 undefined = 不认领,平台落**通用破坏性分支**(仍过护栏)——与原分支条件逐字等价。
 */
import { JOBS } from '../data.js';
import { renderJobs } from '../pages/jobs.js';
import { renderOverview } from '../pages/overview.js';
import { jobsPersistOn } from '../../../platform/shell/data-store.js';
import { tt } from '../../../platform/shell/i18n.js';

/* 认领条件 = 原 `if(action==='delete-job' && payload.id!=null && jobsPersistOn())` 的德摩根取反(逐字等价);
   不认领 → undefined → 平台通用破坏性分支(confirmDestructive 仍执行)。 */
export function jobseekWidgetAction(action, payload){
  if(action!=='delete-job' || payload.id==null || !jobsPersistOn()) return undefined;
  let snap=null;
  /* 预览显示可读目标(公司 · 岗位)而非裸 id —— 威胁 T5 的「预览」腿(#4 §⑥);未命中回退 #id。 */
  const _job=JOBS.find(x=>String(x.id)===String(payload.id));
  const _label=_job?(_job.co+(_job.role?(' · '+String(_job.role).split('·')[0].trim()):'')):('#'+payload.id);
  return {
    title:tt('删除岗位?','Delete job?'), detail:tt('将删除岗位:','Will delete job: ')+_label,
    confirmLabel:tt('删除','Delete'),
    onConfirm:async()=>{ snap=await window.SeekerRT.db.remove('jobs',String(payload.id)); JOBS.length=0; JOBS.push(...await window.SeekerRT.db.list('jobs')); try{renderJobs();renderOverview();}catch(_e){} },
    onUndo:async()=>{ if(snap) await window.SeekerRT.db.upsert('jobs',snap); JOBS.length=0; JOBS.push(...await window.SeekerRT.db.list('jobs')); try{renderJobs();renderOverview();}catch(_e){} },
    undoText:tt('已删除岗位','Job deleted'),
  };
}
