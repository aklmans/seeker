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
import { cEsc, renderProjectSwitch, switchProject } from './copilot-chrome.js';
import { $, $$ } from './dom.js';
import { tt } from './i18n.js';
import { IC } from './icons.js';
import { toast, errText } from './toast.js';
import { openModal, closeModal } from './modal.js';
import { normProject } from './project-model.js';
import { hydrateProjects, listProjects, saveProject } from './project-store.js';
import { currentProjectId } from './project-state.js';
import { mdField, wireMdField, mdRender } from './md-edit.js'; // Markdown 编辑/展示(共享)

/** 生成稳定 id。 */
function newId() {
  return 'pj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Project 视图(能力中心传入 box)。 @param {HTMLElement} box */
export async function renderProjects(box) {
  if (!box) return;
  if(!await hydrateProjects()){box.textContent=tt('无法读取工作空间，请重试。','Could not load workspaces. Please retry.');return;}
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
        ${p.instructions ? `<div class="md-body" style="margin-top:6px;padding:8px 11px;background:var(--bg-subtle);border:0.5px solid var(--border);font-size:12px;max-height:88px;overflow:hidden;">${mdRender(p.instructions)}</div>` : ''}
      </div>`
        )
        .join('')
    : `<p style="color:var(--ink-3);line-height:1.7;">${tt('可以新建学习、工作或生活空间，分别保存对话和助手指令。', 'Create a workspace for learning, work or life, with separate conversations and assistant instructions.')}</p>`;
  box.innerHTML =
    `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-accent" id="pjAdd" style="padding:4px 12px;font-size:11.5px;">${tt('+ 新建工作空间', '+ New workspace')}</button></div>` +
    list +
    `<p style="font-size:12px;color:var(--ink-3);margin:10px 0;line-height:1.7;">${tt('归档后保留全部对话，可随时还原。助手指令仅用于该空间的对话；写作、文件问答和固定任务使用各自的明确输入。', 'Archiving keeps conversations and can be undone. Workspace instructions apply to its chats; writing, file Q&A and fixed tasks use their own explicit inputs.')}</p>`;
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
        if(!p.archived && currentProjectId()===p.id && !await switchProject('')) return;
        await saveProject({ ...p, archived: !p.archived, updated_at: Date.now() }); // 归档/还原(非破坏、可逆 ⇒ 不弹模态)
      } catch (e) {
        toast(errText(e));
        return;
      }
      // ★盯点④(第99轮):归档的是当前项目 → 回落默认工作区(否则用户停在不在切换器里的「幽灵」当前项目)。
      await renderProjects(box);
      renderProjectSwitch(); // 切换器同步(含自愈;Agent 面不在 DOM 时 no-op)
      window.dispatchEvent(new CustomEvent('seeker-workspaces-changed'));
      toast(p.archived ? tt('已还原', 'Restored') : tt('已归档(数据保留)', 'Archived — data kept'));
    };
  });
}

/** 新建·编辑模态(空 id = 新建)。instructions = 用户自撰(可信侧;PJ3 注入位,见 project-model 头注)。
 *  @param {HTMLElement} box @param {string} id */
function openProjectModal(box, id) {
  const p = normProject(id ? listProjects().find((x) => x.id === id) : null);
  const m = openModal(
    `<div class="modal-head"><div><p class="eyebrow">— PROJECT</p><h2 style="margin-top:5px;">${
      id ? tt('编辑工作空间', 'Edit workspace') : tt('新建工作空间', 'New workspace')
    }<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="set-row"><label class="sk" for="pjName">${tt('名称', 'Name')}</label><input class="input" maxlength="80" id="pjName" value="${cEsc(p.name)}" placeholder="${tt('如：秋季学习计划', 'e.g. Autumn learning plan')}"></div>
      <div style="margin-top:12px;"><label for="pjInstr">${tt('助手指令（可选）','Assistant instructions (optional)')}</label>${mdField({ id: 'pjInstr', value: p.instructions, rows: 7, mono: true, placeholder: tt('例如：我正在学习英语，请用简单例子解释，每次给一道练习。', 'For example: I am learning English. Explain with simple examples and give me one exercise each time.') })}</div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" id="pjSave">${tt('保存', 'Save')}</button></div>`,
    true
  );
  wireMdField(m); // Markdown 编辑/预览切换
  const save = $('#pjSave');
  if (save)
    /** @type {HTMLElement} */ (save).onclick = async () => {
      const name = (/** @type {HTMLInputElement|null} */ ($('#pjName')) || { value: '' }).value.trim();
      const instructions = (/** @type {HTMLTextAreaElement|null} */ ($('#pjInstr')) || { value: '' }).value;
      if (!name) {
        toast(tt('给工作空间起个名字', 'Give the workspace a name'));
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
      renderProjectSwitch(); // 新建/改名即时进切换器
      window.dispatchEvent(new CustomEvent('seeker-workspaces-changed'));
      toast(tt('已保存', 'Saved'));
    };
}
