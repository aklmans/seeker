// @ts-check
/**
 * 平台 Scheduled tasks 数据模型 —— fail-safe 归一化 + due 判定纯函数(proposal-scheduled-tasks SC1)。
 * **零 import**(node 可测、真模块导出)。
 *
 * ★★红线(第95轮 [建议]-强 · 结构性缺席钉死):**永不注册任何可写 `platform_schedules` 的
 *   capability / app-tool** —— Agent 能给自己排任务 = 自我持续执行通路(排任务→任务再排任务 =
 *   自激励循环,叠加 BYO 成本)。本红线今天的形态是「不存在这样的工具」= 结构性缺席;
 *   缺席会静默磨损 —— **加此类工具即拆除本红线**。有形锚:capability.rs 守卫测试
 *   (`!is_queryable("platform_schedules")` + 工具枚举不含)+ 本注释 + types.d.ts Schedule 注释。
 *   调度 CRUD 只在能力中心管理面(§4-2「不可经对话改」延伸);Agent 只能引导用户去管理面。
 *
 * ★无人值守语义:到点 fire = 把该 Skill 当作用户在那一刻点了「运行」(经 runSkill,红线全继承);
 *   破坏性依旧只能提议等用户确认(结构性 fail-closed,无预授权)。
 */

/**
 * @typedef {{id:string, skillId:string, kind:('daily'|'weekly'), time:string, dow:number,
 *   enabled:boolean, created_at:number, last_run_at:number, last_status:string}} NormSchedule
 */

/**
 * 防御性归一:任意存储记录 → 良构调度。**fail-safe:非对象/畸形绝不抛。**
 * ★`enabled` 须**显式 === true**(垃圾值 → false = 不跑):无人值守执行,存疑往「不跑」侧靠
 *   (宁可漏跑一次让用户发现,不可误跑烧 BYO 配额)。
 * @param {unknown} rec
 * @returns {NormSchedule}
 */
export function normSchedule(rec) {
  const r = /** @type {any} */ (rec && typeof rec === 'object' ? rec : {});
  const num = (/** @type {any} */ v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
  return {
    id: String(r.id == null ? '' : r.id),
    skillId: String(r.skillId == null ? '' : r.skillId),
    kind: r.kind === 'weekly' ? 'weekly' : 'daily',
    time: typeof r.time === 'string' ? r.time : '',
    dow: Number.isInteger(r.dow) && r.dow >= 0 && r.dow <= 6 ? r.dow : 0,
    enabled: r.enabled === true,
    created_at: num(r.created_at),
    last_run_at: num(r.last_run_at),
    last_status: typeof r.last_status === 'string' ? r.last_status : '',
  };
}

/**
 * 解析 'HH:MM' → {hh,mm};无效 → null(⇒ 该调度永不 due,fail-safe 不误跑)。
 * @param {string} time @returns {{hh:number, mm:number}|null}
 */
function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

/**
 * 最近一次排点(≤ now,本地时区)。daily = 今天 HH:MM(未到则昨天);weekly = 本周 dow 的 HH:MM(未到则上周)。
 * 无效 time → null。
 * @param {NormSchedule} n @param {number} now 毫秒 epoch
 * @returns {number|null}
 */
export function prevOccurrence(n, now) {
  const t = parseTime(n.time);
  if (!t) return null;
  const d = new Date(now);
  const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.hh, t.mm, 0, 0);
  if (n.kind === 'daily') {
    if (cand.getTime() > now) cand.setDate(cand.getDate() - 1);
    return cand.getTime();
  }
  // weekly:退到目标 dow,再未到则退一周
  const delta = (cand.getDay() - n.dow + 7) % 7;
  cand.setDate(cand.getDate() - delta);
  if (cand.getTime() > now) cand.setDate(cand.getDate() - 7);
  return cand.getTime();
}

/**
 * due 判定:**最近排点已过、且尚未为它跑过**。
 * `due = enabled && prev(now) > max(last_run_at, created_at)`。
 * - **错过多个排点只 due 一次**(prev 只取最近一个;fire 后 last_run_at=now 越过全部积压)——错过不补跑、防开机风暴。
 * - **新建不立即开火**:水位含 `created_at` ⇒ 创建时刻晚于今天排点则等**下一个**排点(不把「今早 9 点」算成欠账)。
 * - 禁用 / 无效 time / 畸形记录 → 永不 due(fail-safe:存疑不跑)。
 * @param {unknown} sched 存储记录(内部归一)
 * @param {number} now 毫秒 epoch
 * @returns {boolean}
 */
export function scheduleDue(sched, now) {
  const n = normSchedule(sched);
  if (!n.enabled) return false;
  const prev = prevOccurrence(n, now);
  if (prev == null) return false;
  return prev > Math.max(n.last_run_at, n.created_at);
}
