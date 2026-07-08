// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 总览页(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../../monolith-globals.d.ts。 */
/* ---------- OVERVIEW ---------- */
import { calmDigest, nextStep } from '../cards.js';
import { distinctNeedSkills, pipelineReal, topGapsReal } from '../data-helpers.js';
import { ACTIONS, JOBS } from '../data.js';
import { renderFirstRun } from '../logic/demo-seed.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { onboarded } from '../../../platform/shell/data-store.js';
import { $ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { frontis, signFoot, syncNavCounts } from '../../../platform/shell/nav.js';
import { setState } from '../../../platform/shell/shell-state.js';
export function renderOverview(){
  syncNavCounts();
  if(!onboarded()){ renderFirstRun(); return; }   // 首启未决定 → 价值主张落地页 + 岔路(开始我的 / 逛示例)
  const n=JOBS.length||1;
  const avgI=(JOBS.reduce((a,j)=>a+(j.interest||0),0)/n).toFixed(1);
  const avgM=(JOBS.reduce((a,j)=>a+(j.match||0),0)/n).toFixed(1);
  const PIPE=pipelineReal();
  const maxN=Math.max(1,...PIPE.map(p=>p.n));
  const stats=`<div class="sec" style="border-bottom:none;padding-bottom:0;">
    <div class="stat-grid">
      <div class="stat"><div class="num">${JOBS.length}<small> / ${setState.goal||20}</small></div><div class="lab">JOBS COLLECTED</div><div class="sub">${tt('已收集岗位','Jobs collected')}</div></div>
      <div class="stat"><div class="num">${avgI}<small> / 10</small></div><div class="lab">AVG INTEREST</div><div class="sub">${tt('平均兴趣分','Avg interest')}</div></div>
      <div class="stat"><div class="num">${avgM}<small> / 10</small></div><div class="lab">AVG MATCH</div><div class="sub">${tt('平均匹配分','Avg match')}</div></div>
      <div class="stat"><div class="num">${distinctNeedSkills()}</div><div class="lab">HIGH-FREQ SKILLS</div><div class="sub">${tt('高频技能','High-freq skills')}</div></div>
    </div></div>`;
  const gaps=topGapsReal(3).map(g=>`
    <div class="gap-item">
      <div class="gap-head"><span class="gi">${g.rank}</span><span class="gn">${cEsc(g.name)}</span></div>
      <div class="gap-meta">${tt(g.jobs+' 个岗位需要 · 当前 '+g.have, g.jobs+' jobs need it · now '+g.have)}</div>
      <div class="gap-bar"><div class="bar"><i style="width:${g.pct}%"></i></div><span class="pl">${tt('优先级 '+g.pri,'Priority '+g.pri)}</span></div>
    </div>`).join('');
  const recent=ACTIONS.filter(a=>a.state!=='done').slice(0,5).map(a=>{
    const cls=a.state==='doing'?'half':'';
    return `<div class="mini-todo"><span class="cbox ${cls}">${IC.check}</span><span>${cEsc(a.title)}</span></div>`;
  }).join('');
  const two=`<div class="sec"><div class="cols2">
    <div>
      <p class="seclabel">— TOP GAPS</p><h2 class="sectitle">${tt('最高优先级缺口','Top priority gaps')}<span class="dot">.</span></h2>
      <div style="margin-top:16px;">${gaps}</div>
      <button class="btn-text" style="margin-top:16px;" data-go="analysis">${tt('查看完整缺口矩阵','View full gap matrix')} →</button>
    </div>
    <div>
      <p class="seclabel">— RECENT ACTIONS</p><h2 class="sectitle">${tt('近期行动清单','Recent actions')}<span class="dot">.</span></h2>
      <div style="margin-top:10px;">${recent}</div>
      <button class="btn-text" style="margin-top:16px;" data-go="actions">${tt('查看全部','View all')} →</button>
    </div>
  </div></div>`;
  const pipe=`<div class="sec" style="border-bottom:none;">
    <p class="seclabel">— PIPELINE</p><h2 class="sectitle">${tt('岗位流转','Pipeline')}<span class="dot">.</span></h2>
    <div style="margin-top:18px;max-width:560px;">
    ${PIPE.map(p=>`<div class="barrow"><span class="blab">${p.label}</span><div class="btrack"><i style="width:${maxN?(p.n/maxN*100):0}%;background:${p.color};"></i></div><span class="bval">${p.n}</span></div>`).join('')}
    </div>
    <p style="font-size:12px;color:var(--ink-3);margin-top:14px;">${tt('已记录 '+JOBS.length+' 个岗位 · 持续推进中',JOBS.length+' jobs logged · steady progress')}</p>
  </div>`;
  const ns=nextStep(); // 阶段自适应:有行动→最该做的;无行动且无岗位→录岗位;有岗位无行动→做匹配
  const hero=`<div class="sec" style="border-bottom:none;padding-bottom:0;"><div class="next-hero"><div class="nh-in">
    <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.2em;color:var(--accent);margin:0 0 9px;">— ${tt('AI 建议 · 下一步最该做的一件事','AI · the one thing to do next')}</p>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;">
      <div><h3 style="font-size:19px;color:var(--ink);margin:0;font-weight:600;">${cEsc(ns.title)}</h3>
        <p style="font-size:13px;color:var(--ink-2);margin:7px 0 0;max-width:540px;line-height:1.65;">${cEsc(ns.desc)}</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn btn-accent" data-go="${ns.ctaGo}">${ns.ctaLabel} →</button><button class="btn" data-go="match">${tt('智能匹配新岗位','Match a new job')}</button></div>
    </div></div></div></div>`;
  const dg=calmDigest();
  const digestHtml=dg?`<div class="sec" style="border-bottom:none;padding:2px 0 0;"><p style="font-size:12px;color:var(--ink-3);font-family:var(--font-mono);letter-spacing:0.04em;">${dg}</p></div>`:'';
  $('#page-overview').innerHTML=frontis('OVERVIEW',tt('总览','Overview'))+hero+digestHtml+stats+two+pipe+signFoot();
}

/* ★批11B(widgetActions 契约):renderOverview 桥已摘 —— 最后一个裸读者(platform/shell/widget-actions.js 的 delete-job 分支)已整段回迁 jobseek;
   全部消费者已 import(manifest/cards/persistence/其他页/match/demo-seed/widget-actions-jobseek)。状态符号(文件本地)私有。 */
