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
import { normSkill, skillRunnable } from './skill-model.js'; // 零 import fail-safe 归一化 + 可运行判据(node 可测;S2 prompt→instruction 依赖)
import { hydrateSkills, listSkills, saveSkill, removeSkill } from './skill-store.js'; // ★S2b:数据层(缓存供命令面板同步 platformSkills)

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
          <span style="flex:1;"></span>
          ${skillRunnable(s) ? `<button class="btn btn-accent" data-skrun="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('运行', 'Run')}</button>` : ''}
          <button class="btn" data-skedit="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('编辑', 'Edit')}</button>
          <button class="btn" data-skdel="${cEsc(s.id)}" style="padding:3px 10px;font-size:11px;">${tt('删除', 'Delete')}</button>
        </div>
        <div style="margin-top:6px;padding:8px 11px;background:var(--bg-subtle);border:0.5px solid var(--border);font-family:var(--font-mono);font-size:11.5px;line-height:1.6;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;max-height:66px;overflow:hidden;">${cEsc(s.prompt)}</div>
      </div>`
        )
        .join('')
    : `<p style="color:var(--ink-3);font-size:12px;padding:8px 0;line-height:1.7;max-width:560px;">${tt('还没有 Skill。把你反复用的指令沉淀成技能 —— 本地保存,一点即运行(Agent 会用它跑一轮)。', 'No skills yet. Turn instructions you reuse into skills — stored locally, one-click run (the Agent runs it for you).')}</p>`;
  box.innerHTML =
    `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-accent" id="skAdd" style="padding:4px 12px;font-size:11.5px;">${tt('+ 新建 Skill', '+ New skill')}</button></div>` +
    list;
  const add = $('#skAdd', box);
  if (add) /** @type {HTMLElement} */ (add).onclick = () => openSkillModal(box, '');
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
  openModal(
    `<div class="modal-head"><div><p class="eyebrow">— SKILL</p><h2 style="margin-top:5px;">${
      id ? tt('编辑 Skill', 'Edit skill') : tt('新建 Skill', 'New skill')
    }<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="set-row"><span class="sk">${tt('名称', 'Name')}</span><input class="input" id="skName" value="${cEsc(s.name)}" placeholder="${tt('如:把 JD 拆成硬性/软性要求', 'e.g. Split a JD into hard/soft requirements')}"></div>
      <div class="set-row" style="margin-top:10px;"><span class="sk">${tt('说明', 'Description')}</span><input class="input" id="skDesc" value="${cEsc(s.description)}" placeholder="${tt('一句话(可选)', 'One line (optional)')}"></div>
      <textarea class="input" id="skPrompt" rows="8" style="width:100%;margin-top:12px;font-family:var(--font-mono);font-size:12.5px;line-height:1.7;" placeholder="${tt('指令正文 —— 你希望 Agent 执行的事(保存后一点即运行)。', 'Instruction body — what you want the Agent to do (run it in one click after saving).')}">${cEsc(s.prompt)}</textarea>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" id="skSave">${tt('保存', 'Save')}</button></div>`,
    true
  );
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
      const rec = { id: id || newId(), name, description, prompt, updated_at: Date.now() };
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
