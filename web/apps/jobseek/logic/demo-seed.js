// @ts-nocheck —— 抽壳序4-d-3 择取:jobseek 演示/种子体验。逻辑零改动。
/** jobseek · 演示数据体验:SEED 快照 + demoMode/setDemoMode(演示态)+ captureSeed(抓种子)+ seedDemoData(显式播种)+ syncDemoBanner(示例提示条)。
 *  依赖:jobseek JOBS/SKILLS/ACTIONS/IV_RECORDS(data.js)、renderOverview/rerenderPages(渲染)、el/tt(平台)、go(nav)、
 *  collPersistOn/persistColl/markOnboarded(data-store 序4-b/4-d-1)、clearAllDataFlow(index.html,运行时全局,示例条出口)。
 *  captureSeed/syncDemoBanner 由 index.html INIT 运行时调;seedDemoData 由落地页「先逛示例」调。onboarding 状态(onboarded/markOnboarded)= 平台(data-store 序4-d-1)。 */

/* ===== 首次上手状态(评审落地:首启不静默灌演示数据,改岔路让用户选)=====
   onboarded:已做首启选择(开始我的 / 逛示例)。迁移:旧版已被种子过的用户(jh-seeded-jobs)视为已上手,不弹落地页。 */
let SEED=null; // 演示种子快照(INIT 时趁内存还是 mock 字面量抓一份,供"先逛示例"显式播种)
function demoMode(){ try{ return localStorage.getItem('jh-demo')==='1'; }catch(_e){ return false; } }
function setDemoMode(on){ try{ on?localStorage.setItem('jh-demo','1'):localStorage.removeItem('jh-demo'); }catch(_e){} }
function captureSeed(){ if(SEED) return; try{ SEED={ jobs:JOBS.slice(), skills:SKILLS.slice(), actions:ACTIONS.slice(), ivRecords:IV_RECORDS.slice() }; }catch(_e){ SEED={jobs:[],skills:[],actions:[],ivRecords:[]}; } }

/** 显式播种演示数据(用户在落地页选「先用示例逛一圈」时)。用 INIT 抓的 SEED 快照持久化 + 标记演示模式。 */
function seedDemoData(){
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
function syncDemoBanner(){
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
