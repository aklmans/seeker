// 平台 Scheduled tasks · normSchedule fail-safe + scheduleDue 边界入库单测(proposal-scheduled-tasks SC1)。
// ★承重:scheduleDue 决定无人值守 fire —— 错误的 true = 误跑烧 BYO 配额;错误的 false = 静默漏跑。
//   本地时区构造时间戳(prevOccurrence 用本地 getters ⇒ 测试同用 Date(y,m,d,hh,mm) 构造,确定性)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normSchedule, scheduleDue, prevOccurrence } from '../web/platform/shell/schedule-model.js';

// 固定基准:2026-07-15(周三)。本地时区构造。
const at = (d, hh, mm) => new Date(2026, 6, d, hh, mm, 0, 0).getTime(); // 月份 6 = 7 月
const WED = 15; // 2026-07-15 是周三(dow=3)

test('normSchedule:fail-safe(畸形绝不抛)+ enabled 须显式 true(无人值守存疑不跑)', () => {
  for (const bad of [null, undefined, 'str', 42, [], NaN]) {
    const n = normSchedule(bad);
    assert.equal(n.enabled, false, `坏输入 ${String(bad)} → 不启用`);
    assert.equal(n.kind, 'daily');
    assert.equal(typeof n.time, 'string');
  }
  assert.equal(normSchedule({ enabled: 'yes' }).enabled, false, '★truthy 垃圾 ≠ 启用(宁漏跑不误跑)');
  assert.equal(normSchedule({ enabled: 1 }).enabled, false);
  assert.equal(normSchedule({ enabled: true }).enabled, true, '显式 true = 启用');
  assert.equal(normSchedule({ kind: 'weekly', dow: 9 }).dow, 0, 'dow 越界 → 0');
  assert.equal(normSchedule({ kind: 'monthly' }).kind, 'daily', '未知 kind → daily');
});

test('prevOccurrence:daily 今天已过取今天、未到取昨天;无效 time → null', () => {
  const n = normSchedule({ kind: 'daily', time: '09:00', enabled: true });
  assert.equal(prevOccurrence(n, at(WED, 14, 0)), at(WED, 9, 0), '14:00 → 今天 09:00');
  assert.equal(prevOccurrence(n, at(WED, 8, 59)), at(WED - 1, 9, 0), '08:59 → 昨天 09:00');
  assert.equal(prevOccurrence(n, at(WED, 9, 0)), at(WED, 9, 0), '恰好 09:00 → 今天(≤now 含等)');
  for (const badTime of ['', '9am', '25:00', '09:60', '9:0', null]) {
    assert.equal(prevOccurrence(normSchedule({ time: badTime }), at(WED, 14, 0)), null, `无效 time ${badTime} → null(永不 due)`);
  }
});

test('prevOccurrence:weekly 本周已过取本周、未到取上周(跨周界)', () => {
  const n = normSchedule({ kind: 'weekly', time: '09:00', dow: 3, enabled: true }); // 周三 09:00
  assert.equal(prevOccurrence(n, at(WED, 14, 0)), at(WED, 9, 0), '周三 14:00 → 本周三 09:00');
  assert.equal(prevOccurrence(n, at(WED, 8, 0)), at(WED - 7, 9, 0), '周三 08:00 → 上周三 09:00');
  assert.equal(prevOccurrence(n, at(WED + 2, 10, 0)), at(WED, 9, 0), '周五 → 本周三 09:00');
  const mon = normSchedule({ kind: 'weekly', time: '20:00', dow: 1, enabled: true }); // 周一 20:00
  assert.equal(prevOccurrence(mon, at(WED, 10, 0)), at(WED - 2, 20, 0), '周三看周一排点 → 本周一 20:00');
});

test('★scheduleDue:核心水位语义 —— 最近排点已过且未为它跑过', () => {
  const base = { kind: 'daily', time: '09:00', enabled: true, created_at: at(WED - 10, 0, 0) };
  assert.equal(scheduleDue({ ...base, last_run_at: at(WED - 1, 9, 0) }, at(WED, 14, 0)), true, '昨天跑过、今天排点已过 → due');
  assert.equal(scheduleDue({ ...base, last_run_at: at(WED, 9, 0) }, at(WED, 14, 0)), false, '今天已跑 → 不再 due');
  assert.equal(scheduleDue({ ...base, last_run_at: at(WED - 1, 9, 0) }, at(WED, 8, 0)), false, '今天排点未到 → 不 due');
});

test('★scheduleDue:错过多个排点只 due 一次(fire 后水位越过全部积压 = 不补跑防开机风暴)', () => {
  const s = { kind: 'daily', time: '09:00', enabled: true, created_at: at(1, 0, 0), last_run_at: at(WED - 5, 9, 0) };
  assert.equal(scheduleDue(s, at(WED, 14, 0)), true, '错过 4 天 → due(一次)');
  // 模拟 fire:last_run_at = now → 全部积压被越过
  assert.equal(scheduleDue({ ...s, last_run_at: at(WED, 14, 0) }, at(WED, 14, 1)), false, 'fire 后 → 积压全越过、不补跑');
});

test('★scheduleDue:新建不立即开火(水位含 created_at)', () => {
  // 周三 14:00 新建「每天 09:00」:今天 09:00 已过但早于创建 → 不 due;明天 09:01 → due
  const s = { kind: 'daily', time: '09:00', enabled: true, created_at: at(WED, 14, 0), last_run_at: 0 };
  assert.equal(scheduleDue(s, at(WED, 14, 1)), false, '★创建后立刻 tick → 不开火(今天排点早于创建)');
  assert.equal(scheduleDue(s, at(WED, 23, 59)), false, '当天始终不开火');
  assert.equal(scheduleDue(s, at(WED + 1, 9, 1)), true, '次日排点过 → due');
});

test('scheduleDue:禁用 / 无效 time / 畸形 → 永不 due(fail-safe 不误跑)', () => {
  const runnable = { kind: 'daily', time: '09:00', created_at: 1, last_run_at: 1 };
  assert.equal(scheduleDue({ ...runnable, enabled: false }, at(WED, 14, 0)), false, '禁用不 due');
  assert.equal(scheduleDue({ ...runnable, enabled: 'yes' }, at(WED, 14, 0)), false, 'truthy 垃圾 enabled 不 due');
  assert.equal(scheduleDue({ kind: 'daily', time: '25:00', enabled: true, created_at: 1 }, at(WED, 14, 0)), false, '无效 time 不 due');
  assert.equal(scheduleDue(null, at(WED, 14, 0)), false, '畸形记录不 due 不抛');
});

test('★源守卫:schedule-model.js 零 import + 含「永不注册写调度工具」红线注释(结构性缺席的有形锚)', () => {
  const src = fs.readFileSync(new URL('../web/platform/shell/schedule-model.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bimport\s/.test(code), '零 import(node 可测)');
  assert.ok(src.includes('永不注册任何可写 `platform_schedules` 的'), '★[建议]-强契约注释在场(缺席钉成有形物;删注释=本断言红)');
  assert.ok(src.includes('自我持续执行'), '红线理由在场');
});
