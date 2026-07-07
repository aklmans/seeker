// @ts-check
/** assets(数据资产)· 笔记页(阶段4 第二应用 · 新代码依 C5 直接 @ts-check)。
 *  数据:ASSETS_NOTES(空启动);持久化走平台通用引擎 persistColl/hydrateColl('assets_notes')+ rt.db.remove;
 *  水合经 seeker-rt-ready(classic 解析期注册,同第5轮时序法)。
 *  红线:用户输入进 DOM 前一律 anEsc 转义;删除走 toastUndo 可撤销(§4-3 反焦虑)。 */

/** @type {Array<{id:string, text:string, updated:number}>} */
const ASSETS_NOTES = [];

/** @param {unknown} s @returns {string} */
function anEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function persistNotes(){ persistColl('assets_notes', ASSETS_NOTES); }

function renderNotes(){
  const host=$('#page-notes'); if(!host) return;
  const rows=ASSETS_NOTES.slice().sort((a,b)=>(b.updated||0)-(a.updated||0));
  const list=rows.length
    ? rows.map(n=>`<div class="sec" style="padding:16px 0;">
        <div style="display:flex;align-items:baseline;gap:10px;">
          <span class="mono" style="font-size:10.5px;color:var(--ink-3);">${new Date(n.updated||0).toLocaleString()}</span>
          <span style="flex:1;"></span>
          <button class="btn" data-anedit="${anEsc(n.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('编辑','Edit')}</button>
          <button class="btn" data-andel="${anEsc(n.id)}" style="padding:3px 10px;font-size:11.5px;">${tt('删除','Delete')}</button>
        </div>
        <p style="margin:8px 0 0;font-size:13.5px;line-height:1.8;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;">${anEsc(n.text)}</p>
      </div>`).join('')
    : `<div class="sec" style="border-bottom:none;"><p style="font-size:13.5px;color:var(--ink-3);line-height:1.8;max-width:560px;">${tt('还没有笔记。随手记下想法、片段与线索 —— 只存本地;授权后 AI 也能检索引用。','No notes yet. Jot down ideas, snippets, leads — local-only; with your grant the AI can reference them.')}</p></div>`;
  host.innerHTML=frontis('NOTES', tt('笔记','Notes'))
    +`<div class="sec" style="border-bottom:none;padding-bottom:6px;"><button class="btn btn-accent" id="anAdd">${tt('+ 新建笔记','+ New note')}</button></div>`
    +list+signFoot();
  const add=$('#anAdd'); if(add) /** @type {HTMLElement} */(add).onclick=()=>openNoteModal('');
  $$('#page-notes [data-anedit]').forEach(b=>{ /** @type {HTMLElement} */(b).onclick=()=>openNoteModal(/** @type {HTMLElement} */(b).dataset.anedit||''); });
  $$('#page-notes [data-andel]').forEach(b=>{ /** @type {HTMLElement} */(b).onclick=()=>{
    const id=/** @type {HTMLElement} */(b).dataset.andel; const i=ASSETS_NOTES.findIndex(x=>x.id===id); if(i<0) return;
    const snap=ASSETS_NOTES[i]; ASSETS_NOTES.splice(i,1);
    if(collPersistOn()) /** @type {any} */ (window).SeekerRT.db.remove('assets_notes', String(snap.id)).catch((/** @type {unknown} */ e)=>console.error('[assets] remove note', e));
    renderNotes();
    toastUndo(tt('已删除笔记','Note deleted'), ()=>{ ASSETS_NOTES.splice(i,0,snap); persistNotes(); renderNotes(); });
  };});
}

/** @param {string} id 空串 = 新建 */
function openNoteModal(id){
  const n=ASSETS_NOTES.find(x=>x.id===id);
  openModal(`<div class="modal-head"><div><p class="eyebrow">— NOTE</p><h2 style="margin-top:5px;">${n?tt('编辑笔记','Edit note'):tt('新建笔记','New note')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body"><textarea class="input" id="anText" rows="8" style="width:100%;font-size:13.5px;line-height:1.8;" placeholder="${tt('写点什么…','Write something…')}">${anEsc(n?n.text:'')}</textarea></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">${tt('取消','Cancel')}</button><button class="btn btn-accent" id="anSave">${tt('保存','Save')}</button></div>`);
  const save=$('#anSave'); if(save) /** @type {HTMLElement} */(save).onclick=()=>{
    const text=(/** @type {HTMLTextAreaElement|null} */($('#anText'))||{value:''}).value;
    if(!text.trim()){ toast(tt('写点内容再保存','Add some content first')); return; }
    if(n){ n.text=text; n.updated=Date.now(); }
    else ASSETS_NOTES.push({ id:'an_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), text, updated:Date.now() });
    persistNotes(); closeModal(); renderNotes(); toast(tt('已保存','Saved'));
  };
}

window.addEventListener('seeker-rt-ready', async ()=>{
  try{ await hydrateColl('assets_notes', ASSETS_NOTES); if(currentPage()==='notes') renderNotes(); }
  catch(e){ console.error('[assets] hydrate notes', e); }
});
