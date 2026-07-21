/** 平台 · 长期记忆 + 知识库(RAG 文档)管理 —— P1-c:从 `settings.js` 的两个 module-private 模态
 *  (`openMemoryManager` / `openDocsManager`)**搬迁**至能力中心,提为一等公民内联视图。
 *
 *  搬迁时**零新后端**;此后为「决策点诚实」加了三个**只读预检**命令
 *  (`rt.memory.clearUndoable` / `rt.docs.clearUndoable` / `rt.docs.removeUndoable`)—— 它们不销毁任何东西,
 *  只回答「这次销毁能不能撤销」,供确认弹窗在**用户做决定之前**说真话。
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
 *       正是**失败必须出声**。那行早返如今**结构上不可达**,并已改为**响亮**(`noTokenUnreachable`)。
 *     · ★★**大快照落盘**(评审第62轮裁决6 → 第64轮次序①):超 RAM 环上限的 clear **不再是「不可撤销」** ——
 *       后端把快照**流式写进一个独立 SQLite 文件**再销毁,撤销时 ATTACH 还原。预检 `reason='spill'`
 *       ⇒ `undoable=true`,但对话框**如实告知会花几秒**(既不许承诺做不到的事,也不该瞒着代价)。
 *       只有连落盘上限(2 GiB)也超了,才是真的 `too_large`。
 *     · ★★**决策点不得承诺做不到的撤销 —— 现已在全部四条销毁路径上成立**(第64轮 [应改] 收口):
 *       guardrail 在**建对话框时**就据 `opts.onUndo` 是否存在印出「执行后可撤销。」⇒ 三条 guardrail 路径
 *       (记忆清空 / 文档删 / 文档清空)**各自先问预检**,不可撤销就**连 `onUndo` 都不传** ⇒ 那行提示不出现;
 *       第四条(记忆逐条删)走 `toastUndo`,**事后**提示、事前无承诺,天然无此问题。
 *       预检问不到 ⇒ **保守按不可撤销告知**。**「一条只在 3/4 条销毁路径上成立的不变式,不是不变式。」**
 *     · ★★**不可映射行(坏数据)的逃生口**(评审第64轮次序 ③):`fact` 存了 BLOB、`created_at` 存了 TEXT……
 *       这类行无法完整快照。不变式由此锐化一格:**旧「销毁 ⇔ 快照完整」→ 新「提供撤销 ⇔ 快照完整」**——
 *       损坏行**允许销毁**,但必须走 guardrail 确认 + 明告「无法撤销」+ 不给撤销按钮。
 *       ⚠ **逃生口的第一步不是「能删」,而是「能看见」**:修前后端 `memory_entries` 会整体报错 ⇒ 本模块
 *       `catch` 成空数组 ⇒ 用户看到「AI 还没有记住任何内容。」,而 AI 的 recall 照常读得到整张表。
 *       **这个视图的全部意义就是用户掌控,它却在说谎**(§4-2)。现在后端逐行标 `corrupt` 并给 `rowid`。
 *       ⚠ 损坏行走 `rt.memory.removeCorrupt(rowid)`(其 `id` 本身可能不可映射,不能当删除键);
 *       后端**拒绝销毁健康行** ⇒ 它不是「绕过快照直接删」的后门。
 *       ⚠ **粒度对齐**(第65轮 [建议]):文档侧同样有**逐片段手术** `rt.docs.removeCorrupt(rowid)` ——
 *       一个孤立的坏片段不该逼用户清空整个知识库。移除坏片段后,该篇恢复健康、恢复「可撤销删除」。
 *     · ★★**修复优先于销毁**(第66轮 [应改] + [建议]强 —— 评审自我订正的那一条):
 *       **实测**:`created_at` 坏掉时,`fact`/`text` 与 `embedding` 完好,**AI 正在检索它**
 *       (`memory_all` / `doc_chunks_all` 根本不读 `created_at`)。把它叫「已损坏」并只给「删除」一条路,
 *       是诱导用户为修一个时间戳而永久丢掉仍在服役的知识。
 *       ⇒ 按钮是**「修复」**:`created_at` 有 schema `DEFAULT 0` ⇒ 归一化是忠实修复、**零内容损失**
 *       (第61轮裁决A 的线内);其余列无默认值 ⇒ 一个字节都不碰。修好即恢复「可撤销删除」。
 *       ⚠ 精确些:REAL 时间戳走 `CAST` **保住日期**(SQLite 亲和性使残留的 REAL 必带小数);
 *       **只有非数值文本时间戳**(如 `'2026-07-10'`)才退到 `0` —— 那是唯一有损的一支,
 *       且 UI 今日也已把它显示为 `0`。**repair 不走 guardrail 是显式豁免**,论证见 `types.d.ts`
 *       的 `MemoryApi.repairCorrupt` 与 Rust 侧 `MEM_REPAIR_SQL` 头注:用户**无可失去之物**。
 *       ⇒ 只有**修不好**时才退到销毁,且决策点按后端实测的 `aiReadable` / `recallBroken` 说清代价:
 *       内容仍在服役(删=永久失去)/ 召回列已坏(删=**恢复** AI 检索)/ 无向量(AI 本就读不到)。
 *     · ★**谓词 / oracle 漂移必须响亮**(第66轮裁决2):`corruptRowids` 与 `corrupt` 标记来自 SQL 谓词
 *       (展示用);修复/销毁守卫来自 oracle(快照代码)。二者一致时「其实是健康的」**永不出现**;
 *       一旦出现即不变式违反 ⇒ `driftDetected()` 响亮上报,**绝不静默吸收进计数**。
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

/** @param {number} ts */
const fmtTs = (ts) => { try { return new Date(+ts || 0).toLocaleString(); } catch (_e) { return ''; } };
/** @param {string} txt */
const emptyLine = (txt) => `<p style="color:var(--ink-3);font-size:12px;padding:12px 0;">${txt}</p>`;

/* ── 撤销世代守卫 = **策略,非安全**(评审第63轮 Q2;详见模块头):后端 MemTrash / DocTrash 是
      **各自独立的有界环 `UndoRing`**,token 跨环唯一。刀2b-2 起前端**穿 token**、后端 `take(&str)`
      token 必填 ⇒ 每次撤销只作用于它自己那一次销毁 ⇒ 本守卫**不提供任何安全性**:删掉它,陈旧的
      撤销要么正确还原它自己那一次,要么被 `staleUndo()` 诚实拒绝。它执行的是一条**产品选择** ——
      「只有最近一次可撤销」。**改它 = 改 UX,不是改安全。** 两域计数独立(后端两个环亦独立)。 */
let memGen = 0, docGen = 0;
/** @type {Element|null} */ let memUndoToast = null; // 记忆域当前在场的 toastUndo 元素(新销毁前摘掉 —— UX:场上只留一个撤销按钮)
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
/** @param {Element|null} t */
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

/** ★★评审第66轮裁决2 · **谓词 / oracle 漂移的运行时监视器**。
 *
 *  `corruptRowids`(以及记忆行的 `corrupt` 标记)由 SQL 谓词产出 = **展示用途**;
 *  而后端的修复 / 销毁守卫由 **oracle**(`map_mem_row` / `map_doc_row` —— 快照代码本身)裁决。
 *  二者一致时,「这行其实是健康的」**永不出现**。一旦出现,就是「谓词比 oracle 更严」——
 *  正是第65轮点名的那个危险方向。
 *  ⇒ **绝不把它静默吸收进计数**:响亮上报,让一张沉默的安全网变成活的不变式检查。
 *  @param {number} n 被判定为「其实健康」的条数 */
const driftDetected = (n) => {
  console.error(`[memory-docs] 不变式违反:${n} 条被标为「已损坏」的记录,快照判据说它们是健康的(谓词/oracle 漂移)`);
  toast(tt(`其中 ${n} 条实际未损坏(已跳过)`, `${n} of them were not actually corrupted (skipped)`));
};

/** 销毁一条**不可修复**的记录时,决策点必须说清用户将失去什么(第66轮 [应改])。
 *  三种真实情形,措辞各不相同 —— 都由后端 oracle 实测得出,不靠猜。
 *  @param {{aiReadable?: boolean, recallBroken?: boolean}} r 修复失败时返回的实况 */
const destroyCost = (r) => {
  if (r && r.recallBroken) {
    return tt(
      '它的内容已无法读取,并且正在让 AI 的整个检索失效 —— 删除它可以恢复检索。删除后无法撤销。',
      'Its content is unreadable and is breaking the AI\'s entire retrieval — removing it restores retrieval. This CANNOT be undone.'
    );
  }
  if (r && r.aiReadable) {
    return tt(
      '⚠ 它的内容仍可被 AI 检索(损坏的只是元数据)。删除后这段内容将永久丢失,且无法撤销。',
      '⚠ Its content is still retrievable by the AI (only the metadata is broken). Deleting it loses that content permanently, and CANNOT be undone.'
    );
  }
  return tt(
    'AI 检索不到它(缺少向量)。删除后无法撤销。',
    'The AI cannot retrieve it (no embedding). This CANNOT be undone.'
  );
};

/** 「拿不到 token 却出现了撤销按钮」—— `onConfirm` 返回 `false` 时 guardrail 根本不建按钮,
 *  故此分支**结构上不可达**。它仍然留着,但**必须响亮**(评审第64轮 Q2):
 *
 *  一道守着不可达分支的**静默 `return`**,唯一可能的效果是:某次重构让 `token` 在活路径上变假时,
 *  把一次**响亮的失败**(`undo(undefined)` → 后端 `token: String` 反序列化报错 → `toast(errText)`)
 *  变成一次**沉默的失败**(直接 return,用户点了撤销一声不吭)—— 正是整条 arc 消灭的那个东西。
 *  ⇒ 无论可达与否,它只能让事情更响,永远不会更静。 */
const noTokenUnreachable = () => {
  console.error('[memory-docs] 不变式破坏:onUndo 在没有 token 的情况下被调用(guardrail 本不该给出按钮)');
  staleUndo();
  return false;
};

/**
 * 读一次**只读预检**(`{undoable, reason}`)。命令失败 / 形状不对 ⇒ **保守按「不可撤销」告知**
 * (决策点宁可少承诺,绝不多承诺)。
 * @param {() => Promise<any>} fn 只读预检命令(`rt.*.clearUndoable` / `rt.docs.removeUndoable`)
 * @returns {Promise<{undoable: boolean, reason: string}>}
 */
async function precheck(fn) {
  try {
    const r = await fn();
    if (r && typeof r === 'object' && typeof r.undoable === 'boolean') {
      return { undoable: r.undoable, reason: String(r.reason || 'unknown') };
    }
    return { undoable: false, reason: 'unknown' };
  } catch (_e) {
    return { undoable: false, reason: 'unknown' };
  }
}

/** 「为什么不能撤销」—— 理由由后端给,前端只负责说人话。「内容过大」与「数据已损坏」对用户是两件事。
 *  @param {string} reason `'corrupt'` | `'too_large'` | 其它(含预检失败的 `'unknown'`) */
const whyNotUndoable = (reason) => {
  if (reason === 'corrupt') return tt('其中含已损坏的记录(无法生成撤销快照)。', 'It contains corrupted records (no undo snapshot is possible).');
  if (reason === 'too_large') return tt('内容过大,无法生成撤销快照。', 'Too large to snapshot.');
  return tt('无法确认能否撤销。', 'Unable to confirm whether this can be undone.');
};

/** `reason==='spill'`:**仍然可撤销**,但快照会先落盘 ⇒ 销毁要花几秒。
 *  事前说清楚 —— 决策点既不许承诺做不到的事,也不该瞒着代价(用户会以为界面卡死)。
 *  @param {string} reason 预检给出的理由 */
const spillNote = (reason) => (reason === 'spill'
  ? tt('内容较大,会先把撤销快照写到磁盘,可能需要几秒。', ' Large — the undo snapshot is written to disk first; this may take a few seconds.')
  : '');

/**
 * 由销毁命令的返回 `{ deleted, undoToken }` 决定**这次销毁能否提供撤销**,
 * 并把**撤销所需的 token** 交出去(刀2b-2:token 是撤销的唯一凭据)。
 *
 *  · `deleted === 0`(no-op:行已不在 / 库本就空)→ 不提供 + 「没有可…的内容」;
 *  · **无 `undoToken`** → 不提供 + 「已…;内容过大,无法撤销」。销毁确已发生,但快照超后端环的
 *    字节上限、**未入环**(UndoRing 不变式③),**没有可还原之物**;
 *  · 其余 → 返回 token。
 *
 * @param {any} res @param {string} nothingMsg @param {string} tooBigMsg
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

/** 记忆视图:列表(内容 + 时间)+ 逐条删(即时 + toastUndo 撤销)+ 清除全部(guardrail 预览确认撤销)。
 *  @param {HTMLElement} box */
export async function renderMemory(box) {
  if (!box) return;
  const rt = /** @type {any} */ (window).SeekerRT;
  const G = /** @type {any} */ (window).SeekerGuardrail;

  box.innerHTML = `<div id="ccMemBody" style="max-width:660px;">${tt('加载中…', 'Loading…')}</div>
    <div style="margin-top:10px;"><button class="btn" id="ccMemClear" style="display:none;padding:4px 12px;font-size:11px;">${tt('清除全部记忆', 'Clear all memory')}</button></div>`;

  const refresh = async () => {
    /** @type {any[]} */ let rows = [];
    try { rows = await rt.memory.list(); } catch (_e) {}
    const body = box.querySelector('#ccMemBody');
    if (!body) return;
    body.innerHTML = rows.length
      // r.fact = 用户主动写入的内容,可能含 PII → cEsc 后只呈现给用户;r.id 落 data-* 属性位 → cEsc 转 " 封越狱。
      ? `<p style="font-size:12px;color:var(--ink-3);margin:0 0 12px;">${tt('AI 记住的内容 · 共 ', 'What AI remembers · ')}${rows.length}${tt(' 条 · 仅存本地', ' · local only')}</p>`
        // ★损坏行:标出来 + 删除键改用 rowid(其 id 可能不可映射);删除走 guardrail 逃生口,不给撤销。
        + rows.map((r) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:0.5px solid var(--border);"><div style="flex:1;"><div style="font-size:13px;color:var(--ink-2);line-height:1.55;">${cEsc(r.fact)}</div><div style="font-family:var(--font-mono);font-size:9.5px;color:var(--ink-mute);margin-top:3px;">${fmtTs(r.ts)}${r.corrupt ? ` · <span style="color:var(--accent);">${tt('元数据损坏 · 无法生成撤销快照', 'METADATA CORRUPTED · no undo snapshot')}</span>` : ''}</div></div><button class="btn" ${r.corrupt ? `data-memfix="${cEsc(String(r.rowid))}"` : `data-memdel="${cEsc(r.id)}"`} style="padding:4px 10px;font-size:11px;flex-shrink:0;">${r.corrupt ? tt('修复', 'Repair') : tt('删除', 'Delete')}</button></div>`).join('')
      : emptyLine(tt('AI 还没有记住任何内容。', 'Nothing remembered yet.'));

    // 逐条删:即时删除 + toastUndo(token 必填 ⇒ 每次撤销只作用于它自己那一次)。摘旧撤销 + 世代号 = **UX 策略**,非安全。
    // ★重入守卫(见模块头):await 窗口内的第二次点击会造成重复往返与并存的撤销 ⇒ 逻辑闸(memBusy)+ 物理闸(disabled)。
    const memBtns = () => /** @type {HTMLButtonElement[]} */ ([...box.querySelectorAll('[data-memdel]')]);
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
    // ★★**修复优先于销毁**(评审第66轮 [建议]强)。`created_at` 有 schema `DEFAULT 0` ⇒ 归一化是
    //   忠实修复、零内容损失(第61轮裁决A 的线内)。修好之后这条记录恢复「可撤销删除」——
    //   用户根本不必在「丢内容」和「不可撤销」之间选。
    //   只有**修不好**(损坏落在没有默认值的列上)时,才退到销毁,并在决策点说清失去什么。
    /** @type {HTMLElement[]} */ ([...box.querySelectorAll('[data-memfix]')]).forEach((b) => (b.onclick = async () => {
      if (memBusy) return;
      const rowid = Number(b.dataset.memfix);
      memBusy = true;
      let r;
      try { r = await rt.memory.repairCorrupt(rowid); }
      catch (e) { toast(errText(e)); memBusy = false; return; }
      finally { memBusy = false; }

      if (r.reason === 'repaired') {
        // 措辞与代码一致:REAL 时间戳走 CAST 保住日期;只有**非数值文本**时间戳才退到 0(日期丢失)。
        toast(tt('已修复:时间戳已归一化(无法解析的日期会归零);内容与向量未改动。现在可以正常删除并撤销。',
          'Repaired: timestamp normalized (an unparseable date resets to zero); content and embedding untouched. It can now be deleted with undo.'));
        await refresh(); return;
      }
      if (r.reason === 'healthy') { driftDetected(1); await refresh(); return; } // 谓词/oracle 漂移 ⇒ 响亮
      if (r.reason === 'missing') { toast(tt('该记录已不存在', 'That record no longer exists')); await refresh(); return; }

      // not_repairable ⇒ 销毁是最后手段,且必须说清代价
      if (!G || !G.confirmDestructive) { toast(tt('该端暂不支持', 'Not supported here')); return; } // fail-closed
      await G.confirmDestructive({
        title: tt('无法修复 —— 删除这条记录?', 'Cannot repair — delete this record?'),
        detail: tt('这条记录的损坏不在可归一化的列上(内容或向量本身不是文本/向量)。', 'The corruption is not in a normalizable column (the content or embedding itself is not text/vector). ') + destroyCost(r),
        confirmLabel: tt('删除', 'Delete'),
        onConfirm: async () => {
          memBusy = true;
          try {
            const res = await rt.memory.removeCorrupt(rowid);
            const n = res && typeof res.deleted === 'number' ? res.deleted : 0;
            toast(n > 0
              ? tt('已删除该记录(无法撤销)', 'Record deleted (cannot be undone)')
              : tt('没有可删除的内容', 'Nothing to delete'));
            await refresh();
          } catch (e) { toast(errText(e)); } // 后端拒绝(如「该记录未损坏」)如实浮出,绝不静默
          finally { memBusy = false; }
          return false; // 永不提供撤销:没有快照,就没有可还原之物
        },
      });
    }));
    const cb = /** @type {HTMLElement|null} */ (box.querySelector('#ccMemClear'));
    if (cb) cb.style.display = rows.length ? '' : 'none';
  };
  await refresh();

  // 清除全部 = 破坏性 → guardrail(预览 + 确认 + 撤销)。
  const cb = /** @type {HTMLElement|null} */ (box.querySelector('#ccMemClear'));
  if (cb) cb.onclick = async () => {
    if (!G || !G.confirmDestructive) return; // fail-closed
    // ★guardrail 在 onConfirm 之后**无条件** showUndo(guardrail:125),故销毁失败 / 无 token 时仍会给出
    //   撤销按钮 ⇒ onUndo 必须自行拒绝。**只靠 gen 不够**:失败时不推进世代,`gen(0)===memGen(0)` 会误判为有效。
    //   ⚠ 第62轮曾把 `!token` 记作「挡住『撤销取走环顶』的唯一防线」——**刀2b-2 后那个危害已不存在**
    //     (token 必填,`undo(null)` 会被 serde 打回)。它今日挡的是**一次注定失败的 IPC + 一条莫名的错误 toast**。
    //     仍然保留;正解是 guardrail `onConfirm: () => Promise<boolean>`(false ⇒ 根本不给按钮)。已记债。
    let gen = 0, token = /** @type {string|null} */ (null); // token = 撤销凭据;null ⇒ 无可撤销之物(onUndo 据此拒绝)
    // ★预检(评审第62轮 [应改]):确认文案必须在**用户做决定之前**说真话 ——
    //   超出后端环的字节上限时,这次清空**不可撤销**;绝不能先承诺「可在几秒内撤销」、销毁后才改口。
    // 理由由后端给(too_large / corrupt),前端说人话;问不到 ⇒ 保守按不可撤销告知。
    const pc = await precheck(() => rt.memory.clearUndoable());
    const undoable = pc.undoable;
    await G.confirmDestructive({
      title: tt('清除全部长期记忆?', 'Clear all long-term memory?'),
      detail: undoable
        ? tt('将删除 AI 记住的全部内容。可在几秒内撤销(仅能撤销最近一次销毁)。', 'Deletes everything AI remembers. Undoable for a few seconds (only the most recent destruction).') + spillNote(pc.reason)
        : tt('将删除 AI 记住的全部内容。', 'Deletes everything AI remembers. ') + whyNotUndoable(pc.reason) + tt('清除后无法撤销。', ' This CANNOT be undone.'),
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
        if (!token) return noTokenUnreachable(); // 结构上不可达 ⇒ 若真到了这里,**响亮**而非静默
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

/** 知识库视图:添加(粘贴 / 选 .txt·.md)+ 列表(名/片段数/时间)+ 逐条删 + 清空(均走 guardrail)。
 *  @param {HTMLElement} box */
export async function renderDocs(box) {
  if (!box) return;
  const rt = /** @type {any} */ (window).SeekerRT;
  const G = /** @type {any} */ (window).SeekerGuardrail;

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

  const q = (/** @type {string} */ sel) => /** @type {HTMLElement|null} */ (box.querySelector(sel));

  const refresh = async () => {
    /** @type {any[]} */ let rows = [];
    try { rows = await rt.docs.list(); } catch (_e) {}
    const body = q('#ccDocList');
    if (!body) return;
    // d.name = 用户填的名 / 文件名(可能是外部语料标题)→ cEsc;d.docId 落 data-* 属性位 → cEsc。
    body.innerHTML = rows.length
      ? `<div class="mc-lbl" style="margin-bottom:8px;">${tt('已加入文档 · 共 ', 'Docs · ')}${rows.length}</div>`
        + rows.map((d) => `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border);"><div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:var(--ink);font-weight:500;">${cEsc(d.name)}</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-3);margin-top:3px;">${d.chunks} ${tt('片段', 'chunks')} · ${fmtTs(d.ts)}${d.corrupt ? ` · <span style="color:var(--accent);">${tt('含元数据损坏的片段 · 无法生成撤销快照', 'CORRUPTED metadata · no undo snapshot')}</span>` : ''}</div></div>${d.corrupt && (d.corruptRowids || []).length ? `<button class="btn" data-docfix="${cEsc((d.corruptRowids || []).join(','))}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('修复损坏片段', 'Repair chunks')}</button>` : ''}<button class="btn" data-docdel="${cEsc(d.docId)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('删除', 'Delete')}</button></div>`).join('')
      : emptyLine(tt('知识库为空 —— 加入 JD / 笔记 / 调研,AI 答题时会自动检索相关片段。', 'Empty — add JDs / notes / research; the AI auto-retrieves relevant chunks when answering.'));

    // ★逐片段手术(评审第65轮 [建议] 粒度对齐):一个孤立的坏片段不该逼用户清空整个知识库。
    //   删掉坏片段 ⇒ 该篇恢复健康 ⇒ 常规删除**重新可撤销**。
    //   坏片段本身不可快照 ⇒ 此操作**不可撤销** ⇒ 走 guardrail 确认闸、**不传 onUndo**(§4-3)。
    //   用 rowid 而非 doc_id:坏片段的 `doc_id` 列本身可能就是 BLOB,按名寻址不到它。
    /** @type {HTMLElement[]} */ ([...box.querySelectorAll('[data-docfix]')]).forEach((b) => (b.onclick = async () => {
      const rowids = String(b.dataset.docfix || '').split(',').map(Number).filter((x) => Number.isFinite(x) && x > 0);
      if (!rowids.length) return;

      // ① 先修复:能归一化的一律修好(零内容损失),销毁只对修不好的那些作为最后手段。
      let repaired = 0, drift = 0;
      /** @type {Array<{rowid: number, aiReadable?: boolean, recallBroken?: boolean}>} */
      const stuck = []; // 修不好的那些(销毁是它们的最后手段)
      for (const rid of rowids) {
        let r;
        try { r = await rt.docs.repairCorrupt(rid); } catch (e) { toast(errText(e)); continue; }
        if (r.reason === 'repaired') repaired++;
        else if (r.reason === 'healthy') drift++;                  // 谓词/oracle 漂移
        else if (r.reason === 'not_repairable') stuck.push({ rowid: rid, ...r });
      }
      if (repaired) toast(tt('已修复 ', 'Repaired ') + repaired + tt(' 个片段(时间戳已归一化;内容与向量未改动)', ' chunk(s) (timestamps normalized; content and embeddings untouched)'));
      if (drift) driftDetected(drift);                             // ★绝不静默吸收
      await refresh();
      if (!stuck.length) return;                                   // 全修好了 —— 根本不必销毁

      // ② 修不好的:销毁是最后手段,且决策点必须说清失去什么(按实况取最坏的那一句)
      if (!G || !G.confirmDestructive) { toast(tt('该端暂不支持', 'Not supported here')); return; } // fail-closed
      const worst = stuck.find((x) => x.aiReadable) || stuck.find((x) => x.recallBroken) || stuck[0];
      await G.confirmDestructive({
        title: tt('无法修复 —— 移除这些片段?', 'Cannot repair — remove these chunks?'),
        detail: tt(`这篇文档有 ${stuck.length} 个片段的损坏不在可归一化的列上。`, `${stuck.length} chunk(s) in this doc are corrupted in a non-normalizable column. `) + destroyCost(worst),
        confirmLabel: tt('移除', 'Remove'),
        onConfirm: async () => {
          let done = 0, refused = 0;
          for (const x of stuck) {
            try {
              const res = await rt.docs.removeCorrupt(x.rowid);
              done += (res && typeof res.deleted === 'number') ? res.deleted : 0;
            } catch (e) { refused++; toast(errText(e)); } // 后端拒绝如实浮出,绝不静默
          }
          // ★拒绝不是正常结果,是不变式违反(守卫说它健康,而谓词把它标成了坏的)。响亮。
          if (refused) driftDetected(refused);
          toast(done > 0
            ? tt('已移除 ', 'Removed ') + done + tt(' 个无法修复的片段(无法撤销)', ' unrepairable chunk(s) (cannot be undone)')
            : tt('没有可移除的内容', 'Nothing to remove'));
          await refresh();
          return false; // 永不提供撤销:没有快照,就没有可还原之物
        },
      });
    }));

    // 逐条删 = 破坏性 → guardrail(预览 + 确认 + 撤销)。detail 走 textContent,故传裸名安全。
    // ★DocTrash 与 MemTrash 同款(各自独立的有界环、token 跨环唯一)→ 同一**策略**闸:只撤销最近一次。
    /** @type {HTMLElement[]} */ ([...box.querySelectorAll('[data-docdel]')]).forEach((b) => (b.onclick = async () => { // async:预检需 await
      if (!G || !G.confirmDestructive) return; // fail-closed
      const d = rows.find((x) => String(x.docId) === String(b.dataset.docdel));
      let gen = 0, token = /** @type {string|null} */ (null); // token 必需:它既是撤销凭据,也是「无可撤销之物」的唯一判据(见 renderMemory 同注)
      // ★单篇预检(评审第64轮 [应改] · 队首):guardrail 在**建对话框时**就据 `onUndo` 是否存在印出
      //   「执行后可撤销。」—— 若等 onConfirm 执行时才发现整篇超上限,那句话**已经出口**了。
      //   与两条 clear 路径同款,「决策点不得承诺做不到的撤销」由此在**全部四条销毁路径**上成立。
      const pc = await precheck(() => rt.docs.removeUndoable(b.dataset.docdel)); // 问不到 ⇒ 保守
      const undoable = pc.undoable;
      G.confirmDestructive({
        title: tt('删除文档?', 'Delete doc?'),
        detail: (tt('将从知识库删除:', 'Remove from knowledge: ')) + (d ? d.name : '')
          + (undoable ? spillNote(pc.reason) : ' · ' + whyNotUndoable(pc.reason) + tt('删除后无法撤销。', ' This CANNOT be undone.')),
        confirmLabel: tt('删除', 'Delete'),
        undoText: tt('已删除文档', 'Doc deleted'),
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
        onUndo: undoable ? async () => {
          if (!token) return noTokenUnreachable(); // 结构上不可达 ⇒ 若真到了这里,**响亮**而非静默
          if (gen !== docGen) return expiredUndo(); // 策略闸:只撤销最近一次
          let n;
          try { n = await rt.docs.undo(token); } catch (e) { toast(errText(e)); return; }
          await refresh();
          if (typeof n === 'number' && n === 0) staleUndo();
        } : undefined,
      });
    }));
    const cb = q('#ccDocClear');
    if (cb) cb.style.display = rows.length ? '' : 'none';
  };
  await refresh();

  const addBtn = /** @type {HTMLButtonElement|null} */ (q('#ccDocAddBtn')), nameI = /** @type {HTMLInputElement|null} */ (q('#ccDocName')), textI = /** @type {HTMLTextAreaElement|null} */ (q('#ccDocText')), hint = q('#ccDocHint');
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

  const fileBtn = q('#ccDocFileBtn'), fileI = /** @type {HTMLInputElement|null} */ (q('#ccDocFile'));
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
    let gen = 0, token = /** @type {string|null} */ (null);
    // ★预检同 renderMemory 清空路径:确认文案在用户做决定之前说真话(评审第62轮 [应改])。
    const pc = await precheck(() => rt.docs.clearUndoable());
    const undoable = pc.undoable;
    G.confirmDestructive({
      title: tt('清空全部文档?', 'Clear all docs?'),
      detail: undoable
        ? tt('将删除知识库里的全部文档。可在几秒内撤销(仅能撤销最近一次销毁)。', 'Removes every doc. Undoable for a few seconds (only the most recent destruction).') + spillNote(pc.reason)
        : tt('将删除知识库里的全部文档。', 'Removes every doc. ') + whyNotUndoable(pc.reason) + tt('清空后无法撤销。', ' This CANNOT be undone.'),
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
        if (!token) return noTokenUnreachable(); // 结构上不可达 ⇒ 若真到了这里,**响亮**而非静默
        if (gen !== docGen) return expiredUndo(); // 策略闸:只撤销最近一次
        let n;
        try { n = await rt.docs.undo(token); } catch (e) { toast(errText(e)); return; }
        await refresh();
        if (typeof n === 'number' && n === 0) staleUndo();
      } : undefined,
    });
  };
}
