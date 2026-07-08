// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 简历模块(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../monolith-globals.d.ts。 */
import { PROFILE } from '../../../platform/shell/profile.js'; // ★批8:PROFILE 改 import(profile.js 不上 window 桥、隐私最小暴露)。红线逐字保留:PROFILE 仅在函数体渲染简历预览联系方式、persistResume 绝不入 resumes 集合(见文件尾)。
import { JOBS } from '../data.js';
import { IV_BANK, IV_CATLABEL, IV_CATS, IV_RECORDS, MOD_ICON, RESUME, RESUME_TAILORED, aiRun, genQuestionsFor, genTailoredResume, ivScore, resMod, resSkills, resSummary } from './intake-action.js';
import { ivState, renderInterview } from './interview.js';
import { openResumeModal } from './resume-modals.js';
import { clearAllTailoredResumes, persistResume, removeResume } from './persistence.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { persistColl } from '../../../platform/shell/data-store.js';
import { $, $$, el } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { closeModal, openModal } from '../../../platform/shell/modal.js';
import { frontis, signFoot } from '../../../platform/shell/nav.js';
import { errText, toast, toastUndo } from '../../../platform/shell/toast.js';
/* ---------- RESUMES (独立模块) ---------- */
export let resumeState={jobId:JOBS[0].id, mode:'edit'};  // mutated-property(仅 .jobId=/.mode=、含 interview.js 经 import 绑定跨文件写)→ import 即同一对象、免访问器;JOBS[0] 于 module-eval 急读 **import 绑定**(★第43轮:载序由 import 图自定序,data.js 在 SCC 之外 → 先求值、JOBS 就绪;批11B 后已无 window.JOBS 桥)
let ivRec=null;  // ★从 interview.js 移入:语音识别句柄(reassigned:=new SR()/=null/='demo'),生命周期全在本文件(ivToggleVoice/ivStopVoice/ivVoiceDemo)→ 模块私有、不上桥不访问器(消除跨文件 reassigned 纠缠)
function modLabel(m){const map={basic:['基本信息','Basic info'],summary:['个人简介','Summary'],skills:['专业能力','Skills'],work:['工作经历','Experience'],projects:['项目经历','Projects'],edu:['教育经历','Education'],honors:['荣誉奖项','Honors'],portfolio:['个人作品','Portfolio'],research:['研究经历','Research'],other:['其他经历','Other']};return map[m.key]?tt(map[m.key][0],map[m.key][1]):m.label;}
function blockHTML(m){
  let body;
  if(m.type==='locked'){
    const fields=[[tt('姓名','Name'),PROFILE.name],[tt('求职意向','Target role'),PROFILE.intent],[tt('城市','City'),PROFILE.city],[tt('电话','Phone'),PROFILE.phone],[tt('邮箱','Email'),PROFILE.email],[tt('经验','Experience'),PROFILE.exp]].concat(
      [['site',tt('主页','Website')],['github','GitHub'],['portfolio',tt('作品集','Portfolio')],['linkedin','LinkedIn']].filter(l=>PROFILE[l[0]]&&String(PROFILE[l[0]]).trim()).map(l=>[l[1],PROFILE[l[0]]]));  // 链接填了才显示
    body=`${fields.map(f=>`<div class="lockfield"><span class="lk">${f[0]}</span><span class="lv">${f[1]}</span></div>`).join('')}<div class="lock-note"><span class="li">🔒</span><span>${tt('这些隐私信息从「数据设置 · 个人信息」自动加载,AI 不读取、不修改。要改请去数据设置。','Loaded from Settings · Personal info; AI never reads or edits it. Change it in Settings.')}</span></div>`;
  }else if(m.type==='skills'){
    body=`<input class="rb-skill-in" data-mskills="${m.key}" value="${cEsc((m.content||[]).join(', '))}"><p style="font-size:11px;color:var(--ink-mute);margin:8px 0 0;">${tt('逗号分隔 · 已对齐目标 JD','Comma-separated · aligned to target JD')}</p>`;
  }else if(m.type==='entries'){
    body=`<div>${(m.items||[]).map((it,i)=>`<div class="rb-entry">
      <div class="rb-erow"><input class="rb-in" data-ef="${m.key}|${i}|org" placeholder="${tt('公司 / 机构','Company / org')}" value="${(it.org||'').replace(/"/g,'&quot;')}"><input class="rb-in" data-ef="${m.key}|${i}|date" placeholder="${tt('时间 · 如 2020 — 2024','Dates · e.g. 2020 — 2024')}" value="${(it.date||'').replace(/"/g,'&quot;')}"></div>
      <div class="rb-erow"><input class="rb-in" data-ef="${m.key}|${i}|title" placeholder="${tt('头衔 / 专业方向','Title / field')}" value="${(it.title||'').replace(/"/g,'&quot;')}"><input class="rb-in" data-ef="${m.key}|${i}|loc" placeholder="${tt('城市(可选)','City (optional)')}" value="${(it.loc||'').replace(/"/g,'&quot;')}"></div>
      <textarea class="rb-ta" data-ebul="${m.key}|${i}" rows="3" placeholder="${tt('要点 · 每行一条…','Bullets · one per line…')}">${cEsc((it.bullets||[]).join('\n'))}</textarea>
      <button class="btn-text" data-edel="${m.key}|${i}" style="color:var(--ink-mute);margin-top:4px;">${tt('删除该条','Delete')}</button></div>`).join('')}</div><button class="btn-text" data-eadd="${m.key}" style="margin-top:4px;">${tt('+ 添加一条','+ Add entry')}</button>`;
  }else if(m.type==='projects'){
    body=`<div>${(m.items||[]).map((p,i)=>`<div class="rb-entry ${p.star?'star':''}">
      <div class="rb-erow"><input class="rb-in" data-pf="${m.key}|${i}|name" placeholder="${tt('项目名称','Project name')}" value="${(p.name||'').replace(/"/g,'&quot;')}"><input class="rb-in" data-pf="${m.key}|${i}|date" placeholder="${tt('时间','Date')}" value="${(p.date||'').replace(/"/g,'&quot;')}"></div>
      <textarea class="rb-ta" data-pbul="${m.key}|${i}" rows="2" placeholder="${tt('项目要点 · 每行一条…','Project bullets · one per line…')}">${cEsc((p.bullets||[]).join('\n'))}</textarea>
      <div style="display:flex;gap:12px;align-items:center;margin-top:7px;"><button class="rb-ic ${p.star?'on':''}" data-mpstar="${m.key}|${i}" title="${tt('标记擅长 · 面试重点追问','Mark strength · probed in interview')}">★</button><span style="font-size:11px;color:var(--ink-mute);">${tt('标 ★ 面试会重点追问','★ = probed in interview')}</span><button class="btn-text" data-edel="${m.key}|${i}" style="color:var(--ink-mute);margin-left:auto;">${tt('删除','Delete')}</button></div></div>`).join('')}</div><button class="btn-text" data-eadd="${m.key}" style="margin-top:4px;">${tt('+ 添加项目','+ Add project')}</button>`;
  }else{
    body=`<textarea class="rb-ta" data-mtext="${m.key}" rows="3" placeholder="${tt('填写'+cEsc(modLabel(m))+'…','Write '+cEsc(modLabel(m))+'…')}">${cEsc(m.content||'')}</textarea>`;
  }
  const tag=m.type==='locked'?`<span class="blk-tag lock">${tt('数据设置 · 锁定','Settings · locked')}</span>`:(m.custom?`<button class="blk-del" data-mremove="${m.key}" title="${tt('移除模块','Remove module')}">×</button>`:'');
  return `<div class="blk open" data-blk="${m.key}"><div class="blk-head"><span class="chev">${IC.arrow}</span><span class="blk-title">${cEsc(modLabel(m))}</span>${tag}</div><div class="blk-body">${body}</div></div>`;
}
function resumeEditorBody(j){
  const r=RESUME_TAILORED[j.id];
  const picks=r.modules.map(m=>`<div class="mod-row ${m.on?'':'off'}"><span class="mlabel"><span style="color:var(--ink-3);">${MOD_ICON[m.key]||'•'}</span> ${cEsc(modLabel(m))}${m.type==='locked'?`<span class="mlock">${tt('隐私','private')}</span>`:''}</span><span class="tgl ${m.on?'on':''}" data-mtgl="${m.key}"></span></div>`).join('');
  const blocks=r.modules.filter(m=>m.on).map(blockHTML).join('')||`<p style="color:var(--ink-3);padding:24px 0;text-align:center;">${tt('已隐藏所有模块 —— 在左侧打开几个吧。','All modules hidden — turn some on at left.')}</p>`;
  return `<div class="res-layout">
      <div class="mod-pick"><div class="mp-head">${tt('模块选择','Modules')}</div>${picks}<button class="mp-add" id="rbAddMod">${tt('+ 添加模块','+ Add module')}</button></div>
      <div>${blocks}</div>
    </div>
    <p style="font-size:12px;color:var(--ink-mute);margin:14px 0 0;line-height:1.6;">${tt('编辑自动保存。「基本信息」从数据设置自动加载、AI 不读取也不修改;其余模块可自由开关、编辑与新增。切到「预览 · 排版」可换 4 套版式。','Auto-saves. Basic info loads from Settings (AI never reads/edits it); other modules toggle, edit, and add freely. Switch to Preview to try 4 layouts.')}</p>`;
}
function resumeWorkspaceHTML(j){
  const header=`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;"><span class="acbadge ac-compound">${tt('针对 '+cEsc(j.co)+' · '+cEsc(j.role.split('·')[0].trim()),'For '+cEsc(j.co))}</span><div style="display:flex;gap:14px;flex-wrap:wrap;"><button class="btn-text" id="rbRegen">${tt('重新生成','Regenerate')}</button><button class="btn-text" id="rbExport">${tt('导出 MD','Export MD')}</button><button class="btn-text" id="rbDel" style="color:var(--ink-mute);">${tt('删除','Delete')}</button></div></div>`;
  const tabs=`<div class="tabs" style="margin-bottom:18px;"><button class="tab ${resumeState.mode==='edit'?'on':''}" data-rmode="edit">${tt('编辑内容','Edit content')}</button><button class="tab ${resumeState.mode==='preview'?'on':''}" data-rmode="preview">${tt('预览 · 排版','Preview · Layout')}</button></div>`;
  return header+tabs+(resumeState.mode==='preview'?resumePreviewWrap(j):resumeEditorBody(j));
}
function resumeRender(r){
  const tpl=r.template||'minimal';
  const basicOn=resMod(r,'basic')&&resMod(r,'basic').on;
  const esc=s=>(''+(s||'')).replace(/</g,'&lt;');
  const links=[PROFILE.site,PROFILE.github,PROFILE.portfolio,PROFILE.linkedin].filter(x=>x&&String(x).trim()).map(esc).join(' &nbsp;·&nbsp; ');
  const headInner=`<h1 class="rp-name">${esc(PROFILE.name)}</h1><p class="rp-role">${esc(PROFILE.intent)}</p><p class="rp-contact">${esc(PROFILE.city)} &nbsp;·&nbsp; ${esc(PROFILE.phone)} &nbsp;·&nbsp; ${esc(PROFILE.email)} &nbsp;·&nbsp; ${esc(PROFILE.exp)}</p>${links?`<p class="rp-contact">${links}</p>`:''}`;
  const bullets=arr=>arr&&arr.length?`<ul class="rp-list">${arr.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>`:'';
  const entry=(it,star)=>`<div class="rp-entry"><div class="rp-erow"><span class="rp-org">${star?'<b class="rstar">★</b> ':''}${esc(it.org||it.name)}</span><span class="rp-date">${esc(it.date)}</span></div>${(it.title||it.loc)?`<div class="rp-esub"><span class="rp-role2">${esc(it.title)}</span>${it.loc?`<span class="rp-loc">${esc(it.loc)}</span>`:''}</div>`:''}${bullets(it.bullets)}</div>`;
  const secHTML=m=>{
    let inner;
    if(m.type==='skills') inner=`<div class="rp-skills">${resSkills(r).map(s=>`<span>${esc(s)}</span>`).join('')}</div>`;
    else if(m.type==='entries') inner=(m.items||[]).map(it=>entry(it,false)).join('');
    else if(m.type==='projects') inner=(m.items||[]).map(it=>entry(it,it.star)).join('');
    else inner=`<div class="rp-text">${esc(m.content).replace(/\n/g,'<br>')}</div>`;
    return `<section class="rp-sec"><h2 class="rp-title">${esc(modLabel(m))}</h2><div class="rp-secbody">${inner}</div></section>`;
  };
  if(tpl==='sidebar'){
    const asideKeys=['skills','edu','honors'];
    const aside=(basicOn?`<div class="rp-asidehead">${headInner}</div>`:'')+r.modules.filter(m=>m.on&&asideKeys.includes(m.key)).map(secHTML).join('');
    const main=r.modules.filter(m=>m.on&&m.key!=='basic'&&!asideKeys.includes(m.key)).map(secHTML).join('');
    return `<div class="rp-grid"><aside class="rp-aside">${aside}</aside><main class="rp-main">${main}</main></div>`;
  }
  const head=basicOn?`<header class="rp-head">${headInner}</header>`:'';
  return head+`<div class="rp-body">${r.modules.filter(m=>m.on&&m.key!=='basic').map(secHTML).join('')}</div>`;
}
function resumePreviewWrap(j){
  const r=RESUME_TAILORED[j.id]; const cur=r.template||'minimal';
  const tpls=[['minimal',tt('极简','Minimal')],['classic',tt('经典','Classic')],['sidebar',tt('专业栏','Sidebar')],['editorial',tt('杂志','Editorial')]];
  const picker=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px;">
    <span style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:var(--ink-3);text-transform:uppercase;margin-right:4px;">${tt('排版样式','Layout')}</span>
    ${tpls.map(t=>`<button class="pill ${cur===t[0]?'on':''}" data-tpl="${t[0]}">${t[1]}</button>`).join('')}
    <button class="btn" style="margin-left:auto;" id="rbPrint">${tt('打印 / 存为 PDF','Print / Save PDF')}</button></div>`;
  return picker+`<div class="resume-paper rt-${cur}" id="resumePaper">${resumeRender(r)}</div>`;
}
function resumePrint(){
  const paper=$('#resumePaper'); if(!paper)return;
  let root=$('#printRoot'); if(!root){root=el('<div id="printRoot"></div>');document.body.appendChild(root);}
  const tcls=(paper.className.match(/rt-\w+/)||[''])[0];
  root.innerHTML=`<div class="resume-paper ${tcls}">${paper.innerHTML}</div>`;
  document.body.classList.add('printing'); window.print();
  setTimeout(()=>document.body.classList.remove('printing'),700);
}
export function renderResumes(){
  if(!JOBS.find(x=>x.id===resumeState.jobId)) resumeState.jobId=JOBS[0].id;
  const tailored=JOBS.filter(j=>RESUME_TAILORED[j.id]);
  const base=`<div class="sec"><p class="seclabel">— SOURCE</p><h2 class="sectitle">${tt('主简历','Master resume')}<span class="dot">.</span></h2>
    <div class="rb-card" style="margin-top:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:240px;"><div style="font-size:15px;font-weight:600;color:var(--ink);">${cEsc(RESUME.filename)}</div><div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3);margin-top:5px;">${tt('上传于 '+cEsc(RESUME.uploaded)+' · 已解析为职业资产','Uploaded '+cEsc(RESUME.uploaded)+' · parsed into career assets')}</div><p style="font-size:13px;color:var(--ink-2);margin:12px 0 0;line-height:1.7;">${cEsc(RESUME.summary)}</p></div>
      <button class="btn" data-orm>${tt('管理主简历','Manage master')}</button></div>
    <p style="font-size:12px;color:var(--ink-3);margin:12px 0 0;line-height:1.7;">${tt('主简历是「源」。针对每个目标岗位,可从它派生一份「针对性简历」—— 对齐该 JD 的高频词、突出最契合的经历。','The master resume is the source. For each target job you can derive a tailored version — aligned to that JD\'s keywords, surfacing your most relevant experience.')}</p></div>`;
  const pills=JOBS.map(j=>`<button class="pill ${j.id===resumeState.jobId?'on':''}" data-rj="${j.id}">${RESUME_TAILORED[j.id]?'● ':''}${cEsc(j.co)} · ${cEsc(j.role.split('·')[0].trim())}</button>`).join('');
  const j=JOBS.find(x=>x.id===resumeState.jobId);
  const body=RESUME_TAILORED[j.id]?resumeWorkspaceHTML(j):`<div class="rb-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;"><div><div style="font-size:14px;color:var(--ink);font-weight:500;">${tt('还没有针对 '+cEsc(j.co)+' 的简历','No resume for '+cEsc(j.co)+' yet')}</div><div style="font-size:12.5px;color:var(--ink-3);margin-top:4px;line-height:1.6;">${tt('基于 JD + 你的职业资产,几秒生成一份对口简历 —— 可编辑、标擅长、导出。','From the JD + your assets, generate a matching resume in seconds — editable, mark strengths, export.')}</div></div><button class="btn btn-accent" id="rbGen">${tt('AI 生成针对性简历','AI-generate tailored resume')} →</button></div></div>`;
  const tail=`<div class="sec" style="border-bottom:none;"><p class="seclabel">— TAILORED</p>
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;"><h2 class="sectitle" style="margin:0;">${tt('针对性简历','Tailored resumes')} <span style="font-family:var(--font-mono);font-style:normal;font-size:12px;color:var(--ink-3);">${tt(tailored.length+' 份',''+tailored.length)}</span><span class="dot">.</span></h2>${tailored.length>0?`<button class="btn-text" id="rbClearAll" style="color:var(--ink-mute);">${tt('清空全部','Clear all')}</button>`:''}</div>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 0;">${tt('选一个岗位查看或生成它的针对性简历(● = 已生成)。','Pick a job to view or generate its tailored resume (● = generated).')}</p>
    <div class="pillrow" style="margin-top:14px;">${pills}</div>
    <div style="margin-top:16px;">${body}</div></div>`;
  $('#page-resumes').innerHTML=frontis('RESUMES',tt('我的简历','Resume'))+base+tail+signFoot();
  resumeBind();
}
function resumeSync(id){
  const r=RESUME_TAILORED[id]; if(!r)return;
  $$('#page-resumes [data-mtext]').forEach(t=>{const m=resMod(r,t.dataset.mtext); if(m)m.content=t.value;});
  $$('#page-resumes [data-mskills]').forEach(t=>{const m=resMod(r,t.dataset.mskills); if(m)m.content=t.value.split(/[,，]\s*/).map(s=>s.trim()).filter(Boolean);});
  $$('#page-resumes [data-ef]').forEach(t=>{const a=t.dataset.ef.split('|');const m=resMod(r,a[0]);if(m&&m.items[+a[1]])m.items[+a[1]][a[2]]=t.value;});
  $$('#page-resumes [data-ebul]').forEach(t=>{const a=t.dataset.ebul.split('|');const m=resMod(r,a[0]);if(m&&m.items[+a[1]])m.items[+a[1]].bullets=t.value.split('\n').map(s=>s.trim()).filter(Boolean);});
  $$('#page-resumes [data-pf]').forEach(t=>{const a=t.dataset.pf.split('|');const m=resMod(r,a[0]);if(m&&m.items[+a[1]])m.items[+a[1]][a[2]]=t.value;});
  $$('#page-resumes [data-pbul]').forEach(t=>{const a=t.dataset.pbul.split('|');const m=resMod(r,a[0]);if(m&&m.items[+a[1]])m.items[+a[1]].bullets=t.value.split('\n').map(s=>s.trim()).filter(Boolean);});
  persistResume(id); // 红线安全持久化:只存专业模块,联系方式绝不入集合
}
function resumeBind(){
  const id=resumeState.jobId; const root=$('#page-resumes'); const r=RESUME_TAILORED[id];
  $$('#page-resumes [data-rj]').forEach(b=>b.onclick=()=>{resumeState.jobId=+b.dataset.rj;renderResumes();});
  $$('#page-resumes [data-orm]').forEach(b=>b.onclick=()=>openResumeModal());  // ★批11A:原内联 onclick="openResumeModal()"
  const gen=$('#rbGen',root); if(gen)gen.onclick=()=>resumeGenerate(id,renderResumes);
  const clr=$('#rbClearAll',root); if(clr)clr.onclick=clearAllTailoredResumes;   // 清空所有针对性简历(走 guardrail,主简历资料不受影响)
  if(!r)return;
  const regen=$('#rbRegen',root); if(regen)regen.onclick=()=>resumeGenerate(id,renderResumes);
  const exp=$('#rbExport',root); if(exp)exp.onclick=()=>resumeExport(id);
  const del=$('#rbDel',root); if(del)del.onclick=()=>{const snap=RESUME_TAILORED[id];delete RESUME_TAILORED[id];removeResume(id);renderResumes();renderInterview();toastUndo('已删除针对性简历',()=>{RESUME_TAILORED[id]=snap;persistResume(id);renderResumes();renderInterview();});};
  root.onfocusout = ()=>persistResume(id); // 输入失焦即持久化(oninput 已更新内存);赋值而非 addEventListener,避免重渲染累积监听器
  $$('#page-resumes .blk-head').forEach(h=>h.onclick=(e)=>{if(e.target.closest('[data-mremove]'))return;h.parentElement.classList.toggle('open');});
  $$('#page-resumes [data-mtgl]').forEach(t=>t.onclick=()=>{resumeSync(id);const m=resMod(r,t.dataset.mtgl);m.on=!m.on;renderResumes();renderInterview();});
  $$('#page-resumes [data-mremove]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();resumeSync(id);r.modules=r.modules.filter(m=>m.key!==b.dataset.mremove);renderResumes();});
  $$('#page-resumes [data-mtext]').forEach(t=>t.oninput=()=>{const m=resMod(r,t.dataset.mtext);if(m)m.content=t.value;});
  $$('#page-resumes [data-mskills]').forEach(t=>t.oninput=()=>{const m=resMod(r,t.dataset.mskills);if(m)m.content=t.value.split(/[,，]\s*/).map(s=>s.trim()).filter(Boolean);});
  $$('#page-resumes [data-ef]').forEach(t=>t.oninput=()=>{const a=t.dataset.ef.split('|');const m=resMod(r,a[0]);if(m)m.items[+a[1]][a[2]]=t.value;});
  $$('#page-resumes [data-ebul]').forEach(t=>t.oninput=()=>{const a=t.dataset.ebul.split('|');const m=resMod(r,a[0]);if(m)m.items[+a[1]].bullets=t.value.split('\n').map(s=>s.trim()).filter(Boolean);});
  $$('#page-resumes [data-pf]').forEach(t=>t.oninput=()=>{const a=t.dataset.pf.split('|');const m=resMod(r,a[0]);if(m)m.items[+a[1]][a[2]]=t.value;});
  $$('#page-resumes [data-pbul]').forEach(t=>t.oninput=()=>{const a=t.dataset.pbul.split('|');const m=resMod(r,a[0]);if(m)m.items[+a[1]].bullets=t.value.split('\n').map(s=>s.trim()).filter(Boolean);});
  $$('#page-resumes [data-mpstar]').forEach(b=>b.onclick=()=>{resumeSync(id);const a=b.dataset.mpstar.split('|');const m=resMod(r,a[0]);m.items[+a[1]].star=!m.items[+a[1]].star;renderResumes();renderInterview();toast(m.items[+a[1]].star?'已标记擅长 · 面试会重点追问':'已取消擅长标记');});
  $$('#page-resumes [data-edel]').forEach(b=>b.onclick=()=>{resumeSync(id);const a=b.dataset.edel.split('|');const m=resMod(r,a[0]);m.items.splice(+a[1],1);renderResumes();});
  $$('#page-resumes [data-eadd]').forEach(b=>b.onclick=()=>{resumeSync(id);const m=resMod(r,b.dataset.eadd);if(m.type==='projects')m.items.push({name:'',date:'',star:false,bullets:[]});else m.items.push({org:'',title:'',date:'',loc:'',bullets:[]});renderResumes();});
  const addmod=$('#rbAddMod',root); if(addmod)addmod.onclick=()=>resumeAddModule(id);
  $$('#page-resumes [data-rmode]').forEach(b=>b.onclick=()=>{resumeState.mode=b.dataset.rmode;renderResumes();});
  $$('#page-resumes [data-tpl]').forEach(b=>b.onclick=()=>{RESUME_TAILORED[id].template=b.dataset.tpl;persistResume(id);renderResumes();});
  const pr=$('#rbPrint',root); if(pr)pr.onclick=resumePrint;
}
function resumeAddModule(id){
  const r=RESUME_TAILORED[id];
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— MODULE</p><h2 style="margin-top:5px;">${tt('添加模块','Add module')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body"><div class="field"><label>${tt('模块名称','Module name')}</label><input class="input" id="nmName" placeholder="${tt('如 · 开源贡献 / 证书 / 志愿经历','e.g. Open source / Certs / Volunteering')}"></div><p style="font-size:12px;color:var(--ink-3);margin:4px 0 0;">${tt('添加后出现在右侧,可填写内容、随时开关。','Appears on the right; fill content and toggle anytime.')}</p></div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="nmSave">${tt('添加','Add')}</button></div>`);
  $('#nmSave',m).onclick=()=>{const name=$('#nmName',m).value.trim();if(!name){toast('请填写模块名称');return;}resumeSync(id);r.modules.push({key:'cus_'+Date.now(), label:name, on:true, type:'text', content:'', custom:true});closeModal();renderResumes();toast('已添加模块「'+cEsc(name)+'」');};
}
export function resumeGenerate(id, after){
  const j=JOBS.find(x=>x.id===id); const fresh=!!RESUME_TAILORED[id]; resumeState.jobId=id;
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— AI RESUME</p><h2 style="margin-top:5px;">${fresh?tt('重新生成','Regenerate'):tt('生成','Generate')}${tt('针对性简历',' tailored resume')}</h2><div class="sub"><span>${cEsc(j.co)} · ${cEsc(j.role.split('·')[0].trim())}</span></div></div><button class="x">${IC.x}</button></div><div class="modal-body"><div id="grHost"></div></div>`);
  aiRun($('#grHost',m),[tt('读取 JD 的硬性 + 软性要求','Reading JD hard + soft requirements'),tt('匹配你的职业资产与项目证据','Matching your assets & evidence'),tt('按岗位重写概要、技能与项目亮点','Rewriting summary, skills & highlights')],
    ()=>{RESUME_TAILORED[id]=genTailoredResume(j); persistResume(id); setTimeout(()=>{(after||renderResumes)();renderInterview();},30); const r=RESUME_TAILORED[id];
      return `<p style="font-size:14px;color:var(--ink);margin:0 0 12px;">${tt('已生成针对 <b>'+cEsc(j.co)+'</b> 的简历 ✓ 在「简历」模块可按模块开关、编辑、标擅长、导出。','Generated a resume for <b>'+cEsc(j.co)+'</b> ✓ Toggle modules, edit, mark strengths, and export in the Resume module.')}</p>
        <div style="border:0.5px solid var(--border);padding:14px;background:var(--bg-subtle);"><p style="font-size:13px;color:var(--ink-2);line-height:1.7;margin:0 0 10px;">${cEsc(resSummary(r))}</p><div style="display:flex;gap:6px;flex-wrap:wrap;">${resSkills(r).map(s=>`<span class="chip">${cEsc(s)}</span>`).join('')}</div></div>
        <button class="btn btn-accent" style="margin-top:14px;" data-close data-go="resumes">${tt('去编辑','Go edit')} →</button>`;
    },{label:tt('AI 生成简历中…','Generating resume…')});
}
// ── 导出工具(纯本地:真剪贴板 + Blob 下载;不出网)─────────────────
// 复制到剪贴板(真实):navigator.clipboard 优先 → 退回 execCommand → 失败返回 false。
async function copyText(text){
  try{ if(navigator.clipboard&&navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return true; } }catch(_e){}
  try{
    const ta=document.createElement('textarea'); ta.value=text;
    ta.style.position='fixed'; ta.style.opacity='0'; ta.style.pointerEvents='none';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok=document.execCommand('copy'); document.body.removeChild(ta);
    return ok;
  }catch(_e){ return false; }
}
async function copyWithToast(text){
  const ok=await copyText(text);
  toast(ok?tt('已复制','Copied'):tt('复制失败,请手动选择文本','Copy failed — select the text manually'));
  return ok;
}
// 下载一个文本文件(Blob + a[download],纯本地、不出网)。
function downloadText(filename, text, mime){
  try{
    const blob=new Blob([text],{type:(mime||'text/plain')+';charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return true;
  }catch(e){ toast(errText(e)); return false; }
}
// 文档模型 → .docx(Rust 零依赖渲染 → base64 → Blob 下载)。纯本地、不出网;web 端降级会报错(已被按钮门控隐藏)。
async function exportDocx(fname, model){
  try{
    const b64=await window.SeekerRT.render.docx(model);
    const bin=atob(b64), bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=fname+'.docx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast(tt('已下载 Word','Downloaded Word'));
  }catch(e){ toast(errText(e)); }
}
// 从针对性简历构造「导出模型」(单一来源):title + 各段 blocks。MD / 逐段复制 / Word 共用。
function resumeExportModel(id){
  const j=JOBS.find(x=>x.id===id), r=RESUME_TAILORED[id];
  const title=`${PROFILE.name} · ${tt('针对','for')} ${j.co} · ${j.role.split('·')[0].trim()}`;
  const sections=[];
  r.modules.filter(m=>m.on).forEach(m=>{
    if(m.type==='locked') sections.push({label:tt('基本信息','Basics'),blocks:[
      {kind:'para',text:`${tt('求职意向','Intent')}:${PROFILE.intent} · ${tt('城市','City')}:${PROFILE.city} · ${tt('经验','Exp')}:${PROFILE.exp}`},
      {kind:'para',text:`${tt('电话','Phone')}:${PROFILE.phone} · ${tt('邮箱','Email')}:${PROFILE.email}`}]});
    else if(m.type==='skills') sections.push({label:m.label,blocks:[{kind:'para',text:(m.content||[]).join(' · ')}]});
    else if(m.type==='entries') sections.push({label:m.label,blocks:(m.items||[]).map(it=>({kind:'entry',head:`${it.org||''}${it.title?' · '+it.title:''}`,date:it.date||'',bullets:it.bullets||[]}))});
    else if(m.type==='projects') sections.push({label:m.label,blocks:(m.items||[]).map(p=>({kind:'entry',head:`${p.star?'★ ':''}${p.name||''}`,date:p.date||'',bullets:p.bullets||[]}))});
    else sections.push({label:m.label,blocks:[{kind:'para',text:m.content||''}]});
  });
  return {title,sections};
}
function exportBlockText(b){
  if(b.kind==='entry') return `${b.head}${b.date?'  ('+b.date+')':''}\n`+(b.bullets||[]).map(x=>'- '+x).join('\n');
  return b.text||'';
}
function exportSectionText(s){ return s.label+'\n'+s.blocks.map(exportBlockText).join('\n'); }
function modelToMarkdown(model){
  let md=`# ${model.title}\n`;
  model.sections.forEach(s=>{
    md+=`\n## ${s.label}\n`;
    s.blocks.forEach(b=>{
      if(b.kind==='entry'){ md+=`### ${b.head}${b.date?'  ('+b.date+')':''}\n`+(b.bullets||[]).map(x=>'- '+x).join('\n')+'\n'; }
      else md+=`${b.text||''}\n`;
    });
  });
  return md;
}
function resumeExport(id){
  const j=JOBS.find(x=>x.id===id);
  if(!RESUME_TAILORED[id]){ toast(tt('请先生成针对性简历','Generate a tailored resume first')); return; }  // 守卫:无简历则 r.modules 会 TypeError
  const model=resumeExportModel(id);
  const md=modelToMarkdown(model);
  const fname=`${(PROFILE.name||'resume').replace(/\s+/g,'_')}_${(j.co||'').replace(/\s+/g,'_')}`;
  const esc=s=>(''+(s||'')).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const sectionsHTML=model.sections.map((s,i)=>{
    const body=s.blocks.map((b,k)=>{
      if(b.kind==='entry') return `<div style="margin-top:6px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div style="min-width:0;"><b>${esc(b.head)}</b>${b.date?` <span style="color:var(--ink-3);">(${esc(b.date)})</span>`:''}${(b.bullets||[]).map(x=>`<div style="color:var(--ink-2);">· ${esc(x)}</div>`).join('')}</div><button class="btn" data-copyblk="${i}|${k}" style="padding:2px 8px;font-size:10.5px;flex-shrink:0;">${tt('复制','Copy')}</button></div>`;
      return `<div style="color:var(--ink-2);white-space:pre-wrap;">${esc(b.text)}</div>`;
    }).join('');
    return `<div style="padding:10px 0;border-bottom:0.5px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <span class="seclabel" style="margin:0;">— ${esc(s.label)}</span>
        <button class="btn" data-copysec="${i}" style="padding:3px 10px;font-size:11px;flex-shrink:0;">${tt('复制本段','Copy section')}</button>
      </div>
      <div style="margin-top:6px;font-size:13px;line-height:1.6;">${body}</div></div>`;
  }).join('');
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— EXPORT</p><h2 style="margin-top:5px;">${tt('导出 / 填表','Export / Fill')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button class="btn btn-accent" id="exCopyMd">${tt('复制 Markdown','Copy Markdown')}</button>
        <button class="btn" id="exDlMd">${tt('下载 .md','Download .md')}</button>
        ${(window.SeekerRT&&window.SeekerRT.platform!=='web')?`<button class="btn" id="exDlDocx">${tt('下载 Word','Download Word')}</button>`:''}
      </div>
      <p style="font-size:12px;color:var(--ink-3);margin:0 0 8px;line-height:1.6;">${tt('在招聘网站表单里逐字段填写时,点每段/每条经历的「复制」最省力;Markdown 便于整份保存或再编辑。<b>所有导出纯本地,不出网。</b>','Filling a job-site form field by field? Hit “Copy” on each section or role. Markdown is for saving or further editing. <b>All exports are local — nothing leaves your machine.</b>')}</p>
      ${sectionsHTML}
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('关闭','Close')}</button></div>`, true);
  $('#exCopyMd',m).onclick=()=>copyWithToast(md);
  $('#exDlMd',m).onclick=()=>{ if(downloadText(fname+'.md',md,'text/markdown')) toast(tt('已下载 .md','Downloaded .md')); };
  const dx=$('#exDlDocx',m); if(dx) dx.onclick=()=>exportDocx(fname,model);
  [...m.querySelectorAll('[data-copysec]')].forEach(b=>b.onclick=()=>copyWithToast(exportSectionText(model.sections[+b.dataset.copysec])));
  [...m.querySelectorAll('[data-copyblk]')].forEach(b=>b.onclick=()=>{const a=b.dataset.copyblk.split('|');copyWithToast(exportBlockText(model.sections[+a[0]].blocks[+a[1]]));});
}
export function ivBankHTML(){
  const cats=['全部',...IV_CATS.map(c=>c[1])];
  const toolbar=`<div class="iv-toolbar"><div class="filtergroup"><span class="fl">${tt('分类','Category')}</span>${cats.map(c=>`<button class="fopt ${ivState.cat===c?'on':''}" data-ic="${c}">${c==='全部'?tt('全部','All'):c}</button>`).join('')}</div><input class="iv-search" id="ivSearch" placeholder="${tt('搜索题目…','Search questions…')}" value="${cEsc(ivState.search)}"></div>`;
  const list=IV_BANK.filter(q=>(ivState.cat==='全部'||IV_CATLABEL[q.cat]===ivState.cat));
  const rows=list.map(q=>`<div class="q-row" data-q="${q.id}"><span class="q-cat ${q.src==='AI'?'ai':''}">${IV_CATLABEL[q.cat]}</span><div><div class="q-text">${cEsc(q.text)}</div><div class="q-tags">${cEsc(q.tags.join(' · '))}${q.src!=='内置'?' · '+cEsc(q.src):''}</div></div><span class="q-go">${tt('开始练','Practice')} →</span></div>`).join('');
  return toolbar+(rows||`<p style="color:var(--ink-3);padding:24px 0;text-align:center;">${tt('没有匹配的题目','No matching questions')}</p>`);
}
export function ivBindBank(){
  $$('#page-interview [data-ic]').forEach(b=>b.onclick=()=>{ivState.cat=b.dataset.ic;renderInterview();});
  const s=$('#ivSearch'); if(s)s.oninput=()=>{ivState.search=s.value;$$('#page-interview .q-row').forEach(r=>{const q=IV_BANK.find(x=>x.id===+r.dataset.q);r.style.display=(q&&(!s.value||q.text.includes(s.value)))?'':'none';});};
  $$('#page-interview [data-q]').forEach(r=>r.onclick=()=>{ivState.q=IV_BANK.find(q=>q.id===+r.dataset.q);renderInterview();});
}
export function ivPractice(){
  const q=ivState.q; const j=JOBS.find(x=>x.id===ivState.jobId); const stage=$('#ivStage');
  stage.innerHTML=`<button class="btn-text" id="ivBack" style="margin-bottom:14px;">← ${tt('返回题库','Back to bank')}</button>
    <div class="ai-panel"><div class="ai-bar"><span class="dot"></span><span class="lbl"><b>${tt('AI 面试官','AI interviewer')}</b>${ivState.round?` · ${tt('整轮 · 第 '+(ivState.round.idx+1)+' / '+ivState.round.qs.length+' 题','Round · '+(ivState.round.idx+1)+' / '+ivState.round.qs.length)}`:''} · ${IV_CATLABEL[q.cat]}${q.src==='AI'?' · '+tt('针对 '+cEsc(j.co),'for '+cEsc(j.co)):''}</span></div>
    <div style="padding:20px 22px 22px;">
      <div class="iv-q"><span class="who">${tt('面试官','Interviewer')}</span><div class="qt">${cEsc(q.text)}</div></div>
      <div class="field" style="margin-top:16px;"><label>${tt('你的回答','Your answer')}</label><textarea class="textarea" id="ivAns" style="font-family:var(--font-sans);min-height:130px;" placeholder="${tt('说出你的思路即可,不必完美。可以点「语音作答」直接说…','Just say your approach — no need to be perfect. Or tap Voice answer to speak…')}"></textarea></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><button class="mic-btn" id="ivMic"><span class="mdot"></span><span id="micTxt">${tt('语音作答','Voice answer')}</span></button><button class="btn btn-accent" id="ivSubmit">${tt('提交回答,获取反馈','Submit for feedback')}</button><button class="btn" id="ivSkip">${tt('看参考思路','Reference')}</button></div>
      <div id="ivFb"></div>
    </div></div>`;
  $('#ivBack',stage).onclick=()=>{ivStopVoice();ivState.q=null;ivState.round=null;renderInterview();};
  $('#ivMic',stage).onclick=ivToggleVoice;
  $('#ivSkip',stage).onclick=()=>toast(tt('参考结构:澄清 → 估算 → 画架构 → 讲权衡 → 谈演进','Structure: clarify → estimate → architect → trade-offs → evolution'));
  $('#ivSubmit',stage).onclick=ivSubmit;
}
function ivSubmit(){
  ivStopVoice(); const stage=$('#ivStage'); const ans=$('#ivAns',stage).value; const q=ivState.q; const j=JOBS.find(x=>x.id===ivState.jobId);
  $('#ivSubmit',stage).disabled=true;
  const fbHost=$('#ivFb',stage);
  fbHost.innerHTML=`<div class="ai-panel" style="margin-top:16px;"><div class="ai-bar"><span class="dot"></span><span class="lbl"><b>AI</b> 评估中</span></div><div id="fbInner"></div></div>`;
  aiRun(fbHost.querySelector('#fbInner'),[tt('分析回答结构与覆盖面','Analyzing structure & coverage'),tt('评估技术深度与权衡','Assessing depth & trade-offs'),tt('检查量化与数据支撑','Checking quantification')],
    ()=>{const f=ivScore(ans);
      const dims=[[tt('结构','Structure'),f.scores.structure],[tt('深度','Depth'),f.scores.depth],[tt('量化','Quant'),f.scores.quant]];
      const fbBody=`<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px;"><span style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.18em;color:var(--ink-3);">${tt('综合','Overall')}</span><span style="font-family:var(--font-serif);font-size:28px;color:var(--accent);font-weight:500;">${f.scores.overall.toFixed(1)}</span><span style="font-size:13px;color:var(--ink-3);">/10</span></div>
        ${dims.map(d=>`<div class="dimrow"><span class="dl">${d[0]}</span><div class="dt"><i style="width:${d[1]*10}%"></i></div><span class="dv">${d[1].toFixed(1)}</span></div>`).join('')}
        <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:var(--status-done);margin:16px 0 4px;">✓ ${tt('做得好','Did well')}</p><ul style="margin:0;padding-left:18px;">${f.good.map(g=>`<li style="font-size:13px;color:var(--ink-2);margin:5px 0;line-height:1.6;">${cEsc(g)}</li>`).join('')}</ul>
        <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:var(--ink-3);margin:14px 0 4px;">↑ ${tt('可以更好','Could improve')}</p><ul style="margin:0;padding-left:18px;">${f.improve.map(g=>`<li style="font-size:13px;color:var(--ink-2);margin:5px 0;line-height:1.6;">${cEsc(g)}</li>`).join('')}</ul>`;
      if(ivState.round){
        ivState.round.recs.push({qText:q.text, cat:q.cat, tags:q.tags, scores:f.scores, good:f.good, improve:f.improve});
        const last=ivState.round.idx>=ivState.round.qs.length-1;
        return `<div style="padding:18px 18px 20px;">${fbBody}<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;"><button class="btn btn-accent" id="ivRoundNext">${last?tt('查看整轮总评','See round summary'):tt('下一题','Next')} →</button></div></div>`;
      }
      IV_RECORDS.unshift({id:Date.now(), type:'single', qText:q.text, cat:q.cat, date:'2026.06.02', job:j.co, tags:q.tags, answer:(ans&&ans.trim()?ans.trim():'(语音作答 / 未保存文字)').slice(0,90)+(ans.length>90?'…':''), scores:f.scores, good:f.good, improve:f.improve});
      persistColl('iv_records', IV_RECORDS);
      return `<div style="padding:18px 18px 20px;">${fbBody}<p style="font-size:12px;color:var(--ink-mute);margin:14px 0 0;">${tt('已存入练习记录 ✓','Saved to practice records ✓')}</p>
        <div style="display:flex;gap:10px;margin-top:13px;flex-wrap:wrap;"><button class="btn btn-accent" id="ivNextQ">${tt('换一题继续','Another question')} →</button><button class="btn" id="ivToRecords">${tt('查看练习记录','View records')} →</button></div></div>`;
    },{label:tt('评估你的回答中…','Evaluating your answer…'), after:()=>{const nq=$('#ivNextQ'); if(nq)nq.onclick=ivNextRandom; const rn=$('#ivRoundNext'); if(rn)rn.onclick=ivRoundNext; const tr=$('#ivToRecords'); if(tr)tr.onclick=()=>{ivState.q=null;ivState.tab='records';ivState.search='';renderInterview();};}});  // ★批11A:原内联状态写 handler([建议]③)改 import 绑定词法写
}
function ivNextRandom(){const pool=IV_BANK.filter(q=>q.id!==ivState.q.id);ivState.q=pool[Math.floor(Math.random()*pool.length)]||ivState.q;renderInterview();}
/* ===== Full round ===== */
export function ivStartRound(){
  const j=JOBS.find(x=>x.id===ivState.jobId);
  let qs=genQuestionsFor(j,4);
  if(!qs.some(q=>q.cat==='behavior')){const beh=IV_BANK.filter(q=>q.cat==='behavior');if(beh.length)qs=qs.concat([beh[Math.floor(Math.random()*beh.length)]]);}
  qs=qs.slice(0,4);
  ivState.round={qs, idx:0, recs:[], job:j.co}; ivState.summary=null; ivState.q=qs[0];
  renderInterview();
}
function ivRoundNext(){
  const r=ivState.round; if(!r) return;
  if(r.idx>=r.qs.length-1){ ivFinishRound(); return; }
  r.idx++; ivState.q=r.qs[r.idx]; renderInterview();
}
function ivFinishRound(){
  const r=ivState.round; const avg=k=>r.recs.reduce((a,x)=>a+x.scores[k],0)/r.recs.length;
  const scores={structure:+avg('structure').toFixed(1), depth:+avg('depth').toFixed(1), quant:+avg('quant').toFixed(1), overall:+avg('overall').toFixed(1)};
  const allTags=[...new Set(r.recs.flatMap(x=>x.tags||[]))];
  const dimNames={structure:tt('结构','Structure'),depth:tt('深度','Depth'),quant:tt('量化','Quant')};
  const weakest=['structure','depth','quant'].sort((a,b)=>scores[a]-scores[b])[0];
  const strongest=['structure','depth','quant'].sort((a,b)=>scores[b]-scores[a])[0];
  const rec={id:Date.now(), type:'round', qText:tt('整轮模拟面试 · '+r.qs.length+' 题 · '+r.job,'Full mock interview · '+r.qs.length+' Q · '+r.job), cat:'design', date:'2026.06.02', job:r.job, tags:allTags, qCount:r.qs.length, items:r.recs.map(x=>({qText:x.qText,scores:x.scores})), scores, good:[tt(dimNames[strongest]+'是你的强项('+scores[strongest].toFixed(1)+')',dimNames[strongest]+' is your strength ('+scores[strongest].toFixed(1)+')')], improve:[tt('优先补强'+dimNames[weakest]+'(当前 '+scores[weakest].toFixed(1)+')','Shore up '+dimNames[weakest]+' first (now '+scores[weakest].toFixed(1)+')'),tt('把高分题的"结论先行+量化"习惯迁移到所有题','Carry the "conclusion-first + quantified" habit to every question')]};
  IV_RECORDS.unshift(rec);
  ivState.summary={rec, recs:r.recs, scores, weakest:dimNames[weakest], strongest:dimNames[strongest]};
  ivState.q=null; ivState.round=null; renderInterview();
}
export function ivRenderSummary(){
  const s=ivState.summary; const stage=$('#ivStage'); const sc=s.scores;
  const dims=[[tt('结构','Structure'),sc.structure],[tt('深度','Depth'),sc.depth],[tt('量化','Quant'),sc.quant]];
  const verdict=sc.overall>=8?tt('表现稳定,可以投了','Solid — you\'re ready to apply'):(sc.overall>=7?tt('基础扎实,补强短板就更稳','Good base — shore up weak spots'):tt('多练几轮,重点打磨结构与量化','Practice more — focus on structure & quant'));
  stage.innerHTML=`<button class="btn-text" id="sBack" style="margin-bottom:14px;">← ${tt('返回题库','Back to bank')}</button>
    <div class="ai-panel"><div class="ai-bar"><span class="dot"></span><span class="lbl"><b>${tt('整轮总评','Round summary')}</b> · ${cEsc(s.rec.job)} · ${tt(s.recs.length+' 题',s.recs.length+' Q')}</span></div>
    <div style="padding:22px 22px 24px;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;"><span style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.18em;color:var(--ink-3);">${tt('整轮综合','Round overall')}</span><span style="font-family:var(--font-serif);font-size:40px;color:var(--accent);font-weight:500;line-height:1;">${sc.overall.toFixed(1)}</span><span style="font-size:14px;color:var(--ink-3);">/10</span></div>
      <p style="font-size:13px;color:var(--ink-2);margin:0 0 16px;">${verdict} · ${tt('强项「'+s.strongest+'」,可优先补强「'+s.weakest+'」。','Strength: '+s.strongest+'; shore up '+s.weakest+' first.')}</p>
      ${dims.map(d=>`<div class="dimrow"><span class="dl">${d[0]}</span><div class="dt"><i style="width:${d[1]*10}%"></i></div><span class="dv">${d[1].toFixed(1)}</span></div>`).join('')}
      <div class="msec" style="border-bottom:none;margin-top:8px;"><p class="seclabel">— PER QUESTION</p>
      ${s.recs.map((x,i)=>`<div style="display:flex;gap:12px;align-items:baseline;padding:9px 0;border-bottom:0.5px solid var(--border);"><span class="idx">${String(i+1).padStart(2,'0')}</span><span style="flex:1;font-size:13px;color:var(--ink-2);line-height:1.5;">${cEsc(x.qText)}</span><span class="mono" style="font-size:13px;color:var(--accent);">${x.scores.overall.toFixed(1)}</span></div>`).join('')}</div>
      <p style="font-size:12px;color:var(--ink-mute);margin:14px 0 0;">${tt('整轮记录已存入练习记录,并计入成长曲线 ✓','Round saved to records and counted in your growth curve ✓')}</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;"><button class="btn btn-accent" id="sAgain">${tt('再来一轮','Another round')} →</button><button class="btn" id="sRecords">${tt('查看成长曲线','View growth curve')} →</button></div>
    </div></div>`;
  $('#sBack',stage).onclick=()=>{ivState.summary=null;renderInterview();};
  $('#sAgain',stage).onclick=()=>{ivState.summary=null;ivStartRound();};
  $('#sRecords',stage).onclick=()=>{ivState.summary=null;ivState.tab='records';ivState.search='';renderInterview();};
}
function growthChartHTML(){
  const recs=[...IV_RECORDS].reverse();
  const head=`<p class="seclabel">— GROWTH</p><h3 class="sectitle" style="font-size:15px;">${tt('成长曲线','Growth curve')}<span class="dot">.</span></h3>`;
  if(recs.length<2) return `<div class="sec" style="border-bottom:0.5px solid var(--border);padding-top:0;">${head}<p style="font-size:12.5px;color:var(--ink-3);margin:8px 0 0;">${tt('练满 2 次以上,这里会画出你的综合分成长曲线。','After 2+ sessions, your overall-score growth curve appears here.')}</p></div>`;
  const W=600,H=170,padL=26,padR=12,padT=14,padB=22,n=recs.length,yMin=4,yMax=10;
  const xs=i=>padL+(n===1?0:i*(W-padL-padR)/(n-1));
  const ys=v=>padT+(yMax-v)/(yMax-yMin)*(H-padT-padB);
  const line=(key,col,w)=>`<polyline points="${recs.map((r,i)=>xs(i).toFixed(1)+','+ys(r.scores[key]).toFixed(1)).join(' ')}" style="fill:none;stroke:${col};stroke-width:${w};stroke-linejoin:round;stroke-linecap:round;"/>`;
  const dots=recs.map((r,i)=>`<circle cx="${xs(i).toFixed(1)}" cy="${ys(r.scores.overall).toFixed(1)}" r="3" style="fill:var(--accent);"/>`).join('');
  const grid=[5,7,9].map(v=>`<line x1="${padL}" y1="${ys(v).toFixed(1)}" x2="${W-padR}" y2="${ys(v).toFixed(1)}" style="stroke:var(--border);stroke-width:0.5;"/><text x="2" y="${(ys(v)+3).toFixed(1)}" style="fill:var(--ink-mute);font-size:9px;font-family:monospace;">${v}</text>`).join('');
  const delta=recs[n-1].scores.overall-recs[0].scores.overall;
  const trend=delta>0.2?`▲ +${delta.toFixed(1)}`:(delta<-0.2?`▼ ${delta.toFixed(1)}`:tt('≈ 持平','≈ flat'));
  return `<div class="sec" style="border-bottom:0.5px solid var(--border);padding-top:0;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;">${`<div>${head}</div>`}<div style="text-align:right;"><span style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.1em;color:var(--ink-3);">${tt('综合分变化','Overall change')}</span><div style="font-family:var(--font-serif);font-size:20px;color:${delta>=0?'var(--status-done)':'var(--ink-3)'};font-weight:500;">${trend}</div></div></div>
    <div style="border:0.5px solid var(--border);margin-top:12px;padding:8px 6px;background:var(--bg-elevated);"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">${grid}${line('structure','var(--border-strong)',1)}${line('depth','var(--ink-mute)',1)}${line('overall','var(--accent)',2)}${dots}</svg></div>
    <div style="display:flex;gap:18px;margin-top:10px;font-family:var(--font-mono);font-size:10px;color:var(--ink-3);"><span style="color:var(--accent);">━ ${tt('综合','Overall')}</span><span>━ ${tt('结构','Structure')}</span><span>━ ${tt('深度','Depth')}</span><span style="margin-left:auto;">${tt('共 '+n+' 次练习',n+' sessions')}</span></div>
  </div>`;
}
export function ivRecordsHTML(){
  const cats=['全部',...IV_CATS.map(c=>c[1])];
  const toolbar=`<div class="iv-toolbar"><div class="filtergroup"><span class="fl">${tt('分类','Category')}</span>${cats.map(c=>`<button class="fopt ${ivState.cat===c?'on':''}" data-rc="${c}">${c==='全部'?tt('全部','All'):c}</button>`).join('')}</div><input class="iv-search" id="ivRSearch" placeholder="${tt('搜索题目 / 公司…','Search questions / company…')}" value="${cEsc(ivState.search)}"></div>`;
  const growth=growthChartHTML();
  const list=IV_RECORDS.filter(r=>(ivState.cat==='全部'||IV_CATLABEL[r.cat]===ivState.cat));
  if(!list.length) return growth+toolbar+`<p style="color:var(--ink-3);padding:24px 0;text-align:center;">${tt('还没有匹配的练习记录。','No matching practice records yet.')}</p>`;
  const rows=list.map(r=>{
    const badge=r.type==='round'?`<span class="q-cat ai">${tt('整轮 '+r.qCount+' 题','Round '+r.qCount+'Q')}</span>`:`<span class="q-cat">${IV_CATLABEL[r.cat]}</span>`;
    return `<div class="rec-row" data-rec="${r.id}"><div class="rec-top"><span class="rec-q">${cEsc(r.qText)}</span><span class="rec-meta">${r.date}${r.job?' · '+cEsc(r.job):''}</span></div><div class="rec-sc"><span><b>${r.scores.overall.toFixed(1)}</b>${tt('综合','overall')}</span><span><b style="font-size:13px;">${r.scores.structure.toFixed(1)}</b>${tt('结构','struct')}</span><span><b style="font-size:13px;">${r.scores.depth.toFixed(1)}</b>${tt('深度','depth')}</span><span><b style="font-size:13px;">${r.scores.quant.toFixed(1)}</b>${tt('量化','quant')}</span><span style="margin-left:auto;">${badge}</span></div></div>`;
  }).join('');
  return growth+toolbar+rows;
}
export function ivBindRecords(){
  $$('#page-interview [data-rc]').forEach(b=>b.onclick=()=>{ivState.cat=b.dataset.rc;renderInterview();});
  const s=$('#ivRSearch'); if(s)s.oninput=()=>{ivState.search=s.value;$$('#page-interview .rec-row').forEach(row=>{const r=IV_RECORDS.find(x=>x.id===+row.dataset.rec);const show=r&&(!s.value||r.qText.includes(s.value)||(r.job||'').includes(s.value));row.style.display=show?'':'none';});};
  $$('#page-interview [data-rec]').forEach(row=>row.onclick=()=>ivRecordDetail(+row.dataset.rec));
}
function ivRecordDetail(id){
  const r=IV_RECORDS.find(x=>x.id===id); const dims=[[tt('结构','Structure'),r.scores.structure],[tt('深度','Depth'),r.scores.depth],[tt('量化','Quant'),r.scores.quant]];
  const mid = r.type==='round'
    ? `<div class="msec"><p class="seclabel">— PER QUESTION</p><h3 class="sectitle" style="font-size:15px;margin-bottom:6px;">${tt('逐题表现','Per question')}<span class="dot">.</span></h3>${(r.items||[]).map((x,i)=>`<div style="display:flex;gap:12px;align-items:baseline;padding:9px 0;border-bottom:0.5px solid var(--border);"><span class="idx">${String(i+1).padStart(2,'0')}</span><span style="flex:1;font-size:13px;color:var(--ink-2);line-height:1.5;">${cEsc(x.qText)}</span><span class="mono" style="font-size:13px;color:var(--accent);">${x.scores.overall.toFixed(1)}</span></div>`).join('')}</div>`
    : `<div class="msec"><p class="seclabel">— QUESTION</p><p style="font-size:15px;color:var(--ink);line-height:1.6;margin:8px 0 0;">${cEsc(r.qText)}</p></div>
       <div class="msec"><p class="seclabel">— YOUR ANSWER</p><p style="font-size:13.5px;color:var(--ink-2);line-height:1.75;margin:8px 0 0;">${cEsc(r.answer)}</p></div>`;
  openModal(`<div class="modal-head"><div><p class="eyebrow">— ${r.type==='round'?'ROUND':'RECORD'}</p><h2 style="margin-top:5px;">${r.type==='round'?tt('整轮总评','Round summary'):tt('练习记录','Practice record')}</h2><div class="sub"><span>${r.date}</span>${r.job?`<span>·</span><span>${cEsc(r.job)}</span>`:''}${r.type==='round'?`<span>·</span><span>${tt(r.qCount+' 题',r.qCount+' Q')}</span>`:`<span>·</span><span>${IV_CATLABEL[r.cat]}</span>`}</div></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="msec"><p class="seclabel">— SCORES</p><div style="display:flex;align-items:baseline;gap:10px;margin:8px 0 12px;"><span style="font-family:var(--font-serif);font-size:26px;color:var(--accent);font-weight:500;">${r.scores.overall.toFixed(1)}</span><span style="font-size:13px;color:var(--ink-3);">/10 ${tt('综合','overall')}</span></div>${dims.map(d=>`<div class="dimrow"><span class="dl">${d[0]}</span><div class="dt"><i style="width:${d[1]*10}%"></i></div><span class="dv">${d[1].toFixed(1)}</span></div>`).join('')}</div>
      ${mid}
      <div class="msec" style="border-bottom:none;"><p class="seclabel">— FEEDBACK</p>
        <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:var(--status-done);margin:8px 0 4px;">✓ ${tt('做得好','Did well')}</p><ul style="margin:0;padding-left:18px;">${r.good.map(g=>`<li style="font-size:13px;color:var(--ink-2);margin:5px 0;">${cEsc(g)}</li>`).join('')}</ul>
        <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:var(--ink-3);margin:14px 0 4px;">↑ ${tt('可以更好','Could improve')}</p><ul style="margin:0;padding-left:18px;">${r.improve.map(g=>`<li style="font-size:13px;color:var(--ink-2);margin:5px 0;">${cEsc(g)}</li>`).join('')}</ul></div>
    </div>`);
}
export function ivGenerate(){
  const j=JOBS.find(x=>x.id===ivState.jobId);
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— AI</p><h2 style="margin-top:5px;">${tt('生成针对性面试题','Generate tailored questions')}</h2><div class="sub"><span>${cEsc(j.co)} · ${cEsc(j.role.split('·')[0].trim())}</span></div></div><button class="x">${IC.x}</button></div><div class="modal-body"><div id="genHost"></div></div>`);
  aiRun($('#genHost',m),[tt('解析该岗位 JD 与你的针对性简历','Reading the JD & your tailored resume'),tt('定位简历里最可能被深挖的点','Finding the most probe-worthy points'),tt('生成 3 道针对性新题','Generating 3 tailored questions')],
    ()=>{const qs=genQuestionsFor(j,3); qs.forEach(q=>IV_BANK.unshift(q)); ivState.tab='bank'; setTimeout(renderInterview,30);
      return `<p style="font-size:14px;color:var(--ink);margin:0 0 12px;">${tt('已生成 3 道针对 <b>'+cEsc(j.co)+'</b> 的新题,加入题库顶部 ✓','Generated 3 new questions for <b>'+cEsc(j.co)+'</b>, added to the top of the bank ✓')}</p>${qs.map(q=>`<div style="border:0.5px solid var(--border);padding:12px 14px;margin-bottom:8px;"><span class="q-cat ai">${IV_CATLABEL[q.cat]}</span><p style="font-size:13.5px;color:var(--ink);margin:8px 0 0;line-height:1.55;">${cEsc(q.text)}</p></div>`).join('')}<button class="btn btn-accent" style="margin-top:8px;" data-close>${tt('去题库练','Practice in bank')} →</button>`;
    },{label:tt('AI 出题中…','Generating questions…')});
}
export function ivAddQuestion(){
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— NEW</p><h2 style="margin-top:5px;">${tt('添加我自己的题','Add my own question')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="field"><label>${tt('题目','Question')}</label><textarea class="textarea" id="nqText" style="font-family:var(--font-sans);min-height:84px;" placeholder="${tt('粘贴或写下你想练的面试题…','Paste or write a question to practice…')}"></textarea></div>
      <div class="field-row"><div class="field"><label>${tt('分类','Category')}</label><select class="select" id="nqCat">${IV_CATS.map(c=>`<option value="${c[0]}">${c[1]}</option>`).join('')}</select></div><div class="field"><label>${tt('关联技能(可选)','Linked skills (optional)')}</label><input class="input" id="nqTags" placeholder="${tt('如 · Redis 高并发','e.g. Redis scale')}"></div></div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="nqSave">${tt('添加到题库','Add to bank')}</button></div>`);
  $('#nqSave',m).onclick=()=>{const text=$('#nqText',m).value.trim(); if(!text){toast('请先写题目');return;} const cat=$('#nqCat',m).value; const tags=$('#nqTags',m).value.trim().split(/\s+/).filter(Boolean); IV_BANK.unshift({id:Date.now(),cat,text,tags:tags.length?tags:['自建'],src:'自建'}); closeModal(); ivState.tab='bank'; renderInterview(); toast('已添加到题库');};
}
function ivToggleVoice(){
  const btn=$('#ivMic'), txt=$('#micTxt'), ta=$('#ivAns');
  if(ivRec){ivStopVoice();return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SR){
    try{
      ivRec=new SR(); ivRec.lang='zh-CN'; ivRec.continuous=true; ivRec.interimResults=true;
      let base=ta.value?ta.value+' ':'';
      ivRec.onresult=(e)=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const tr=e.results[i][0].transcript;if(e.results[i].isFinal)base+=tr;else interim+=tr;}ta.value=base+interim;};
      ivRec.onerror=()=>{ivStopVoice();ivVoiceDemo();};
      ivRec.start(); btn.classList.add('rec'); txt.textContent='聆听中 · 点此停止';
    }catch(err){ivRec=null;ivVoiceDemo();}
  } else { ivVoiceDemo(); }
}
export function ivStopVoice(){ if(ivRec&&ivRec!=='demo'){try{ivRec.stop();}catch(e){}} ivRec=null; const btn=$('#ivMic'),txt=$('#micTxt'); if(btn)btn.classList.remove('rec'); if(txt)txt.textContent='语音作答'; }
function ivVoiceDemo(){
  const btn=$('#ivMic'),txt=$('#micTxt'),ta=$('#ivAns'); if(!btn)return;
  btn.classList.add('rec'); txt.textContent='聆听中(演示)…'; ivRec='demo';
  const demo='我先澄清需求和量级,做容量估算,再分接入层、服务层、存储层给出架构,重点讲缓存与降级策略,最后谈监控和演进方向。';
  ta.dataset.base=ta.value?ta.value+' ':''; let i=0;
  const tick=()=>{ if(ivRec!=='demo')return; if(i<=demo.length){ta.value=(ta.dataset.base||'')+demo.slice(0,i);i+=2;setTimeout(tick,38);} else {ivStopVoice();toast('语音转写完成(演示)');} };
  tick();
}

/* ★批11B(pageActions 契约):resumeState/renderResumes/resumeGenerate 桥已摘 —— nav 顶栏动作(resumeGenerate(resumeState.jobId, renderResumes))改经 SeekerShell.pageActions 契约取(最后一个平台裸读者去);
   全部消费者已 import(manifest/cards/persistence/interview/job-actions)。resumeState mutated dual-publish → import 即同一对象(interview.js 跨文件 mutate 安全)。ivRec(移入)+ 大量 resume 编辑/导出内部函数私有。
   ★红线(在函数体、逐字保留):resumes 集合只存专业模块结构、联系方式绝不入(走独立 PROFILE 实时渲染)→ query_data(resumes) 天然无联系方式。★PROFILE 已 import from platform/shell/profile.js(批8;不上 window 桥)。 */