// @ts-check
/** assets(数据资产)· Prompt 库页(阶段4 第二应用 · 新代码依 C5 直接 @ts-check)。
 *  数据:ASSETS_PROMPTS(空启动,无静默演示数据 —— 同首启落地页哲学);持久化走平台通用引擎
 *  persistColl/hydrateColl('assets_prompts')+ rt.db.remove;水合经 seeker-rt-ready(classic 解析期注册,同第5轮时序法)。
 *  红线:用户输入(标题/内容)进 DOM 前一律 apEsc 转义;删除走 toastUndo 可撤销(§4-3 反焦虑)。
 *  ★批7:平台基元(dom/i18n/icons/toast/modal/data-store/nav)改 import,不再依赖 window ambient;
 *    renderPrompts 由 assets/manifest.js import 消费(经 grep 证唯一外部消费者)→ 不再上 window 桥。
 *    (内联 onclick "closeModal()" 仍按 window 解析——modal.js 运行时桥仍在;import 供页内直调 + tsc。)
 *    shell-globals.d.ts 未删:仍服务 jobseek/assets 两 manifest 的 tt 等 ambient(tsc 已证)→ 留待账本清空(批10)整销。 */
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { toast, toastUndo, errText } from '../../../platform/shell/toast.js';
import { openModal, closeModal } from '../../../platform/shell/modal.js';
import { persistColl, collPersistOn, hydrateColl } from '../../../platform/shell/data-store.js';
import { currentPage, frontis, signFoot } from '../../../platform/shell/nav.js';
import { saveSkill, listSkills, hydrateSkills } from '../../../platform/shell/skill-store.js'; // ★S3:prompts → 平台 Skills 迁移(app→platform API,同 notes→rt.docs)

/** @type {Array<{id:string, title:string, text:string, updated:number, skillId?:string}>} skillId=已迁入的 Skill id(幂等键,同 notes 的 docId) */
const ASSETS_PROMPTS = [];

// ★S3 迁移状态(自愈,同 notes 的 LIVE_DOC_IDS):当前平台 Skills 里实际存在的 id 集 + 状态是否已知。
/** @type {Set<string>} */
let CURRENT_SKILL_IDS = new Set();
let skillsStatusKnown = false;
/** 一条 prompt 是否已迁入(且其 Skill 仍在)。自愈:用户在能力中心删了那个 Skill ⇒ 重新变「可迁入」。
 *  @param {{skillId?:string}} p */
function promptMigrated(p){ return !!p.skillId && CURRENT_SKILL_IDS.has(p.skillId); }
/** 刷新「当前平台 Skills 有哪些 id」——看**实际**存在(非本地记录),自愈不留悬挂引用。
 *  hydrateSkills 返回 false(读失败)⇒ 状态未知 ⇒ 迁移按钮禁用(同 notes 第67轮:判定不了就拒绝行动,免造重复)。 */
async function refreshMigratedSkills(){
  const ok = await hydrateSkills();
  if(ok){ CURRENT_SKILL_IDS = new Set(listSkills().map((/** @type {any} */ s)=>s.id)); skillsStatusKnown = true; }
  else { CURRENT_SKILL_IDS = new Set(); skillsStatusKnown = false; }
}

/** @param {unknown} s @returns {string} */
function apEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function persistPrompts(){ persistColl('assets_prompts', ASSETS_PROMPTS); }

export async function renderPrompts(){
  const host=$('#page-prompts'); if(!host) return;
  await refreshMigratedSkills();                       // 自愈:看当前平台 Skills 实际有哪些(重渲即对齐)
  const rows=ASSETS_PROMPTS.slice().sort((a,b)=>(b.updated||0)-(a.updated||0));
  const list=rows.length
    ? rows.map(p=>`<div class="sec" style="padding:16px 0;">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
          <h3 style="font-size:15px;color:var(--ink);margin:0;font-weight:600;">${apEsc(p.title)||tt('(未命名)','(untitled)')}</h3>
          <span class="mono" style="font-size:10.5px;color:var(--ink-3);">${new Date(p.updated||0).toLocaleDateString()}</span>
          ${promptMigrated(p)?`<span class="mono" style="font-size:9.5px;color:var(--status-done,#5a8);">${tt('已迁入 Skills','In Skills')}</span>`:''}
          <span style="flex:1;"></span>
          <button class="btn" data-apcopy="${apEsc(p.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('复制','Copy')}</button>
          <button class="btn" data-apedit="${apEsc(p.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('编辑','Edit')}</button>
          <button class="btn" data-apdel="${apEsc(p.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('删除','Delete')}</button>
        </div>
        <pre style="margin:10px 0 0;padding:12px 14px;background:var(--bg-subtle);border:0.5px solid var(--border);font-size:12.5px;line-height:1.7;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);">${apEsc(p.text)}</pre>
      </div>`).join('')
    : `<div class="sec" style="border-bottom:none;"><p style="font-size:13.5px;color:var(--ink-3);line-height:1.8;max-width:560px;">${tt('还没有 Prompt。把你反复使用的提示词沉淀在这里 —— 本地保存,可随时复制取用;授权后 AI 也能检索引用。','No prompts yet. Curate the prompts you reuse — stored locally, one-click copy; with your grant the AI can reference them too.')}</p></div>`;
  // ★S3 迁入 Skills:待迁数 = 未迁入的 prompt。状态未知(读 Skills 失败)⇒ 禁用 + 提示(免造重复,同 notes 第67轮)。
  const pending=ASSETS_PROMPTS.filter(p=>!promptMigrated(p));
  const migrateBtn = !skillsStatusKnown
    ? `<button class="btn" id="apToSkills" disabled style="opacity:.5;cursor:not-allowed;margin-left:8px;">${tt('迁入 Skills','Migrate to Skills')}</button><span class="mono" style="font-size:10px;color:var(--ink-3);margin-left:6px;">${tt('无法确认 Skills 状态,稍后重试','Cannot confirm Skills state — retry later')}</span>`
    : (pending.length
        ? `<button class="btn" id="apToSkills" style="margin-left:8px;">${tt('迁入 Skills','Migrate to Skills')} · ${pending.length}</button>`
        : (ASSETS_PROMPTS.length ? `<span class="mono" style="font-size:10px;color:var(--ink-3);margin-left:8px;">${tt('已全部迁入 Skills','All migrated to Skills')}</span>` : ''));
  // ★S4 软退役引导(反焦虑、非倒计时):Prompt 库并入 Skills;迁完可在应用管理自行关闭此应用(数据保留)。
  const retireNote=`<div class="sec" style="border-bottom:none;padding-bottom:0;"><div class="lock-note" style="margin:0;max-width:680px;"><span class="li">✨</span><span>${tt('Prompt 库正在并入 <b>Skills</b> —— 迁入后可一点即运行(Agent 用它跑一轮)。全部迁完后,可在<b>应用管理</b>关闭「数据资产」应用;<b>数据始终保留、可导出</b>。','The Prompt Library is merging into <b>Skills</b> — once migrated, run them in one click. After migrating all, you can close the Data Assets app in <b>App Manager</b>; <b>your data is always kept and exportable</b>.')}</span></div></div>`;
  host.innerHTML=frontis('PROMPTS', tt('Prompt 库','Prompt Library'))
    +retireNote
    +`<div class="sec" style="border-bottom:none;padding-bottom:6px;"><button class="btn btn-accent" id="apAdd">${tt('+ 新建 Prompt','+ New prompt')}</button>${migrateBtn}</div>`
    +list+signFoot();
  const add=$('#apAdd'); if(add) /** @type {HTMLElement} */(add).onclick=()=>openPromptModal('');
  { const mig=$('#apToSkills'); if(mig && !(/** @type {HTMLButtonElement} */(mig).disabled)) /** @type {HTMLElement} */(mig).onclick=()=>openMigrateSkillsModal(); }
  $$('#page-prompts [data-apcopy]').forEach(b=>{ /** @type {HTMLElement} */(b).onclick=()=>{
    const p=ASSETS_PROMPTS.find(x=>x.id===/** @type {HTMLElement} */(b).dataset.apcopy); if(!p) return;
    try{ navigator.clipboard.writeText(p.text); toast(tt('已复制','Copied')); }catch(_e){ toast(tt('复制失败','Copy failed')); }
  };});
  $$('#page-prompts [data-apedit]').forEach(b=>{ /** @type {HTMLElement} */(b).onclick=()=>openPromptModal(/** @type {HTMLElement} */(b).dataset.apedit||''); });
  $$('#page-prompts [data-apdel]').forEach(b=>{ /** @type {HTMLElement} */(b).onclick=()=>{
    const id=/** @type {HTMLElement} */(b).dataset.apdel; const i=ASSETS_PROMPTS.findIndex(x=>x.id===id); if(i<0) return;
    const snap=ASSETS_PROMPTS[i]; ASSETS_PROMPTS.splice(i,1);
    if(collPersistOn()) /** @type {any} */ (window).SeekerRT.db.remove('assets_prompts', String(snap.id)).catch((/** @type {unknown} */ e)=>console.error('[assets] remove prompt', e));
    renderPrompts();
    toastUndo(tt('已删除「','Deleted "')+(apEsc(snap.title)||tt('未命名','untitled'))+tt('」','"'), ()=>{ ASSETS_PROMPTS.splice(i,0,snap); persistPrompts(); renderPrompts(); }); // 第23轮[应改]:toast 消息经 el(innerHTML) 渲染,title 须转义(同 render 路径纪律)
  };});
}

/** @param {string} id 空串 = 新建 */
function openPromptModal(id){
  const p=ASSETS_PROMPTS.find(x=>x.id===id);
  openModal(`<div class="modal-head"><div><p class="eyebrow">— PROMPT</p><h2 style="margin-top:5px;">${p?tt('编辑 Prompt','Edit prompt'):tt('新建 Prompt','New prompt')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="set-row"><span class="sk">${tt('标题','Title')}</span><input class="input" id="apTitle" value="${apEsc(p?p.title:'')}" placeholder="${tt('如:代码评审提示词','e.g. code-review prompt')}"></div>
      <textarea class="input" id="apText" rows="10" style="width:100%;margin-top:10px;font-family:var(--font-mono);font-size:12.5px;line-height:1.7;" placeholder="${tt('Prompt 正文…','Prompt body…')}">${apEsc(p?p.text:'')}</textarea>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="apSave">${tt('保存','Save')}</button></div>`, true);
  const save=$('#apSave'); if(save) /** @type {HTMLElement} */(save).onclick=()=>{
    const title=(/** @type {HTMLInputElement|null} */($('#apTitle'))||{value:''}).value.trim();
    const text=(/** @type {HTMLTextAreaElement|null} */($('#apText'))||{value:''}).value;
    if(!title && !text.trim()){ toast(tt('写点内容再保存','Add some content first')); return; }
    if(p){ p.title=title; p.text=text; p.updated=Date.now(); }
    else ASSETS_PROMPTS.push({ id:'ap_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), title, text, updated:Date.now() });
    persistPrompts(); closeModal(); renderPrompts(); toast(tt('已保存','Saved'));
  };
}

/** ★S3 知情通知(**非**隐私同意闸)—— prompts → 平台 `platform_skills` 迁移。
 *  与 notes→知识库的**关键区别**(第79轮 [建议]2):`platform_skills` **不进 QUERYABLE**、永不 AI 可读 ⇒ 迁移
 *  **不扩大** AI 可读面(零或收窄:若曾授权 Prompt 库可读,迁后 AI 不再可读)。故文案是**知情通知说清真实变化**,
 *  不是「扩大 AI 可读」的同意闸。**非破坏**(原 Prompt 保留);幂等键=`p.skillId`(自愈);状态未知拒绝行动(免重复)。 */
function openMigrateSkillsModal(){
  if(!skillsStatusKnown){ toast(tt('无法确认 Skills 状态,请稍后重试','Cannot confirm Skills state — please retry')); return; } // 判定不了就别动
  const pending=ASSETS_PROMPTS.filter(p=>!promptMigrated(p));
  if(!pending.length){ toast(tt('没有待迁入的 Prompt','Nothing to migrate')); return; }
  openModal(`<div class="modal-head"><div><p class="eyebrow">— SKILLS</p><h2 style="margin-top:5px;">${tt('把 Prompt 迁入 Skills?','Migrate prompts to Skills?')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body" style="font-size:13.5px;line-height:1.85;color:var(--ink-2);">
      <p style="margin:0 0 10px;">${tt(`将把 ${pending.length} 条 Prompt 变成可执行 Skill(原 Prompt 保留,不会被删除)。Skill 一点即运行(Agent 用它跑一轮),在「能力中心 → 技能」管理。`,`Turns ${pending.length} prompt(s) into executable Skills (your prompts are kept, not deleted). A Skill runs in one click (the Agent runs it), managed in Capabilities → Skills.`)}</p>
      <p style="margin:0;color:var(--ink-3);font-size:12.5px;">${tt('这不会扩大 AI 能读到的范围 —— Skill 是你的指令,永不进 AI 检索。若你曾授权 Prompt 库可读,迁移后这些内容 AI 将不再自动可读。','This does not widen what the AI can read — Skills are your instructions and never enter AI retrieval. If you had granted the Prompt Library as readable, the AI will no longer auto-read this content after migration.')}</p>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="apMigGo">${tt('迁入','Migrate')}</button></div>`);
  const go=$('#apMigGo'); if(go) /** @type {HTMLElement} */(go).onclick=async ()=>{
    /** @type {HTMLButtonElement} */(go).disabled=true; go.textContent=tt('迁入中…','Migrating…'); // 物理闸:await 窗口内不可重入
    let done=0, failed=0; let firstErr='';
    for(const p of pending){
      try{
        const id='sk_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
        await saveSkill({ id, name:p.title, description:'', prompt:p.text, updated_at:Date.now() });
        p.skillId=id; done++;                          // 幂等键:下次跳过(自愈见 promptMigrated);fresh id ⇒ 不覆盖用户对既有 Skill 的编辑
      }catch(e){ failed++; if(!firstErr) firstErr=errText(e); }
    }
    if(done) persistPrompts();                          // 存 p.skillId(桌面持久;web 端 prompts 本就临时态、无 reload 存活)
    closeModal();
    await renderPrompts();                              // 重渲(内含 refreshMigratedSkills 自愈)
    // 如实上报:成功几条、失败几条、第一条失败的真实原因
    if(done) toast(tt('已迁入 ','Migrated ')+done+tt(' 条到 Skills','  to Skills'));
    if(failed) toast(tt('有 ','')+failed+tt(' 条未能迁入','  could not migrate')+(firstErr?' · '+firstErr:''));
  };
}

window.addEventListener('seeker-rt-ready', async ()=>{
  try{ await hydrateColl('assets_prompts', ASSETS_PROMPTS); if(currentPage()==='prompts') renderPrompts(); }
  catch(e){ console.error('[assets] hydrate prompts', e); }
});
