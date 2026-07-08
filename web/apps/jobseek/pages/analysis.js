// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 岗位分析页(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../../monolith-globals.d.ts。 */
/* ---------- ANALYSIS ---------- */
import { distBy, distinctNeedSkills, keywordsReal, skillByName } from '../data-helpers.js';
import { JOBS, SKILLS } from '../data.js';
import { SALARY, TREND, YOU_VALUE } from '../logic/intake-action.js';
import { dotsHTML } from '../logic/job-actions.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { $ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { frontis, signFoot } from '../../../platform/shell/nav.js';
export function renderAnalysis(){
  if(!JOBS.length){   // 空态教学(评审 P1-9):无岗位 → 讲清这页干嘛 + 指回录入
    $('#page-analysis').innerHTML=frontis('ANALYSIS',tt('岗位分析','Analysis'))+
      `<div class="sec" style="border-bottom:none;"><div class="guide-step" style="border-bottom:none;"><span class="gnum">— ${tt('空','EMPTY')}</span><div><h3>${tt('添加目标岗位,这页就活了','Add target jobs and this comes alive')}</h3><p style="max-width:600px;">${tt('录入岗位后,这里从你的 JD 聚合:高频技能、能力缺口、城市 / 公司类型分布、JD 关键词 —— 你的私人市场地图,只有持续收集才攒得出。','Once you add jobs, this aggregates from your JDs: high-frequency skills, skill gaps, city / company-type distribution, and JD keywords — your private market map, built only by collecting over time.')}</p><button class="btn btn-accent" style="margin-top:14px;" onclick="go('jobs')">${tt('+ 录入岗位','+ Add a job')}</button></div></div></div>`+signFoot();
    return;
  }
  const top=[...SKILLS].filter(s=>s.cat==='tech').sort((a,b)=>b.demand-a.demand).slice(0,10);
  const skillRows=top.map((s,i)=>{
    const occ=s.demand+Math.round(s.demand*0.6);
    return `<tr style="cursor:default;">
      <td class="idx">${String(i+1).padStart(2,'0')}</td>
      <td><span class="co" style="font-weight:500;">${cEsc(s.name)}</span></td>
      <td class="mono" style="font-size:12px;color:var(--ink-2);">${occ} 次</td>
      <td class="mono" style="font-size:12px;color:var(--ink-3);">${s.demand}/${JOBS.length}</td>
      <td>${dotsHTML(s.lvl,'lvl')}</td>
    </tr>`;
  }).join('');
  const skillTable=`<div class="sec"><p class="seclabel">— TOP SKILLS</p><h2 class="sectitle">${tt('高频技能','High-frequency skills')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 16px;">${tt('基于 '+JOBS.length+' 个岗位 JD 抽取 · 按需求频次排序','From '+JOBS.length+' job JDs · by demand frequency')}</p>
    <div style="border:0.5px solid var(--border);"><table>
      <thead><tr><th style="width:44px;">排名</th><th>技能</th><th>出现次数</th><th>覆盖岗位</th><th>你的掌握</th></tr></thead>
      <tbody>${skillRows}</tbody></table></div></div>`;

  const matCompanies=JOBS.slice(0,8);
  const matSkills=['Go','MySQL','Redis','K8s','Rust','分布式系统','微服务','高并发','系统设计'];
  const matHead=`<tr><th>技能 \\ 岗位</th>${matCompanies.map(j=>`<th>${cEsc(j.co.slice(0,2))}</th>`).join('')}</tr>`;
  const matBody=matSkills.map(sk=>{
    const s=skillByName(sk); const isGap=!s||s.lvl<2;
    const cells=matCompanies.map(j=>{
      const required=j.need.includes(sk)||j.plus.includes(sk);
      if(!required) return `<td></td>`;
      const have=s&&s.lvl>=2;
      return have?`<td class="cell-has">●</td>`:`<td class="cell-gap">○</td>`;
    }).join('');
    return `<tr style="cursor:default;"><td>${sk}${isGap?'<span class="skill-gaplabel">★ 缺口</span>':''}</td>${cells}</tr>`;
  }).join('');
  const matrix=`<div class="sec"><p class="seclabel">— GAP MATRIX</p><h2 class="sectitle">${tt('缺口矩阵','Gap matrix')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 16px;">● 已具备　○ 可补充　· 横向看岗位覆盖,纵向看技能需求</p>
    <div class="matrix-wrap"><table class="matrix"><thead>${matHead}</thead><tbody>${matBody}</tbody></table></div></div>`;

  const CITY=distBy('city'), KIND=distBy('kind');
  const maxC=Math.max(1,...CITY.map(c=>c[1])), maxK=Math.max(1,...KIND.map(c=>c[1]));
  const dist=`<div class="sec"><p class="seclabel">— DISTRIBUTION</p><h2 class="sectitle">${tt('分布','Distribution')}<span class="dot">.</span></h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:18px;max-width:760px;">
    <div><p style="font-size:12px;color:var(--ink-3);margin:0 0 12px;font-family:var(--font-mono);letter-spacing:0.12em;">${tt('按城市','By city')}</p>
      ${CITY.map(c=>`<div class="barrow" style="grid-template-columns:48px 1fr 30px;"><span class="blab">${cEsc(c[0])}</span><div class="btrack"><i style="width:${c[1]/maxC*100}%;background:var(--status-info);"></i></div><span class="bval">${c[1]}</span></div>`).join('')}</div>
    <div><p style="font-size:12px;color:var(--ink-3);margin:0 0 12px;font-family:var(--font-mono);letter-spacing:0.12em;">${tt('按公司类型','By type')}</p>
      ${KIND.map(c=>`<div class="barrow" style="grid-template-columns:96px 1fr 30px;"><span class="blab" style="font-size:12.5px;">${cEsc(c[0])}</span><div class="btrack"><i style="width:${maxK?c[1]/maxK*100:0}%;background:var(--ink-mute);"></i></div><span class="bval">${c[1]}</span></div>`).join('')}</div>
    </div></div>`;

  const KW=keywordsReal();
  const cloud= KW.length ? (()=>{ const maxKw=Math.max(1,...KW.map(k=>k[1]));
    return `<div class="sec" style="border-bottom:none;"><p class="seclabel">— KEYWORDS</p><h2 class="sectitle">${tt('JD 高频关键词','JD top keywords')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 18px;">${tt('除硬技能外,JD 中反复出现的"软词"','Recurring soft-words in your JDs, beyond hard skills')}</p>
    <div class="cloud">${KW.map(k=>{const sz=12+(k[1]/maxKw)*12;return `<span class="kw" style="font-size:${sz}px;"><b>${k[0]}</b> <span class="c">${k[1]}${tt('次','×')}</span></span>`;}).join('')}</div></div>`; })() : '';

  const maxTrend=Math.max(...TREND.map(t=>t.pct));
  const trendRows=TREND.map(t=>{
    const w=Math.min(48,(t.pct/maxTrend)*48);
    const bar=t.dir==='flat'?`<i class="up" style="width:3px;background:var(--ink-mute);"></i>`:`<i class="${t.dir}" style="width:${w}%;"></i>`;
    const sign=t.dir==='up'?'+':(t.dir==='down'?'−':'±');
    return `<div class="trend-row"><span class="tn">${t.skill}</span><div class="trend-track"><span class="mid"></span>${bar}</div><span class="trend-val ${t.dir}">${sign}${t.pct}%${t.note?'':''}</span></div>${t.note?`<div style="font-size:11.5px;color:var(--ink-mute);margin:-4px 0 4px 110px;">${t.note}</div>`:''}`;
  }).join('');
  const maxSal=100;
  const salRows=SALARY.map(s=>`<div class="sal-row"><span class="sn">${s.role}</span><div class="sal-bar"><i style="left:${s.lo}%;width:${s.hi-s.lo}%;"></i><span class="you" style="left:${YOU_VALUE}%;"></span></div><span class="sal-val">${s.lo}-${s.hi}万</span></div>`).join('');
  const market=`<div class="sec"><p class="seclabel">— MARKET INTEL</p><h2 class="sectitle">${tt('市场情报','Market intel')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 18px;max-width:680px;line-height:1.7;">${tt('聚合你的 '+JOBS.length+' 份目标 JD 与市场样本得出 —— 这是只有"持续收集 JD"才攒得出的独家数据。趋势仅作机会参考,不必焦虑。','Aggregated from your '+JOBS.length+' target JDs and market samples — exclusive data only built by collecting JDs over time. Trends are for opportunity-spotting only; no need to stress.')}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;">
    <div><p style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.14em;color:var(--ink-3);margin:0 0 12px;">技能需求趋势 · 近 6 个月</p>${trendRows}
      <p style="font-size:11px;color:var(--ink-mute);margin:12px 0 0;">绿 = 需求上行 · 灰 = 平稳/回落</p></div>
    <div><p style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.14em;color:var(--ink-3);margin:0 0 12px;">薪资 benchmark · <span style="color:var(--accent);">│</span> 为你的估算位</p>${salRows}
      <p style="font-size:12px;color:var(--ink-3);margin:14px 0 0;line-height:1.7;">你的估算位约 <b style="color:var(--accent);">${YOU_VALUE} 万</b>,处「高级」带中上沿。<button class="btn-text" onclick="openMarketValue()">看完整市场价值报告 →</button></p></div>
    </div></div>`;
  // 私人市场地图(评审 P2-12 护城河前置 + P2-11 研究资产定位):把"持续收集才攒得出"提到显眼处。
  const marketMap=`<div class="sec" style="border-bottom:none;padding-bottom:0;"><div class="ai-bar" style="border:0.5px solid var(--border);">
    <span class="dot"></span><span class="lbl">${tt('你的私人市场地图 · 已从 '+JOBS.length+' 份 JD 聚合出 '+distinctNeedSkills()+' 个高频技能 —— 持续收集,地图越长越值钱(只有你才有的研究资产)。','Your private market map · '+distinctNeedSkills()+' high-frequency skills from '+JOBS.length+' JDs — the more you collect, the more valuable it gets (a research asset only you have).')}</span></div></div>`;
  $('#page-analysis').innerHTML=frontis('ANALYSIS',tt('岗位分析','Analysis'))+marketMap+skillTable+matrix+dist+market+cloud+signFoot();
}

/* 过渡 window 兼容桥:manifest 箭头 render:()=>renderAnalysis() + 运行时消费者(cards/persistence/其他页/index.html)按全局名调;改 import 后摘。状态符号(文件本地)不上桥。 */
