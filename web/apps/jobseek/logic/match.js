// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 智能匹配(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../monolith-globals.d.ts。 */
/* ---------- SMART MATCH (旗舰) ---------- */
import { skillByName } from '../data-helpers.js';
import { JOBS } from '../data.js';
import { RESUME, aiRun, genPlanFromGap, genRewrites, planFor, topGapsOf } from './intake-action.js';
import { aiResumeForJob, goInterview } from './job-actions.js';
import { renderActions } from '../pages/actions.js';
import { renderOverview } from '../pages/overview.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { openResumeModal } from './resume-modals.js';
import { openNewJob } from './intake-job.js';
import { frontis, go, signFoot } from '../../../platform/shell/nav.js';
import { toast } from '../../../platform/shell/toast.js';
export let matchState={jobId:JOBS[0].id, done:false};
export function renderMatch(){
  const resumeBar=`<div class="sec" style="padding-bottom:18px;"><div class="ai-bar" style="border:0.5px solid var(--border);">
    <span class="dot"></span><span class="lbl">已基于简历 · <b>${cEsc(RESUME.filename)}</b> · 自动识别 ${RESUME.derivedSkills} 项能力 / ${RESUME.derivedEvidence} 段证据</span>
    <button class="btn-text" style="margin-left:auto;" data-orm>更换简历 →</button></div></div>`;
  const jobPills=JOBS.map(x=>`<button class="pill ${x.id===matchState.jobId?'on':''}" data-mj="${x.id}">${cEsc(x.co)} · ${cEsc(x.role.split('·')[0].trim())}</button>`).join('');
  const input=`<div class="sec">
    <p class="seclabel">— STEP · SELECT JOB</p><h2 class="sectitle">想匹配哪个岗位?<span class="dot">.</span></h2>
    <p style="font-size:13px;color:var(--ink-3);margin:6px 0 0;max-width:640px;line-height:1.7;">从目标岗位里挑一个,或 <button class="btn-text" id="mNewJob">粘贴一段新 JD</button>。AI 会在几秒内给出匹配度、能力缺口、针对性简历改写和训练计划 —— 这是产品的核心一屏。</p>
    <div class="pillrow" style="margin-top:16px;">${jobPills}</div>
    <button class="btn btn-accent" style="margin-top:20px;" id="mRun">开始智能匹配 →</button>
  </div>`;
  $('#page-match').innerHTML=frontis('SMART MATCH',tt('智能匹配','Smart match'))+resumeBar+input+`<div class="sec" style="border-bottom:none;" id="matchResultSec"><div id="matchResult"></div></div>`+signFoot();
  $$('#page-match [data-mj]').forEach(b=>b.onclick=()=>{matchState.jobId=+b.dataset.mj;matchState.done=false;renderMatch();});
  $$('#page-match [data-orm]').forEach(b=>b.onclick=()=>openResumeModal());  // ★批11A:原内联 onclick="openResumeModal()" 改程序绑定
  { const nj=$('#mNewJob'); if(nj)nj.onclick=()=>openNewJob(); const mr=$('#mRun'); if(mr)mr.onclick=()=>runMatch(); }  // ★批11A:原内联 openNewJob()/runMatch()
  if(matchState.done){const j=JOBS.find(x=>x.id===matchState.jobId);$('#matchResult').innerHTML=`<div class="ai-panel"><div class="ai-bar"><span class="dot"></span><span class="lbl"><b>AI</b> 匹配结果</span></div><div style="padding:22px 22px 24px;">${matchReadout(j)}</div></div>`;bindReadout(j);}
}
export function runMatch(){
  const j=JOBS.find(x=>x.id===matchState.jobId);
  $('#matchResult').innerHTML=`<div class="ai-panel"><div class="ai-bar"><span class="dot"></span><span class="lbl"><b>AI</b> 正在分析</span></div><div id="aihost"></div></div>`;
  aiRun($('#matchResult').querySelector('#aihost'),
    ['解析 JD,抽取硬性 + 软性要求 12 项','比对你的简历与能力档案','定位能力缺口与既有优势','生成针对性简历改写与训练计划'],
    ()=>`<div style="padding:22px 22px 24px;">${matchReadout(j)}</div>`,
    {label:'分析「'+cEsc(j.co)+' · '+cEsc(j.role.split('·')[0].trim())+'」中…', after:()=>{matchState.done=true;bindReadout(j);}});
}
function matchReadout(j){
  const pct=Math.round(j.match*10);
  const gaps=topGapsOf(j); const top=gaps[0]||j.plus[0]||'系统设计';
  const strengths=j.need.filter(n=>{const s=skillByName(n);return s&&s.lvl>=3;});
  const rw=genRewrites(j); const p=planFor(top);
  return `
  <div style="display:flex;gap:40px;align-items:flex-end;flex-wrap:wrap;">
    <div><p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.2em;color:var(--ink-3);margin:0 0 6px;">${tt('综合匹配度','Overall match')}</p>
      <div class="score-big"><span class="v accent">${pct}</span><span class="u">/ 100</span></div></div>
    <div style="flex:1;min-width:200px;"><div class="bar" style="height:6px;"><i style="width:${pct}%;"></i></div>
      <p style="font-size:12.5px;color:var(--ink-3);margin:10px 0 0;line-height:1.6;">${tt('你已具备 <b style="color:var(--status-done);">'+strengths.length+'</b> 项硬性要求,还可补充 <b style="color:var(--ink-2);">'+gaps.length+'</b> 项 —— 不是“不够格”,是“差临门一脚”。','You already meet <b style="color:var(--status-done);">'+strengths.length+'</b> hard requirements and can add <b style="color:var(--ink-2);">'+gaps.length+'</b> more — not “unqualified”, just “one step away”.')}</p></div>
  </div>
  <div class="msec" style="border-bottom:0.5px solid var(--border);margin-top:8px;"><p class="seclabel">— GAPS</p><h3 class="sectitle" style="font-size:15px;margin-bottom:10px;">${tt('可补充的能力','Gaps to fill')}<span class="dot">.</span></h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${(gaps.length?gaps:[tt('暂无明显缺口','No clear gaps')]).map(g=>`<span class="chip gap">${cEsc(g)}</span>`).join('')}</div></div>
  <div class="msec" style="border-bottom:0.5px solid var(--border);"><p class="seclabel">— RESUME REWRITE</p><h3 class="sectitle" style="font-size:15px;margin-bottom:4px;">${tt('针对这个岗位,简历这样改','Rewrite your resume for this job')}<span class="dot">.</span></h3>
    <p style="font-size:12px;color:var(--ink-3);margin:0 0 12px;">${tt('对齐该 JD 的高频词,用量化结果替换职责描述:','Align to the JD\'s keywords; replace duties with quantified results:')}</p>
    <div class="rw-diff">${rw.map(r=>`<div><div class="h">${tt('原文','Before')}</div><div class="rw-old">${r.old}</div></div><div><div class="h" style="color:var(--accent);">${tt('AI 改写','AI rewrite')}</div><div class="rw-new">${cEsc(r.neo)}</div></div>`).join('')}</div>
    <button class="btn" style="margin-top:12px;" data-full="${j.id}">${tt('生成完整定制简历','Generate full tailored resume')} →</button></div>
  <div class="msec" style="border-bottom:none;"><p class="seclabel">— PLAN</p><h3 class="sectitle" style="font-size:15px;margin-bottom:4px;">${tt('下一步该练什么','What to train next')}<span class="dot">.</span></h3>
    <p style="font-size:13px;color:var(--ink-2);margin:0 0 4px;">${tt('优先补齐 <b>'+cEsc(top)+'</b> · 约 '+p.weeks+' 周 · '+p.ms.length+' 个里程碑','Fill <b>'+cEsc(top)+'</b> first · ~'+p.weeks+' weeks · '+p.ms.length+' milestones')}</p>
    <p style="font-size:12px;color:var(--ink-3);margin:0 0 14px;">${tt('推荐资源:','Resources:')}${p.res.join(' · ')}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn btn-accent" data-plan="${cEsc(top)}" data-pj="${cEsc(j.co)} · ${cEsc(j.role.split('·')[0].trim())}">${tt('一键加入行动清单','Add to action list')}</button><button class="btn" data-iv="${j.id}">${tt('去模拟面试','Go to mock interview')} →</button></div></div>`;
}
function bindReadout(j){
  const host=$('#matchResult');
  const fb=host.querySelector(`[data-plan]`); if(fb)fb.onclick=()=>{const id=genPlanFromGap(fb.dataset.plan, fb.dataset.pj);renderActions();renderOverview();toast('已生成训练计划并加入行动清单');go('actions');};
  const full=host.querySelector(`[data-full]`); if(full)full.onclick=()=>aiResumeForJob(+full.dataset.full);
  const iv=host.querySelector(`[data-iv]`); if(iv)iv.onclick=()=>goInterview(+iv.dataset.iv);
}

/* 过渡 window 桥:renderMatch 经 manifest/cards/copilot-actions 消费;runMatch 经 copilot-actions setTimeout + 内联 onclick;matchState mutated dual-publish(cards/copilot-actions 跨文件 .k= 同引用安全)。matchReadout/bindReadout 私有。
   ★matchState={jobId:JOBS[0].id} module-eval 急读 **import 绑定**(第43轮:载序由 import 图自定序、data.js 在 SCC 之外先求值;批11B 后已无 window.JOBS 桥);★红线逐字保留(函数体):RESUME.filename/derivedSkills 元数据、无联系方式。 */
/* ★批10d 账本终态:本行为白名单桥——(d) window-解析强制(内联 onclick·cBtn 串·CACT window[name]·aiErrHTML 的 go)或 §1 平台裸读(契约化批11);其余桥已全摘、消费者已 import。 */
