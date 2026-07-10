/** 平台 · 长期记忆 + 知识库(RAG 文档)管理 —— P1-c:从 `settings.js` 的两个 module-private 模态
 *  (`openMemoryManager` / `openDocsManager`)**搬迁**至能力中心,提为一等公民内联视图。
 *
 *  **零新后端**:复用既有 `rt.memory.*`(list/remove/clear/undo)与 `rt.docs.*`(list/add/remove/clear/undo)。
 *
 *  ★红线(§4-3 破坏性 · §4-4 转义):
 *   - **破坏性(§4-3)· 两档 + 撤销世代守卫**:
 *     · **安全内核**:Agent/widget 触发的破坏性永远走 guardrail —— 而**模型根本无法删记忆**
 *       (`memory` 工具 `op` enum 仅 `remember`/`recall`、无 `Permission::Destructive`,memory.rs:75/88),
 *       故本页的删除**纯属用户 UI 发起**。
 *     · **用户发起**:记忆逐条删 = 即时删 + `toastUndo`;记忆清空 / 文档删 / 文档清空 = `guardrail`
 *       的 `confirmDestructive`(预览 + 确认 + `onUndo`),`!G` 时 fail-closed 早返。
 *     · ★**撤销语义 = 撤销「最近一次销毁」,而非「撤销这一条」**(评审第56轮 [应改] 坐实):后端
 *       `MemTrash`/`DocTrash` 各自是**单槽覆盖**(`*trash = snap`,data.rs:593/622;`memory_undo` 用
 *       `mem::take` 取走并清空)。⇒ **任何新的销毁都会让本域先前的撤销立即过期**。本模块据此守卫:
 *       ① 新销毁前**摘掉本域尚存的撤销 toast**(不留会还原错记录的死按钮);② 过期的撤销回调
 *       **诚实拒绝**并提示,而非静默还原错记录。(修前实测:6.5s 内连删两条 → 第一条快照被覆盖、
 *       其 toast 仍可点 → 还原的是第二条,第一条永久丢失。)
 *       ⚠ **不得改 `toast.js` 共享原语**:notes/prompts/resumes 的撤销是**闭包快照、各自独立正确**,
 *       做成全局互斥反而把它们改坏。世代守卫**只作用于本模块自己的两个 trash 域**(memory / docs)。
 *   - **转义不变式**(覆盖两条 sink,勿声明为假):用户/外部内容进 DOM **一律** `cEsc`(`&<>"`)——
 *     ① `innerHTML` 渲染(含 `data-memdel` / `data-docdel` **属性位**;原 `_mgrEsc`/`esc` 只转 `&<>`、
 *     **漏 `"`**,属性位有漂移风险,本刀一并收敛);② **`toast()` 路径**(`toast`→`el`→`template.innerHTML`
 *     是 HTML sink,见 toast.js:9 / dom.js:9)—— **原 `openDocsManager` 把用户填的文档名裸拼进 toast
 *     = 自 XSS,本刀修复**(承第55轮 [应改] 同款纪律)。
 *   - **唯一有意免转义处**:`guardrail.confirmDestructive` 的 `detail` 走 `textContent`
 *     (`platform/guardrail/index.js:71`),传裸名安全 —— 勿"顺手"加转义(会把 `&amp;` 显给用户)。
 *
 *  ★数据性质(措辞须精确,勿过度声称):
 *   - **长期记忆 / 知识库文档本就是 Agent 的上下文** —— AI **会**读取它们(`LongTermMemory` / `DocContext`
 *     能力),这是设计意图,非泄露。本视图让用户**查看与删除**它们(掌控权)。
 *   - 记忆内容可能含用户主动写入的 PII;文档内容可能是外部(不可信)语料 —— 二者进 DOM 全 `cEsc`。
 *   - 本视图本身是**「给人看」的前端面**,不把任何东西额外喂进模型上下文。 */
import { cEsc } from './copilot-chrome.js';
import { tt } from './i18n.js';
import { errText, toast, toastUndo } from './toast.js';

const fmtTs = (ts) => { try { return new Date(+ts || 0).toLocaleString(); } catch (_e) { return ''; } };
const emptyLine = (txt) => `<p style="color:var(--ink-3);font-size:12px;padding:12px 0;">${txt}</p>`;

/* ── 撤销世代守卫(见模块头 §4-3):后端 MemTrash / DocTrash 各自单槽、只存「最近一次销毁」。
      任一域发生新销毁 → 该域此前的撤销 affordance 立即过期。两域计数独立(后端两个 State 亦独立)。 */
let memGen = 0, docGen = 0;
let memUndoToast = null; // 记忆域当前在场的 toastUndo 元素(新销毁前摘掉,避免留下会还原错记录的死按钮)
const dropToast = (t) => { if (t && t.isConnected) t.remove(); };
const expiredUndo = () => toast(tt(
  '该撤销已过期 —— 此后又发生了新的销毁(只能撤销最近一次)。',
  'Undo expired — a newer deletion superseded it (only the most recent can be undone).'
));
/** toastUndo 无返回值:它同步 append 到 #toasts,故紧随其后的 lastElementChild 即本次的 toast。 */
const lastToastEl = () => { const h = document.getElementById('toasts'); return h ? h.lastElementChild : null; };

/* ─────────────────────────── 长期记忆 ─────────────────────────── */

/** 记忆视图:列表(内容 + 时间)+ 逐条删(即时 + toastUndo 撤销)+ 清除全部(guardrail 预览确认撤销)。 */
export async function renderMemory(box) {
  if (!box) return;
  const rt = window.SeekerRT;
  const G = window.SeekerGuardrail;

  box.innerHTML = `<div id="ccMemBody" style="max-width:660px;">${tt('加载中…', 'Loading…')}</div>
    <div style="margin-top:10px;"><button class="btn" id="ccMemClear" style="display:none;padding:4px 12px;font-size:11px;">${tt('清除全部记忆', 'Clear all memory')}</button></div>`;

  const refresh = async () => {
    let rows = [];
    try { rows = await rt.memory.list(); } catch (_e) {}
    const body = box.querySelector('#ccMemBody');
    if (!body) return;
    body.innerHTML = rows.length
      // r.fact = 用户主动写入的内容,可能含 PII → cEsc 后只呈现给用户;r.id 落 data-* 属性位 → cEsc 转 " 封越狱。
      ? `<p style="font-size:12px;color:var(--ink-3);margin:0 0 12px;">${tt('AI 记住的内容 · 共 ', 'What AI remembers · ')}${rows.length}${tt(' 条 · 仅存本地', ' · local only')}</p>`
        + rows.map((r) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:0.5px solid var(--border);"><div style="flex:1;"><div style="font-size:13px;color:var(--ink-2);line-height:1.55;">${cEsc(r.fact)}</div><div style="font-family:var(--font-mono);font-size:9.5px;color:var(--ink-mute);margin-top:3px;">${fmtTs(r.ts)}</div></div><button class="btn" data-memdel="${cEsc(r.id)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('删除', 'Delete')}</button></div>`).join('')
      : emptyLine(tt('AI 还没有记住任何内容。', 'Nothing remembered yet.'));

    // 逐条删:即时删除 + toastUndo。★后端单槽:先摘掉尚存的旧撤销(它此刻即将失效),再以世代号守卫。
    [...box.querySelectorAll('[data-memdel]')].forEach((b) => (b.onclick = async () => {
      dropToast(memUndoToast); memUndoToast = null;
      const gen = ++memGen;
      try { await rt.memory.remove(b.dataset.memdel); } catch (_e) {}
      await refresh();
      toastUndo(tt('已删除该记忆', 'Memory deleted'), async () => {
        if (gen !== memGen) return expiredUndo(); // 过期:诚实拒绝,绝不静默还原错记录
        try { await rt.memory.undo(); } catch (_e) {}
        await refresh();
      });
      memUndoToast = lastToastEl();
    }));
    const cb = box.querySelector('#ccMemClear');
    if (cb) cb.style.display = rows.length ? '' : 'none';
  };
  await refresh();

  // 清除全部 = 破坏性 → guardrail(预览 + 确认 + 撤销)。
  const cb = box.querySelector('#ccMemClear');
  if (cb) cb.onclick = async () => {
    if (!G || !G.confirmDestructive) return; // fail-closed
    let gen = 0; // onConfirm 时登记世代;onUndo 据此判断是否已被更新的销毁取代
    await G.confirmDestructive({
      title: tt('清除全部长期记忆?', 'Clear all long-term memory?'),
      detail: tt('将删除 AI 记住的全部内容。可在几秒内撤销(仅能撤销最近一次销毁)。', 'Deletes everything AI remembers. Undoable for a few seconds (only the most recent destruction).'),
      confirmLabel: tt('清除', 'Clear'),
      undoText: tt('已清除长期记忆', 'Memory cleared'),
      onConfirm: async () => {
        dropToast(memUndoToast); memUndoToast = null; // 清空即将覆盖单槽 → 旧的逐条撤销就此失效
        gen = ++memGen;
        try { await rt.memory.clear(); } catch (_e) {}
        await refresh();
      },
      onUndo: async () => {
        if (gen !== memGen) return expiredUndo();
        try { await rt.memory.undo(); } catch (_e) {}
        await refresh();
      },
    });
  };
}

/* ─────────────────────────── 知识库(RAG 文档)─────────────────────────── */

/** 知识库视图:添加(粘贴 / 选 .txt·.md)+ 列表(名/片段数/时间)+ 逐条删 + 清空(均走 guardrail)。 */
export async function renderDocs(box) {
  if (!box) return;
  const rt = window.SeekerRT;
  const G = window.SeekerGuardrail;

  box.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;max-width:560px;">
      <input class="input" id="ccDocName" placeholder="${tt('文档名称(如 字节后端 JD)', 'Doc name (e.g. ByteDance JD)')}">
      <textarea class="input" id="ccDocText" rows="4" placeholder="${tt('粘贴文档内容,或从下方选 .txt / .md 文件', 'Paste text, or pick a .txt/.md file below')}" style="resize:vertical;font-family:inherit;"></textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-accent" id="ccDocAddBtn">${tt('添加到知识库', 'Add to knowledge')}</button>
        <button class="btn" id="ccDocFileBtn">${tt('选文件 .txt/.md', 'Pick .txt/.md')}</button>
        <input type="file" id="ccDocFile" accept=".txt,.md,text/plain,text/markdown" style="display:none">
        <span class="mono" id="ccDocHint" style="font-size:11px;color:var(--ink-mute);"></span>
      </div>
    </div>
    <div id="ccDocList" style="max-width:660px;">${tt('加载中…', 'Loading…')}</div>
    <div style="margin-top:10px;"><button class="btn" id="ccDocClear" style="display:none;padding:4px 12px;font-size:11px;">${tt('清空全部', 'Clear all')}</button></div>`;

  const q = (sel) => box.querySelector(sel);

  const refresh = async () => {
    let rows = [];
    try { rows = await rt.docs.list(); } catch (_e) {}
    const body = q('#ccDocList');
    if (!body) return;
    // d.name = 用户填的名 / 文件名(可能是外部语料标题)→ cEsc;d.docId 落 data-* 属性位 → cEsc。
    body.innerHTML = rows.length
      ? `<div class="mc-lbl" style="margin-bottom:8px;">${tt('已加入文档 · 共 ', 'Docs · ')}${rows.length}</div>`
        + rows.map((d) => `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border);"><div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:var(--ink);font-weight:500;">${cEsc(d.name)}</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-3);margin-top:3px;">${d.chunks} ${tt('片段', 'chunks')} · ${fmtTs(d.ts)}</div></div><button class="btn" data-docdel="${cEsc(d.docId)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('删除', 'Delete')}</button></div>`).join('')
      : emptyLine(tt('知识库为空 —— 加入 JD / 笔记 / 调研,AI 答题时会自动检索相关片段。', 'Empty — add JDs / notes / research; the AI auto-retrieves relevant chunks when answering.'));

    // 逐条删 = 破坏性 → guardrail(预览 + 确认 + 撤销)。detail 走 textContent,故传裸名安全。
    // ★DocTrash 与 MemTrash 同款单槽 → 同一世代守卫(承评审第56轮 [建议]1「修 (a) 时一并对齐」)。
    [...box.querySelectorAll('[data-docdel]')].forEach((b) => (b.onclick = () => {
      if (!G || !G.confirmDestructive) return; // fail-closed
      const d = rows.find((x) => String(x.docId) === String(b.dataset.docdel));
      let gen = 0;
      G.confirmDestructive({
        title: tt('删除文档?', 'Delete doc?'),
        detail: (tt('将从知识库删除:', 'Remove from knowledge: ')) + (d ? d.name : ''),
        confirmLabel: tt('删除', 'Delete'),
        undoText: tt('已删除文档', 'Doc deleted'),
        onConfirm: async () => { gen = ++docGen; try { await rt.docs.remove(b.dataset.docdel); } catch (_e) {} await refresh(); },
        onUndo: async () => { if (gen !== docGen) return expiredUndo(); try { await rt.docs.undo(); } catch (_e) {} await refresh(); },
      });
    }));
    const cb = q('#ccDocClear');
    if (cb) cb.style.display = rows.length ? '' : 'none';
  };
  await refresh();

  const addBtn = q('#ccDocAddBtn'), nameI = q('#ccDocName'), textI = q('#ccDocText'), hint = q('#ccDocHint');
  if (addBtn) addBtn.onclick = async () => {
    const text = ((textI && textI.value) || '').trim();
    if (!text) { toast(tt('请先粘贴内容或选文件', 'Paste text or pick a file first')); return; }
    const name = ((nameI && nameI.value) || '').trim();
    addBtn.disabled = true;
    const old = addBtn.textContent;
    addBtn.textContent = tt('添加中…', 'Adding…');
    try {
      const r = await rt.docs.add(name, text);
      // ★toast = HTML sink(el→template.innerHTML):文档名是用户输入 → 必须 cEsc。
      //   原 settings.js:129 裸拼 = 自 XSS,本刀修复(同第55轮 [应改] 纪律)。
      const shown = (r && r.name) || name || tt('未命名', 'Untitled');
      toast(tt('已加入「', 'Added "') + cEsc(shown) + '」 · ' + ((r && r.chunks) || 0) + tt(' 片段', ' chunks'));
      if (nameI) nameI.value = '';
      if (textI) textI.value = '';
      if (hint) hint.textContent = '';
      await refresh();
    }
    catch (e) { toast(errText(e)); }
    finally { addBtn.disabled = false; addBtn.textContent = old; }
  };

  const fileBtn = q('#ccDocFileBtn'), fileI = q('#ccDocFile');
  if (fileBtn && fileI) {
    fileBtn.onclick = () => fileI.click();
    fileI.onchange = () => {
      const f = fileI.files && fileI.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (textI) textI.value = String(reader.result || '');
        if (nameI && !nameI.value) nameI.value = f.name.replace(/\.(txt|md)$/i, '');
        if (hint) hint.textContent = f.name; // textContent,安全
      };
      reader.readAsText(f);
      fileI.value = '';
    };
  }

  // 清空全部 = 破坏性 → guardrail。
  const clr = q('#ccDocClear');
  if (clr) clr.onclick = () => {
    if (!G || !G.confirmDestructive) return; // fail-closed
    let gen = 0;
    G.confirmDestructive({
      title: tt('清空全部文档?', 'Clear all docs?'),
      detail: tt('将删除知识库里的全部文档。可在几秒内撤销(仅能撤销最近一次销毁)。', 'Removes every doc. Undoable for a few seconds (only the most recent destruction).'),
      confirmLabel: tt('清空', 'Clear'),
      undoText: tt('已清空知识库', 'Knowledge cleared'),
      onConfirm: async () => { gen = ++docGen; try { await rt.docs.clear(); } catch (_e) {} await refresh(); },
      onUndo: async () => { if (gen !== docGen) return expiredUndo(); try { await rt.docs.undo(); } catch (_e) {} await refresh(); },
    });
  };
}
