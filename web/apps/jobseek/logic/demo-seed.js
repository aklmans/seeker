// @ts-nocheck —— 抽壳序4-d-3 择取:jobseek 演示/种子体验。逻辑零改动。
/** jobseek · 演示数据体验:SEED 快照 + demoMode/setDemoMode(演示态)+ captureSeed(抓种子)+ seedDemoData(显式播种)+ syncDemoBanner(示例提示条)。
 *  依赖:jobseek JOBS/SKILLS/ACTIONS/IV_RECORDS(data.js)、renderOverview/rerenderPages(渲染)、el/tt(平台)、go(nav)、
 *  collPersistOn/persistColl/markOnboarded(data-store 序4-b/4-d-1)、clearAllDataFlow(index.html,运行时全局,示例条出口)。
 *  captureSeed/syncDemoBanner 由 index.html INIT 运行时调;seedDemoData 由落地页「先逛示例」调。onboarding 状态(onboarded/markOnboarded)= 平台(data-store 序4-d-1)。 */

/* ===== 首次上手状态(评审落地:首启不静默灌演示数据,改岔路让用户选)=====
   onboarded:已做首启选择(开始我的 / 逛示例)。迁移:旧版已被种子过的用户(jh-seeded-jobs)视为已上手,不弹落地页。 */
let SEED=null; // 演示种子快照(INIT 时趁内存还是 mock 字面量抓一份,供"先逛示例"显式播种)
function demoMode(){ try{ return localStorage.getItem('jh-demo')==='1'; }catch(_e){ return false; } }
export function setDemoMode(on){ try{ on?localStorage.setItem('jh-demo','1'):localStorage.removeItem('jh-demo'); }catch(_e){} }
export function captureSeed(){ if(SEED) return; try{ SEED={ jobs:JOBS.slice(), skills:SKILLS.slice(), actions:ACTIONS.slice(), ivRecords:IV_RECORDS.slice() }; }catch(_e){ SEED={jobs:[],skills:[],actions:[],ivRecords:[]}; } }

/** 显式播种演示数据(用户在落地页选「先用示例逛一圈」时)。用 INIT 抓的 SEED 快照持久化 + 标记演示模式。 */
export function seedDemoData(){
  captureSeed();
  if(SEED){
    JOBS.length=0; JOBS.push(...SEED.jobs);
    SKILLS.length=0; SKILLS.push(...SEED.skills);
    ACTIONS.length=0; ACTIONS.push(...SEED.actions);
    IV_RECORDS.length=0; IV_RECORDS.push(...SEED.ivRecords);
    if(collPersistOn()){ persistColl('jobs', JOBS); persistColl('skills', SKILLS); persistColl('actions', ACTIONS); persistColl('iv_records', IV_RECORDS); }
  }
  markOnboarded(); setDemoMode(true);
  try{ rerenderPages(); }catch(_e){}
  go('overview'); renderOverview(); syncDemoBanner();
}
/** 示例模式提示条(反焦虑:无红色;bg-subtle + 橙「示例」chip + 出口「清空示例,开始我的」)。本次会话可隐藏,重启仍提示以确保出口可达。 */
export function syncDemoBanner(){
  const main=document.querySelector('.main'); if(!main) return;
  let bar=document.getElementById('demoBanner');
  if(demoMode()){
    if(!bar){
      bar=el(`<div id="demoBanner" style="display:flex;align-items:center;gap:12px;padding:9px 22px;background:var(--bg-subtle);border-bottom:0.5px solid var(--border);font-size:12.5px;color:var(--ink-2);">
        <span style="font-family:var(--font-mono);font-size:9px;letter-spacing:0.12em;text-transform:uppercase;background:var(--accent);color:#fff;padding:2px 7px;flex-shrink:0;">${tt('示例','SAMPLE')}</span>
        <span style="flex:1;min-width:0;">${tt('这是示例数据,帮你看清产品能做什么 · 随时换成你自己的。','Sample data — see what Seeker can do; replace it with your own anytime.')}</span>
        <button class="btn" id="demoClear" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('清空示例,开始我的','Clear sample, start mine')}</button>
        <button id="demoDismiss" title="${tt('关闭','Dismiss')}" style="background:none;border:none;color:var(--ink-3);cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;">×</button></div>`);
      const tb=main.querySelector('.topbar');
      if(tb && tb.nextSibling) main.insertBefore(bar, tb.nextSibling); else main.insertBefore(bar, main.firstChild);
      const cb=bar.querySelector('#demoClear'); if(cb) cb.onclick=()=>clearAllDataFlow();      // 走护栏+备份;onConfirm 关演示模式
      const db=bar.querySelector('#demoDismiss'); if(db) db.onclick=()=>bar.remove();            // 本次会话隐藏
    }
  } else if(bar){ bar.remove(); }
}

/* ★批9c:首启落地页(原 index.html inline)归位至此 —— 首启/演示同 surface,frDemo 直调同文件 seedDemoData。 */
// 首启价值主张落地页(评审 ★A/B):一句话说清"是什么/为什么/给谁" + 本地优先·隐私·反焦虑信任锚 + 岔路。
export function renderFirstRun(){
  const hero=`<div class="sec" style="border-bottom:none;padding-bottom:0;">
    <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.2em;color:var(--accent);margin:0;">— ${tt('本地优先 · 反焦虑','LOCAL-FIRST · CALM')}</p>
    <h2 class="sectitle" style="font-size:28px;margin:11px 0 0;">${tt('把求职,当成一个研究项目','Run your job hunt like a research project')}<span class="dot">.</span></h2>
    <p style="font-size:14.5px;color:var(--ink-2);line-height:1.75;max-width:620px;margin:14px 0 0;">${tt('收集你心仪的岗位,Seeker 帮你反推出「该补什么能力、简历怎么改、面试怎么练」。所有数据只存在你的电脑里,联系方式永不参与 AI。','Collect the jobs you want, and Seeker reverse-engineers what skills to build, how to tune your resume, and how to prep interviews. All your data stays on this machine — your contact details never go to AI.')}</p></div>`;
  const steps=`<div class="sec" style="border-bottom:none;padding-top:10px;">
    <div class="guide-step"><span class="gnum">— 01</span><div><h3>${tt('上传你的简历','Upload your resume')}</h3><p>${tt('AI 自动把你的技能 / 经历建成「能力档案」—— 本地处理、联系方式不参与 AI;解锁匹配与缺口分析。','AI builds your skills & experience into a career-asset profile — local-only, contact details excluded; unlocks matching & gap analysis.')}</p><button class="btn" id="frResume" style="margin-top:10px;">${tt('+ 上传简历','+ Upload resume')}</button></div></div>
    <div class="guide-step"><span class="gnum">— 02</span><div><h3>${tt('录入 3-5 个心仪岗位','Add 3-5 jobs you want')}</h3><p>${tt('粘贴 JD,Seeker 自动抽取要求 —— 简历 + 岗位齐了,才算得准匹配、找得出缺口。','Paste a JD and Seeker auto-extracts the requirements — with both resume and jobs, it can compute fit and find gaps.')}</p></div></div>
    <div class="guide-step" style="border-bottom:none;"><span class="gnum">— 03</span><div><h3>${tt('看匹配与缺口,定行动','See fit & gaps, then act')}</h3><p>${tt('AI 算出你与每个岗位的差距、该补什么,一键排进行动:补能力 / 改简历 / 练面试。稳步推进 —— 你没有落后。','AI computes your gap to each job and what to build — turn it into actions: skills / resume / interviews. Steady progress — you\'re not behind.')}</p></div></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:26px;">
      <button class="btn btn-accent" id="frStart">${tt('+ 录入第一个岗位','+ Add your first job')}</button>
      <button class="btn" id="frDemo">${tt('先用示例数据逛一圈 →','Explore with sample data →')}</button>
    </div></div>`;
  $('#page-overview').innerHTML=frontis('OVERVIEW',tt('开始吧','Get started'))+hero+steps+signFoot();
  const rb=$('#frResume'); if(rb) rb.onclick=()=>{ markOnboarded(); renderOverview(); openResumeModal(); }; // 上传简历:标记上手 → 工作台 → 简历模态(解锁匹配/缺口)
  const s=$('#frStart'); if(s) s.onclick=()=>{ markOnboarded(); renderOverview(); openNewJob(); };  // 开始我的:标记上手 → 空工作台 → 录第一个岗位
  const d=$('#frDemo'); if(d) d.onclick=()=>{ seedDemoData(); };                                     // 先逛示例:显式播种 + 示例提示条
}
// 设置页「查看引导态」:强制预览落地页(已上手用户也能看)。
export function showEmptyState(){ go('overview'); renderFirstRun(); }

/* 过渡 window 桥:captureSeed/syncDemoBanner 经 manifest.init;setDemoMode 经 manifest.onDataCleared。
   ★批10a:seedDemoData 桥删——批9c renderFirstRun 归位本文件后其 frDemo onclick 走模块词法、零外部消费者(死桥)。
   ★批9c:renderFirstRun 被 overview.js:6 裸全局读;showEmptyState 被 settings.js:384 内联 onclick="showEmptyState()" 消费 → **须保 window 桥**(内联属性按 window 解析)。
   ★SEED(let,reassigned)+ demoMode(函数)= 文件私有、不上桥不访问器。 */
window.captureSeed=captureSeed; window.syncDemoBanner=syncDemoBanner; window.setDemoMode=setDemoMode; window.renderFirstRun=renderFirstRun; window.showEmptyState=showEmptyState;
