// @ts-nocheck —— 批9c:jobseek 岗位级快捷动作 + 市场价值模态 + 微渲染件从 index.html inline 归位(逻辑零改动)。读 tt/IC/$/openModal/closeModal/go/aiRun/YOU_VALUE/JOBS/resumeGenerate/renderResumes/ivState/renderInterview 仍运行时全局(账本清空再 import)。
/** jobseek · 岗位级快捷动作(原 index.html inline 收尾 · 批9c):
 *  dotsHTML(技能点渲染件,analysis/skills 页消费)· openMarketValue(市场价值报告模态,nav 顶栏动作/cards/copilot/analysis/skills 消费)·
 *  aiResumeForJob + goInterview(岗位→简历/面试快捷跳转,jobs/match/cards/copilot 消费)。
 *  ★ownership:openMarketValue 读 YOU_VALUE/aiRun(intake-action.js)= jobseek 业务,归 apps(先前"9b 含 openMarketValue"框定经 grep 订正);
 *    analysis:75/skills:68 经内联 onclick="openMarketValue()" 消费 → **须保 window 桥**。 */

/* ---------- MARKET VALUE modal ---------- */
import { JOBS } from '../data.js';
import { YOU_VALUE, aiRun } from './intake-action.js';
import { ivState, renderInterview } from './interview.js';
import { renderResumes, resumeGenerate } from './resumes.js';
import { $ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { closeModal, openModal } from '../../../platform/shell/modal.js';
import { go } from '../../../platform/shell/nav.js';
export function openMarketValue(){
  const html=`<div class="modal-head"><div><p class="eyebrow">— MARKET VALUE</p><h2 style="margin-top:5px;">${tt('你的市场价值报告','Your market-value report')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body"><div id="mvHost"></div></div>`;
  const m=openModal(html);
  aiRun($('#mvHost',m),[tt('聚合你的能力档案与项目证据','Aggregating your assets & evidence'),tt('对照 12 份目标 JD 与市场薪资带','Comparing against 12 JDs & salary bands'),tt('估算你的市场定位','Estimating your market position')],
    ()=>`<div style="text-align:center;padding:8px 0 18px;border-bottom:0.5px solid var(--border);">
      <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.2em;color:var(--ink-3);margin:0 0 8px;">${tt('综合估算 · 年包','Estimate · annual')}</p>
      <div class="score-big" style="justify-content:center;"><span class="v accent">${YOU_VALUE}</span><span class="u">${tt('万 / 年','w / yr')}</span></div>
      <p style="font-size:12.5px;color:var(--ink-3);margin:12px 0 0;">${tt('落在「后端 · 高级」带的中上沿,补齐 1-2 项复利能力即可冲「专家」带。','Upper-mid of the Senior Backend band; fill 1-2 compounding skills to reach the Expert band.')}</p></div>
    <div class="msec" style="border-bottom:none;"><p class="seclabel">— LEVERAGE</p><h3 class="sectitle" style="font-size:15px;margin-bottom:10px;">${tt('最高杠杆动作','Highest-leverage moves')}<span class="dot">.</span></h3>
      ${[[tt('补齐 分布式系统 证据','Add distributed-systems evidence'),tt('已有经历,整理即用,提升匹配最快','Already have it — organize and use; fastest match gain')],[tt('完成 Rust 项目','Finish the Rust project'),tt('稀缺 + 需求半年涨 42%,差异化最大','Scarce + demand up 42% in 6mo; biggest differentiator')],[tt('强化 系统设计 表达','Sharpen system-design delivery'),tt('高级岗硬门槛,直接影响面试通过率','Senior-role gate; directly affects pass rate')]].map((x,i)=>`<div style="display:flex;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border);"><span class="idx">${String(i+1).padStart(2,'0')}</span><div><div style="font-size:14px;color:var(--ink);font-weight:500;">${x[0]}</div><div style="font-size:12.5px;color:var(--ink-3);margin-top:3px;">${x[1]}</div></div></div>`).join('')}
      <p style="font-size:12px;color:var(--ink-3);margin:14px 0 0;line-height:1.7;">${tt('这份报告在职时也值得每季度看一次 —— 把求职工具变成长期的职业资产管家。','Worth reviewing quarterly even while employed — turning a job tool into a long-term career-asset manager.')}</p></div>`,
    {label:tt('估算市场价值中…','Estimating market value…')});
}

/* skill demand matrix for analysis (top skills × first companies) */
export function dotsHTML(lvl, cls){let s='<span class="dots '+(cls||'')+'">';for(let i=1;i<=5;i++)s+='<span class="'+(i<=lvl?'on':'')+'"></span>';return s+'</span>';}

/* ---------- per-job AI: resume rewrite ---------- */
export function aiResumeForJob(id){
  const j=JOBS.find(x=>x.id===id);
  resumeGenerate(id, renderResumes);
}
export function goInterview(id){ closeModal(); ivState.jobId=id; ivState.tab='bank'; ivState.q=null; ivState.search=''; go('interview'); renderInterview(); }

/* 过渡 window 桥:openMarketValue(nav.js:59 顶栏动作/cards:274/copilot-actions:18 + ★analysis:75/skills:68 内联 onclick 须 window)、
   dotsHTML(analysis:18/skills:15,102 裸全局)、aiResumeForJob(jobs:114/copilot:15/match:54/cards:198 typeof 守卫)、goInterview(jobs:116/copilot:13/match:55/cards:245)——账本清空改 import 后摘(内联 onclick 两处届时一并改绑定)。 */
/* ★批10d 账本终态:本行为白名单桥——(d) window-解析强制(内联 onclick·cBtn 串·CACT window[name]·aiErrHTML 的 go)或 §1 平台裸读(契约化批11);其余桥已全摘、消费者已 import。 */
window.openMarketValue=openMarketValue; 