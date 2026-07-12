// @ts-check
/** assets(数据资产)· 笔记页(阶段4 第二应用 · 新代码依 C5 直接 @ts-check)。
 *  数据:ASSETS_NOTES(空启动);持久化走平台通用引擎 persistColl/hydrateColl('assets_notes')+ rt.db.remove;
 *  水合经 seeker-rt-ready(classic 解析期注册,同第5轮时序法)。
 *  红线:用户输入进 DOM 前一律 anEsc 转义;删除走 toastUndo 可撤销(§4-3 反焦虑)。
 *
 *  ★★**「迁入知识库」是一次隐私域升级,必须知情同意**(§4-2):
 *   · `assets` 整应用 `aiReadable: 'default-off'` —— 本文件同目录的 manifest 写明了理由:
 *     **「笔记是自由文本兜底容器、可能承载敏感个人信息」**,故需用户在应用管理页显式授权才进 AI 可读集。
 *   · 而**知识库(`doc_chunks`)是 `Kind::Context`** —— 经 `contribute_all` → `build_context_message`
 *     **自动进模型上下文**(`src-tauri/src/ai.rs:411`),**没有 per-app 闸**。
 *   ⇒ 把笔记迁进知识库 = 把内容从「默认不可读、需授权」搬到「**无需授权、自动被召回**」。
 *   ⇒ 因此**绝不能是一个静默按钮**:迁移前必须把这句话原原本本讲给用户,并告诉他怎么撤回
 *     (能力中心 → 知识库 → 删除,那条路已在撤销债 arc 里彻底加固:可撤销、决策点说真话)。
 *   ⇒ 迁移本身**非破坏性**:笔记原样留在本地,只是**多了一份**进了知识库。故不走 guardrail
 *     (guardrail 的判据是「用户有没有可失去之物」—— 这里他不失去,只是**多暴露**;所以要的是
 *     **知情同意**,不是撤销闸)。**别把两者搞混。**
 *
 *  ★批7:平台基元改 import;renderNotes 由 assets/manifest.js import 消费(唯一外部消费者)→ 不再上 window 桥。
 *    (内联 onclick "closeModal()" 仍按 window 解析——modal.js 运行时桥仍在。shell-globals.d.ts 仍服务两 manifest 的 tt 等 ambient,留待账本清空批10。) */
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { errText, toast, toastUndo } from '../../../platform/shell/toast.js';
import { openModal, closeModal } from '../../../platform/shell/modal.js';
import { persistColl, collPersistOn, hydrateColl } from '../../../platform/shell/data-store.js';
import { currentPage, frontis, signFoot } from '../../../platform/shell/nav.js';

/** @type {Array<{id:string, text:string, updated:number, docId?:string}>} */
const ASSETS_NOTES = [];

/** 本次渲染时,知识库里实际存在的 docId 集合 —— 用它判断一条笔记「是否真的还在知识库里」,
 *  而不是只看本地的 `docId` 字段(用户可能已在能力中心把那篇文档删了)。**自愈,不留悬挂引用。** */
let LIVE_DOC_IDS = new Set();
/** 后端知识库状态**是否已知**。`rt.docs.list()` **抛错**时为 false(web 端返回 `[]` 是「已知为空」,不算未知)。
 *  ★评审第67轮 [建议]:状态未知时**拒绝行动**,不假设最宽松 —— 否则会诱导用户在知识库里造重复副本
 *  (`docs.add` 不会拒绝,它会欣然再加一份,RAG top-k 被同一段内容稀释)。**判定不了就别动 = fail-closed。** */
let docsStatusKnown = false;

/** 笔记 → 知识库文档的标题:取首行(截断),空则退回时间戳。
 *  @param {{text:string, updated:number}} n */
function noteDocName(n) {
  const first = String(n.text || '').split('\n')[0].trim();
  return first ? first.slice(0, 40) : tt('笔记 · ', 'Note · ') + new Date(n.updated || 0).toLocaleString();
}

/** 这条笔记是否已在知识库里(本地有 docId **且**该文档确实还在)。
 *  @param {{docId?:string}} n */
const inKnowledge = (n) => !!n.docId && LIVE_DOC_IDS.has(n.docId);

/** @param {unknown} s @returns {string} */
function anEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function persistNotes(){ persistColl('assets_notes', ASSETS_NOTES); }

export function renderNotes(){
  const host=$('#page-notes'); if(!host) return;
  const rows=ASSETS_NOTES.slice().sort((a,b)=>(b.updated||0)-(a.updated||0));
  const list=rows.length
    ? rows.map(n=>`<div class="sec" style="padding:16px 0;">
        <div style="display:flex;align-items:baseline;gap:10px;">
          <span class="mono" style="font-size:10.5px;color:var(--ink-3);">${new Date(n.updated||0).toLocaleString()}</span>
          <span style="flex:1;"></span>
          ${inKnowledge(n)?`<span class="mono" style="font-size:10px;color:var(--accent);">${tt('已在知识库','IN KNOWLEDGE')}</span>`:''}
          <button class="btn" data-anedit="${anEsc(n.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('编辑','Edit')}</button>
          <button class="btn" data-andel="${anEsc(n.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('删除','Delete')}</button>
        </div>
        <p style="margin:8px 0 0;font-size:13.5px;line-height:1.8;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;">${anEsc(n.text)}</p>
      </div>`).join('')
    : `<div class="sec" style="border-bottom:none;"><p style="font-size:13.5px;color:var(--ink-3);line-height:1.8;max-width:560px;">${tt('还没有笔记。随手记下想法、片段与线索 —— 只存本地;授权后 AI 也能检索引用。','No notes yet. Jot down ideas, snippets, leads — local-only; with your grant the AI can reference them.')}</p></div>`;
  // ★fail-closed:状态未知(问不到后端)⇒ 按钮禁用 + 提示重试,绝不让用户在盲态下造重复副本。
  const pending=docsStatusKnown ? ASSETS_NOTES.filter(n=>!inKnowledge(n)).length : 0;
  const kbBtn = (!docsStatusKnown && ASSETS_NOTES.length)
    ? `<button class="btn" id="anToKb" disabled style="opacity:.5;cursor:not-allowed;">${tt('迁入知识库','Add to knowledge')}</button><span class="mono" style="font-size:10px;color:var(--ink-3);">${tt('无法确认知识库状态,稍后重试','Cannot confirm knowledge state — retry later')}</span>`
    : (pending?`<button class="btn" id="anToKb">${tt('迁入知识库','Add to knowledge')} · ${pending}</button>`:'');
  // ★S4 软退役引导(反焦虑、非倒计时):笔记可迁入知识库;迁完可在应用管理自行关闭此应用(数据保留)。
  const retireNote=`<div class="sec" style="border-bottom:none;padding-bottom:0;"><div class="lock-note" style="margin:0;max-width:680px;"><span class="li">✨</span><span>${tt('笔记可迁入<b>知识库</b> —— 迁入后 AI 能检索作答(需你在迁入弹窗确认,那会扩大 AI 可读范围)。若你把 Prompt/笔记都迁走了,可在<b>应用管理</b>关闭「数据资产」应用;<b>数据始终保留、可导出</b>。','Notes can move into the <b>Knowledge base</b> — once added, the AI can retrieve them (you confirm in the dialog, which widens what the AI can read). Once you have migrated both prompts and notes, you can close the Data Assets app in <b>App Manager</b>; <b>your data is always kept and exportable</b>.')}</span></div></div>`;
  host.innerHTML=frontis('NOTES', tt('笔记','Notes'))
    +retireNote
    +`<div class="sec" style="border-bottom:none;padding-bottom:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><button class="btn btn-accent" id="anAdd">${tt('+ 新建笔记','+ New note')}</button>`
    +kbBtn
    +`</div>`
    +list+signFoot();
  const add=$('#anAdd'); if(add) /** @type {HTMLElement} */(add).onclick=()=>openNoteModal('');
  const kb=$('#anToKb'); if(kb && !(/** @type {HTMLButtonElement} */(kb).disabled)) /** @type {HTMLElement} */(kb).onclick=()=>openMigrateModal();
  $$('#page-notes [data-anedit]').forEach(b=>{ /** @type {HTMLElement} */(b).onclick=()=>openNoteModal(/** @type {HTMLElement} */(b).dataset.anedit||''); });
  $$('#page-notes [data-andel]').forEach(b=>{ /** @type {HTMLElement} */(b).onclick=()=>{
    const id=/** @type {HTMLElement} */(b).dataset.andel; const i=ASSETS_NOTES.findIndex(x=>x.id===id); if(i<0) return;
    const snap=ASSETS_NOTES[i]; ASSETS_NOTES.splice(i,1);
    if(collPersistOn()) /** @type {any} */ (window).SeekerRT.db.remove('assets_notes', String(snap.id)).catch((/** @type {unknown} */ e)=>console.error('[assets] remove note', e));
    renderNotes();
    toastUndo(tt('已删除笔记','Note deleted'), ()=>{ ASSETS_NOTES.splice(i,0,snap); persistNotes(); renderNotes(); });
  };});
}

/**
 * 刷新「哪些笔记真的还在知识库里」。**不看本地 docId,看后端实际有哪些文档** ——
 * 用户可能已在能力中心把某篇删了,那条笔记应当重新变成「可迁入」。**自愈,不留悬挂引用。**
 *
 * ★评审第67轮 [建议] 订正了我原来的「保守 = 假设一篇都不在」:那不是保守,是**假设最宽松的状态** ——
 * 于是所有笔记显示「可迁入」,用户一点就在知识库里造出重复副本(`docs.add` 不会拒绝)。
 * **真正的保守是拒绝行动**:`docs.list()` 抛错 ⇒ `docsStatusKnown=false` ⇒ 迁入按钮禁用 + 提示重试;
 * 既不谎称「已在知识库」,也不制造重复。
 */
async function refreshLiveDocIds(){
  try{
    const rt=/** @type {any} */(window).SeekerRT;
    const rows=await rt.docs.list();
    LIVE_DOC_IDS=new Set((rows||[]).map((/** @type {any} */d)=>String(d.docId)));
    docsStatusKnown=true;                         // 成功(含 web 端返回空列表)⇒ 状态已知
  }catch(_e){ LIVE_DOC_IDS=new Set(); docsStatusKnown=false; }  // ★问不到 ⇒ 状态未知,拒绝行动
}

/**
 * ★★知情同意闸(§4-2)—— 见文件头。**迁移非破坏性,故不走 guardrail;但它扩大 AI 可读面,
 * 故必须在用户点下去之前把后果讲清,并告诉他怎么撤回。**
 */
function openMigrateModal(){
  if(!docsStatusKnown){ toast(tt('无法确认知识库状态,请稍后重试','Cannot confirm knowledge state — please retry')); return; } // ★判定不了就别动
  const pending=ASSETS_NOTES.filter(n=>!inKnowledge(n));
  if(!pending.length){ toast(tt('没有待迁入的笔记','Nothing to add')); return; }
  openModal(`<div class="modal-head"><div><p class="eyebrow">— KNOWLEDGE</p><h2 style="margin-top:5px;">${tt('把笔记迁入知识库?','Add notes to knowledge?')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body" style="font-size:13.5px;line-height:1.85;color:var(--ink-2);">
      <p style="margin:0 0 10px;">${tt(`将把 ${pending.length} 条笔记加入知识库(原笔记保留,不会被删除)。`,`Adds ${pending.length} note(s) to the knowledge base. Your notes are kept, not deleted.`)}</p>
      <p style="margin:0 0 10px;"><strong>${tt('这会扩大 AI 能读到的范围。','This widens what the AI can read.')}</strong>${tt('笔记本身默认不进 AI 可读集(需要你在应用管理页授权);而知识库是 AI 的自动召回上下文 —— 迁入后,AI 无需任何授权即可检索到这些内容。','Notes are AI-unreadable by default (you grant access in the app manager). The knowledge base, however, is auto-recalled context — once added, the AI can retrieve this content without any further grant.')}</p>
      <p style="margin:0;color:var(--ink-3);font-size:12.5px;">${tt('随时可在「能力中心 → 知识库」删除它们(可撤销)。','You can remove them anytime in Capabilities → Knowledge (undoable).')}</p>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="anKbGo">${tt('迁入','Add')}</button></div>`);
  const go=$('#anKbGo'); if(go) /** @type {HTMLElement} */(go).onclick=async ()=>{
    /** @type {HTMLButtonElement} */(go).disabled=true;                    // 物理闸:await 窗口内不可重入
    go.textContent=tt('迁入中…','Adding…');
    const rt=/** @type {any} */(window).SeekerRT;
    let done=0, failed=0; let firstErr='';
    for(const n of pending){
      try{
        const r=await rt.docs.add(noteDocName(n), n.text);
        if(r&&r.docId){ n.docId=String(r.docId); done++; }               // 幂等键:下次跳过
        else failed++;
      }catch(e){ failed++; if(!firstErr) firstErr=errText(e); }
    }
    if(done) persistNotes();
    closeModal();
    await refreshLiveDocIds();
    renderNotes();
    // 如实上报:成功几条、失败几条、第一条失败的**真实原因**(如未配置嵌入模型 / 网页端不支持)
    if(done) toast(tt('已迁入 ','Added ')+done+tt(' 条笔记到知识库','note(s) to knowledge'));
    if(failed) toast(tt('有 ','')+failed+tt(' 条未能迁入','  note(s) could not be added')+(firstErr?' · '+firstErr:''));
    if(!done&&!failed) toast(tt('没有待迁入的笔记','Nothing to add'));
  };
}

/** @param {string} id 空串 = 新建 */
function openNoteModal(id){
  const n=ASSETS_NOTES.find(x=>x.id===id);
  openModal(`<div class="modal-head"><div><p class="eyebrow">— NOTE</p><h2 style="margin-top:5px;">${n?tt('编辑笔记','Edit note'):tt('新建笔记','New note')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body"><textarea class="input" id="anText" rows="8" style="width:100%;font-size:13.5px;line-height:1.8;" placeholder="${tt('写点什么…','Write something…')}">${anEsc(n?n.text:'')}</textarea></div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="anSave">${tt('保存','Save')}</button></div>`);
  const save=$('#anSave'); if(save) /** @type {HTMLElement} */(save).onclick=()=>{
    const text=(/** @type {HTMLTextAreaElement|null} */($('#anText'))||{value:''}).value;
    if(!text.trim()){ toast(tt('写点内容再保存','Add some content first')); return; }
    if(n){ n.text=text; n.updated=Date.now(); }
    else ASSETS_NOTES.push({ id:'an_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), text, updated:Date.now() });
    persistNotes(); closeModal(); renderNotes(); toast(tt('已保存','Saved'));
  };
}

window.addEventListener('seeker-rt-ready', async ()=>{
  try{
    await hydrateColl('assets_notes', ASSETS_NOTES);
    await refreshLiveDocIds();               // 「已在知识库」以后端实况为准,不认本地 docId 的一面之词
    if(currentPage()==='notes') renderNotes();
  }
  catch(e){ console.error('[assets] hydrate notes', e); }
});
