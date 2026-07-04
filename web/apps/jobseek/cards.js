// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 卡实现束 + 卡注册表 SEEKER_CARDS(平台化阶段3-e 择取搬迁 · 第8轮裁定 C「归属驱动零改动移动」)。
    纯 jobseek 卡实现:各卡渲染器 render*CardEl + show 包装 + AI CRUD 提案(job-create/update/delete)
    + 卡数据 helper(matchRadarSVG/topGapsAcrossJobs/calmDigest…)+ SEEKER_CARDS 注册表定义;
    经 manifest.cards 契约化贡献给壳。从壳基元(extractSeekerBlock 上 / aiHTML·streamReply 下)之间择出;
    那些渲染引擎是壳基元、留 index.html 待抽壳到 platform/shell/。classic 全局语义不变;依赖见 ./monolith-globals.d.ts。 */
function showResumeProposal(bubble, edit, who){
  // 定位简历:edit.jobId → 当前打开的简历 → 仅有一份时取之
  let jid = edit.jobId;
  const has = k => k!=null && RESUME_TAILORED[k];
  if(!has(jid)){
    if(typeof resumeState==='object' && resumeState && has(resumeState.jobId)) jid = resumeState.jobId;
    else { const ks = Object.keys(RESUME_TAILORED); jid = (ks.length===1) ? ks[0] : null; }
  }
  const r = (jid!=null) ? RESUME_TAILORED[jid] : null;
  if(!r || !Array.isArray(r.modules)) return; // 无法定位:静默(自然语言建议仍在)
  const changes = [];
  for(const e of (edit.edits||[])){
    if(!e || e.module==null) continue;
    const mod = r.modules.find(x=>x.key===e.module);
    if(!mod || mod.type==='locked' || mod.key==='basic') continue; // 联系方式 / 锁定模块绝不可改
    let afterVal, before, after;
    if(mod.type==='skills'){
      afterVal = Array.isArray(e.content) ? e.content.map(s=>String(s).trim()).filter(Boolean)
               : String(e.content==null?'':e.content).split(/[、,，·\/|\n]+/).map(s=>s.trim()).filter(Boolean);
      before = Array.isArray(mod.content) ? mod.content.join(' · ') : '';
      after = afterVal.join(' · ');
    } else if(mod.type==='text'){
      afterVal = String(e.content==null?'':e.content).trim();
      before = String(mod.content==null?'':mod.content);
      after = afterVal;
    } else continue; // 嵌套结构(work/projects/edu)本期不结构化改写
    if(!after || after===before) continue;
    changes.push({ key:mod.key, label:mod.label||mod.key, type:mod.type, before, after, afterVal });
  }
  if(!changes.length) return;
  const names = changes.map(c=>c.label).join('、').replace(/</g,'&lt;');
  const card = el(`<div class="cop-card" style="margin-top:8px;"><div class="cct">✎ ${tt('AI 建议改写简历','AI suggests resume edits')} · ${changes.length} ${tt('处','edit(s)')}</div><div class="ccm">${tt('模块:','Modules: ')}${names}</div></div>`);
  const acts = el('<div class="cop-actions"></div>');
  const btn = el(`<button class="btn btn-accent">${tt('预览并应用 →','Preview & apply →')}</button>`);
  btn.onclick = ()=> reviewResumeProposal(jid, changes);
  acts.appendChild(btn); card.appendChild(acts);
  const host = (bubble && bubble.parentElement) || bubble;
  if(host){ host.appendChild(card); }
}
function reviewResumeProposal(jid, changes){
  const G = window.SeekerGuardrail; if(!G || !G.confirmDestructive) return;
  const r = RESUME_TAILORED[jid]; if(!r) return;
  const job = JOBS.find(j=>String(j.id)===String(jid));
  const snap = JSON.parse(JSON.stringify(r.modules)); // 撤销快照
  G.confirmDestructive({
    title: tt('应用 AI 简历改写?','Apply AI resume edits?'),
    detail: tt('将改写以下专业模块,不涉及姓名 / 电话 / 邮箱等联系方式。','Rewrites these professional modules; contact info untouched.'),
    changes: changes.map(c=>({label:c.label, before:c.before, after:c.after})),
    source: (job?job.co+' · ':'')+'AI',
    confirmLabel: tt('应用','Apply'),
    undoText: tt('已应用 AI 简历改写','AI resume edits applied'),
    onConfirm: ()=>{
      for(const c of changes){
        const mod = r.modules.find(x=>x.key===c.key);
        if(!mod || mod.type==='locked' || mod.key==='basic') continue; // 二次红线守卫
        mod.content = (mod.type==='skills') ? c.afterVal : c.after;
      }
      persistResume(jid);
      try{ if(typeof renderResumes==='function') renderResumes(); }catch(_e){}
    },
    onUndo: ()=>{
      RESUME_TAILORED[jid].modules = JSON.parse(JSON.stringify(snap));
      persistResume(jid);
      try{ if(typeof renderResumes==='function') renderResumes(); }catch(_e){}
    },
  });
}
/* ===== 块4:AI 对话式 CRUD —— AI 出 ```seeker:job-{create,update,delete} 提案块,domain 渲染卡 + 用户确认后落库。
   红线:AI 从不静默增删改库;一律先卡片预览,扳机在用户;改/删走 guardrail(预览 + 撤销),新增卡即预览、按钮即确认。 ===== */
function jobsReRender(){ [renderJobs,renderOverview,renderAnalysis,renderInterview].forEach(f=>{ try{ f&&f(); }catch(_e){} }); }
function jobLabel(j){ const s = j ? ((j.co||'')+(j.role?(' · '+j.role):'')) : ''; return (s.replace(/</g,'&lt;')) || tt('该岗位','this job'); }
const JOB_FIELD_META = {
  co:{label:'公司'}, role:{label:'岗位'}, city:{label:'城市'}, pay:{label:'薪资'}, years:{label:'年限'}, edu:{label:'学历'},
  jd:{label:'JD'}, summary:{label:'一句话'}, seniority:{label:'职级'}, workMode:{label:'工作方式'}, kind:{label:'类型'},
  status:{label:'状态', status:true}, need:{label:'必需技能', array:true}, plus:{label:'加分技能', array:true},
};
function parseJobVal(field, v){
  const meta = JOB_FIELD_META[field]||{};
  if(meta.array) return (Array.isArray(v) ? v : String(v==null?'':v).split(/[、,，\/|\n]+/)).map(s=>String(s).trim()).filter(Boolean);
  if(meta.status){ const s=String(v==null?'':v).trim(); if(STATUS[s]) return s; const hit=Object.keys(STATUS).find(k=>STATUS[k].label===s); return hit||s; } // AI 给标签("已投")→ 归一为键("sent")
  return String(v==null?'':v);
}
function fmtJobVal(field, v){
  const meta = JOB_FIELD_META[field]||{};
  if(meta.array) return parseJobVal(field, v).join(' · ');
  if(meta.status) return (STATUS[v]&&STATUS[v].label) || String(v==null?'':v);
  return String(v==null?'':v);
}
// 新增提案:AI 建议加一个岗位 → 卡片即预览、按钮即确认(非破坏,无需 guardrail)。
function showJobCreateProposal(bubble, d, who){
  const co=String(d.co||'').trim(), role=String(d.role||'').trim();
  if(!co && !role) return;
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const rows=[['公司',co],['岗位',role],['城市',d.city],['薪资',d.pay],['年限',d.years]].filter(r=>r[1]).map(r=>esc(tt(r[0],r[0]))+':'+esc(r[1])).join('  ·  ');
  const card = el(`<div class="cop-card" style="margin-top:8px;"><div class="cct">🗂 ${tt('AI 建议新增岗位','AI suggests adding a job')}</div><div class="ccm">${rows||esc(co||role)}</div></div>`);
  const acts = el('<div class="cop-actions"></div>');
  const btn = el(`<button class="btn btn-accent">${tt('保存岗位','Save job')}</button>`);
  btn.onclick = ()=>{
    const job = { id:nextJobId(), status:'todo', kind:String(d.kind||''), edu:String(d.edu||''),
      co, role, city:String(d.city||''), src:String(d.src||'AI'), pay:String(d.pay||''), years:String(d.years||''),
      jd:String(d.jd||''), interest:0, growth:0, match:0, chance:0,
      need:parseJobVal('need', d.need), plus:parseJobVal('plus', d.plus),
      summary:String(d.summary||''), seniority:String(d.seniority||''), workMode:String(d.workMode||''),
      highlights:Array.isArray(d.highlights)?d.highlights:[] };
    JOBS.unshift(job); persistJob(job); jobsReRender();
    btn.disabled=true; btn.textContent=tt('✓ 已添加','✓ Added'); toast(tt('已添加岗位','Job added'));
  };
  acts.appendChild(btn); card.appendChild(acts);
  const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card);
}
// 修改提案:AI 建议改某岗位字段 → guardrail 预览(before→after)+ 应用 + 撤销。
function showJobUpdateProposal(bubble, d, who){
  const job = JOBS.find(j=>String(j.id)===String(d.id)); if(!job) return;
  const changes=[];
  for(const c of (d.changes||[])){
    if(!c || !c.field || c.field==='id' || !(c.field in JOB_FIELD_META)) continue;
    const stored=parseJobVal(c.field, c.after);                  // 先归一(status 标签→键、数组拆分)
    const after=fmtJobVal(c.field, stored), before=fmtJobVal(c.field, job[c.field]);
    if(!after || after===before) continue;                       // 无变化/空值不提议
    changes.push({ field:c.field, label:JOB_FIELD_META[c.field].label, before, after, stored });
  }
  if(!changes.length) return;
  const card = el(`<div class="cop-card" style="margin-top:8px;"><div class="cct">✎ ${tt('AI 建议修改岗位','AI suggests editing a job')} · ${jobLabel(job)}</div><div class="ccm">${changes.map(c=>c.label).join('、')}</div></div>`);
  const acts = el('<div class="cop-actions"></div>');
  const btn = el(`<button class="btn btn-accent">${tt('预览并应用 →','Preview & apply →')}</button>`);
  btn.onclick = ()=>{
    const G=window.SeekerGuardrail; if(!G||!G.confirmDestructive){ toast(tt('该端暂不支持','Not supported here')); return; }
    const snap = Object.assign({}, job);
    G.confirmDestructive({
      title: tt('应用 AI 修改?','Apply AI edits?'), detail: tt('将更新该岗位的以下字段(可撤销)。','Updates these fields (undoable).'),
      changes: changes.map(c=>({label:c.label, before:c.before, after:c.after})),
      source: jobLabel(job)+' · AI', confirmLabel: tt('应用','Apply'), undoText: tt('已应用修改','Edits applied'),
      onConfirm: ()=>{ for(const c of changes) job[c.field]=c.stored; persistJob(job); jobsReRender(); btn.disabled=true; btn.textContent=tt('✓ 已应用','✓ Applied'); },
      onUndo: ()=>{ Object.assign(job, snap); persistJob(job); jobsReRender(); },
    });
  };
  acts.appendChild(btn); card.appendChild(acts);
  const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card);
}
// 删除提案:AI 建议删某岗位 → guardrail(破坏性)预览 + 删 + 撤销(还原内存 + DB)。
function showJobDeleteProposal(bubble, d, who){
  const job = JOBS.find(j=>String(j.id)===String(d.id)); if(!job) return;
  const card = el(`<div class="cop-card" style="margin-top:8px;"><div class="cct">🗑 ${tt('AI 建议删除岗位','AI suggests deleting a job')}</div><div class="ccm">${jobLabel(job)}</div></div>`);
  const acts = el('<div class="cop-actions"></div>');
  const btn = el(`<button class="btn">${tt('删除 →','Delete →')}</button>`);
  btn.onclick = ()=>{
    const G=window.SeekerGuardrail; if(!G||!G.confirmDestructive){ toast(tt('该端暂不支持','Not supported here')); return; }
    let snap=Object.assign({}, job);
    G.confirmDestructive({
      title: tt('删除岗位?','Delete job?'), detail:(tt('将删除:','Will delete: '))+jobLabel(job),
      confirmLabel: tt('删除','Delete'), undoText: tt('已删除岗位','Job deleted'),
      onConfirm: async()=>{ try{ if(window.SeekerRT) snap=(await window.SeekerRT.db.remove('jobs', String(job.id)))||snap; }catch(_e){} const i=JOBS.findIndex(x=>String(x.id)===String(job.id)); if(i>=0) JOBS.splice(i,1); jobsReRender(); btn.disabled=true; btn.textContent=tt('✓ 已删除','✓ Deleted'); },
      onUndo: async()=>{ try{ if(window.SeekerRT) await window.SeekerRT.db.upsert('jobs', snap); }catch(_e){} if(!JOBS.some(x=>String(x.id)===String(snap.id))) JOBS.unshift(snap); jobsReRender(); },
    });
  };
  acts.appendChild(btn); card.appendChild(acts);
  const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card);
}
/** 岗位能力雷达 SVG(真实数据:job.need 维度 × 我的技能等级 lvl/4)。维度<3 不画。 */
function matchRadarSVG(job){
  const dims=(job.need||[]).slice(0,6), n=dims.length;
  if(n<3) return '';
  const cx=105, cy=98, R=60, esc=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const pt=(i,r)=>{ const a=-Math.PI/2 + i*2*Math.PI/n; return [cx+r*Math.cos(a), cy+r*Math.sin(a)]; };
  const ring=r=>dims.map((_,i)=>pt(i,r).map(v=>v.toFixed(1)).join(',')).join(' ');
  let grid=''; [0.34,0.67,1].forEach(f=>{ grid+=`<polygon points="${ring(R*f)}" fill="none" stroke="var(--border)" stroke-width="0.5"/>`; });
  let axes='', labels='';
  dims.forEach((d,i)=>{ const [ax,ay]=pt(i,R); axes+=`<line x1="${cx}" y1="${cy}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="var(--border)" stroke-width="0.5"/>`;
    const [lx,ly]=pt(i,R+11); const anc=Math.abs(lx-cx)<6?'middle':(lx>cx?'start':'end');
    labels+=`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anc}" dominant-baseline="middle" font-size="8.5" fill="var(--ink-3)">${esc(d).slice(0,5)}</text>`; });
  const dpts=dims.map((d,i)=>{ const s=skillByName(d); const lvl=s?s.lvl:0; const f=Math.max(0.08,Math.min(1,lvl/4)); return pt(i,R*f).map(v=>v.toFixed(1)).join(','); }).join(' ');
  return `<svg viewBox="0 0 210 188" width="200" height="178" class="match-radar" role="img" aria-label="${tt('岗位能力雷达','Role-fit radar')}">${grid}${axes}<polygon points="${dpts}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.3"/>${labels}</svg>`;
}
/** 智能匹配交互卡(原生 domain · 真实数据):匹配度 + 雷达 + 缺口 + CTA(查看完整匹配/改简历/排计划)。 */
function renderMatchCardEl(job){
  const pct=Math.round((job.match||0)*10);
  const need=job.need||[]; const strengths=need.filter(n=>{const s=skillByName(n);return s&&s.lvl>=3;});
  const gaps=topGapsOf(job); const role=String(job.role||'').split('·')[0].trim();
  const esc=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const gapChips=(gaps.length?gaps:[tt('暂无明显缺口','No clear gaps')]).slice(0,6).map(g=>`<span class="chip gap">${esc(g)}</span>`).join('');
  const card=el(`<div class="cop-card match-card">
    <div class="mc-head"><div><div class="mc-co">${esc(job.co)} · ${esc(role)}</div>
      <div class="mc-sub">${tt('综合匹配','Match')} · ${tt('已具备','met')} ${strengths.length}/${need.length}</div></div>
      <div class="mc-score"><span class="v">${pct}</span><span class="u">/100</span></div></div>
    <div class="mc-bar"><i style="width:${pct}%;"></i></div>
    <div class="mc-body"><div class="mc-radar">${matchRadarSVG(job)}</div>
      <div class="mc-gaps"><div class="mc-lbl">${tt('可补齐的能力','Gaps to fill')}</div><div class="mc-chips">${gapChips}</div></div></div>
    <div class="cop-actions mc-acts"></div></div>`);
  const acts=card.querySelector('.mc-acts');
  const mk=(label,fn,accent)=>{ const b=el(`<button class="btn${accent?' btn-accent':''}">${label}</button>`); b.onclick=fn; acts.appendChild(b); };
  mk(tt('查看完整匹配','Full match')+' →', ()=>{ if(typeof copMatch==='function') copMatch(job.id); else { matchState.jobId=job.id; matchState.done=false; go('match'); renderMatch(); } }, true);
  mk(tt('改简历','Tailor resume'), ()=>{ if(typeof copResume==='function') copResume(job.id); else if(typeof aiResumeForJob==='function') aiResumeForJob(job.id); });
  if(gaps.length) mk(tt('排训练计划','Plan'), ()=>{ if(typeof copPlan==='function') copPlan(gaps[0], job.co+' · '+role); });
  return card;
}
function showMatchCard(bubble, match, who){
  const find=k=>JOBS.find(j=>String(j.id)===String(k));
  let job=find(match.jobId);
  if(!job && typeof matchState==='object' && matchState) job=find(matchState.jobId);
  if(!job) return; // 无法定位:静默(文字分析仍在)
  try{ const card=renderMatchCardEl(job); const host=(bubble&&bubble.parentElement)||bubble; if(host){ host.appendChild(card); } }
  catch(e){ console.error('[match] render', e); }
}
/** 训练计划交互卡(原生 domain · 真实 planFor 数据):里程碑时间线 + 资源 + 一键加入行动清单。 */
function renderPlanCardEl(skill, jobLabel){
  const p=planFor(skill); const esc=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const steps=(p.ms||[]).map((t,i)=>`<div class="pc-step"><span class="pc-idx">${String(i+1).padStart(2,'0')}</span><span class="pc-ms">${esc(t)}</span></div>`).join('');
  const res=(p.res||[]).map(r=>`<span class="chip">${esc(r)}</span>`).join('');
  const card=el(`<div class="cop-card plan-card">
    <div class="pc-head"><div class="pc-title">${tt('训练计划','Training plan')} · ${esc(skill)}</div>
      <div class="pc-badge">${tt('约 ','~')}${p.weeks} ${tt('周','wk')} · ${(p.ms||[]).length} ${tt('里程碑','steps')}</div></div>
    <div class="pc-timeline">${steps}</div>
    <div class="pc-res"><div class="pc-lbl">${tt('推荐资源','Resources')}</div><div class="pc-chips">${res}</div></div>
    <div class="cop-actions pc-acts"></div></div>`);
  const acts=card.querySelector('.pc-acts');
  const mk=(label,fn,accent)=>{ const b=el(`<button class="btn${accent?' btn-accent':''}">${label}</button>`); b.onclick=fn; acts.appendChild(b); };
  mk(tt('加入行动清单','Add to actions')+' →', ()=>{ if(typeof copPlan==='function') copPlan(skill, jobLabel||''); else if(typeof genPlanFromGap==='function'){ genPlanFromGap(skill, jobLabel||''); try{renderActions();renderOverview();}catch(_e){} if(typeof go==='function') go('actions'); } }, true);
  return card;
}
function showPlanCard(bubble, plan, who){
  const skill = plan && plan.skill!=null ? String(plan.skill).trim() : '';
  if(!skill) return; // 无技能名:静默(文字计划仍在)
  try{ const card=renderPlanCardEl(skill, plan.jobLabel||''); const host=(bubble&&bubble.parentElement)||bubble; if(host){ host.appendChild(card); } }
  catch(e){ console.error('[plan] render', e); }
}
/** 面试题交互卡(原生 · genQuestionsFor 真实题目):题目列表 + 去模拟面试。 */
function renderInterviewCardEl(job){
  const esc=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const qs=(typeof genQuestionsFor==='function'?genQuestionsFor(job,4):[]);
  const role=String(job.role||'').split('·')[0].trim();
  const CAT={project:tt('项目深挖','Project'),design:tt('系统设计','Design'),perf:tt('性能/算法','Perf'),dist:tt('分布式','Dist'),behavior:tt('行为面','Behavior')};
  const items=qs.map((q,i)=>`<div class="iv-q"><div class="iv-qtop"><span class="iv-idx">${String(i+1).padStart(2,'0')}</span><span class="iv-cat">${esc(CAT[q.cat]||q.cat||'')}</span></div><div class="iv-qt">${esc(q.text)}</div></div>`).join('')
    || `<p style="color:var(--ink-3);padding:6px 0;">${tt('暂无题目。','No questions.')}</p>`;
  const card=el(`<div class="cop-card iv-card">
    <div class="iv-head"><div class="iv-title">${tt('面试题','Interview prep')} · ${esc(job.co)} · ${esc(role)}</div><div class="iv-badge">${qs.length} ${tt('题','Q')}</div></div>
    <div class="iv-list">${items}</div>
    <div class="cop-actions iv-acts"></div></div>`);
  const b=el(`<button class="btn btn-accent">${tt('去模拟面试','Mock interview')} →</button>`);
  b.onclick=()=>{ if(typeof copInterview==='function') copInterview(job.id); else if(typeof goInterview==='function') goInterview(job.id); };
  card.querySelector('.iv-acts').appendChild(b);
  return card;
}
function showInterviewCard(bubble, data, who){
  const find=k=>JOBS.find(j=>String(j.id)===String(k));
  let job=find(data.jobId); if(!job && typeof matchState==='object'&&matchState) job=find(matchState.jobId);
  if(!job) return;
  try{ const card=renderInterviewCardEl(job); const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card); }catch(e){ console.error('[iv] render', e); }
}
/** 跨目标岗位的能力缺口聚合:某技能 lvl<3 且被几个目标岗位需要,按需求数排序。 */
function topGapsAcrossJobs(limit){
  const map={};
  for(const j of JOBS){ for(const n of (j.need||[])){ const s=skillByName(n); const lvl=s?s.lvl:0; if(lvl<3){ if(!map[n]) map[n]={skill:n, lvl, jobs:0}; map[n].jobs++; } } }
  return Object.values(map).sort((a,b)=> b.jobs-a.jobs || a.lvl-b.lvl).slice(0, limit||5);
}
/** 市场价值交互卡(原生 · 真实数据):年包估算 + 带位 + 最高杠杆动作(取自跨岗缺口)+ 完整报告。 */
function renderValueCardEl(){
  const esc=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const gaps=topGapsAcrossJobs(3);
  const moves=gaps.map(g=>`<div class="vc-move"><span class="vc-dot"></span><span>${tt('补齐 ','Fill ')}<b>${esc(g.skill)}</b> · ${g.jobs} ${tt('个目标岗位需要','jobs need it')}</span></div>`).join('')
    || `<p style="font-size:12.5px;color:var(--ink-3);">${(JOBS&&JOBS.length)?tt('暂无明显短板。','No clear gaps.'):tt('添加目标岗位后给出杠杆动作。','Add target jobs to see leverage moves.')}</p>`;
  const card=el(`<div class="cop-card value-card">
    <div class="vc-head"><div class="vc-lbl">${tt('综合市场价值 · 年包','Market value · annual')}</div>
      <div class="vc-num"><span class="v">${YOU_VALUE}</span><span class="u">${tt('万 / 年','w/yr')}</span></div>
      <div class="vc-band">${tt('后端 · 高级带中上沿','Senior Backend · upper-mid')}</div></div>
    <div class="vc-moves"><div class="vc-mlbl">${tt('最高杠杆动作','Highest-leverage moves')}</div>${moves}</div>
    <div class="cop-actions vc-acts"></div></div>`);
  const b=el(`<button class="btn btn-accent">${tt('看完整报告','Full report')} →</button>`);
  b.onclick=()=>{ if(typeof copMarket==='function') copMarket(); else if(typeof openMarketValue==='function') openMarketValue(); };
  card.querySelector('.vc-acts').appendChild(b);
  return card;
}
function showValueCard(bubble, data, who){
  try{ const card=renderValueCardEl(); const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card); }catch(e){ console.error('[value] render', e); }
}
/** 能力缺口交互卡(原生 · 跨岗聚合):每项缺口 lvl + 几岗需要 + 排计划;底部去智能匹配。 */
function renderGapsCardEl(){
  const esc=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const gaps=topGapsAcrossJobs(5);
  const rows=gaps.map(g=>`<div class="gc-row"><div class="gc-skill">${esc(g.skill)}</div><div class="gc-meta"><span>lvl ${g.lvl}/4</span><span class="gc-jobs">${g.jobs} ${tt('岗需要','jobs')}</span></div><button class="btn" data-gapskill="${esc(g.skill)}" style="padding:3px 9px;font-size:11px;flex-shrink:0;">${tt('排计划','Plan')}</button></div>`).join('')
    || `<p style="color:var(--ink-3);padding:8px 0;">${(JOBS&&JOBS.length)?tt('目标岗位的硬性要求你都已具备 👏','You already meet all hard requirements 👏'):tt('还没有目标岗位 —— 先添加岗位,再看能力缺口。','No target jobs yet — add a job to see your gaps.')}</p>`;
  const card=el(`<div class="cop-card gaps-card">
    <div class="gc-head"><div class="gc-title">${tt('能力缺口 · 按目标岗位需求排序','Skill gaps · by demand')}</div></div>
    <div class="gc-list">${rows}</div>
    <div class="cop-actions gc-acts"></div></div>`);
  [...card.querySelectorAll('[data-gapskill]')].forEach(b=>b.onclick=()=>{ if(typeof copPlan==='function') copPlan(b.dataset.gapskill, ''); });
  const b=el(`<button class="btn btn-accent">${tt('看智能匹配','Smart match')} →</button>`);
  b.onclick=()=>{ if(typeof copGo==='function') copGo('match'); else if(typeof go==='function') go('match'); };
  card.querySelector('.gc-acts').appendChild(b);
  return card;
}
function showGapsCard(bubble, data, who){
  try{ const card=renderGapsCardEl(); const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card); }catch(e){ console.error('[gaps] render', e); }
}
/** 「下一步最该做的一件事」推荐:进行中(按 pri)→ 待开始 → 任意;无则 null。 */
function recommendNextAction(){
  const pr={high:0,mid:1,low:2};
  return ACTIONS.filter(a=>a.state==='doing').sort((a,b)=>pr[a.pri]-pr[b.pri])[0] || ACTIONS.find(a=>a.state==='todo') || ACTIONS[0] || null;
}
/** 总览「下一步」阶段自适应(评审 P0-4):有行动→最该做的;无行动且无岗位→录岗位;有岗位无行动→做匹配找缺口。 */
function nextStep(){
  const a=recommendNextAction();
  if(a) return { title:a.title, desc:(a.cap?(tt('练 ','Train ')+a.cap+' · '):'')+(a.goal||tt('持续推进,保持节奏。','Keep the momentum.')), ctaLabel:tt('去完成','Go do it'), ctaGo:'actions' };
  if(!JOBS.length) return { title:tt('从添加一个目标岗位开始','Start by adding a target job'), desc:tt('录入岗位 → 分析缺口 → AI 给你下一步该做的事。','Add a job → analyze gaps → the AI suggests your next move.'), ctaLabel:tt('添加岗位','Add a job'), ctaGo:'jobs' };
  return { title:tt('做一次智能匹配,看清你的缺口','Run a smart match to see your gaps'), desc:tt('挑一个岗位,AI 算出匹配度与该补的能力,再一键排进行动。','Pick a job; AI computes your fit and what to build, then turn it into actions.'), ctaLabel:tt('智能匹配','Smart match'), ctaGo:'match' };
}
/** 回访 calm 摘要(评审 P1-10):平静呈现当前推进(无红 / 无倒计时 / 不施压);无活动则空。 */
function calmDigest(){
  if(!JOBS.length) return '';
  const inPlay=JOBS.filter(j=>['fav','todo','sent','interview'].includes(j.status)).length;
  const doing=ACTIONS.filter(a=>a.state==='doing').length;
  const mins=ACTIONS.reduce((s,a)=>s+((a.sessions||[]).reduce((x,ss)=>x+(+ss.mins||0),0)),0);
  const parts=[];
  if(inPlay) parts.push(tt(inPlay+' 个岗位在跟进', inPlay+' jobs in play'));
  if(doing) parts.push(tt(doing+' 项行动进行中', doing+' actions in progress'));
  if(mins>=30) parts.push(tt('累计训练 '+(mins/60).toFixed(1)+'h', (mins/60).toFixed(1)+'h trained'));
  return parts.length ? tt('你在稳步推进 · ','Steady progress · ')+parts.join(' · ') : '';
}
/** 下一步轻卡(原生 · 真实 ACTIONS):最该做的一件事 + CTA;无行动则引导智能匹配。 */
function renderNextCardEl(){
  const esc=s=>String(s==null?'':s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const a=recommendNextAction();
  const sub = a ? (a.goal?esc(a.goal):(a.cap?(tt('练 ','Train ')+esc(a.cap)+(a.jobs?(' · '+esc(a.jobs)):'')):'')) : '';
  const card=el(`<div class="cop-card next-card">
    <div class="nx-lbl">${tt('下一步 · 最该做的一件事','Next · the one thing')}</div>
    <div class="nx-title">${a?esc(a.title):tt('先选个目标,让 AI 给你排下一步','Pick a target — AI will plan your next move')}</div>
    ${sub?`<div class="nx-goal">${sub}</div>`:''}
    <div class="cop-actions nx-acts"></div></div>`);
  const acts=card.querySelector('.nx-acts');
  const mk=(label,fn,accent)=>{ const b=el(`<button class="btn${accent?' btn-accent':''}">${label}</button>`); b.onclick=fn; acts.appendChild(b); };
  const goP=id=>{ if(typeof copGo==='function') copGo(id); else if(typeof go==='function') go(id); };
  if(a){ mk(tt('打开行动清单','Open actions')+' →', ()=>goP('actions'), true); mk(tt('智能匹配','Smart match'), ()=>goP('match')); }
  else { mk(tt('智能匹配','Smart match')+' →', ()=>goP('match'), true); mk(tt('看职业资产','My assets'), ()=>goP('skills')); }
  return card;
}
function showNextCard(bubble, data, who){
  try{ const card=renderNextCardEl(); const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card); }catch(e){ console.error('[next] render', e); }
}
/** 机会来源卡(发现 agent · P1):AI 经搜索工具整理的真实岗位来源。
   红线:url 只显示为文本 + 经 rt.web.open(平台核 scheme 校验)在系统浏览器打开 —— **绝不进 DOM 链接 / 不在应用内导航 / 不可信外链不入 WebView**。 */
function renderJobSourcesEl(data){
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const sources=(data.sources||[]).filter(s=>s&&s.url&&/^https?:\/\//i.test(String(s.url)));
  const rows=sources.map((s,i)=>{
    const url=String(s.url||''); const host=(url.match(/^https?:\/\/([^\/?#]+)/i)||[])[1]||url;
    const kind=s.kind?`<span class="mono" style="font-size:9.5px;color:var(--ink-3);border:0.5px solid var(--border);border-radius:3px;padding:0 4px;">${esc(s.kind)}</span> `:'';
    return `<div style="padding:9px 0;border-bottom:0.5px solid var(--border);"><div style="display:flex;gap:10px;align-items:flex-start;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13.5px;color:var(--ink);font-weight:500;">${kind}${esc(s.company||host)}${s.role?` · ${esc(s.role)}`:''}${s.fit?` <span class="mono" style="font-size:9.5px;color:var(--accent);border:0.5px solid var(--accent);border-radius:3px;padding:0 4px;">${tt('契合','fit')} ${esc(s.fit)}</span>`:''}</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><span data-srcstatus="${i}">${tt('验链中…','checking…')}</span> · ${esc(host)}</div>
        ${s.why?`<div style="font-size:12px;color:var(--ink-2);margin-top:4px;line-height:1.6;">${esc(s.why)}</div>`:''}
      </div>
      <button class="btn" data-opensrc="${i}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('在浏览器打开','Open')} ↗</button></div></div>`;
  }).join('');
  const card=el(`<div class="cop-card">
    <div style="font-size:13px;color:var(--ink);font-weight:600;">${tt('机会来源 · 在你自己的浏览器打开','Opportunity sources · open in your browser')} <span style="font-family:var(--font-mono);font-style:normal;font-size:11px;color:var(--ink-3);">${sources.length}</span></div>
    <div style="font-size:11px;color:var(--ink-3);margin:3px 0 6px;line-height:1.5;">${tt('来自外部搜索 · 链接未经核实;点开在你的浏览器查看,合适的可「扔回」录入框抓取。','From external search · links unverified; open in your browser, and throw a good one back into the entry box to fetch it.')}</div>
    ${rows||`<p style="color:var(--ink-3);padding:8px 0;">${tt('没有可展示的来源','No sources to show')}</p>`}</div>`);
  [...card.querySelectorAll('[data-opensrc]')].forEach(b=>b.onclick=()=>{
    const s=sources[+b.dataset.opensrc]; if(!s) return;
    const rt=window.SeekerRT;
    if(rt&&rt.web&&rt.web.open) rt.web.open(String(s.url)).catch(e=>toast(String((e&&e.message)||e)));
  });
  return card;
}
function showJobSources(bubble, data, who){
  try{ const card=renderJobSourcesEl(data); const host=(bubble&&bubble.parentElement)||bubble; if(host) host.appendChild(card); verifyJobSources(card, data); }catch(e){ console.error('[job-sources] render', e); }
}
/** 渲染后自动验链(P2):平台核受控抓取(rt.web.verifySources)逐个验存活 → 标「有效/已失效」、死链禁打开。
   模型不参与抓取(web 出口非 AI 能力);死链多为模型臆造/已下架,标出来避免用户白点。 */
async function verifyJobSources(card, data){
  const rt=window.SeekerRT; if(!card||!rt||!rt.web||!rt.web.verifySources) return;
  const sources=(data.sources||[]).filter(s=>s&&s.url&&/^https?:\/\//i.test(String(s.url)));
  if(!sources.length) return;
  let results=[]; try{ results=await rt.web.verifySources(sources.map(s=>String(s.url))); }catch(_e){ return; }
  const byUrl={}; for(const r of (results||[])) byUrl[r.url]=r;
  sources.forEach((s,i)=>{
    const st=card.querySelector(`[data-srcstatus="${i}"]`); if(!st) return;
    const r=byUrl[String(s.url)];
    if(!r){ st.textContent=''; return; }
    if(r.ok){ st.innerHTML=`<span style="color:var(--status-done);">${tt('链接有效','live')}</span>`; }
    else {
      st.innerHTML=`<span style="color:var(--ink-3);">${tt('链接已失效','dead')}</span>`;
      const ob=card.querySelector(`[data-opensrc="${i}"]`);
      if(ob){ ob.disabled=true; ob.style.opacity='0.45'; ob.title=tt('链接已失效','Link is dead'); }
    }
  });
}
/** 卡注册表(jobseek 的卡实现束):AI 出 ```seeker:<kind> 块 → 用真实数据渲染。**新增卡只在此登记一行 + frameQuery 加指令**。
 *  多应用平台(阶段1):经 apps/jobseek/manifest.js 贡献给壳;消费方(streamReply/hydrateMessages)走 window.SeekerShell.cards() 组合。 */
const SEEKER_CARDS = {
  // persist=true 的「视图卡」会随消息存指令、重启后用实时数据重渲;resume-edit 是一次性护栏提案,不持久(否则重渲会重复提议)。
  'resume-edit':    { valid: d=>Array.isArray(d.edits) && d.edits.length>0, show: showResumeProposal },
  'match-card':     { valid: d=>d.jobId!=null, show: showMatchCard,     persist:true },
  'plan-card':      { valid: d=>d.skill!=null, show: showPlanCard,      persist:true },
  'interview-card': { valid: d=>d.jobId!=null, show: showInterviewCard, persist:true },
  'value-card':     { valid: ()=>true,         show: showValueCard,     persist:true },
  'gaps-card':      { valid: ()=>true,         show: showGapsCard,      persist:true },
  'next-card':      { valid: ()=>true,         show: showNextCard,      persist:true },
  'job-sources':    { valid: d=>Array.isArray(d.sources) && d.sources.length>0, show: showJobSources, persist:true },
  // 块4:AI 对话式 CRUD 提案(非持久 —— 一次性动作,重渲会重复提议;落库扳机在用户,改/删走 guardrail)。
  'job-create':     { valid: d=>!!(d && (d.co||d.role)),                                  show: showJobCreateProposal },
  'job-update':     { valid: d=>!!(d && d.id!=null && Array.isArray(d.changes) && d.changes.length), show: showJobUpdateProposal },
  'job-delete':     { valid: d=>!!(d && d.id!=null),                                       show: showJobDeleteProposal },
};
