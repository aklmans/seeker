// @ts-check
/** 平台 · Project 管理面(proposal-project PJ1)—— 能力中心内联视图(非 app,§1)。
 *
 *  ★红线:
 *   - **项目 CRUD 只在此管理面**(§4-2「不可经对话改」延伸):Agent 不能创建/切换/改写项目 ——
 *     否则可自改「每轮注入的指令」= 自我提示注入通路(第98轮;详见 project-model.js 头注)。
 *   - **MVP 只归档不删**(§5.4 预裁):归档 = 不出现在切换器(PJ2)、消息数据保留、可还原;
 *     真删涉项目消息批量销毁 = guardrail 批量档,后续单出。
 *   - 转义(§4-4):name/instructions 进 DOM 一律 cEsc。
 *   - PJ1 无切换器、不显消息数(messages 的 projectId 属 PJ2;不显示还不存在的数据,诚实)。 */
import { cEsc } from './copilot-chrome.js';
import { $, $$ } from './dom.js';
import { tt } from './i18n.js';
import { IC } from './icons.js';
import { toast, errText } from './toast.js';
import { openModal, closeModal } from './modal.js';
import { normProject } from './project-model.js';
import { hydrateProjects, listProjects, saveProject } from './project-store.js';

/** 生成稳定 id。 */
function newId() {
  return 'pj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Project 视图(能力中心传入 box)。 @param {HTMLElement} box */
export async function renderProjects(box) {
  if (!box) return;
  await hydrateProjects();
  const rows = listProjects();
  const list = rows.length
    ? rows
        .map(
          (p) => `<div style="padding:11px 0;border-bottom:0.5px solid var(--border);${p.archived ? 'opacity:.55;' : ''}">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
          <span style="font-size:13.5px;color:var(--ink);font-weight:600;">${cEsc(p.name) || tt('(未命名)', '(untitled)')}</span>
          ${p.archived ? `<span class="mono" style="font-size:10px;letter-spacing:.5px;color:var(--ink-3);">${tt('已归档', 'ARCHIVED')}</span>` : ''}
          <span style="flex:1;"></span>
          <button class="btn" data-pjedit="${cEsc(p.id)}" style="padding:3px 10px;font-size:11px;">${tt('编辑', 'Edit')}</button>
          <button class="btn" data-pjarch="${cEsc(p.id)}" style="padding:3px 10px;font-size:11px;">${p.archived ? tt('还原', 'Restore') : tt('归档', 'Archive')}</button>
        </div>
        ${p.instructions ? `<div style="margin-top:6px;padding:8px 11px;background:var(--bg-subtle);border:0.5px solid var(--border);font-family:var(--font-mono);font-size:11.5px;line-height:1.6;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;max-height:66px;overflow:hidden;">${cEsc(p.instructions)}</div>` : ''}
      </div>`
        )
        .join('')
    : `<p style="color:var(--ink-3);font-size:12px;padding:8px 0;line-height:1.7;max-width:560px;">${tt('还没有项目。一个项目 = 一个目标的工作区:自己的对话线、自己的定制指令。找完一个目标,归档它 —— 数据始终保留。', 'No projects yet. A project is a goal workspace: its own conversation thread and its own instructions. Done with a goal? Archive it — data is always kept.')}</p>`;
  box.innerHTML =
    `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-accent" id="pjAdd" style="padding:4px 12px;font-size:11.5px;">${tt('+ 新建项目', '+ New project')}</button></div>` +
    list +
    `<p style="font-size:11px;color:var(--ink-3);margin:10px 0 0;line-height:1.7;">${tt('项目只在这里管理(不经对话);归档不删除 —— 对话数据始终保留、可随时还原。对话切换与项目指令生效将在后续版本接入。', 'Projects are managed here only (never via chat); archiving deletes nothing — conversation data is always kept and restorable. Thread switching and project instructions take effect in an upcoming update.')}</p>`;
  const add = $('#pjAdd', box);
  if (add) /** @type {HTMLElement} */ (add).onclick = () => openProjectModal(box, '');
  $$('[data-pjedit]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => openProjectModal(box, /** @type {HTMLElement} */ (b).dataset.pjedit || '');
  });
  $$('[data-pjarch]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = async () => {
      const p = rows.find((x) => x.id === /** @type {HTMLElement} */ (b).dataset.pjarch);
      if (!p) return;
      try {
        await saveProject({ ...p, archived: !p.archived, updated_at: Date.now() }); // 归档/还原(非破坏、可逆 ⇒ 不弹模态)
      } catch (e) {
        toast(errText(e));
        return;
      }
      await renderProjects(box);
      toast(p.archived ? tt('已还原', 'Restored') : tt('已归档(数据保留)', 'Archived — data kept'));
    };
  });
}

/** 新建·编辑模态(空 id = 新建)。instructions = 用户自撰(可信侧;PJ3 注入位,见 project-model 头注)。
 *  @param {HTMLElement} box @param {string} id */
function openProjectModal(box, id) {
  const p = normProject(id ? listProjects().find((x) => x.id === id) : null);
  openModal(
    `<div class="modal-head"><div><p class="eyebrow">— PROJECT</p><h2 style="margin-top:5px;">${
      id ? tt('编辑项目', 'Edit project') : tt('新建项目', 'New project')
    }<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="set-row"><span class="sk">${tt('名称', 'Name')}</span><input class="input" id="pjName" value="${cEsc(p.name)}" placeholder="${tt('如:2026 后端求职', 'e.g. Backend job hunt 2026')}"></div>
      <textarea class="input" id="pjInstr" rows="7" style="width:100%;margin-top:12px;font-family:var(--font-mono);font-size:12.5px;line-height:1.7;" placeholder="${tt('项目指令(可选)—— 这个项目里 Agent 该知道的背景与偏好;生效于后续版本。', 'Project instructions (optional) — background & preferences the Agent should know in this project; takes effect in an upcoming update.')}">${cEsc(p.instructions)}</textarea>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" id="pjSave">${tt('保存', 'Save')}</button></div>`,
    true
  );
  const save = $('#pjSave');
  if (save)
    /** @type {HTMLElement} */ (save).onclick = async () => {
      const name = (/** @type {HTMLInputElement|null} */ ($('#pjName')) || { value: '' }).value.trim();
      const instructions = (/** @type {HTMLTextAreaElement|null} */ ($('#pjInstr')) || { value: '' }).value;
      if (!name) {
        toast(tt('给项目起个名字', 'Give the project a name'));
        return;
      }
      const rec = { id: id || newId(), name, instructions, archived: p.archived, created_at: id ? p.created_at : Date.now(), updated_at: Date.now() };
      try {
        await saveProject(rec);
      } catch (e) {
        toast(errText(e));
        return;
      }
      closeModal();
      await renderProjects(box);
      toast(tt('已保存', 'Saved'));
    };
}
