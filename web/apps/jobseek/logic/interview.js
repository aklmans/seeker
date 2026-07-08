// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 面试陪练(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../monolith-globals.d.ts。 */
/* ---------- INTERVIEW (旗舰) ---------- */
export let ivState={jobId:JOBS[0].id, tab:'bank', cat:'全部', search:'', q:null, round:null, summary:null};  // mutated-property(仅 .k= mutate,含 resumes.js 跨文件写)→ dual-publish 免访问器;JOBS[0] 于 module-eval 急读 window.JOBS(★批6:data.js 已 module@929、tag-order 先 eval 设 JOBS 桥;本 module@1052 在其后 → 就绪)
/* ★ivRec(语音识别句柄,reassigned)所有权移入 resumes.js:其生命周期全在 resumes.js(ivToggleVoice/ivStopVoice/ivVoiceDemo),interview.js 从不引用;移后 resumes 内私有,消除跨文件 reassigned 纠缠(否则需 setter 原子翻转)。 */
export function renderInterview(){
  // 面试岗位与目标岗位一一对应:只取活跃岗位(排除 放弃/拒绝;与岗位列表口径一致),空则引导先加岗位(修 jb.co 空崩)。
  const activeJobs=JOBS.filter(j=>!['skip','reject'].includes(j.status));
  if(!activeJobs.length){
    $('#page-interview').innerHTML=frontis('INTERVIEW',tt('面试陪练','Interview prep'))+
      `<div class="sec" style="border-bottom:none;"><div class="guide-step" style="border-bottom:none;"><span class="gnum">— ${tt('空','EMPTY')}</span><div><h3>${tt('添加目标岗位后开始针对性练习','Add a target job to start tailored practice')}</h3><p style="max-width:600px;">${tt('面试陪练围绕你的目标岗位 + 简历展开,各公司风格不同。先添加一个岗位(放弃 / 拒绝的不计),再来这里针对性练。','Interview prep revolves around your target jobs + resume; each company differs. Add a job (skipped / rejected ones excluded), then come back for tailored practice.')}</p><button class="btn btn-accent" style="margin-top:14px;" onclick="go('jobs')">${tt('+ 录入岗位','+ Add a job')}</button></div></div></div>`+signFoot();
    return;
  }
  const jobPills=activeJobs.map(x=>`<button class="pill ${x.id===ivState.jobId?'on':''}" data-ij="${x.id}">${cEsc(x.co)} · ${cEsc(x.role.split('·')[0].trim())}</button>`).join('');
  let jb=activeJobs.find(x=>x.id===ivState.jobId); if(!jb){ jb=activeJobs[0]; ivState.jobId=jb.id; } // null-safe:默认首个活跃岗位
  const st=styleFor(jb.co);
  const styleLine=`<div class="style-line"><span class="sl-co">${tt(cEsc(jb.co)+' 面试风格',cEsc(jb.co)+' style')}</span>${st.tags.map(t=>`<span class="chip">${t}</span>`).join('')}<span class="sl-note">${st.note}</span></div>`;
  const setup=`<div class="sec">
    <p class="seclabel">— SETUP</p><h2 class="sectitle">${tt('选岗位 · 先备一份针对性简历','Pick a job · prep a tailored resume')}<span class="dot">.</span></h2>
    <p style="font-size:13px;color:var(--ink-3);margin:6px 0 0;max-width:700px;line-height:1.7;">${tt('真实面试大多是面试官拿着你的<b>简历 + JD</b>提问,各公司风格也不同。先让 AI 按目标岗位和你的职业资产生成一份针对性简历(可编辑、可标记擅长),面试就会围绕它来问。','Real interviews mostly run off your <b>resume + JD</b>, and each company differs. Let AI build a tailored resume from the target job and your assets (editable, mark your strengths) — the interview will revolve around it.')}</p>
    <div class="pillrow" style="margin-top:16px;">${jobPills}</div>
    ${styleLine}
    <div style="margin-top:14px;">${ivResumeRef(jb)}</div>
    <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;"><button class="btn btn-accent" id="ivRound">${tt('开始整轮模拟面试','Start full mock interview')} →</button><button class="btn" id="ivGen">${tt('按简历出 3 道新题','3 new questions from resume')}</button><button class="btn" id="ivAdd">${tt('+ 添加我自己的题','+ Add my own question')}</button></div>
  </div>`;
  let inner;
  if(ivState.summary){ inner=setup+`<div class="sec" style="border-bottom:none;" id="ivStage"></div>`; }
  else if(ivState.q){ inner=setup+`<div class="sec" style="border-bottom:none;" id="ivStage"></div>`; }
  else{
    const tabbar=`<div class="tabs"><button class="tab ${ivState.tab==='bank'?'on':''}" data-it="bank">${tt('题库','Question bank')} (${IV_BANK.length})</button><button class="tab ${ivState.tab==='records'?'on':''}" data-it="records">${tt('练习记录','Practice records')} (${IV_RECORDS.length})</button></div>`;
    inner=setup+tabbar+`<div class="sec" style="border-bottom:none;padding-top:8px;">${ivState.tab==='bank'?ivBankHTML():ivRecordsHTML()}</div>`;
  }
  $('#page-interview').innerHTML=frontis('INTERVIEW',tt('面试陪练','Interview prep'))+inner+signFoot();
  $$('#page-interview [data-ij]').forEach(b=>b.onclick=()=>{ivStopVoice();ivState.jobId=+b.dataset.ij;renderInterview();});
  $$('#page-interview [data-it]').forEach(b=>b.onclick=()=>{ivState.tab=b.dataset.it;ivState.search='';renderInterview();});
  const g=$('#ivGen'); if(g)g.onclick=ivGenerate;
  const a=$('#ivAdd'); if(a)a.onclick=ivAddQuestion;
  const rd=$('#ivRound'); if(rd)rd.onclick=ivStartRound;
  if(ivState.summary) ivRenderSummary();
  else if(ivState.q) ivPractice();
  else if(ivState.tab==='bank') ivBindBank();
  else ivBindRecords();
}
function ivResumeRef(j){
  const r=RESUME_TAILORED[j.id];
  if(r){
    const projs=resProjects(r); const skills=resSkills(r); const starN=projs.filter(p=>p.star).length;
    const onCount=r.modules.filter(m=>m.on).length;
    return `<div class="rb-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:220px;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span class="acbadge ac-compound">${tt('已绑定简历','Resume bound')}</span><span style="font-size:13px;color:var(--ink-2);">${tt('针对 '+cEsc(j.co),'for '+cEsc(j.co))}</span></div>
        <p style="font-size:13px;color:var(--ink-2);margin:10px 0 0;line-height:1.65;">${cEsc(shorten(resSummary(r),76))}</p>
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3);margin:8px 0 0;">${tt(onCount+' 个模块 · '+skills.length+' 项技能 · '+starN+' 个 ★ 擅长',onCount+' modules · '+skills.length+' skills · '+starN+' ★ strengths')}</p></div>
      <button class="btn" onclick="resumeState.jobId=${j.id};go('resumes')">${tt('编辑简历','Edit resume')} →</button></div>
      <p style="font-size:12px;color:var(--ink-mute);margin:12px 0 0;line-height:1.6;">${tt('面试将围绕这份简历与 JD 提问 —— ★ 擅长会被重点深挖。简历在「简历」模块统一管理。','The interview revolves around this resume + JD — ★ strengths get probed. Manage resumes in the Resume module.')}</p></div>`;
  }
  return `<div class="rb-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
    <div><div style="font-size:14px;color:var(--ink);font-weight:500;">${tt('还没有针对 '+cEsc(j.co)+' 的简历','No resume for '+cEsc(j.co)+' yet')}</div><div style="font-size:12.5px;color:var(--ink-3);margin-top:4px;line-height:1.6;">${tt('带简历面试更贴合(面试官会拿着它问)—— 没有简历也能直接训练。','Interviewing with a resume fits better (the interviewer uses it) — but you can train without one.')}</div></div>
    <button class="btn btn-accent" onclick="resumeState.jobId=${j.id};go('resumes')">${tt('去生成简历','Generate resume')} →</button></div></div>`;
}

/* 过渡 window 桥:renderInterview 经 manifest/cards/persistence/resumes/jobs 消费;ivState mutated dual-publish(resumes.js 跨文件 mutate .k= 同引用安全)。ivResumeRef 私有。ivRec 已移 resumes.js。 */
window.renderInterview=renderInterview; window.ivState=ivState;
