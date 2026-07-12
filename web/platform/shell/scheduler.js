// @ts-check
/** 平台 · 调度器(proposal-scheduled-tasks SC1)—— 壳级分钟 tick,到点把 Skill 经 **runSkill** 重放。
 *
 *  ★红线继承(方案 §2 · 第95轮评审走查):fire = runSkill = agentSend 用户打字路径 ⇒
 *   D3 / profile 不可达 / guardrail(破坏性只能提议等用户点)/ 设置不可经对话改 / F1 scoping /
 *   I1 needsReview 双点拒 **全部结构性继承** —— 本模块不实现任何安全逻辑,只做「到点重放」。
 *  ★AI 不能给自己排任务(第95轮 [建议]-强):本模块**只读**调度(fire 写回 last_run 经管理面同一 store);
 *   永不注册可写 platform_schedules 的 capability/app-tool(详见 schedule-model.js 头注)。
 *  ★诚实边界:仅 Seeker 开着时触发(setInterval;无 OS 级调度);分钟级精度。
 */
import { aiStreamBusy } from './ai-engine.js';
import { runSkill } from './copilot-chrome.js';
import { scheduleDue } from './schedule-model.js';
import { listSchedules, saveSchedule } from './schedule-store.js';
import { normSkill, skillRunnable, skillNeedsReview } from './skill-model.js';
import { listSkills } from './skill-store.js';

/**
 * 一次 tick(可测导出;setInterval 每分钟调它)。
 * - **每 tick 至多 fire 一枚**(第95轮盯点③):两枚同时 fire = 两条流撞同一对话(忙信号要防的碰撞的自制版);
 *   未 fire 的那枚 last_run_at 未更新 ⇒ 下一 tick 仍 due、天然轮到,无饥饿。
 * - **忙则跳过本 tick**(预裁③):流在飞不 fire、下分钟重查;不排队、不堆积。
 * - **水位恒推进 + 状态如实**(第95轮盯点④):悬空 skillId → 'skill-missing';草稿/待审 → 'skill-blocked'
 *   (runSkill 会 no-op,如实记不静默)。**不推进水位会让坏调度每分钟重试 + 因「每 tick 一枚」饿死其他调度** ⇒
 *   一律推进 last_run_at、用 last_status 说真话。
 * - 'ok' = **已发起运行**(结果在对话里),非「模型成功」—— 流式结果异步、不在本函数可知范围。
 * @param {number} now 毫秒 epoch
 * @returns {{fired:string|null, status?:string, reason?:string}} 测试断言用
 */
export function schedulerTick(now) {
  if (aiStreamBusy()) return { fired: null, reason: 'busy' };
  const due = listSchedules().filter((s) => scheduleDue(s, now));
  if (!due.length) return { fired: null, reason: 'none' };
  const sched = due[0]; // 每 tick 至多一枚;其余下 tick 天然轮到
  const skill = listSkills().find((x) => x.id === sched.skillId);
  let status;
  if (!skill) {
    status = 'skill-missing'; // 悬空:Skill 已删 → no-op + 如实记(不静默;UI 据此显示)
  } else {
    const s = normSkill(skill);
    if (!skillRunnable(s) || skillNeedsReview(s)) {
      status = 'skill-blocked'; // 草稿 / 导入待审([建议]2 编辑重审同落此):runSkill 会 no-op,如实记
    } else {
      try {
        runSkill(s); // ★标准路径(红线全继承);内部守卫仍兜底(双点)
        status = 'ok';
      } catch (_e) {
        status = 'error';
      }
    }
  }
  // 写回:水位推进(错过/坏调度不重试、不饿死他人)+ 状态如实。fire-and-forget(失败仅缓存内可见,下次水合对齐)。
  saveSchedule({ ...sched, last_run_at: now, last_status: status }).catch(() => {});
  return { fired: sched.id, status };
}

/** @type {ReturnType<typeof setInterval>|null} */
let _timer = null;

/** 启动调度器(壳 boot 调;幂等)。60s tick = 分钟级精度(方案 §6 诚实边界)。 */
export function startScheduler() {
  if (_timer != null) return;
  _timer = setInterval(() => schedulerTick(Date.now()), 60_000);
}
