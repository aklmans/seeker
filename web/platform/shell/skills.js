// @ts-check
/** 平台 · Skills 管理面(proposal-skills.md S1b + S2)—— 能力中心内联视图(非 app,§1:跨应用用户能力归平台)。
 *
 *  Skill = **用户自撰的具名指令** {name, description?, prompt}。存平台 `platform_skills` 集合(经 skill-store 数据层,
 *  rt.db 双端:桌面 SQLite / 网页 IndexedDB)。管理(增删改)在此;**运行**(S2)= 管理面「运行」按钮 / 命令面板 → runSkill。
 *
 *  ★数据经 skill-store(非直连 rt.db):CRUD 同步更新缓存 ⇒ 命令面板 `platformSkills()` 即时可见(S2b)。
 *  ★红线:
 *   - **不进 QUERYABLE = 永不 AI 可读**(capability.rs;S1a 守卫测试证):Skill 是用户指令、非 AI 检索数据。
 *   - **管理不经对话**(§4-2 设置红线):增删改在此 UI,Agent 对话无法改 Skill(同 connector/记忆管理面)。
 *   - **转义**(§4-4):name/description/prompt 是用户输入、id 落 data-* 属性位 → 进 DOM 一律 `cEsc`(含 `"`)。
 *   - **删除可撤销**(§4-3 反焦虑):单条删 = `removeSkill`(返快照)+ `toastUndo`(经 `saveSkill` 还原);
 *     每条各自闭包快照 + keyed upsert ⇒ 非单槽、连删独立可靠(异于 memory/docs 后端单槽)。
 *   - **信任 + 红线继承**:见 copilot-chrome `runSkill`(运行 = skill.prompt 走 agentSend 标准用户消息路径)。
 */
import { cEsc, runSkill } from './copilot-chrome.js'; // runSkill(S2):管理面「运行」= 走 agentSend 标准路径(红线结构性继承)
import { $, $$ } from './dom.js';
import { tt } from './i18n.js';
import { IC } from './icons.js';
import { toast, toastUndo, errText } from './toast.js';
import { openModal, closeModal } from './modal.js';
import { normSkill, skillRunnable, skillNeedsReview, importSkillWire, exportSkillWire } from './skill-model.js'; // 零 import fail-safe 归一化 + 可运行判据;I1:待审谓词 + 导入白名单(载重不变式);I2:白名单导出(剥信任标志)
import { hydrateSkills, listSkills, saveSkill, removeSkill } from './skill-store.js'; // ★S2b:数据层(缓存供命令面板同步 platformSkills)
import { mdField, wireMdField, mdRender } from './md-edit.js'; // Markdown 编辑/展示(共享);审阅门与 JSON 导入导出保持 raw source

/** 生成稳定 id。 */
function newId() {
  return 'sk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Skills 视图:列表(名/说明/指令预览)+ 新建·编辑(模态)+ 逐条删(即时 + toastUndo)。
 *  渲染进能力中心传入的 `box`;rt.db 双端可用 ⇒ 桌面/网页均生效(异于 connector/memory 的桌面限定)。
 *  @param {HTMLElement} box */
export async function renderSkills(box) {
  if (!box) return;
  await hydrateSkills(); // 与存储对齐(缓存亦供命令面板;CRUD 走 skill-store 保持二者一致)
  const rows = listSkills();
  const list = rows.length
    ? rows
        .map(
          (/** @type {ReturnType<typeof normSkill>} */ s) => `<div style="padding:11px 0;border-bottom:0.5px solid var(--border);">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
          <span style="font-size:13.5px;color:var(--ink);font-weight:600;">${cEsc(s.name) || tt('(未命名)', '(untitled)')}</span>
          ${s.description ? `<span style="font-size:12px;color:var(--ink-3);">${cEsc(s.description)}</span>` : ''}
          ${skillNeedsReview(s) ? `<span class="mono" style="font-size:10px;letter-spacing:.5px;color:var(--accent);">${tt('导入 · 待审阅', 'IMPORTED · UNREVIEWED')}</span>` : ''}
          <span style="flex:1;"></span>
          ${skillNeedsReview(s) ? `<button class="btn btn-accent" data-skreview="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('审阅', 'Review')}</button>` : skillRunnable(s) ? `<button class="btn btn-accent" data-skrun="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('运行', 'Run')}</button>` : ''}
          <button class="btn" data-skedit="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('编辑', 'Edit')}</button>
          ${skillRunnable(s) ? `<button class="btn" data-skshare="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('分享', 'Share')}</button>` : ''}
          <button class="btn" data-skdel="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('删除', 'Delete')}</button>
        </div>
        <div class="md-body" style="margin-top:6px;padding:8px 11px;background:var(--bg-subtle);border:0.5px solid var(--border);font-size:12px;max-height:88px;overflow:hidden;">${mdRender(s.prompt)}</div>
      </div>`
        )
        .join('')
    : `<p style="color:var(--ink-3);font-size:12px;padding:8px 0;line-height:1.7;max-width:560px;">${tt('还没有 Skill。把你反复用的指令沉淀成技能 —— 本地保存,一点即运行(Agent 会用它跑一轮)。', 'No skills yet. Turn instructions you reuse into skills — stored locally, one-click run (the Agent runs it for you).')}</p>`;
  box.innerHTML =
    `<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:4px;"><button class="btn" id="skImport" style="padding:4px 12px;font-size:11.5px;">${tt('导入', 'Import')}</button><button class="btn btn-accent" id="skAdd" style="padding:4px 12px;font-size:11.5px;">${tt('+ 新建 Skill', '+ New skill')}</button></div>` +
    list;
  const add = $('#skAdd', box);
  if (add) /** @type {HTMLElement} */ (add).onclick = () => openSkillModal(box, '');
  const imp = $('#skImport', box);
  if (imp) /** @type {HTMLElement} */ (imp).onclick = () => openImportSkillModal(box);
  $$('[data-skreview]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => {
      const s = rows.find((/** @type {any} */ x) => x.id === /** @type {HTMLElement} */ (b).dataset.skreview);
      if (s) openReviewSkillModal(box, s);
    };
  });
  $$('[data-skshare]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => {
      const s = rows.find((/** @type {any} */ x) => x.id === /** @type {HTMLElement} */ (b).dataset.skshare);
      if (s) openShareSkillModal(s);
    };
  });
  $$('[data-skrun]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => {
      const s = rows.find((/** @type {any} */ x) => x.id === /** @type {HTMLElement} */ (b).dataset.skrun);
      if (s) runSkill(s); // 走 agentSend 标准路径 → ai_chat(红线结构性继承);无正文时 runSkill 内 skillRunnable 守卫 no-op
    };
  });
  $$('[data-skedit]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => openSkillModal(box, /** @type {HTMLElement} */ (b).dataset.skedit || '');
  });
  $$('[data-skdel]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => {
      const s = rows.find((/** @type {any} */ x) => x.id === /** @type {HTMLElement} */ (b).dataset.skdel);
      if (s) delSkill(box, s);
    };
  });
}

/** 逐条删:即时删除 + toastUndo(rt.db.remove 返快照,经 db.upsert 还原;单条可靠 ⇒ 不走 guardrail)。
 *  @param {HTMLElement} box @param {ReturnType<typeof normSkill>} snap */
async function delSkill(box, snap) {
  try {
    await removeSkill(snap.id); // rt.db.remove + 缓存移除(命令面板即时不再列出)
  } catch (e) {
    toast(errText(e));
    return;
  }
  await renderSkills(box);
  // toast 消息经 el(innerHTML) 渲染 → name 须 cEsc(同 prompts/记忆 删除路径纪律)。
  toastUndo(tt('已删除「', 'Deleted "') + (cEsc(snap.name) || tt('未命名', 'untitled')) + tt('」', '"'), async () => {
    try {
      await saveSkill(snap); // 闭包快照经 keyed upsert 还原(非单槽、连删独立可靠)+ 缓存回填
    } catch (e) {
      toast(errText(e));
      return;
    }
    await renderSkills(box);
  });
}

/** 新建·编辑模态(空 id = 新建)。写入走 skill-store `saveSkill`({id,name,description,prompt,updated_at})。
 *  @param {HTMLElement} box @param {string} id */
async function openSkillModal(box, id) {
  let s = normSkill(id ? listSkills().find((x) => x.id === id) : null); // 编辑读缓存(hydrateSkills 已对齐存储);新建 → 空
  // ★F2 工具 scoping:列**全部启用应用**的 app-tool(声明意图用全集;运行时 scopeAppTools 再 ∩ readable 减权,声明 ⊇ 生效)。
  const _S = /** @type {any} */ (window).SeekerShell;
  const allTools = _S && typeof _S.appTools === 'function' ? _S.appTools() : [];
  const scoped = Array.isArray(s.tools); // 三态:undefined=不限定(开关未勾)/ 数组=限定(开关勾,含 []=无 app-tool)
  const selTools = Array.isArray(s.tools) ? s.tools : []; // 已选集(TS 确定数组,供 .map 闭包内 includes)
  const m = openModal(
    `<div class="modal-head"><div><p class="eyebrow">— SKILL</p><h2 style="margin-top:5px;">${
      id ? tt('编辑 Skill', 'Edit skill') : tt('新建 Skill', 'New skill')
    }<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="set-row"><span class="sk">${tt('名称', 'Name')}</span><input class="input" id="skName" value="${cEsc(s.name)}" placeholder="${tt('如:把 JD 拆成硬性/软性要求', 'e.g. Split a JD into hard/soft requirements')}"></div>
      <div class="set-row" style="margin-top:10px;"><span class="sk">${tt('说明', 'Description')}</span><input class="input" id="skDesc" value="${cEsc(s.description)}" placeholder="${tt('一句话(可选)', 'One line (optional)')}"></div>
      <div style="margin-top:12px;">${mdField({ id: 'skPrompt', value: s.prompt, rows: 8, mono: true, placeholder: tt('指令正文 —— 你希望 Agent 执行的事(保存后一点即运行,支持 Markdown)。', 'Instruction body — what you want the Agent to do (run in one click after saving; Markdown supported).') })}</div>
      ${
        allTools.length
          ? `<div class="set-row" style="margin-top:14px;flex-direction:column;align-items:stretch;gap:7px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;color:var(--ink-2);"><input type="checkbox" id="skScopeOn"${scoped ? ' checked' : ''}> ${tt('限定此 Skill 可用的工具', 'Limit which tools this skill can use')}</label>
        <p style="font-size:11px;color:var(--ink-3);margin:0 0 0 23px;line-height:1.6;">${tt(
          '未勾 = 可用全部工具(与你打字一致);勾选后仅用下面选中的。平台能力(查数据 / 记忆 / 卡片)不受影响、始终可用。',
          'Unchecked = all tools (same as typing); when checked, only the selected ones. Platform capabilities (query data / memory / widgets) are unaffected and always available.'
        )}</p>
        <div id="skToolList" style="display:${scoped ? 'flex' : 'none'};flex-direction:column;gap:6px;margin-left:23px;">${allTools
          .map(
            (/** @type {any} */ t) =>
              `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--ink-2);font-family:var(--font-mono);"><input type="checkbox" class="skTool" value="${cEsc(t.name)}"${
                selTools.includes(t.name) ? ' checked' : ''
              }> ${cEsc(t.name)}</label>`
          )
          .join('')}</div>
      </div>`
          : ''
      }
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" id="skSave">${tt('保存', 'Save')}</button></div>`,
    true
  );
  wireMdField(m); // Markdown 编辑/预览切换
  // ★F2:限定开关 → 显隐工具多选列表(三态 UI 交互)。
  const scopeOn = /** @type {HTMLInputElement|null} */ ($('#skScopeOn'));
  if (scopeOn)
    scopeOn.onchange = () => {
      const listEl = $('#skToolList');
      if (listEl) /** @type {HTMLElement} */ (listEl).style.display = scopeOn.checked ? 'flex' : 'none';
    };
  const save = $('#skSave');
  if (save)
    /** @type {HTMLElement} */ (save).onclick = async () => {
      const name = (/** @type {HTMLInputElement|null} */ ($('#skName')) || { value: '' }).value.trim();
      const description = (/** @type {HTMLInputElement|null} */ ($('#skDesc')) || { value: '' }).value.trim();
      const prompt = (/** @type {HTMLTextAreaElement|null} */ ($('#skPrompt')) || { value: '' }).value;
      if (!name && !prompt.trim()) {
        toast(tt('写点内容再保存', 'Add some content first'));
        return;
      }
      // ★F2 工具 scoping 三态收集:段未渲染(无 app-tool 可选)→ 保留原 s.tools 不 clobber;
      //   开关未勾 → undefined(不限定=全,雏形零回归);勾 → 选中 name[](可 []=无 app-tool)。
      let tools = s.tools;
      if (allTools.length) {
        const on = /** @type {HTMLInputElement|null} */ ($('#skScopeOn'));
        tools =
          on && on.checked
            ? $$('.skTool')
                .filter((/** @type {any} */ c) => c.checked)
                .map((/** @type {any} */ c) => c.value)
            : undefined;
      }
      // ★I1 溯源保持:编辑不洗白导入来源(imported 恒承原值);[建议]2 背书绑**特定 prompt**:
      //   导入件 prompt 变更 ⇒ reviewed 失效重审(旧背书对不上新指令);未变 ⇒ 承原值(含未审=仍待审)。
      //   本地件(含新建 id='' → normSkill(null) imported:false)恒 reviewed:true(可信来源,字段无意义但保持一致)。
      const rec = { id: id || newId(), name, description, prompt, updated_at: Date.now(), tools,
        imported: s.imported, reviewed: s.imported ? (prompt === s.prompt ? s.reviewed : false) : true };
      try {
        await saveSkill(rec); // rt.db.upsert + 缓存更新(命令面板即时可见新 Skill)
      } catch (e) {
        toast(errText(e));
        return;
      }
      closeModal();
      await renderSkills(box);
      toast(tt('已保存', 'Saved'));
    };
}

/** ★I1 导入(JSON 粘贴 · 本地优先无网络,第92轮预裁①)。**载重不变式**在 importSkillWire(白名单提取 +
 *  平台强制 imported:true/reviewed:false,粘贴的信任标志/id 一律丢弃);此处**显式字面构造** rec
 *  (信任标志在保存位字面可见,绝不 spread 粘贴派生对象)+ **fresh id**(不可能 clobber 既有 Skill,同 S3 fresh-id)。
 *  导入即存为**未审阅**(fail-closed:即使用户关掉随后的审阅门,它仍双点拒运行)→ 自动开审阅门(逐条审阅,预裁②)。
 *  @param {HTMLElement} box */
function openImportSkillModal(box) {
  openModal(
    `<div class="modal-head"><div><p class="eyebrow">— IMPORT · UNTRUSTED</p><h2 style="margin-top:5px;">${tt('导入 Skill', 'Import skill')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <p style="font-size:12px;color:var(--ink-2);line-height:1.7;margin:0 0 10px;max-width:640px;">${tt('粘贴他人分享的 Skill JSON(含 name / prompt,可选 description / tools)。<b>导入的 Skill 是第三方指令</b>:导入后为「待审阅」,审阅认可前不可运行。', 'Paste a shared skill JSON (name / prompt, optional description / tools). <b>An imported skill is a third-party instruction</b>: it arrives unreviewed and cannot run until you review and approve it.')}</p>
      <textarea class="input" id="skImpText" rows="10" style="width:100%;font-family:var(--font-mono);font-size:12px;line-height:1.7;" placeholder='{"name":"…","prompt":"…"}'></textarea>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" id="skImpGo">${tt('导入', 'Import')}</button></div>`,
    true
  );
  const go = $('#skImpGo');
  if (go)
    /** @type {HTMLElement} */ (go).onclick = async () => {
      const text = (/** @type {HTMLTextAreaElement|null} */ ($('#skImpText')) || { value: '' }).value;
      const wire = importSkillWire(text); // ★白名单提取 + 平台强制标志(载重不变式,node 双向阳性对照测)
      if (!wire) {
        toast(tt('无法解析:需要含 prompt 的 JSON 对象', 'Cannot parse: need a JSON object with a prompt'));
        return;
      }
      // ★显式字面构造(载重不变式第二层:imported:true/reviewed:false 在保存位字面可见)+ fresh id。
      const rec = { id: newId(), name: wire.name, description: wire.description, prompt: wire.prompt, tools: wire.tools, imported: true, reviewed: false, updated_at: Date.now() };
      try {
        await saveSkill(rec);
      } catch (e) {
        toast(errText(e));
        return;
      }
      closeModal();
      await renderSkills(box);
      openReviewSkillModal(box, normSkill(rec)); // 逐条审阅:导入即开审阅门(已先存为未审 ⇒ 关掉也 fail-closed)
    };
}

/** ★I1 知情审阅门(承 notes 同意闸 · **信任转移点**)。摊开:prompt **全文**(Untrusted · cEsc · 可滚动不截断)+
 *  声明 tools scope(注明运行时 ∩ 可读集只减不增)+ **硬红线兜底文案**([建议]3:审阅是知情、不是唯一防线)。
 *  显式认可 → reviewed:true(**唯一**置 true 的通路);删除复用 delSkill(toastUndo 可撤销)。
 *  @param {HTMLElement} box @param {ReturnType<typeof normSkill>} s */
function openReviewSkillModal(box, s) {
  const lbl = 'font-family:var(--font-mono);font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-3);';
  const toolsLine = Array.isArray(s.tools)
    ? s.tools.length
      ? s.tools.map((t) => `<span class="mono" style="font-size:11px;">${cEsc(t)}</span>`).join(' · ')
      : tt('无(不使用任何应用工具)', 'None (no app tools)')
    : tt('未限定(全部可读工具)', 'Unlimited (all readable tools)');
  openModal(
    `<div class="modal-head"><div><p class="eyebrow">— REVIEW · UNTRUSTED</p><h2 style="margin-top:5px;">${tt('审阅导入的 Skill', 'Review imported skill')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        <span style="font-size:13.5px;color:var(--ink);font-weight:600;">${cEsc(s.name) || tt('(未命名)', '(untitled)')}</span>
        ${s.description ? `<span style="font-size:12px;color:var(--ink-3);">${cEsc(s.description)}</span>` : ''}
      </div>
      <p style="${lbl}margin:10px 0 6px;">${tt('指令全文(第三方撰写 · 审阅它会让 Agent 做什么)', 'FULL INSTRUCTION (THIRD-PARTY · REVIEW WHAT IT MAKES THE AGENT DO)')}</p>
      <div style="padding:10px 12px;background:var(--bg-subtle);border:0.5px solid var(--border);font-family:var(--font-mono);font-size:11.5px;line-height:1.7;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;">${cEsc(s.prompt)}</div>
      <p style="${lbl}margin:12px 0 6px;">${tt('声明的工具', 'DECLARED TOOLS')}</p>
      <p style="font-size:12px;color:var(--ink-2);margin:0;">${toolsLine}<span style="font-size:11px;color:var(--ink-3);"> · ${tt('运行时仍与你的可读集取交集(只减不增)', 'still intersected with your readable set at runtime (never widened)')}</span></p>
      <p style="font-size:12px;color:var(--ink-2);line-height:1.8;margin:14px 0 0;max-width:640px;">${tt('这是他人写的指令,运行时会以<b>你的身份</b>驱动 Agent。你已看到它会让 Agent 做什么;<b>平台仍保护你的隐私资料(AI 永不可读),破坏性操作仍需你确认</b> —— 审阅是知情,不是唯一防线。', 'This is an instruction someone else wrote; when run it drives the Agent <b>as you</b>. You have seen what it makes the Agent do; <b>the platform still protects your private profile (never AI-readable) and destructive actions still require your confirmation</b> — reviewing informs you; it is not the only line of defense.')}</p>
    </div>
    <div class="modal-foot"><button class="btn" id="skRevDel">${tt('删除', 'Delete')}</button><button class="btn" data-close>${tt('关闭', 'Close')}</button><button class="btn btn-accent" id="skRevOk">${tt('我已审阅,信任并启用', 'Reviewed — trust and enable')}</button></div>`,
    true
  );
  const ok = $('#skRevOk');
  if (ok)
    /** @type {HTMLElement} */ (ok).onclick = async () => {
      try {
        await saveSkill({ ...s, reviewed: true, updated_at: Date.now() }); // s = 平台归一记录(非粘贴数据);显式 reviewed:true 在 spread 后
      } catch (e) {
        toast(errText(e));
        return;
      }
      closeModal();
      await renderSkills(box);
      toast(tt('已启用', 'Enabled'));
    };
  const del = $('#skRevDel');
  if (del)
    /** @type {HTMLElement} */ (del).onclick = async () => {
      closeModal();
      await delSkill(box, s); // 复用逐条删(toastUndo 可撤销)
    };
}

/** ★I2 分享导出(本地优先无网络 · 第93轮盯点③)。JSON 经 exportSkillWire **白名单**产出 ——
 *  **绝不含 id / updated_at / imported / reviewed**(剥信任标志 = 不依赖接收方实现的防线:
 *  即便接收方不是 I1 importSkillWire,也吃不到 reviewed:true 绕审阅门);接收方导入后重走审阅(预裁③)。
 *  复制:navigator.clipboard 优先、execCommand 兜底、都不行则全选提示手动 ⌘C(WKWebView 剪贴板可用性不赌)。
 *  @param {ReturnType<typeof normSkill>} s */
function openShareSkillModal(s) {
  const wire = exportSkillWire(s);
  if (!wire) {
    toast(tt('无指令正文,补全后再分享', 'Nothing to share yet — add an instruction first'));
    return;
  }
  const json = JSON.stringify(wire, null, 2);
  openModal(
    `<div class="modal-head"><div><p class="eyebrow">— SHARE</p><h2 style="margin-top:5px;">${tt('分享 Skill', 'Share skill')}<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <p style="font-size:12px;color:var(--ink-2);line-height:1.7;margin:0 0 10px;max-width:640px;">${tt('复制下面的 JSON 发给对方。<b>不含你的本地状态</b>(id / 审阅标志);对方导入后,会经<b>自己的审阅门</b>认可才能运行。', 'Copy the JSON below and send it. <b>None of your local state</b> (id / review flags) is included; the recipient reviews and approves it in <b>their own review gate</b> before it can run.')}</p>
      <textarea class="input" id="skShareText" rows="10" readonly style="width:100%;font-family:var(--font-mono);font-size:12px;line-height:1.7;">${cEsc(json)}</textarea>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('关闭', 'Close')}</button><button class="btn btn-accent" id="skShareCopy">${tt('复制', 'Copy')}</button></div>`,
    true
  );
  const cp = $('#skShareCopy');
  if (cp)
    /** @type {HTMLElement} */ (cp).onclick = async () => {
      const ta = /** @type {HTMLTextAreaElement|null} */ ($('#skShareText'));
      if (ta) ta.select();
      let ok = false;
      try {
        await navigator.clipboard.writeText(json);
        ok = true;
      } catch (_e) {
        try {
          ok = document.execCommand('copy');
        } catch (_e2) {
          ok = false;
        }
      }
      toast(ok ? tt('已复制', 'Copied') : tt('已全选,按 ⌘C 复制', 'Selected — press ⌘C to copy'));
    };
}
