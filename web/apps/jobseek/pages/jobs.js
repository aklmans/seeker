// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 目标岗位页(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../../monolith-globals.d.ts。 */
/* ---------- JOBS ---------- */
let jobFilter={city:'全部', status:'全部'};
let selectedJob=null;
function renderJobs(){
  syncNavCounts();
  const cities=['全部','北京','上海','深圳','杭州'];
  const statuses=[['全部','全部'],['fav','收藏'],['todo','待投'],['sent','已投'],['interview','面试'],['reject','拒绝']];
  const filterbar=`<div class="filterbar">
    <div class="filtergroup"><span class="fl">${tt('城市','City')}</span>${cities.map(c=>`<button class="fopt ${jobFilter.city===c?'on':''}" data-fc="${c}">${c==='全部'?tt('全部','All'):c}</button>`).join('')}</div>
    <div class="filtergroup"><span class="fl">${tt('状态','Status')}</span>${statuses.map(s=>`<button class="fopt ${jobFilter.status===s[0]?'on':''}" data-fs="${s[0]}">${s[0]==='全部'?tt('全部','All'):s[1]}</button>`).join('')}</div>
  </div>`;
  const rows=JOBS.filter(j=>(jobFilter.city==='全部'||j.city===jobFilter.city)&&(jobFilter.status==='全部'||j.status===jobFilter.status)).map(j=>{
    const st=STATUS[j.status];
    const chips=j.need.slice(0,3).map(n=>`<span class="chip">${cEsc(n)}</span>`).join('')+(j.need.length>3?`<span class="chip" style="border:none;color:var(--ink-mute);">+${j.need.length-3}</span>`:'');
    return `<tr data-job="${j.id}">
      <td class="idx">${String(j.id).padStart(2,'0')}</td>
      <td><span class="co">${cEsc(j.co)}</span></td>
      <td>${cEsc(j.role)}</td>
      <td class="mono" style="font-size:12px;color:var(--ink-3);">${cEsc(j.city)}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td class="num-cell">${j.interest.toFixed(1)}<small>/10</small></td>
      <td class="num-cell">${j.match.toFixed(1)}<small>/10</small></td>
      <td class="mono" style="font-size:12px;color:var(--ink-2);">${cEsc(j.pay)}</td>
      <td style="white-space:nowrap;"><div style="display:flex;gap:5px;flex-wrap:wrap;max-width:170px;">${chips}</div></td>
    </tr>`;
  }).join('');
  const table=`<div class="sec" style="border-bottom:none;">
    <div class="matrix-wrap" style="overflow-x:auto;border:0.5px solid var(--border);">
    <table style="min-width:880px;">
      <thead><tr><th style="width:44px;">#</th><th>${tt('公司','Company')}</th><th>${tt('岗位','Role')}</th><th>${tt('城市','City')}</th><th>${tt('状态','Status')}</th><th>${tt('兴趣','Interest')}</th><th>${tt('匹配','Match')}</th><th>${tt('薪资','Pay')}</th><th>${tt('关键技能','Key skills')}</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:30px;">${JOBS.length?tt('没有符合条件的岗位','No matching jobs'):tt('还没有岗位 — 点上方「+ 新增岗位」添加第一个目标岗位开始','No jobs yet — add your first target job to get started')}</td></tr>`}</tbody>
    </table></div>
    <p style="font-size:12px;color:var(--ink-3);margin-top:12px;">${tt('共 '+JOBS.length+' 个岗位 · 点击任意行查看完整 JD 与匹配分析', JOBS.length+' jobs · click a row for full JD & match analysis')}</p>
  </div>`;
  $('#page-jobs').innerHTML=frontis('JOBS',tt('目标岗位','Jobs'))+filterbar+table+signFoot();
  $$('#page-jobs [data-fc]').forEach(b=>b.onclick=()=>{jobFilter.city=b.dataset.fc;renderJobs();});
  $$('#page-jobs [data-fs]').forEach(b=>b.onclick=()=>{jobFilter.status=b.dataset.fs;renderJobs();});
  $$('#page-jobs tr[data-job]').forEach(r=>r.onclick=()=>openJobDetail(+r.dataset.job, r));
}

// 投递时间线(评审 P2-13):per-job 纯记录日志,严守反焦虑 —— 无倒计时、无截止红色,只是"投了哪些 / 几轮 / 何时跟进"。
function jobTimelineRows(j){
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const tl=Array.isArray(j.timeline)?j.timeline:[];
  return tl.length
    ? tl.map((e,i)=>`<div style="display:flex;gap:12px;align-items:baseline;padding:7px 0;border-bottom:0.5px solid var(--border);"><span class="mono" style="font-size:11px;color:var(--accent);white-space:nowrap;flex-shrink:0;min-width:42px;">${esc(e.date||'')}</span><span style="flex:1;font-size:13px;color:var(--ink-2);">${esc(e.note||'')}</span><button class="btn-text" data-tldel="${i}" style="font-size:11px;color:var(--ink-3);flex-shrink:0;">${tt('删','×')}</button></div>`).join('')
    : `<p style="font-size:13px;color:var(--ink-3);padding:6px 0;line-height:1.6;">${tt('还没有记录 —— 投了就记一笔:哪天投的、几轮了、何时跟进。纯记录,不催你。','Nothing logged yet — jot down milestones: applied date, interview rounds, follow-ups. Just a log, no pressure.')}</p>`;
}
function openJobDetail(id, row){
  selectedJob=id;
  $$('#page-jobs tr[data-job]').forEach(r=>r.classList.toggle('selected', +r.dataset.job===id));
  const j=JOBS.find(x=>x.id===id); const st=STATUS[j.status];
  const need=j.need.map(n=>`<span class="chip">${cEsc(n)}</span>`).join(' ');
  const plus=j.plus.map(n=>`<span class="chip">${cEsc(n)}</span>`).join(' ');
  // build match lines: for each need skill, check user's skill level
  const matchLines=j.need.map(n=>{
    const s=skillByName(n);
    if(s&&s.lvl>=3) return `<div class="match-line"><span class="mk ok">✓</span><span class="mt"><b>${cEsc(n)}</b> · ${tt(cEsc(s.years)+' 年','y'+cEsc(s.years))} · ${cEsc(s.evidence[0])||tt('有实践经验','has experience')}</span></div>`;
    if(s&&s.lvl>=1) return `<div class="match-line"><span class="mk par">○</span><span class="mt">${cEsc(n)} · ${tt('仅基础','basic only')} · <span style="color:var(--ink-3);">${tt('可补充','to add')}</span></span></div>`;
    return `<div class="match-line"><span class="mk par">○</span><span class="mt">${cEsc(n)} · ${tt('学习中','learning')} · <span style="color:var(--ink-3);">${tt('可补充','to add')}</span></span></div>`;
  }).join('');
  // top gap = first need skill with lvl<3
  const gapSkill=j.need.find(n=>{const s=skillByName(n);return !s||s.lvl<3;})||j.plus[0]||'—';
  const statusBtns=Object.values(STATUS).map(s=>`<button class="btn ${s.k===j.status?'btn-accent':''}" data-setstatus="${s.k}" style="padding:6px 12px;">${s.label}</button>`).join('');
  const html=`
    <div class="modal-head">
      <div><h2>${cEsc(j.co)} · ${cEsc(j.role)}</h2>
      <div class="sub"><span>${cEsc(j.city)}</span><span>·</span><span class="badge ${st.cls}">${st.label}</span><span>${tt('兴趣','Interest')} ${j.interest.toFixed(1)}</span><span>·</span><span>${tt('匹配','Match')} ${j.match.toFixed(1)}</span><span>·</span><span>${cEsc(j.pay)}</span></div></div>
      <div style="display:flex;gap:8px;align-items:flex-start;flex-shrink:0;">
        <button class="btn" id="jdEdit" style="padding:5px 11px;font-size:12px;">${tt('编辑','Edit')}</button>
        <button class="btn" id="jdDel" style="padding:5px 11px;font-size:12px;">${tt('删除','Delete')}</button>
        <button class="x">${IC.x}</button></div>
    </div>
    <div class="modal-body">
      <div style="display:flex;gap:28px;padding:6px 0 18px;border-bottom:0.5px solid var(--border);">
        ${[[tt('兴趣','Interest'),j.interest],[tt('成长','Growth'),j.growth],[tt('匹配','Match'),j.match],[tt('机会','Odds'),j.chance]].map(s=>`<div><p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.2em;color:var(--ink-3);margin:0;">${s[0]}</p><p style="font-family:var(--font-serif);font-size:24px;font-weight:500;margin:4px 0 0;color:var(--ink);">${s[1].toFixed(1)}<span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3);">/10</span></p></div>`).join('')}
      </div>
      ${aiMetaHtml(j)}
      <div class="msec"><p class="seclabel">— JD ORIGINAL</p><h3 class="sectitle" style="font-size:16px;margin-bottom:12px;">${tt('完整 JD','Full JD')}<span class="dot">.</span></h3><div class="jd-text">${cEsc(j.jd)}</div></div>
      <div class="msec"><p class="seclabel">— EXTRACTED</p><h3 class="sectitle" style="font-size:16px;margin-bottom:12px;">${tt('抽取的要求','Extracted requirements')}<span class="dot">.</span></h3>
        <p style="font-size:12px;color:var(--ink-3);margin:0 0 6px;">${tt('必需技能','Required skills')}</p><div style="display:flex;gap:6px;flex-wrap:wrap;">${need}</div>
        <p style="font-size:12px;color:var(--ink-3);margin:14px 0 6px;">${tt('加分技能','Bonus skills')}</p><div style="display:flex;gap:6px;flex-wrap:wrap;">${plus}</div>
        <div style="display:flex;gap:32px;margin-top:16px;font-size:13px;color:var(--ink-2);"><span>${tt('年限要求','Years')} · <b class="mono">${cEsc(j.years)}</b></span><span>${tt('学历','Education')} · <b class="mono">${cEsc(j.edu)}</b></span><span>${tt('来源','Source')} · <b class="mono">${cEsc(j.src)}</b></span></div>
      </div>
      <div class="msec"><p class="seclabel">— YOUR MATCH</p><h3 class="sectitle" style="font-size:16px;margin-bottom:8px;">${tt('个人匹配证据','Your match evidence')}<span class="dot">.</span></h3>${matchLines}</div>
      <div class="msec"><p class="seclabel">— AI ACTIONS</p><h3 class="sectitle" style="font-size:16px;margin-bottom:4px;">${tt('让 AI 帮你拿下它','Let AI help you land it')}<span class="dot">.</span></h3>
        <p style="font-size:12.5px;color:var(--ink-3);margin:0 0 12px;">${tt('不止诊断 —— 直接产出可用的简历、计划与面试练习:','Beyond diagnosis — produce a usable resume, plan, and interview practice:')}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn btn-accent" id="aiResume">${tt('生成定制简历','Tailored resume')}</button><button class="btn" id="aiPlan">${tt('生成训练计划','Training plan')}</button><button class="btn" id="aiIv">${tt('模拟面试','Mock interview')} →</button></div></div>
      <div class="msec"><p class="seclabel">— SUGGESTION</p><h3 class="sectitle" style="font-size:16px;margin-bottom:8px;">${tt('可补充方向','Suggested focus')}<span class="dot">.</span></h3>
        <p style="font-size:14px;color:var(--ink);margin:0;font-weight:500;">${tt(cEsc(gapSkill)+' 实战经验',cEsc(gapSkill)+' hands-on experience')}</p>
        <p style="font-size:13px;color:var(--ink-3);margin:6px 0 12px;">${tt('可补充: 在训练项目中加入 '+cEsc(gapSkill)+' 的生产实践,沉淀为可展示证据。','Add '+cEsc(gapSkill)+' to a training project as production practice, and turn it into demonstrable evidence.')}</p>
        <button class="btn-text" id="addToActions">${tt('一键加入行动清单','Add to action list')} →</button>
      </div>
      <div class="msec"><p class="seclabel">— STATUS</p><h3 class="sectitle" style="font-size:16px;margin-bottom:10px;">${tt('状态','Status')}<span class="dot">.</span></h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${statusBtns}</div></div>
      <div class="msec" style="border-bottom:none;"><p class="seclabel">— TIMELINE</p><h3 class="sectitle" style="font-size:16px;margin-bottom:4px;">${tt('申请时间线','Application timeline')}<span class="dot">.</span></h3>
        <p style="font-size:12.5px;color:var(--ink-3);margin:0 0 10px;">${tt('记录投递与进展 —— 纯日志,无倒计时、不催你。','Log your applications and progress — just a journal, no countdowns, no pressure.')}</p>
        <div id="jobTimeline">${jobTimelineRows(j)}</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;"><input class="input" id="tlDate" placeholder="${tt('日期 如 5/20','Date e.g. 5/20')}" style="max-width:120px;"><input class="input" id="tlNote" placeholder="${tt('如 · 投递 / 一面 / 等回复','e.g. applied / round 1 / waiting')}" style="flex:1;min-width:160px;"><button class="btn" id="tlAdd">${tt('记一笔','Log')}</button></div></div>
    </div>`;
  const m=openModal(html);
  $('#addToActions',m).onclick=()=>{genPlanFromGap(gapSkill, j.co+' · '+j.role.split('·')[0].trim());renderActions();renderOverview();closeModal();toast('已生成训练计划: 补齐 '+cEsc(gapSkill));go('actions');};
  // 手动 CRUD 完善:编辑(复用录入表单预填+更新)/ 删除(走 guardrail 预览+确认+撤销;同 widget delete-job 纪律)。
  const eb=$('#jdEdit',m); if(eb) eb.onclick=()=>{ closeModal(); openNewJob(j.id); };
  const db=$('#jdDel',m); if(db) db.onclick=()=>{ const G=window.SeekerGuardrail; if(!G||!G.confirmDestructive) return;
    const reJobs=()=>[renderJobs,renderOverview,renderAnalysis,renderInterview].forEach(f=>{try{f();}catch(_e){}});
    let snap=Object.assign({}, j);   // 内存兜底快照(web 无后端时也能撤销)
    G.confirmDestructive({ title:tt('删除岗位?','Delete job?'), detail:(tt('将删除:','Will delete: '))+j.co+' · '+j.role, confirmLabel:tt('删除','Delete'), undoText:tt('已删除岗位','Job deleted'),
      onConfirm:async()=>{ try{ if(window.SeekerRT) snap=(await window.SeekerRT.db.remove('jobs', String(j.id)))||snap; }catch(_e){} const i=JOBS.findIndex(x=>x.id===j.id); if(i>=0) JOBS.splice(i,1); closeModal(); reJobs(); },
      onUndo:async()=>{ try{ if(window.SeekerRT) await window.SeekerRT.db.upsert('jobs', snap); }catch(_e){} if(!JOBS.some(x=>x.id===snap.id)) JOBS.unshift(snap); reJobs(); } });
  };
  $('#aiResume',m).onclick=()=>aiResumeForJob(j.id);
  $('#aiPlan',m).onclick=()=>{genPlanFromGap(gapSkill, j.co+' · '+j.role.split('·')[0].trim());renderActions();renderOverview();closeModal();toast('已生成「'+cEsc(gapSkill)+'」训练计划');go('actions');};
  $('#aiIv',m).onclick=()=>goInterview(j.id);
  $$('[data-setstatus]',m).forEach(b=>b.onclick=()=>{j.status=b.dataset.setstatus;toast('状态已更新: '+STATUS[j.status].label);closeModal();renderJobs();renderOverview();});
  // 投递时间线:记一笔 / 删一笔 → 写 j.timeline + persistJob(随岗位持久化)+ 就地重渲(不重建整模态)。
  const redrawTl=()=>{ const c=$('#jobTimeline',m); if(!c) return; c.innerHTML=jobTimelineRows(j);
    c.querySelectorAll('[data-tldel]').forEach(b=>b.onclick=()=>{ if(Array.isArray(j.timeline)) j.timeline.splice(+b.dataset.tldel,1); persistJob(j); redrawTl(); }); };
  redrawTl();
  const tlAdd=$('#tlAdd',m); if(tlAdd) tlAdd.onclick=()=>{
    const d=(($('#tlDate',m)||{}).value||'').trim(), nt=(($('#tlNote',m)||{}).value||'').trim();
    if(!d&&!nt){ toast(tt('填日期或内容再记','Add a date or note first')); return; }
    if(!Array.isArray(j.timeline)) j.timeline=[];
    j.timeline.push({date:d, note:nt}); persistJob(j);
    if($('#tlDate',m))$('#tlDate',m).value=''; if($('#tlNote',m))$('#tlNote',m).value='';
    redrawTl();
  };
}
