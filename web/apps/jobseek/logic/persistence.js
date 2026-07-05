// @ts-nocheck —— 抽壳序4-d-2 择取:jobseek 数据持久化 + 水合层(jobs/resumes + 编排)。逻辑零改动。
/** jobseek · 数据持久化/水合:nextJobId/persistJob/hydrateJobs(+rt-ready)、persistResume/removeResume/clearAllTailoredResumes/hydrateResumes、hydrateBizColls(+rt-ready)。
 *  依赖:平台 jobsPersistOn/collPersistOn/persistColl/hydrateColl/markOnboarded(data-store 序4-b/4-d-1)、hydrateMessages(copilot-chrome 序3-d-13)、rerenderPages(nav);
 *  jobseek JOBS/SKILLS/ACTIONS/IV_RECORDS/RESUME_TAILORED/MASTER(data.js)、renderX 渲染器、toast/tt(平台)、SeekerRT/SeekerGuardrail(rt)。
 *  ⚠ rt-ready 时序不变式:本文件是 classic <script src>、解析期执行 → addEventListener('seeker-rt-ready', …) 在模块脚本(deferred)dispatch 之前注册(同第5轮时序法)。
 *  ★red-line(逐字保留):resumes 集合只存专业模块结构、**联系方式绝不入 resumes**(走独立 profile 实时渲染)→ query_data('resumes') 天然不含联系方式。 */

/* ===== #3 D1b:jobs 数据走仓库(桌面持久化;web 沿用内存 mock) ===== */
function nextJobId(){ return Math.max(0, ...JOBS.map(j=>+j.id||0)) + 1; }
function persistJob(job){ if(jobsPersistOn()) window.SeekerRT.db.upsert('jobs', job).catch(e=>console.error('[data] upsert job', e)); }
async function hydrateJobs(){
  if(!jobsPersistOn()) return;
  try{
    const rows = await window.SeekerRT.db.list('jobs');
    JOBS.length=0;                                      // 不再静默播种(评审):首启 DB 空 → 内存也空 → 落地页
    if(rows.length){ markOnboarded(); JOBS.push(...rows); } // 有数据 = 已上手,水合(否则留空,等用户在落地页选择)
    [renderOverview, renderJobs, renderAnalysis].forEach(f=>{try{f();}catch(_e){}});
  }catch(e){ console.error('[data] jobs 水合失败', e); }
}
window.addEventListener('seeker-rt-ready', hydrateJobs);

/* resumes 红线安全持久化:只存专业模块结构(modules 含 basic/locked 标记但**无 PROFILE 内容**);
   联系方式始终从独立 profile 实时渲染、**绝不入 resumes 集合**,故 query_data('resumes') 天然不含联系方式。 */
function persistResume(jobId){
  if(!collPersistOn()) return;
  const r = RESUME_TAILORED[jobId]; if(!r) return;
  window.SeekerRT.db.upsert('resumes', { id:'r_'+jobId, jobId:jobId, template:r.template, modules:r.modules })
    .catch(e=>console.error('[data] upsert resume', e));
}
function removeResume(jobId){
  if(!collPersistOn()) return;
  window.SeekerRT.db.remove('resumes', 'r_'+jobId).catch(e=>console.error('[data] remove resume', e));
}
// 清空所有针对性简历(走 guardrail 预览 + 撤销)。主简历资料(哨兵 r__master__ 不在 RESUME_TAILORED)与个人信息不受影响。
function clearAllTailoredResumes(){
  const ids=Object.keys(RESUME_TAILORED);
  if(!ids.length){ toast(tt('没有针对性简历','No tailored resumes')); return; }
  const G=window.SeekerGuardrail;
  if(!G||!G.confirmDestructive){ toast(tt('该端暂不支持','Not supported here')); return; }
  const snap=JSON.parse(JSON.stringify(RESUME_TAILORED));
  G.confirmDestructive({
    title: tt('清空所有针对性简历?','Clear all tailored resumes?'),
    detail: tt('将删除全部 '+ids.length+' 份针对性简历。主简历资料与个人信息不受影响,可撤销。','Deletes all '+ids.length+' tailored resume(s). Master resume data & personal info untouched. Undoable.'),
    confirmLabel: tt('清空','Clear'), undoText: tt('已清空针对性简历','Tailored resumes cleared'),
    onConfirm:()=>{ for(const k of ids){ delete RESUME_TAILORED[k]; removeResume(k); } renderResumes(); try{ renderInterview(); }catch(_e){} },
    onUndo:()=>{ Object.keys(snap).forEach(k=>{ RESUME_TAILORED[k]=snap[k]; persistResume(k); }); renderResumes(); try{ renderInterview(); }catch(_e){} },
  });
}
async function hydrateResumes(){
  if(!collPersistOn()) return;
  try{
    const rows = await window.SeekerRT.db.list('resumes');
    for(const rec of rows){
      if(!rec) continue;
      if(rec.master || rec.jobId==='__master__'){   // 主简历资料哨兵 → MASTER(不进 RESUME_TAILORED,不当作某岗位的简历)
        MASTER.edu=Array.isArray(rec.edu)?rec.edu:[]; MASTER.work=Array.isArray(rec.work)?rec.work:[]; MASTER.projects=Array.isArray(rec.projects)?rec.projects:[];
        MASTER.strengths=rec.strengths||''; MASTER.certs=rec.certs||''; MASTER.languages=rec.languages||''; MASTER.honors=rec.honors||'';
        continue;
      }
      if(rec.jobId!=null) RESUME_TAILORED[rec.jobId] = { template:rec.template||'minimal', modules:rec.modules||[] };
    }
    try{ if(current==='settings') renderSettings(); }catch(_e){}   // 水合后若在设置页,重渲让主简历资料显示
  }catch(e){ console.error('[data] hydrate resumes', e); }
}
async function hydrateBizColls(){
  await hydrateColl('skills', SKILLS);
  await hydrateColl('actions', ACTIONS);
  await hydrateColl('iv_records', IV_RECORDS);
  await hydrateResumes();
  await hydrateMessages();
  try{ rerenderPages(); }catch(_e){}
}
window.addEventListener('seeker-rt-ready', hydrateBizColls);
