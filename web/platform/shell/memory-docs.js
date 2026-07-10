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
 *     · ★★**撤销语义 = 「撤销它自己那一次销毁」(刀2b-2 起,由 token 结构性保证)**:
 *       · 旧理由一(第56轮,**已不成立**):后端曾是**单槽覆盖**,新销毁会把上一次的快照冲掉。
 *       · 旧理由二(刀2b-1,**已不成立**):环已保留多次销毁,但前端不穿 token ⇒ `undo()` 取环顶。
 *       · **今日**:`rt.*.undo(token)` 的 **`token` 必填**(后端 `UndoRing::take(&str)`,「取最近一次」
 *         的 affordance 已在**类型层面删除**;token 取自**进程级序号**,跨环唯一 ⇒ 错配也只会落空)
 *         ⇒ 每次撤销**只能**作用于它自己那一次销毁;token 已失效(被撤销过 / 被更新的销毁挤出上限)
 *         → 后端还原 0 条 → 前端 `staleUndo()` + `return false`。
 *       ⇒ **「还原错记录」在类型层面不可能**(评审第62轮验收判据③ + 第63轮不变式④)。
 *     · ★★**`memGen`/`docGen` 世代守卫与 `dropToast` = 「策略」,不是「安全」**(评审第63轮 Q2 · **勿误读**):
 *       token 化之后,一个陈旧的撤销 toast 点下去,要么**精确还原它自己那一次**(正确 —— 这正是环存在的意义),
 *       要么 token 已失效被 `staleUndo()` 诚实拒绝。**两种结果都不是「还原错记录」** ⇒ **现在删掉它们是安全的。**
 *       它们幸存下来只在执行一条**产品选择**:「只有最近一次可撤销」(环有能力精确撤销更早的,我们选择不暴露),
 *       外加「场上只留一个撤销 affordance」的 UX。**别在其上加码安全性,也别因「看着冗余」就删 —— 那是在无声中改 UX。**
 *       ⚠ 对比:`toast.js` 的 `done` 重入闸**仍为另外四个闭包消费者(notes/prompts/resumes/jobs)承重**
 *         —— 它们的 `restoreFn` 是 `splice(i,0,snap)`,双击会**重复插入**。**别把它一起降级。**
 *       ⚠ **不得改 `toast.js` 共享原语**:notes/prompts/resumes 的撤销是**闭包快照、各自独立正确**,
 *       做成全局互斥反而把它们改坏。世代守卫**只作用于本模块自己的两个 trash 域**(memory / docs)。
 *     · ★**提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原**(第58轮 [建议]A + 第60轮 [建议]1 + 刀2b-1):
 *       ① 后端调用**失败**(sqlite 锁 / 磁盘 / IPC)→ **不给撤销**,并 `toast(errText(e))` 而非静默吞错;
 *       ② 后端返回 `deleted === 0`(no-op:行已不在 / 库本就空)→ **无可还原之物** ⇒ 不给撤销;
 *       ③ `deleted > 0` 但 **`undoToken` 为空** → 销毁确已发生,但快照超后端环的字节上限、**未入环**
 *          ⇒ **没有可还原之物**,如实告知「内容过大,无法撤销」,而不是给一个还原不了的按钮。
 *       ⚠ 四条路径全部经 `offerUndo()` 收口(逐条删 / 清空 / 文档删 / 文档清空);`memory_remove` 的返回值由 `()`
 *       改为 `{deleted, undoToken}` 正是为了让本条在它身上**可被贯彻**(原先前端无从判断销毁是否真发生)。
 *       web 端降级返回 `{deleted:0, undoToken:null}` → 被 ② 拦下(如实上报,不让「不可达」承重)。
 *       ⚠ **guardrail 三条路径的撤销按钮由 `onConfirm` 的返回值决定**(第63轮 [建议]② 已落):
 *       返回 `false`(无 token = 没有可还原之物)⇒ **按钮根本不出现**。此前 guardrail 无条件 `showUndo`,
 *       `onUndo` 只能靠 `if (!token) return;` 早返 ⇒ 用户点下去**一声不吭** —— 而整条撤销 arc 的主题
 *       正是**失败必须出声**。那行早返如今**结构上不可达**,留 1 行作纵深。
 *       ⚠ 两条 `clear` 路径更进一步:**预检说不可撤销 ⇒ 连 `onUndo` 都不传** ⇒ guardrail 的
 *       「执行后可撤销。」提示(它由 `opts.onUndo` 是否存在驱动)也不会印出来 —— 否则同一个对话框会
 *       一边说「无法撤销」、一边说「执行后可撤销」。**事前不承诺做不到的事。**
 *     · ★**即时删除按钮在 await 窗口内必须不可重入**:逻辑闸 `memBusy` + 物理闸 `disabled`(见下)。
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

/* ── 撤销世代守卫 = **策略,非安全**(评审第63轮 Q2;详见模块头):后端 MemTrash / DocTrash 是
      **各自独立的有界环 `UndoRing`**,token 跨环唯一。刀2b-2 起前端**穿 token**、后端 `take(&str)`
      token 必填 ⇒ 每次撤销只作用于它自己那一次销毁 ⇒ 本守卫**不提供任何安全性**:删掉它,陈旧的
      撤销要么正确还原它自己那一次,要么被 `staleUndo()` 诚实拒绝。它执行的是一条**产品选择** ——
      「只有最近一次可撤销」。**改它 = 改 UX,不是改安全。** 两域计数独立(后端两个环亦独立)。 */
let memGen = 0, docGen = 0;
let memUndoToast = null; // 记忆域当前在场的 toastUndo 元素(新销毁前摘掉 —— UX:场上只留一个撤销按钮)
/* ★重入守卫(评审第57轮 [应改]):记忆逐条删是**唯一的即时删除路径** —— 按钮在 `await remove()`+`await refresh()`
   期间仍留在 DOM 里可点。
   · 当年(单槽):双击让 `memory_remove` 第二次以空快照**覆盖**单槽 ⇒ 撤销还原 0 条,而 `toast.js` 的 doUndo
     无条件报「已撤销」⇒ 静默丢数据 + 假成功。**该根因已在刀2a(空快照不入环 + fail-closed)与刀1(撤销结果
     契约)消除。**
   · 今日(环):双击的第二次是 no-op 销毁 ⇒ `deleted=0` ⇒ `offerUndo` 拒 ⇒ 不再丢数据。但重入仍会造成
     **重复的后端往返与并存的撤销 affordance**,且逻辑闸是 `dropToast`/世代推进的前提。**故守卫保留。**
   对比:guardrail 的确认按钮先 `close()` 再 await onConfirm(guardrail/index.js:122-124),DOM 同步移除
   ⇒ 文档域天然不可重入。故守卫只需加在本路径。 */
let memBusy = false;
const dropToast = (t) => { if (t && t.isConnected) t.remove(); };
const expiredUndo = () => toast(tt(
  '该撤销已过期 —— 此后又发生了新的销毁(只能撤销最近一次)。',
  'Undo expired — a newer deletion superseded it (only the most recent can be undone).'
));
/** toastUndo 无返回值:它同步 append 到 #toasts,故紧随其后的 lastElementChild 即本次的 toast。 */
const lastToastEl = () => { const h = document.getElementById('toasts'); return h ? h.lastElementChild : null; };

/** 该次撤销已不在环内(已被撤回过 / 被更新的销毁挤出上限)—— 如实上报,绝不报「已撤销」。
 *  ⚠ 措辞刻意**不含「已撤销」四字**:那是 `toast.js` 成功路径的专用提示,
 *    复用它会让用户(以及断言)把一次失败读成成功。 */
const staleUndo = () => toast(tt(
  '该撤销已失效 —— 这次销毁已不在撤销环内(可能已被撤回,或被更新的销毁挤出)。',
  'Undo no longer available — that deletion is no longer in the undo ring.'
));

/**
 * 由销毁命令的返回 `{ deleted, undoToken }` 决定**这次销毁能否提供撤销**,
 * 并把**撤销所需的 token** 交出去(刀2b-2:token 是撤销的唯一凭据)。
 *
 *  · `deleted === 0`(no-op:行已不在 / 库本就空)→ 不提供 + 「没有可…的内容」;
 *  · **无 `undoToken`** → 不提供 + 「已…;内容过大,无法撤销」。销毁确已发生,但快照超后端环的
 *    字节上限、**未入环**(UndoRing 不变式③),**没有可还原之物**;
 *  · 其余 → 返回 token。
 *
 * @returns {string|null} 撤销凭据;`null` = 不提供撤销。
 *
 * ★「无 token ⇒ 不提供撤销」由后端**结构性**保证(`undo(token)` 的 `token` 必填),前端只是把它显式化。
 * 与不变式「**提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原**」一致。
 */
function offerUndo(res, nothingMsg, tooBigMsg) {
  const n = res && typeof res.deleted === 'number' ? res.deleted : undefined;
  const token = res && res.undoToken != null ? String(res.undoToken) : null;
  if (typeof n === 'number' && n === 0) { toast(nothingMsg); return null; }
  if (token == null) { toast(tooBigMsg); return null; }
  return token;
}

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

    // 逐条删:即时删除 + toastUndo(token 必填 ⇒ 每次撤销只作用于它自己那一次)。摘旧撤销 + 世代号 = **UX 策略**,非安全。
    // ★重入守卫(见模块头):await 窗口内的第二次点击会造成重复往返与并存的撤销 ⇒ 逻辑闸(memBusy)+ 物理闸(disabled)。
    const memBtns = () => [...box.querySelectorAll('[data-memdel]')];
    memBtns().forEach((b) => (b.onclick = async () => {
      if (memBusy) return;
      memBusy = true;
      const frozen = memBtns();
      frozen.forEach((x) => { x.disabled = true; }); // disabled 按钮不触发 click:双击 / 交错删都被物理挡住
      try {
        // 先摘旧撤销(UX:场上只留一个撤销按钮)。摘掉的那个如今点下去本会**正确**还原它自己那一次
        // —— 这是产品选择「只撤销最近一次」,不是在防数据损害。remove 失败也无损:旧 toast 已走,
        // 而后端环里那一次仍在(Mod+Z / lastUndo 已随之清掉,不会误触)。
        dropToast(memUndoToast); memUndoToast = null;
        // ★不变式(第58轮 [建议]A + 第60轮 [建议]1):**提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原**。
        //   · 后端调用抛错 → 销毁未必发生 ⇒ 不给撤销,错误浮出(原 `catch(_e){}` 吞错是缺陷)。
        //   · `deleted===0`(no-op 删除:行已不在)⇒ **没有可还原之物** ⇒ 不给撤销。
        //   · 无 `undoToken`(快照超环上限)⇒ 同样没有可还原之物 ⇒ 不给撤销,如实告知。
        //   web 端降级返回 `{deleted:0, undoToken:null}` ⇒ 走第二条,如实不给撤销(不让「不可达」承重)。
        let token = null;
        try {
          token = offerUndo(
            await rt.memory.remove(b.dataset.memdel),
            tt('没有可删除的内容', 'Nothing to delete'),
            tt('已删除;内容过大,无法撤销', 'Deleted; too large to undo')
          );
        } catch (e) { token = null; toast(errText(e)); }
        await refresh(); // 重渲出全新(enabled)按钮
        if (token) {
          const gen = ++memGen; // 世代 = **UX 策略**「只有最近一次可撤销」(安全性由 token 保证,见模块头)
          // ★上报撤销结果(toast.js 契约):返回 false ⇒ toast.js 不报「已撤销」;失败因由由本回调自报。
          //   ⚠ 陷阱:`return expiredUndo()` 的值是 undefined(toast 的返回值)⇒ 会被读成**成功**。必须显式 return false。
          toastUndo(tt('已删除该记忆', 'Memory deleted'), async () => {
            if (gen !== memGen) { expiredUndo(); return false; } // **策略**闸(非安全):token 已保证只能还原它自己那一次
            let n;
            // ★刀2b-2:token 必填 —— 这次撤销**只能**作用于它自己那一次销毁,还原错记录在类型层面不可能。
            try { n = await rt.memory.undo(token); } catch (e) { toast(errText(e)); return false; }
            await refresh();
            if (typeof n === 'number' && n === 0) { staleUndo(); return false; } // token 已失效 ⇒ 绝不报「已撤销」
            return undefined; // n>0 → 成功
          });
          memUndoToast = lastToastEl();
        }
      } finally {
        memBusy = false;
        frozen.forEach((x) => { if (x.isConnected) x.disabled = false; }); // refresh 失败时解禁旧按钮
      }
    }));
    const cb = box.querySelector('#ccMemClear');
    if (cb) cb.style.display = rows.length ? '' : 'none';
  };
  await refresh();

  // 清除全部 = 破坏性 → guardrail(预览 + 确认 + 撤销)。
  const cb = box.querySelector('#ccMemClear');
  if (cb) cb.onclick = async () => {
    if (!G || !G.confirmDestructive) return; // fail-closed
    // ★guardrail 在 onConfirm 之后**无条件** showUndo(guardrail:125),故销毁失败 / 无 token 时仍会给出
    //   撤销按钮 ⇒ onUndo 必须自行拒绝。**只靠 gen 不够**:失败时不推进世代,`gen(0)===memGen(0)` 会误判为有效。
    //   ⚠ 第62轮曾把 `!token` 记作「挡住『撤销取走环顶』的唯一防线」——**刀2b-2 后那个危害已不存在**
    //     (token 必填,`undo(null)` 会被 serde 打回)。它今日挡的是**一次注定失败的 IPC + 一条莫名的错误 toast**。
    //     仍然保留;正解是 guardrail `onConfirm: () => Promise<boolean>`(false ⇒ 根本不给按钮)。已记债。
    let gen = 0, token = null; // token = 撤销凭据;null ⇒ 无可撤销之物(onUndo 据此拒绝)
    // ★预检(评审第62轮 [应改]):确认文案必须在**用户做决定之前**说真话 ——
    //   超出后端环的字节上限时,这次清空**不可撤销**;绝不能先承诺「可在几秒内撤销」、销毁后才改口。
    let undoable = true;
    try { undoable = await rt.memory.clearUndoable(); } catch (_e) { undoable = false; } // 问不到 ⇒ 保守按不可撤销告知
    await G.confirmDestructive({
      title: tt('清除全部长期记忆?', 'Clear all long-term memory?'),
      detail: undoable
        ? tt('将删除 AI 记住的全部内容。可在几秒内撤销(仅能撤销最近一次销毁)。', 'Deletes everything AI remembers. Undoable for a few seconds (only the most recent destruction).')
        : tt('将删除 AI 记住的全部内容。内容过大,清除后无法撤销。', 'Deletes everything AI remembers. Too large to snapshot — this CANNOT be undone.'),
      confirmLabel: tt('清除', 'Clear'),
      undoText: tt('已清除长期记忆', 'Memory cleared'),
      // ★销毁**之后**才知道有没有可还原之物 ⇒ 返回 `false` 让 guardrail **根本不给撤销按钮**
      //   (guardrail `onConfirm` 契约,与 toast.js 的 `toastUndo` 同构)。
      //   旧行为:guardrail 无条件 showUndo,`onUndo` 只能靠 `!token` 早返 ⇒ 点下去**一声不吭**。
      onConfirm: async () => {
        memBusy = true; // 与逐条删互斥(guardrail 确认按钮先 close() 再 await,故自身不可重入)
        try {
          // ★[建议]1:清空一个已空的库 = 销毁 0 条 ⇒ **没有可还原之物**(环不变式①:空快照永不入环、不发 token)。
          try {
            token = offerUndo(
              await rt.memory.clear(),
              tt('没有可清除的内容', 'Nothing to clear'),
              tt('已清除;内容过大,无法撤销', 'Cleared; too large to undo')
            );
          } catch (e) { token = null; toast(errText(e)); }
          if (token) { // 提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原
            dropToast(memUndoToast); memUndoToast = null; // 只保留一个在场的撤销 affordance(UX,非安全)
            gen = ++memGen; // 策略:只有最近一次可撤销
          }
          await refresh();
          return !!token; // false ⇒ 无按钮(而非「有按钮但点了没反应」)
        } finally { memBusy = false; }
      },
      // ★事前**不承诺做不到的事**:预检说不可撤销 ⇒ **连 onUndo 都不传** ⇒ guardrail 的
      //   「执行后可撤销。」那行提示也不会出现(它由 `opts.onUndo` 是否存在驱动,guardrail:99)。
      //   否则同一个对话框会一边说「无法撤销」、一边说「执行后可撤销」——自相矛盾的决策点谎报。
      //   ⚠ 走 `guardrail.showUndo`:它**从不报成功**、**返回值不被解释** ⇒ 无需 toast.js 的「显式 return false」。
      //   若将来改走 `toastUndo`,失败路径**必须显式 return false**(第59轮 [建议]3 · 防漂移)。
      onUndo: undoable ? async () => {
        // 变体(f)(第62轮):`memGen` **刷新即归零**而环**跨刷新存活** ⇒「刷新后 memGen=0、环里躺着上一次销毁」
        //   真实可达。⚠ 今日 `!token` 已**结构上不可达**(onConfirm 返回 false ⇒ 按钮根本不出现);
        //   留 1 行作纵深,且它也不再是「挡住还原错记录」的那道闸(token 必填,`undo(null)` 发不出去)。
        if (!token) return;
        if (gen !== memGen) return expiredUndo(); // 策略闸:只撤销最近一次
        let n;
        try { n = await rt.memory.undo(token); } catch (e) { toast(errText(e)); return; }
        await refresh();
        if (typeof n === 'number' && n === 0) staleUndo(); // token 已失效 —— guardrail 不报成功,故只需如实告知
      } : undefined,
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
    // ★DocTrash 与 MemTrash 同款(各自独立的有界环、token 跨环唯一)→ 同一**策略**闸:只撤销最近一次。
    [...box.querySelectorAll('[data-docdel]')].forEach((b) => (b.onclick = () => {
      if (!G || !G.confirmDestructive) return; // fail-closed
      const d = rows.find((x) => String(x.docId) === String(b.dataset.docdel));
      let gen = 0, token = null; // token 必需:它既是撤销凭据,也是「无可撤销之物」的唯一判据(见 renderMemory 同注)
      G.confirmDestructive({
        title: tt('删除文档?', 'Delete doc?'),
        detail: (tt('将从知识库删除:', 'Remove from knowledge: ')) + (d ? d.name : ''),
        confirmLabel: tt('删除', 'Delete'),
        undoText: tt('已删除文档', 'Doc deleted'),
        // ⚠ **无单篇预检**(后端只有 `doc_clear_undoable`,没有 `doc_remove_undoable`)⇒ 事前的
        //   「执行后可撤销。」在「执行时才发现整篇超上限」的罕见情形下仍是一句**事前承诺**。
        //   `offerUndo` 会如实 toast「已删除;内容过大,无法撤销」,且 `false` 令按钮不出现 —— 但承诺已出口。
        //   **记债**:补 `doc_remove_undoable` 预检,与两条 clear 路径同款。此刀不扩范围。
        onConfirm: async () => {
          try {
            token = offerUndo(
              await rt.docs.remove(b.dataset.docdel),
              tt('没有可删除的内容', 'Nothing to delete'),
              tt('已删除;内容过大,无法撤销', 'Deleted; too large to undo')
            );
          } catch (e) { token = null; toast(errText(e)); }
          if (token) gen = ++docGen; // 提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原
          await refresh();
          return !!token; // false ⇒ guardrail 不给撤销按钮(不再是「有按钮但一声不吭」)
        },
        // ★走 guardrail.showUndo:不报成功、返回值不被解释(详见 renderMemory 清空路径同注 · [建议]3)。
        onUndo: async () => {
          if (!token) return; // 结构上不可达(onConfirm 返回 false ⇒ 无按钮);留 1 行作纵深
          if (gen !== docGen) return expiredUndo(); // 策略闸:只撤销最近一次
          let n;
          try { n = await rt.docs.undo(token); } catch (e) { toast(errText(e)); return; }
          await refresh();
          if (typeof n === 'number' && n === 0) staleUndo();
        },
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
  if (clr) clr.onclick = async () => { // async:预检需 await(确认文案在用户决定前说真话)
    if (!G || !G.confirmDestructive) return; // fail-closed
    let gen = 0, token = null;
    // ★预检同 renderMemory 清空路径:确认文案在用户做决定之前说真话(评审第62轮 [应改])。
    let undoable = true;
    try { undoable = await rt.docs.clearUndoable(); } catch (_e) { undoable = false; }
    G.confirmDestructive({
      title: tt('清空全部文档?', 'Clear all docs?'),
      detail: undoable
        ? tt('将删除知识库里的全部文档。可在几秒内撤销(仅能撤销最近一次销毁)。', 'Removes every doc. Undoable for a few seconds (only the most recent destruction).')
        : tt('将删除知识库里的全部文档。内容过大,清空后无法撤销。', 'Removes every doc. Too large to snapshot — this CANNOT be undone.'),
      confirmLabel: tt('清空', 'Clear'),
      undoText: tt('已清空知识库', 'Knowledge cleared'),
      onConfirm: async () => {
        // ★[建议]1 同源:清空一个已空的知识库 = 销毁 0 条 ⇒ **没有可还原之物** ⇒ 返回 false,不给按钮。
        try {
          token = offerUndo(
            await rt.docs.clear(),
            tt('没有可清空的内容', 'Nothing to clear'),
            tt('已清空;内容过大,无法撤销', 'Cleared; too large to undo')
          );
        } catch (e) { token = null; toast(errText(e)); }
        if (token) gen = ++docGen;
        await refresh();
        return !!token;
      },
      // ★同 renderMemory 清空:预检说不可撤销 ⇒ 连 onUndo 都不传 ⇒ 对话框不会印出「执行后可撤销。」。
      onUndo: undoable ? async () => {
        if (!token) return; // 结构上不可达;留 1 行作纵深
        if (gen !== docGen) return expiredUndo(); // 策略闸:只撤销最近一次
        let n;
        try { n = await rt.docs.undo(token); } catch (e) { toast(errText(e)); return; }
        await refresh();
        if (typeof n === 'number' && n === 0) staleUndo();
      } : undefined,
    });
  };
}
