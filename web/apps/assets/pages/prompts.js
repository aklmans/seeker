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
import { toast, toastUndo } from '../../../platform/shell/toast.js';
import { openModal, closeModal } from '../../../platform/shell/modal.js';
import { persistColl, collPersistOn, hydrateColl } from '../../../platform/shell/data-store.js';
import { currentPage, frontis, signFoot } from '../../../platform/shell/nav.js';

/** @type {Array<{id:string, title:string, text:string, updated:number}>} */
const ASSETS_PROMPTS = [];

/** @param {unknown} s @returns {string} */
function apEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function persistPrompts(){ persistColl('assets_prompts', ASSETS_PROMPTS); }

export function renderPrompts(){
  const host=$('#page-prompts'); if(!host) return;
  const rows=ASSETS_PROMPTS.slice().sort((a,b)=>(b.updated||0)-(a.updated||0));
  const list=rows.length
    ? rows.map(p=>`<div class="sec" style="padding:16px 0;">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
          <h3 style="font-size:15px;color:var(--ink);margin:0;font-weight:600;">${apEsc(p.title)||tt('(未命名)','(untitled)')}</h3>
          <span class="mono" style="font-size:10.5px;color:var(--ink-3);">${new Date(p.updated||0).toLocaleDateString()}</span>
          <span style="flex:1;"></span>
          <button class="btn" data-apcopy="${apEsc(p.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('复制','Copy')}</button>
          <button class="btn" data-apedit="${apEsc(p.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('编辑','Edit')}</button>
          <button class="btn" data-apdel="${apEsc(p.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('删除','Delete')}</button>
        </div>
        <pre style="margin:10px 0 0;padding:12px 14px;background:var(--bg-subtle);border:0.5px solid var(--border);font-size:12.5px;line-height:1.7;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);">${apEsc(p.text)}</pre>
      </div>`).join('')
    : `<div class="sec" style="border-bottom:none;"><p style="font-size:13.5px;color:var(--ink-3);line-height:1.8;max-width:560px;">${tt('还没有 Prompt。把你反复使用的提示词沉淀在这里 —— 本地保存,可随时复制取用;授权后 AI 也能检索引用。','No prompts yet. Curate the prompts you reuse — stored locally, one-click copy; with your grant the AI can reference them too.')}</p></div>`;
  host.innerHTML=frontis('PROMPTS', tt('Prompt 库','Prompt Library'))
    +`<div class="sec" style="border-bottom:none;padding-bottom:6px;"><button class="btn btn-accent" id="apAdd">${tt('+ 新建 Prompt','+ New prompt')}</button></div>`
    +list+signFoot();
  const add=$('#apAdd'); if(add) /** @type {HTMLElement} */(add).onclick=()=>openPromptModal('');
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

window.addEventListener('seeker-rt-ready', async ()=>{
  try{ await hydrateColl('assets_prompts', ASSETS_PROMPTS); if(currentPage()==='prompts') renderPrompts(); }
  catch(e){ console.error('[assets] hydrate prompts', e); }
});
