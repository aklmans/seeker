// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 职业资产页(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../../monolith-globals.d.ts。 */
/* ---------- SKILLS ---------- */
import { skillByName } from '../data-helpers.js';
import { ACCRUAL, ACTIONS, CAT_LABEL, JOBS, PRI, SKILLS } from '../data.js';
import { IV_RECORDS, RESUME } from '../logic/intake-action.js';
import { dotsHTML } from '../logic/job-actions.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { openModal } from '../../../platform/shell/modal.js';
import { frontis, signFoot } from '../../../platform/shell/nav.js';
import { setState } from '../../../platform/shell/shell-state.js';
let skillFilter={cat:'全部', accrual:'全部'};
function capCard(s){
  const star=(s.pri==='high'&&s.lvl<2)?'<span class="star">★</span>':'';
  const ac=ACCRUAL[s.accrual];
  const eviList=s.evidence.length?`<ul>${s.evidence.slice(0,3).map(e=>`<li>${cEsc(e)}</li>`).join('')}</ul>`:`<button class="btn-text" style="margin-top:6px;">+ 添加证据</button>`;
  const priLabel=PRI[s.pri];
  const demandLabel=s.cat==='tech'?`在 ${s.demand} / 12 岗位需求`:`在 ${s.demand} / 12 份 JD 提及`;
  const tn=trainingFor(s.name);
  const train=(setState.trainCounts&&tn>0)?`<div style="margin-top:11px;padding-top:11px;border-top:0.5px solid var(--border);"><div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--ink-3);margin-bottom:5px;"><span>训练投入 <b style="color:var(--accent);font-family:var(--font-mono);">${tn}</b> 次</span><span class="mono" style="font-size:10px;letter-spacing:0.08em;">迈向 Lv ${Math.min(5,s.lvl+1)}</span></div><div class="bar" style="height:3px;"><i style="width:${Math.min(100,tn/3*100)}%"></i></div></div>`:'';
  return `<div class="skill-card" data-skill="${cEsc(s.name)}">
    <div class="stop"><div class="sname">${cEsc(s.name)} ${star}</div><span class="acbadge ${ac.cls}">${ac.label}</span></div>
    <div class="slvl">${dotsHTML(s.lvl,'lvl')}<span class="mono">${s.lvl} / 5</span></div>
    <div class="sstate">${cEsc(s.state)}${s.years?' · '+cEsc(s.years)+' 年':''}</div>
    <div class="smeta"><span>半衰期 <b>${cEsc(s.halflife)}</b></span><span>迁移性 <b>${cEsc(s.transfer)}</b></span></div>
    <div class="sevi"><span class="ec">项目证据 (${s.evidence.length})</span>${eviList}</div>
    <div class="sdemand"><span>${demandLabel}</span><span class="pl ${priLabel.cls}">优先级 ${priLabel.label}</span></div>
    ${train}
  </div>`;
}
function trainingFor(name){
  let n=0;
  ACTIONS.forEach(a=>{ if(a.cap===name) n+=(a.sessions||[]).length; });
  (typeof IV_RECORDS!=='undefined'?IV_RECORDS:[]).forEach(r=>{ if((r.tags||[]).includes(name)) n+=1; });
  return n;
}
export function renderSkills(){
  const buckets={compound:[],accumulate:[],depreciate:[]};
  SKILLS.forEach(s=>buckets[s.accrual].push(s));
  const invest={compound:tt('优先投入','Invest first'),accumulate:tt('稳定维护','Maintain'),depreciate:tt('够用即可','Good enough')};
  const accLabel={compound:tt('复利型','Compounding'),accumulate:tt('积累型','Accumulating'),depreciate:tt('易折旧','Depreciating')};
  const accDesc={compound:tt('随经验复利增长,跨场景迁移,几乎不折旧 — 值得优先重投入。','Compounds with experience, transfers across contexts, barely depreciates — invest first.'),accumulate:tt('稳定积累、基本不折旧,但增长接近线性 — 稳定维护即可。','Accumulates steadily, low depreciation, near-linear growth — just maintain.'),depreciate:tt('与具体工具/版本绑定,折旧较快 — 够用即可,按需更新,别过度投入。','Tied to specific tools/versions, depreciates fast — keep it good enough, update as needed.')};
  const lensCol=(key)=>{
    const ac=ACCRUAL[key]; const arr=buckets[key];
    const chips=arr.slice(0,9).map(s=>`<span class="chip" data-skill="${cEsc(s.name)}" style="cursor:pointer;">${cEsc(s.name)}</span>`).join('')+(arr.length>9?`<span class="chip" style="border:none;color:var(--ink-mute);">+${arr.length-9}</span>`:'');
    return `<div class="lens-col"><div class="lh"><span class="acbadge ${ac.cls}">${accLabel[key]}</span><span class="mono" style="font-size:11px;color:var(--ink-3);">${arr.length} ${tt('项','items')}</span></div><p class="ld">${accDesc[key]}</p><div class="ll">${chips}</div><p class="invest">${tt('投资策略 · ','Strategy · ')}${invest[key]}</p></div>`;
  };
  const lens=`<div class="sec"><p class="seclabel">— ACCRUAL VALUE</p><h2 class="sectitle">${tt('积累价值视角','Accrual-value lens')}<span class="dot">.</span></h2>
    <p style="font-size:12.5px;color:var(--ink-3);margin:6px 0 16px;max-width:680px;line-height:1.7;">${tt('不是所有能力都值得平均用力。复利型能力随经验跨场景叠加增值、几乎不折旧;易折旧能力与工具版本强绑定。把有限的刻意练习,优先投到复利与积累上。','Not every skill deserves equal effort. Compounding skills stack across contexts and barely depreciate; depreciating ones are tied to tool versions. Invest your limited deliberate practice in compounding & accumulating ones first.')}</p>
    <div class="lens">${lensCol('compound')}${lensCol('accumulate')}${lensCol('depreciate')}</div></div>`;
  const cats=['全部','元能力','通用能力','专业技能'];
  const catLab={'全部':tt('全部','All'),'元能力':tt('元能力','Meta'),'通用能力':tt('通用能力','General'),'专业技能':tt('专业技能','Technical')};
  const accs=[['全部',tt('全部','All')],['compound',tt('复利型','Compounding')],['accumulate',tt('积累型','Accumulating')],['depreciate',tt('易折旧','Depreciating')]];
  const bar=`<div class="filterbar">
    <div class="filtergroup"><span class="fl">${tt('类别','Category')}</span>${cats.map(c=>`<button class="fopt ${skillFilter.cat===c?'on':''}" data-sc="${c}">${catLab[c]}</button>`).join('')}</div>
    <div class="filtergroup"><span class="fl">${tt('积累','Accrual')}</span>${accs.map(a=>`<button class="fopt ${skillFilter.accrual===a[0]?'on':''}" data-sa="${a[0]}">${a[1]}</button>`).join('')}</div>
  </div>`;
  const order=['meta','general','tech'];
  const eyebrowMap={meta:'META ABILITIES',general:'GENERAL',tech:'TECHNICAL'};
  const catTitle={meta:tt('元能力','Meta abilities'),general:tt('通用能力','General abilities'),tech:tt('专业技能','Technical skills')};
  const noteMap={meta:tt('元能力是「学习能力的能力」— 复利最强、最该养护,却最少被显式训练。','Meta-abilities are "the ability to learn" — highest compounding, most worth nurturing, yet least explicitly trained.'),general:tt('通用能力跨岗位迁移,JD 里常以「Owner / 推动 / 落地」等软词出现。','General abilities transfer across roles — JDs phrase them as "own / drive / deliver".'),tech:tt('专业技能里,架构思维复利、语言与中间件积累、特定工具易折旧 — 区别对待。','In technical skills: architecture thinking compounds, languages & middleware accumulate, specific tools depreciate — treat them differently.')};
  let sections='';
  order.forEach(cat=>{
    if(skillFilter.cat!=='全部' && CAT_LABEL[cat]!==skillFilter.cat) return;
    const arr=SKILLS.filter(s=>s.cat===cat && (skillFilter.accrual==='全部'||s.accrual===skillFilter.accrual));
    if(!arr.length) return;
    sections+=`<div class="sec"><p class="seclabel">— ${eyebrowMap[cat]}</p><h2 class="sectitle">${catTitle[cat]} <span style="font-family:var(--font-mono);font-style:normal;font-size:12px;color:var(--ink-3);">${arr.length}</span><span class="dot">.</span></h2>
      <p style="font-size:12px;color:var(--ink-3);margin:6px 0 0;">${noteMap[cat]}</p>
      <div class="skill-grid" style="margin-top:16px;">${arr.map(capCard).join('')}</div></div>`;
  });
  if(!sections) sections = SKILLS.length
    ? `<div class="sec"><p style="color:var(--ink-3);padding:20px 0;text-align:center;">${tt('没有符合筛选的能力','No abilities match the filter')}</p></div>`
    : `<div class="sec" style="border-bottom:none;"><div class="guide-step" style="border-bottom:none;"><span class="gnum">— ${tt('空','EMPTY')}</span><div><h3>${tt('你的能力档案来自简历','Your career assets come from your resume')}</h3><p style="max-width:600px;">${tt('在「我的简历」上传简历后,AI 自动把你的技能、年限、经历建成"职业资产"档案(复利型 / 积累型 / 易折旧),并和岗位需求对照。本地处理、联系方式不参与。','Upload your resume in "My resume" and AI builds your skills, years and experience into a career-asset profile (compounding / accumulating / depreciating), matched against job demand. Local-only; contact details excluded.')}</p><button class="btn btn-accent" style="margin-top:14px;" onclick="openResumeModal()">${tt('上传 / 管理简历','Upload / manage resume')} →</button></div></div></div>`;
  const assetIntro=`<div class="sec" style="border-bottom:none;padding-bottom:0;"><div class="ai-bar" style="border:0.5px solid var(--border);">
    <span class="dot"></span><span class="lbl">${tt('由简历 <b>'+cEsc(RESUME.filename)+'</b> 自动建档 · 这是你贯穿职业生涯的长期资产,在职时也值得每季度盘点','Auto-built from <b>'+cEsc(RESUME.filename)+'</b> · a long-term career asset worth reviewing quarterly, even while employed')}</span>
    <button class="btn-text" style="margin-left:auto;" onclick="openMarketValue()">${tt('市场价值报告','Market value report')} →</button></div></div>`;
  $('#page-skills').innerHTML=frontis('CAREER ASSETS',tt('职业资产','Career assets'))+assetIntro+lens+bar+sections+signFoot();
  $$('#page-skills [data-sc]').forEach(b=>b.onclick=()=>{skillFilter.cat=b.dataset.sc;renderSkills();});
  $$('#page-skills [data-sa]').forEach(b=>b.onclick=()=>{skillFilter.accrual=b.dataset.sa;renderSkills();});
  $$('#page-skills [data-skill]').forEach(c=>c.onclick=(e)=>{e.stopPropagation();openSkillDetail(c.dataset.skill);});
}

function openSkillDetail(name){
  const s=skillByName(name); const ac=ACCRUAL[s.accrual];
  const evi=s.evidence.length?s.evidence.map((e,i)=>`<div style="padding:11px 0;border-bottom:0.5px solid var(--border);"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;"><span style="font-size:14px;color:var(--ink);"><span class="idx" style="margin-right:8px;">${String(i+1).padStart(2,'0')}</span>${cEsc(e)}</span><span style="display:flex;gap:10px;white-space:nowrap;"><button class="btn-text">${tt('编辑','Edit')}</button><button class="btn-text" style="color:var(--ink-mute);">${tt('删除','Delete')}</button></span></div></div>`).join(''):`<p style="color:var(--ink-3);font-size:13px;padding:8px 0;">${tt('暂无证据 — 这正是可以补充的方向。','No evidence yet — a good place to add some.')}</p>`;
  let demandBlock;
  if(s.cat==='tech'){
    const demandJobs=JOBS.filter(j=>j.need.includes(name)||j.plus.includes(name)).map(j=>`<span class="chip">${cEsc(j.co)}</span>`).join(' ');
    demandBlock=`<h3 class="sectitle" style="font-size:16px;margin-bottom:10px;">${tt('在 '+s.demand+' / 12 岗位中被明确要求','Explicitly required in '+s.demand+' / 12 jobs')}<span class="dot">.</span></h3><div style="display:flex;gap:6px;flex-wrap:wrap;">${demandJobs||`<span style="color:var(--ink-3);font-size:13px;">${tt('暂无','None')}</span>`}</div>`;
  }else{
    const soft=['Owner','推动','落地','稳定性','复盘','0-1','协同'];
    demandBlock=`<h3 class="sectitle" style="font-size:16px;margin-bottom:8px;">${tt('在 '+s.demand+' / 12 份 JD 中作为软性要求出现','Appears as a soft requirement in '+s.demand+' / 12 JDs')}<span class="dot">.</span></h3><p style="font-size:13px;color:var(--ink-3);margin:0 0 11px;line-height:1.7;">${tt('通用能力与元能力很少被写成硬性技能,却藏在 JD 反复出现的这些词里:','General & meta abilities are rarely listed as hard skills — they hide in the words JDs keep repeating:')}</p><div style="display:flex;gap:6px;flex-wrap:wrap;">${soft.map(k=>`<span class="chip">${k}</span>`).join('')}</div>`;
  }
  const accrualNote={
    compound:tt('复利型能力 — 每次刻意练习的收益会叠加,并迁移到新场景,折旧极慢。值得在训练排期里优先占位。','Compounding — each practice session\'s payoff stacks and transfers to new contexts, with very slow decay. Give it priority in your training schedule.'),
    accumulate:tt('积累型能力 — 稳定、抗折旧,但收益接近线性。保持手感、按需深化即可,不必过度投入。','Accumulating — stable and decay-resistant, but returns are near-linear. Keep it sharp and deepen as needed; no need to overinvest.'),
    depreciate:tt('易折旧能力 — 与具体工具/版本强绑定,更新很快。抓住背后可迁移的概念,具体字段够用即查,别陷进去。','Depreciating — tied to specific tools/versions that change fast. Grasp the transferable concepts behind it; look up the specifics as needed, don\'t over-sink.')
  }[s.accrual];
  const tn=trainingFor(name);
  const trainItems=[];
  ACTIONS.forEach(a=>{ if(a.cap===name)(a.sessions||[]).forEach(se=>trainItems.push([tt('训练','Train'),a.title,se.date,tt(se.mins+' 分钟',se.mins+' min')])); });
  IV_RECORDS.forEach(r=>{ if((r.tags||[]).includes(name)) trainItems.push([tt('面试','Interview'),r.qText,r.date,tt(r.scores.overall.toFixed(1)+' 分',r.scores.overall.toFixed(1)+' pts')]); });
  const trainBlock=(setState.trainCounts&&tn>0)?`<div class="msec"><p class="seclabel">— TRAINING</p><h3 class="sectitle" style="font-size:16px;margin-bottom:6px;">${tt('训练投入 · '+tn+' 次','Training invested · '+tn)}<span class="dot">.</span></h3>
    <p style="font-size:12.5px;color:var(--ink-3);margin:0 0 10px;line-height:1.7;">${tt('来自刻意练习与面试陪练的投入,作为这项能力成长的参考(可在设置中关闭)。每 3 次投入约推进一格。','Drawn from deliberate practice & interview prep as a growth signal (toggle off in settings). ~3 sessions advances one level.')}</p>
    <div class="bar" style="height:4px;margin-bottom:12px;"><i style="width:${Math.min(100,tn/3*100)}%"></i></div>
    ${trainItems.slice(0,6).map(t=>`<div style="display:flex;gap:12px;align-items:baseline;padding:7px 0;border-bottom:0.5px solid var(--border);font-size:13px;"><span class="q-cat" style="border:none;padding:0;color:var(--accent);">${t[0]}</span><span style="flex:1;color:var(--ink-2);line-height:1.5;">${cEsc(t[1])}</span><span class="mono" style="font-size:11px;color:var(--ink-3);white-space:nowrap;">${t[2]} · ${t[3]}</span></div>`).join('')}</div>`:'';
  const levels=[['1',tt('听说过','Heard of it')],['2',tt('用过教程','Did a tutorial')],['3',tt('业务里用过','Used at work')],['4',tt('主导过项目','Led a project')],['5',tt('能教别人','Can teach it')]];
  const lvlList=levels.map(l=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13.5px;color:${+l[0]===s.lvl?'var(--ink)':'var(--ink-3)'};"><span style="width:10px;height:10px;border-radius:50%;border:1px solid var(--border-strong);${+l[0]<=s.lvl?'background:var(--accent);border-color:var(--accent);':''}"></span><span class="mono" style="font-size:11px;">${l[0]}</span><span>${l[1]}</span></div>`).join('');
  const html=`
    <div class="modal-head"><div><h2>${cEsc(name)}</h2><div class="sub"><span class="chip">${CAT_LABEL[s.cat]}</span><span class="acbadge ${ac.cls}">${ac.label}</span><span>${dotsHTML(s.lvl,'lvl')}</span><span>${s.lvl} / 5</span><span>·</span><span>${cEsc(s.state)}</span></div></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="msec"><p class="seclabel">— ACCRUAL VALUE</p><h3 class="sectitle" style="font-size:16px;margin-bottom:8px;">${tt('积累价值','Accrual value')}<span class="dot">.</span></h3>
        <div style="display:flex;gap:36px;margin:6px 0 13px;">${[[tt('类型','Type'),ac.label],[tt('半衰期','Half-life'),s.halflife],[tt('迁移性','Transfer'),s.transfer]].map(x=>`<div><p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.18em;color:var(--ink-3);margin:0;">${x[0]}</p><p style="font-size:16px;color:var(--ink);margin:5px 0 0;font-weight:500;">${x[1]}</p></div>`).join('')}</div>
        <p style="font-size:13px;color:var(--ink-2);line-height:1.75;margin:0;">${accrualNote}</p></div>
      <div class="msec"><p class="seclabel">— EVIDENCE</p><h3 class="sectitle" style="font-size:16px;margin-bottom:8px;">${tt('项目证据','Evidence')} (${s.evidence.length})<span class="dot">.</span></h3>${evi}<button class="btn-text" style="margin-top:14px;">${tt('+ 添加新证据','+ Add evidence')}</button></div>
      <div class="msec"><p class="seclabel">— DEMAND</p>${demandBlock}</div>
      ${trainBlock}
      <div class="msec" style="border-bottom:none;"><p class="seclabel">— LEVEL</p><h3 class="sectitle" style="font-size:16px;margin-bottom:10px;">${tt('掌握程度','Proficiency')}<span class="dot">.</span></h3>${lvlList}</div>
    </div>`;
  openModal(html);
}

/* 过渡 window 兼容桥:manifest 箭头 render:()=>renderSkills() + 运行时消费者(cards/persistence/其他页/index.html)按全局名调;改 import 后摘。状态符号(文件本地)不上桥。 */
