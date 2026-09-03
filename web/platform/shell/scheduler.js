// @ts-check
/** 平台 · 调度器 —— 壳级分钟 tick，到点重放用户预先确认的 Skill 或机会雷达任务。
 *
 *  ★红线继承:Skill 经 runSkill 重放，继续继承 D3 / profile 不可达 / guardrail / F1 scoping /
 *   I1 needsReview；机会雷达只接受固定 workflow id，再由 Rust Agent 核重新验证 TaskSpec、来源、
 *   活动 run 与预算。本模块只选择到期目标、先推进水位，再调用对应的受控入口。
 *  ★AI 不能给自己排任务(第95轮 [建议]-强):本模块**只读**调度(fire 写回 last_run 经管理面同一 store);
 *   永不注册可写 platform_schedules 的 capability/app-tool(详见 schedule-model.js 头注)。
 *  ★诚实边界:仅 Seeker 开着时触发(setInterval;无 OS 级调度);分钟级精度。
 */
import { aiStreamBusy } from './ai-engine.js';
import { runSkill } from './copilot-chrome.js';
import { agentRunBlocksSchedule, occurrencesSinceWatermark, radarTaskSchedulable, scheduleDue } from './schedule-model.js';
import { listSchedules, saveSchedule } from './schedule-store.js';
import { normSkill, skillRunnable, skillNeedsReview } from './skill-model.js';
import { listSkills } from './skill-store.js';
import { rt } from '../runtime/index.js';

/** SC2 结局回写:流 settle 后按 id **重读**记录、只更状态字段(fire 与 settle 之间用户可能编辑/删除 ——
 *  重读防 clobber 编辑、已删则跳过;spread 旧闭包快照会把编辑顶掉)。errMsg 截 200 字防日志式膨胀。
 *  @param {string} id @param {boolean} ok @param {string=} errMsg */
function settleRun(id, ok, errMsg) {
  const cur = listSchedules().find((x) => x.id === id);
  if (!cur) return; // fire 后被删 → 结局无处落,跳过(记录已不存在,不是静默吞失败)
  saveSchedule({ ...cur, last_status: ok ? 'ok' : 'error', last_error: ok ? '' : String(errMsg || '').slice(0, 200) }).catch(() => {});
}

/**
 * 一次 tick(可测导出;setInterval 每分钟调它)。
 * - **每 tick 至多 fire 一枚**:避免两条流撞同一对话或同时争用模型；
 *   未 fire 的那枚 last_run_at 未更新 ⇒ 下一 tick 仍 due、天然轮到,无饥饿。
 * - **忙则跳过本 tick**(预裁③):流在飞不 fire、下分钟重查;不排队、不堆积。
 * - **水位恒推进 + 状态如实**:悬空 skillId → 'skill-missing';草稿/待审 → 'skill-blocked'
 *   (runSkill 会 no-op,如实记不静默)。**不推进水位会让坏调度每分钟重试 + 因「每 tick 一枚」饿死其他调度** ⇒
 *   一律推进 last_run_at、用 last_status 说真话。雷达目标缺失/不合法/已有活动 run 也分别如实记录。
 * - **状态语义(SC2)**:'started' = 已发起(流式结局异步;settle 后 settleRun 改 'ok'/'error'+last_error ——
 *   「已发起」不再掩盖 mid-stream 失败;app 中途退出 / web mock 分支不回 settle 则停 'started' = 诚实「结局未知」)。
 * @param {number} now 毫秒 epoch
 * @returns {Promise<{fired:string|null, status?:string, reason?:string, missed?:number}>} 测试断言用
 */
export async function schedulerTick(now) {
  if (aiStreamBusy()) return { fired: null, reason: 'busy' };
  const due = listSchedules().filter((s) => scheduleDue(s, now));
  if (!due.length) return { fired: null, reason: 'none' };
  const sched = due[0]; // 每 tick 至多一枚;其余下 tick 天然轮到
  // ★SC2 错过计数(第96轮 forward-note②):水位后排点数 - 1(本次跑的是最新一个,其余=永久错过、不补跑)。
  const missed = Math.max(0, occurrencesSinceWatermark(sched, now) - 1);
  const skill = sched.agentTaskId ? null : listSkills().find((x) => x.id === sched.skillId);
  /** @type {string} */ let status;
  let statusError = '';
  /** @type {ReturnType<typeof normSkill>|null} */ let run = null;
  let agentReady = false;
  if (sched.agentTaskId) {
    try {
      const [task, runs] = await Promise.all([
        rt.agent.getTask(sched.agentTaskId),
        rt.agent.listRuns(sched.agentTaskId),
      ]);
      if (!task) status = 'agent-task-missing';
      else if (!radarTaskSchedulable(task, sched.agentTaskId)) status = 'agent-task-blocked';
      else if (runs.some(agentRunBlocksSchedule)) status = 'agent-active';
      else { status = 'agent-started'; agentReady = true; }
    } catch (error) {
      status = 'error';
      statusError = String((/** @type {any} */ (error))?.message || error).slice(0, 200);
    }
  } else if (!skill) {
    status = 'skill-missing'; // 悬空:Skill 已删 → no-op + 如实记(不静默;UI 据此显示)
  } else {
    const s = normSkill(skill);
    if (!skillRunnable(s) || skillNeedsReview(s)) {
      status = 'skill-blocked'; // 草稿 / 导入待审([建议]2 编辑重审同落此):runSkill 会 no-op,如实记
    } else {
      // ★SC2 真实结局(第96轮 forward-note①):'started'=已发起(app 中途退出停在此=诚实「结局未知」;
      //   web 无桌面 rt 的 mock 分支不回 settle,同样停 'started');settle 后改 'ok'/'error'+last_error。
      status = 'started';
      run = s;
    }
  }
  // ★水位先落、await 到缓存已新,**再**起跑 —— settle 可能同步到来(测试 spy/极速失败),
  //   若跑在写回前,settleRun 会基于旧缓存记录写回 ⇒ **丢水位 ⇒ 重跑循环**。落不下就不跑(fail-closed,防同一循环)。
  try {
    await saveSchedule({ ...sched, last_run_at: now, last_status: status, last_missed: missed, last_error: statusError });
  } catch (_e) {
    return { fired: sched.id, status: 'error', missed };
  }
  if (run) {
    try {
      // 定时 fire 用独立 historyKey('sched:<id>')= clean-slate 保持无人值守今日行为
      //   (不携带项目对话上下文 ⇒ token 成本不涨、输出不受无关近期对话影响;「带上下文的定时任务」后续 opt-in 另出)。
      runSkill(run, (/** @type {boolean} */ ok, /** @type {string=} */ errMsg) => settleRun(sched.id, ok, errMsg), 'sched:' + sched.id); // ★标准路径(红线全继承);内部守卫仍兜底(双点)
    } catch (_e) {
      settleRun(sched.id, false, 'fire failed');
    }
  }
  if (agentReady) {
    try {
      // 后端 prepare_new_run 仍会原子检查活动 run，关闭这里查询与启动之间的竞态窗口。
      await rt.agent.start(sched.agentTaskId);
    } catch (error) {
      settleRun(sched.id, false, String((/** @type {any} */ (error))?.message || error));
      return { fired: sched.id, status: 'error', missed };
    }
  }
  return { fired: sched.id, status, missed };
}

/** @type {ReturnType<typeof setInterval>|null} */
let _timer = null;

/** 启动调度器(壳 boot 调;幂等)。60s tick = 分钟级精度(方案 §6 诚实边界)。 */
export function startScheduler() {
  if (_timer != null) return;
  _timer = setInterval(() => { schedulerTick(Date.now()).catch(() => {}); }, 60_000);
}
