// @ts-check
/** 平台 · Scheduled tasks 管理面(proposal-scheduled-tasks SC1)—— 能力中心内联视图(非 app,§1)。
 *
 *  ★红线:
 *   - **调度 CRUD 只在此管理面**(§4-2「不可经对话改」延伸):Agent 不能给自己排任务(第95轮 [建议]-强,
 *     结构性缺席的有形锚之一;platform_schedules 亦不进 QUERYABLE = AI 不可读)。
 *   - **Skill 选择器只列「可运行且已审阅」**(I1 双点之外的第三点收口;fire 侧 runSkill 守卫仍兜底)。
 *   - 转义(§4-4):Skill 名等进 DOM 一律 cEsc;删除 toastUndo 可撤销(keyed upsert 还原)。
 *   - 诚实文案:「仅 Seeker 开着时触发 · 错过不补跑」(方案 §6 边界,不承诺做不到的)。 */
import { cEsc } from './copilot-chrome.js';
import { $, $$ } from './dom.js';
import { tt } from './i18n.js';
import { IC } from './icons.js';
import { toast, toastUndo, errText } from './toast.js';
import { openModal, closeModal } from './modal.js';
import { normSchedule } from './schedule-model.js';
import { hydrateSchedules, listSchedules, saveSchedule, removeSchedule } from './schedule-store.js';
import { normSkill, skillRunnable, skillNeedsReview } from './skill-model.js';
import { hydrateSkills, listSkills } from './skill-store.js';

/** 生成稳定 id。 */
function newId() {
  return 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const DOW = () => [tt('周日', 'Sun'), tt('周一', 'Mon'), tt('周二', 'Tue'), tt('周三', 'Wed'), tt('周四', 'Thu'), tt('周五', 'Fri'), tt('周六', 'Sat')];

/** 排点人话:每天 09:00 / 每周三 09:00。 @param {ReturnType<typeof normSchedule>} n */
function schedLabel(n) {
  return n.kind === 'weekly' ? tt('每', 'Every ') + DOW()[n.dow] + ' ' + n.time : tt('每天 ', 'Daily ') + n.time;
}

/** 上次运行状态人话(如实,不粉饰)。 @param {ReturnType<typeof normSchedule>} n */
function lastLabel(n) {
  if (!n.last_run_at) return tt('未运行过', 'Never ran');
  const when = new Date(n.last_run_at).toLocaleString();
  const st =
    n.last_status === 'ok' ? tt('已运行', 'ran') :
    n.last_status === 'skill-missing' ? tt('Skill 已删除,未运行', 'skill missing — did not run') :
    n.last_status === 'skill-blocked' ? tt('Skill 不可运行(草稿/待审阅),未运行', 'skill not runnable (draft/unreviewed) — did not run') :
    n.last_status === 'error' ? tt('出错', 'errored') : n.last_status;
  return when + ' · ' + st;
}

/** Scheduled 视图(能力中心传入 box)。 @param {HTMLElement} box */
export async function renderSchedules(box) {
  if (!box) return;
  await Promise.all([hydrateSchedules(), hydrateSkills()]); // 调度 + Skill 名解析都要新鲜
  const rows = listSchedules();
  const skillName = (/** @type {string} */ id) => {
    const s = listSkills().find((x) => x.id === id);
    return s ? normSkill(s).name || tt('(未命名)', '(untitled)') : '';
  };
  const list = rows.length
    ? rows
        .map((n) => {
          const name = skillName(n.skillId);
          return `<div style="padding:11px 0;border-bottom:0.5px solid var(--border);">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
          <span style="font-size:13.5px;color:var(--ink);font-weight:600;">${name ? cEsc(name) : tt('(Skill 已删除)', '(skill deleted)')}</span>
          <span class="mono" style="font-size:11px;color:var(--ink-2);">${cEsc(schedLabel(n))}</span>
          <span style="flex:1;"></span>
          <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ink-2);cursor:pointer;"><input type="checkbox" data-sctoggle="${cEsc(n.id)}"${n.enabled ? ' checked' : ''}> ${tt('启用', 'On')}</label>
          <button class="btn" data-scedit="${cEsc(n.id)}" style="padding:3px 10px;font-size:11px;">${tt('编辑', 'Edit')}</button>
          <button class="btn" data-scdel="${cEsc(n.id)}" style="padding:3px 10px;font-size:11px;">${tt('删除', 'Delete')}</button>
        </div>
        <div style="margin-top:5px;font-size:11px;color:var(--ink-3);">${cEsc(lastLabel(n))}</div>
      </div>`;
        })
        .join('')
    : `<p style="color:var(--ink-3);font-size:12px;padding:8px 0;line-height:1.7;max-width:560px;">${tt('还没有定时任务。选一枚 Skill、定个时间 —— 到点 Agent 自动跑它(仅 Seeker 开着时)。', 'No scheduled tasks yet. Pick a skill and a time — the Agent runs it on schedule (while Seeker is open).')}</p>`;
  box.innerHTML =
    `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-accent" id="scAdd" style="padding:4px 12px;font-size:11.5px;">${tt('+ 新建定时任务', '+ New scheduled task')}</button></div>` +
    list +
    `<p style="font-size:11px;color:var(--ink-3);margin:10px 0 0;line-height:1.7;">${tt('仅 Seeker 开着时触发(到点后一分钟内);错过的排点不补跑。运行结果出现在 Agent 对话里;若涉及删除等操作,Agent 只会提议、等你回来确认。', 'Fires only while Seeker is open (within a minute of the scheduled time); missed runs are skipped, not replayed. Output appears in the Agent conversation; anything destructive is only proposed — it waits for your confirmation.')}</p>`;
  const add = $('#scAdd', box);
  if (add) /** @type {HTMLElement} */ (add).onclick = () => openScheduleModal(box, '');
  $$('[data-sctoggle]', box).forEach((b) => {
    /** @type {HTMLInputElement} */ (b).onchange = async () => {
      const el = /** @type {HTMLInputElement} */ (b);
      const n = rows.find((x) => x.id === el.dataset.sctoggle);
      if (!n) return;
      try {
        await saveSchedule({ ...n, enabled: el.checked, updated_at: Date.now() });
      } catch (e) {
        toast(errText(e));
      }
      await renderSchedules(box);
    };
  });
  $$('[data-scedit]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => openScheduleModal(box, /** @type {HTMLElement} */ (b).dataset.scedit || '');
  });
  $$('[data-scdel]', box).forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = async () => {
      const n = rows.find((x) => x.id === /** @type {HTMLElement} */ (b).dataset.scdel);
      if (!n) return;
      let snap;
      try {
        snap = await removeSchedule(n.id);
      } catch (e) {
        toast(errText(e));
        return;
      }
      await renderSchedules(box);
      toastUndo(tt('已删除定时任务', 'Scheduled task deleted'), async () => {
        try {
          if (snap) await saveSchedule(snap);
        } catch (e) {
          toast(errText(e));
          return;
        }
        await renderSchedules(box);
      });
    };
  });
}

/** 新建·编辑模态(空 id = 新建)。Skill 选择器只列**可运行且已审阅**(红线,fire 侧守卫仍兜底)。
 *  @param {HTMLElement} box @param {string} id */
function openScheduleModal(box, id) {
  const n = normSchedule(id ? listSchedules().find((x) => x.id === id) : { enabled: true, time: '09:00' });
  const pickable = listSkills()
    .map((s) => normSkill(s))
    .filter((s) => skillRunnable(s) && !skillNeedsReview(s));
  if (!pickable.length) {
    toast(tt('先在上方 Skills 里建一枚可运行的 Skill', 'Create a runnable skill first (Skills section above)'));
    return;
  }
  openModal(
    `<div class="modal-head"><div><p class="eyebrow">— SCHEDULED</p><h2 style="margin-top:5px;">${
      id ? tt('编辑定时任务', 'Edit scheduled task') : tt('新建定时任务', 'New scheduled task')
    }<span class="dot">.</span></h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="set-row"><span class="sk">Skill</span><select class="input" id="scSkill">${pickable
        .map((s) => `<option value="${cEsc(s.id)}"${s.id === n.skillId ? ' selected' : ''}>${cEsc(s.name) || tt('(未命名)', '(untitled)')}</option>`)
        .join('')}</select></div>
      <div class="set-row" style="margin-top:10px;"><span class="sk">${tt('频率', 'Repeat')}</span><select class="input" id="scKind">
        <option value="daily"${n.kind === 'daily' ? ' selected' : ''}>${tt('每天', 'Daily')}</option>
        <option value="weekly"${n.kind === 'weekly' ? ' selected' : ''}>${tt('每周', 'Weekly')}</option>
      </select></div>
      <div class="set-row" style="margin-top:10px;display:${n.kind === 'weekly' ? 'flex' : 'none'};" id="scDowRow"><span class="sk">${tt('星期', 'Day')}</span><select class="input" id="scDow">${DOW()
        .map((d, i) => `<option value="${i}"${i === n.dow ? ' selected' : ''}>${d}</option>`)
        .join('')}</select></div>
      <div class="set-row" style="margin-top:10px;"><span class="sk">${tt('时间', 'Time')}</span><input class="input" id="scTime" value="${cEsc(n.time)}" placeholder="09:00"></div>
      <p style="font-size:11px;color:var(--ink-3);margin:12px 0 0;line-height:1.7;">${tt('仅 Seeker 开着时触发;错过不补跑。新建的任务从下一个排点开始(不会立刻跑)。', 'Fires only while Seeker is open; missed runs are skipped. A new task starts from its next scheduled time (it will not fire immediately).')}</p>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" id="scSave">${tt('保存', 'Save')}</button></div>`,
    true
  );
  const kindSel = /** @type {HTMLSelectElement|null} */ ($('#scKind'));
  if (kindSel)
    kindSel.onchange = () => {
      const row = $('#scDowRow');
      if (row) /** @type {HTMLElement} */ (row).style.display = kindSel.value === 'weekly' ? 'flex' : 'none';
    };
  const save = $('#scSave');
  if (save)
    /** @type {HTMLElement} */ (save).onclick = async () => {
      const skillId = (/** @type {HTMLSelectElement|null} */ ($('#scSkill')) || { value: '' }).value;
      const kind = (/** @type {HTMLSelectElement|null} */ ($('#scKind')) || { value: 'daily' }).value;
      const dow = Number((/** @type {HTMLSelectElement|null} */ ($('#scDow')) || { value: '0' }).value);
      const time = (/** @type {HTMLInputElement|null} */ ($('#scTime')) || { value: '' }).value.trim();
      if (!/^(\d{1,2}):(\d{2})$/.test(time)) {
        toast(tt('时间格式 HH:MM,如 09:00', 'Time must be HH:MM, e.g. 09:00'));
        return;
      }
      // 编辑保留 created_at/last_run(水位不重置);新建 created_at=now ⇒ 从下一个排点开始(schedule-model 水位语义)。
      const rec = { id: id || newId(), skillId, kind, time, dow, enabled: n.enabled, created_at: id ? n.created_at : Date.now(), last_run_at: n.last_run_at, last_status: n.last_status, updated_at: Date.now() };
      try {
        await saveSchedule(rec);
      } catch (e) {
        toast(errText(e));
        return;
      }
      closeModal();
      await renderSchedules(box);
      toast(tt('已保存', 'Saved'));
    };
}
