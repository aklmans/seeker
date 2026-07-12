// @ts-nocheck —— 批9c:jobseek 岗位级快捷动作 + 市场价值模态 + 微渲染件从 index.html inline 归位(逻辑零改动)。读 tt/IC/$/openModal/closeModal/go/aiRun/YOU_VALUE/JOBS/resumeGenerate/renderResumes/ivState/renderInterview 仍运行时全局(账本清空再 import)。
/** jobseek · 岗位级快捷动作(原 index.html inline 收尾 · 批9c):
 *  dotsHTML(技能点渲染件,analysis/skills 页消费)· openMarketValue(市场价值报告模态,nav 顶栏动作/cards/copilot/analysis/skills 消费)·
 *  aiResumeForJob + goInterview(岗位→简历/面试快捷跳转,jobs/match/cards/copilot 消费)。
 *  ★ownership:openMarketValue 读 marketValue/topLeverageGaps/aiRun(intake-action.js)= jobseek 业务,归 apps(先前"9b 含 openMarketValue"框定经 grep 订正);
 *    批11A 已把 analysis/skills 的原内联 onclick 改 [data-omv] import 绑定、批11B nav 顶栏动作改 SeekerShell.pageActions 契约 → openMarketValue 桥已摘、消费者全 import。 */

/* ---------- MARKET VALUE modal ---------- */
import { JOBS } from '../data.js';
import { marketValue, topLeverageGaps, aiRun } from './intake-action.js';
import { ivState, renderInterview } from './interview.js';
import { renderResumes, resumeGenerate } from './resumes.js';
import { $ } from '../../../platform/shell/dom.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js'; // 真 gaps 可能 JD 派生 → 进 DOM 转义(§4-4)
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { closeModal, openModal } from '../../../platform/shell/modal.js';
import { go } from '../../../platform/shell/nav.js';
export function openMarketValue(){
  const html=`<div class="modal-head"><div><p class="eyebrow">— MARKET VALUE</p><h2 style="margin-top:5px;">${tt('你的市场价值报告','Your market-value report')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body"><div id="mvHost"></div></div>`;
  const m=openModal(html);
  aiRun($('#mvHost',m),[tt('聚合你的能力档案与项目证据','Aggregating your assets & evidence'),tt('对照 12 份目标 JD 与市场薪资带','Comparing against 12 JDs & salary bands'),tt('估算你的市场定位','Estimating your market position')],
    ()=>{ const mv=marketValue(); const gaps=topLeverageGaps(); return `<div style="text-align:center;padding:8px 0 18px;border-bottom:0.5px solid var(--border);">
      <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.2em;color:var(--ink-3);margin:0 0 8px;">${tt('参考区间 · 年包(示意)','Reference range · annual (indicative)')}</p>
      <div class="score-big" style="justify-content:center;"><span class="v accent">${mv.low}–${mv.high}</span><span class="u">${tt('万 / 年','w / yr')}</span></div>
      <p style="font-size:12.5px;color:var(--ink-3);margin:12px auto 0;max-width:460px;line-height:1.7;">${tt('由你 <b>'+mv.jobs+'</b> 个目标岗位的真实薪资、按你对各岗位的匹配分加权得出 —— <b>示意级、仅供参考</b>,勿作决策依据。','Weighted from the real pay of your <b>'+mv.jobs+'</b> target roles by how well you match each — <b>indicative only</b>, not a decision basis.')}</p></div>
    <div class="msec" style="border-bottom:none;"><p class="seclabel">— LEVERAGE</p><h3 class="sectitle" style="font-size:15px;margin-bottom:10px;">${tt('最该补的能力','Gaps worth closing')}<span class="dot">.</span></h3>
      ${(gaps.length?gaps:[tt('暂无明显缺口','No clear gaps')]).map((g,i)=>`<div style="display:flex;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border);"><span class="idx">${String(i+1).padStart(2,'0')}</span><div><div style="font-size:14px;color:var(--ink);font-weight:500;">${tt('补齐 ','Close ')}${cEsc(g)}</div><div style="font-size:12.5px;color:var(--ink-3);margin-top:3px;">${tt('在多个目标岗位里是缺口 —— 补上提升匹配与定价最快。','A gap across several target roles — closing it lifts match & value fastest.')}</div></div></div>`).join('')}
      <p style="font-size:12px;color:var(--ink-3);margin:14px 0 0;line-height:1.7;">${tt('这份报告在职时也值得每季度看一次 —— 把求职工具变成长期的职业资产管家。','Worth reviewing quarterly even while employed — turning a job tool into a long-term career-asset manager.')}</p></div>`; },
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

/* ★批11B(pageActions 契约):openMarketValue 桥已摘 —— nav 顶栏动作改经 SeekerShell.pageActions 契约取(analysis/skills 原内联 onclick 已在 11A 改 [data-omv] import 绑定)。
   全部消费者已 import(cards/copilot-actions/skills/analysis);dotsHTML/aiResumeForJob/goInterview 亦无桥、消费者 import。 */ 