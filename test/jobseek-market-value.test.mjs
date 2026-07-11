// jobseek_market_value app-tool 迁移(T3)的入库单测:真模块导出,零漂移。
// 覆盖:① compute 公式与旧 Rust 打样等价 ② 输出合 output schema(projectToSchema 不剥) ③ compute 自包含
// ④ ★D3「上架」双向阳性对照(用真 MARKET_VALUE_READS:skills 可读⇒上架 / 不可读⇒不上架)。
// 「调用硬拒」半在 run.test.mjs(D3-reject⇒fail-closed);浏览器隔离性 + render 双语走 preview。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMarketValue,
  MARKET_VALUE_OUTPUT,
  MARKET_VALUE_READS,
  MARKET_VALUE_NAME,
} from '../web/apps/jobseek/tools/market-value-compute.js';
import { projectToSchema } from '../web/platform/capability/app-tools/validate.js';
import { filterReadableTools } from '../web/platform/capability/app-tools/readable.js';

test('compute 公式与旧 Rust 打样逐字等价(base 20 + Σ lvl×1.6,×0.88/×1.16)', () => {
  // Go L4 + Rust L5:sum=6.4+8=14.4;mid=34.4;low=round(30.272)=30;high=round(39.904)=40
  const r = computeMarketValue({}, { skills: [{ name: 'Go', lvl: 4 }, { name: 'Rust', lvl: 5 }] });
  assert.equal(r.low, 30);
  assert.equal(r.high, 40);
  assert.equal(r.n, 2);
  assert.deepEqual(r.top, [{ name: 'Rust', lvl: 5 }, { name: 'Go', lvl: 4 }], 'top 按等级降序');
});

test('compute 空技能 ⇒ 仅基线(mid=20;low=18,high=23,n=0)', () => {
  const r = computeMarketValue({}, { skills: [] });
  assert.deepEqual(r, { low: 18, high: 23, n: 0, top: [] });
  // rows 缺 skills 也不崩(fail-safe)
  assert.deepEqual(computeMarketValue({}, {}), { low: 18, high: 23, n: 0, top: [] });
});

test('compute lvl 钳制(缺省 1 / 越界钳 1-5 / 取整)+ 无名技能剔除', () => {
  const r = computeMarketValue({}, { skills: [
    { name: 'A' },              // 缺 lvl ⇒ 1
    { name: 'B', lvl: 9 },      // ⇒ 5
    { name: 'C', lvl: 0 },      // ⇒ 1
    { name: 'D', lvl: 3.9 },    // ⇒ 3(floor)
    { name: '', lvl: 5 },       // 无名 ⇒ 剔除
    { lvl: 4 },                 // 无名 ⇒ 剔除
  ] });
  assert.equal(r.n, 4, '两条无名被剔除');
  assert.deepEqual(r.top.map((k) => k.lvl), [5, 3, 1, 1], '钳制后等级');
});

test('compute top5 封顶 + 同级按名升序', () => {
  const skills = [];
  for (let i = 0; i < 7; i++) skills.push({ name: 'S' + i, lvl: 3 });
  const r = computeMarketValue({}, { skills });
  assert.equal(r.top.length, 5, 'top 最多 5');
  assert.deepEqual(r.top.map((k) => k.name), ['S0', 'S1', 'S2', 'S3', 'S4'], '同级按名升序');
});

test('输出合 output schema,projectToSchema 不剥任何字段(输出=声明)', () => {
  const out = computeMarketValue({}, { skills: [{ name: 'Go', lvl: 4 }] });
  const p = projectToSchema(out, MARKET_VALUE_OUTPUT);
  assert.equal(p.ok, true, '合 schema');
  assert.deepEqual(p.value, out, '声明字段齐全,投影后一字不少不多');
});

test('★compute 自包含(注入沙箱可跑)—— eval 隔离作用域仍工作', () => {
  // 平台以 String(compute) 注入三墙沙箱;若闭包引用了模块符号,这里 eval 就会 ReferenceError。
  const fn = new Function('return (' + String(computeMarketValue) + ')')();
  const r = fn({}, { skills: [{ name: 'X', lvl: 2 }] });
  assert.equal(r.n, 1);
  assert.equal(r.top[0].name, 'X');
});

test('★D3「上架」双向阳性对照(真 reads=[skills])', () => {
  const tool = { name: MARKET_VALUE_NAME, description: 'd', parameters: {}, reads: MARKET_VALUE_READS };
  // skills 可读 ⇒ 上架
  const up = filterReadableTools([tool], ['skills', 'jobs']);
  assert.equal(up.length, 1);
  assert.equal(up[0].name, MARKET_VALUE_NAME);
  assert.equal('compute' in up[0], false, '描述符只元数据,不带 compute');
  assert.equal('reads' in up[0], false, '不带 reads 给模型');
  // skills 不可读(应用关/未授权)⇒ 不上架
  assert.deepEqual(filterReadableTools([tool], ['jobs']), [], '★skills 不可读 ⇒ 不上架');
  assert.deepEqual(filterReadableTools([tool], []), [], '空可读集 ⇒ 不上架');
});
