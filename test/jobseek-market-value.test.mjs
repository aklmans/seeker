// jobseek_market_value app-tool 入库单测:真模块导出,零漂移。
// ★收敛后(评审 [应改]):compute = 目标岗位真实薪资(pay)× 内联匹配分加权(退役 base20+Σ 求和公式=对全量技能算 174万荒谬);
//   ★UI(intake-action.marketValue)与 app-tool 共用本自包含函数 ⇒ 结构上不发散。
// 覆盖:① job-pay×匹配 公式 ② div-zero guard(0.1 下限)③ pay 解析 + 不可解析岗位跳过 ④ gaps 聚合
//   ⑤ 输出合 schema ⑥ compute 自包含(注入沙箱)⑦ 零 import 源守卫 ⑧ ★两集合 reads=[jobs,skills] 的 D3 上架双向阳性对照。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  computeMarketValue,
  MARKET_VALUE_OUTPUT,
  MARKET_VALUE_READS,
  MARKET_VALUE_NAME,
} from '../web/apps/jobseek/tools/market-value-compute.js';
import { projectToSchema } from '../web/platform/capability/app-tools/validate.js';
import { filterReadableTools } from '../web/platform/capability/app-tools/readable.js';

const SK = [{ name: 'Go', lvl: 4 }]; // Go 满(lvl≥3);Rust 缺

test('job-pay × 匹配加权公式(手算等价)', () => {
  // job1 pay40-60 need[Go]:matchScore=10(Go 满)⇒ w=10;job2 pay30-50 need[Rust]:matchScore=0 ⇒ w=0.1(下限)
  // W=10.1;low=round((40*10+30*0.1)/10.1)=round(39.9)=40;high=round((60*10+50*0.1)/10.1)=round(59.9)=60;mid=50
  const r = computeMarketValue({}, { jobs: [
    { pay: '40-60万', need: ['Go'] },
    { pay: '30-50万', need: ['Rust'] },
  ], skills: SK });
  assert.equal(r.low, 40);
  assert.equal(r.high, 60);
  assert.equal(r.mid, 50);
  assert.equal(r.jobs, 2);
  assert.deepEqual(r.gaps, ['Rust'], 'gaps = need 里 lvl<3 的(Rust 缺;Go 满不入)');
});

test('空 jobs ⇒ fail-safe {0,0,0,0,[]}(不崩)', () => {
  assert.deepEqual(computeMarketValue({}, { jobs: [], skills: SK }), { low: 0, high: 0, mid: 0, jobs: 0, gaps: [] });
  assert.deepEqual(computeMarketValue({}, {}), { low: 0, high: 0, mid: 0, jobs: 0, gaps: [] }, 'rows 全缺也不崩');
});

test('★div-zero guard:全 0 匹配的岗位仍得 0.1 权重 ⇒ 不 NaN/不除零', () => {
  // 两岗位 need 全缺 ⇒ matchScore=0 ⇒ w=0.1 each;W=0.2>0 ⇒ 正常加权(非 NaN)
  const r = computeMarketValue({}, { jobs: [
    { pay: '40-60万', need: ['X'] },
    { pay: '50-70万', need: ['Y'] },
  ], skills: [] });
  assert.ok(Number.isFinite(r.low) && Number.isFinite(r.high), '不 NaN/Infinity');
  assert.equal(r.low, 45); // (40*0.1+50*0.1)/0.2 = 45
  assert.equal(r.high, 65); // (60*0.1+70*0.1)/0.2 = 65
});

test('pay 解析:不可解析(面议/空)的岗位跳过估算,但 gaps 仍聚合', () => {
  const r = computeMarketValue({}, { jobs: [
    { pay: '面议', need: ['Rust'] },        // 不可解析 ⇒ 不入估算
    { pay: '', need: ['K8s'] },             // 空 ⇒ 不入估算
    { pay: '40-60万', need: ['Go'] },       // 可解析
  ], skills: SK });
  assert.equal(r.jobs, 1, '只 1 个可解析岗位入估算');
  assert.equal(r.low, 40); assert.equal(r.high, 60);
  assert.deepEqual(r.gaps.sort(), ['K8s', 'Rust'], 'gaps 跨全部岗位聚合(含不可解析薪资的)');
});

test('gaps 聚合:跨岗位按频次降序取前 3', () => {
  const jobs = [
    { pay: '40-60万', need: ['A', 'B'] },
    { pay: '40-60万', need: ['A', 'C'] },
    { pay: '40-60万', need: ['A', 'B', 'D'] },
  ];
  const r = computeMarketValue({}, { jobs, skills: [] }); // 全缺 ⇒ 都是 gap
  assert.equal(r.gaps.length, 3, '取前 3');
  assert.equal(r.gaps[0], 'A', 'A 出现 3 次频次最高');
  assert.deepEqual(r.gaps, ['A', 'B', 'C'], 'A(3)>B(2)>C(1)=D(1) 同频按名升序取 C');
});

test('输出合 output schema,projectToSchema 声明字段齐全、投影后一字不少不多(low/high/mid/jobs/gaps)', () => {
  const out = computeMarketValue({}, { jobs: [{ pay: '40-60万', need: ['Go'] }], skills: SK });
  const p = projectToSchema(out, MARKET_VALUE_OUTPUT);
  assert.equal(p.ok, true, '合 schema');
  assert.deepEqual(p.value, out, '声明字段齐全,投影后一字不少不多(additionalProperties:false 无越界)');
});

test('★compute 自包含(注入沙箱可跑)—— eval 隔离作用域含内联 matchScore 仍工作', () => {
  // 平台以 String(compute) 注入三墙沙箱;若引用了模块符号(如 import 的 computeMatch),这里 eval 就会 ReferenceError。
  const fn = new Function('return (' + String(computeMarketValue) + ')')();
  const r = fn({}, { jobs: [{ pay: '40-60万', need: ['Go'] }], skills: SK });
  assert.equal(r.jobs, 1);
  assert.equal(r.low, 40); assert.equal(r.high, 60); assert.equal(r.mid, 50); // 单岗位 ⇒ 加权=该岗位 lo/hi
});

test('★market-value-compute.js 零 import(自包含源码守卫,path-independent)', () => {
  const src = fs.readFileSync(new URL('../web/apps/jobseek/tools/market-value-compute.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\b/m.test(src), 'market-value-compute.js 必须零 import(compute 注入三墙沙箱须自包含)');
});

test('★两集合 reads=[jobs,skills] 的 D3 上架双向阳性对照', () => {
  assert.deepEqual(MARKET_VALUE_READS, ['jobs', 'skills'], 'reads 已收敛为两集合');
  const tool = { name: MARKET_VALUE_NAME, description: 'd', parameters: {}, reads: MARKET_VALUE_READS };
  // 两集合都可读 ⇒ 上架
  const up = filterReadableTools([tool], ['jobs', 'skills', 'resumes']);
  assert.equal(up.length, 1);
  assert.equal('compute' in up[0], false, '描述符只元数据、不带 compute');
  assert.equal('reads' in up[0], false, '不带 reads 给模型');
  // ★缺任一集合 ⇒ 不上架(两层 D3 的「上架」层:reads ⊄ readable 则整个工具不给模型)
  assert.deepEqual(filterReadableTools([tool], ['jobs']), [], '★缺 skills ⇒ 不上架');
  assert.deepEqual(filterReadableTools([tool], ['skills']), [], '★缺 jobs ⇒ 不上架');
  assert.deepEqual(filterReadableTools([tool], []), [], '空可读集 ⇒ 不上架');
});
