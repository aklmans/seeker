// 面试反馈评分 schema + 归一化(承重结构)的入库单测。真模块导出,零漂移。
// ivScore schema 刀:钉死 {scores:{structure,depth,quant,overall}, good, improve} 契约,解锁面试反馈真化。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normIvFeedback, IV_FEEDBACK_SCHEMA, IV_DIMS, parseFeedbackWire } from '../web/apps/jobseek/logic/iv-feedback.js';
import { projectToSchema } from '../web/platform/capability/app-tools/validate.js';

test('归一:各维钳 [0,10] 保留 1 位', () => {
  const r = normIvFeedback({ structure: 15, depth: -3, quant: 7.25 });
  assert.equal(r.scores.structure, 10, '超上限 → 10');
  assert.equal(r.scores.depth, 0, '负 → 0');
  assert.equal(r.scores.quant, 7.3, '保留 1 位(7.25→7.3)');
});

test('★overall 永远由 3 维重算(不信输入 overall)', () => {
  const r = normIvFeedback({ structure: 6, depth: 6, quant: 6, overall: 99 });
  assert.equal(r.scores.overall, 6, '输入 overall:99 被忽略,重算 = (6+6+6)/3');
  const r2 = normIvFeedback({ structure: 8, depth: 5, quant: 6 });
  assert.equal(r2.scores.overall, 6.3, 'round((8+5+6)/3,1)=6.3');
});

test('★fail-safe:null / {} / 垃圾 / 非数维 ⇒ 合规默认,绝不抛(承重消费者不崩)', () => {
  for (const bad of [null, undefined, {}, 'garbage', 42, []]) {
    const r = normIvFeedback(bad);
    assert.deepEqual(r.scores, { structure: 0, depth: 0, quant: 0, overall: 0 }, '默认全 0: ' + JSON.stringify(bad));
    assert.deepEqual(r.good, []);
    assert.deepEqual(r.improve, []);
  }
  assert.equal(normIvFeedback({ structure: 'abc', depth: NaN, quant: Infinity }).scores.structure, 0, '非有限数 → 0');
});

test('good/improve:强制字符串数组、去空、有界、截断', () => {
  const r = normIvFeedback({
    structure: 7, depth: 7, quant: 7,
    good: ['a', '', '  ', 123, null, 'b', 'c', 'd', 'e'], // 非字符串/空剔除,余截到 4
    improve: [' x '.repeat(200)], // 截到 240
  });
  assert.deepEqual(r.good, ['a', 'b', 'c', 'd'], '去空+非串+截到 4');
  assert.ok(r.improve[0].length <= 240, '单条截 240');
  assert.equal(normIvFeedback({ good: 'not-array' }).good.length, 0, '非数组 → []');
});

test('小数分数保留(评分是 number 非 integer)', () => {
  assert.equal(normIvFeedback({ structure: 6.5, depth: 8.2, quant: 5.1 }).scores.structure, 6.5);
});

test('IV_DIMS = 三评分维(overall 派生、不在列)', () => {
  assert.deepEqual(IV_DIMS, ['structure', 'depth', 'quant']);
});

test('★IV_FEEDBACK_SCHEMA 校验 wire 形(真化 prep;projectToSchema)', () => {
  // 合规 wire(AI 真化后产出)通过
  assert.equal(projectToSchema({ structure: 7, depth: 6, quant: 8, good: ['ok'], improve: ['do'] }, IV_FEEDBACK_SCHEMA).ok, true);
  // 缺必填维 ⇒ 拒(真化时 AI 漏维即被挡)
  assert.equal(projectToSchema({ depth: 6, quant: 8 }, IV_FEEDBACK_SCHEMA).ok, false, '缺 structure ⇒ 拒');
  // 维非数 ⇒ 拒
  assert.equal(projectToSchema({ structure: 'x', depth: 6, quant: 8 }, IV_FEEDBACK_SCHEMA).ok, false, 'structure 非 number ⇒ 拒');
});

test('parseFeedbackWire:干净 JSON / 裹散文 / ```json / 串内花括号 / 无 JSON / 畸形', () => {
  assert.deepEqual(parseFeedbackWire('{"structure":7,"depth":8,"quant":6}'), { structure: 7, depth: 8, quant: 6 });
  // 前后带散文(模型爱解释)
  assert.deepEqual(parseFeedbackWire('这是评分:\n{"structure":7,"good":["清晰"]}\n希望有帮助'), { structure: 7, good: ['清晰'] });
  // ```json 代码块
  assert.deepEqual(parseFeedbackWire('```json\n{"depth":9}\n```'), { depth: 9 });
  // 串内的 } 不该提前收尾
  assert.deepEqual(parseFeedbackWire('{"good":["用 {x} 表示"],"depth":5}'), { good: ['用 {x} 表示'], depth: 5 });
  // 嵌套对象
  assert.deepEqual(parseFeedbackWire('{"a":{"b":1},"c":2}'), { a: { b: 1 }, c: 2 });
  // 无 JSON / 畸形 → null(诚实降级,不臆造)
  assert.equal(parseFeedbackWire('模型只说了一堆废话,没有 JSON'), null);
  assert.equal(parseFeedbackWire('{"structure":7,'), null, '畸形 JSON → null');
  assert.equal(parseFeedbackWire(''), null);
  assert.equal(parseFeedbackWire(null), null);
});

test('★parse→schema→norm 全链:合法产 canonical、畸形/漏维在 schema 硬闸被拦', () => {
  // 合法 wire → projectToSchema.ok → normIvFeedback canonical
  const good = parseFeedbackWire('{"structure":8,"depth":7,"quant":9,"good":["a"],"improve":["b"]}');
  assert.equal(projectToSchema(good, IV_FEEDBACK_SCHEMA).ok, true);
  assert.equal(normIvFeedback(good).scores.overall, 8, 'round((8+7+9)/3)=8');
  // 漏维(AI 只给两维)→ schema 拒 ⇒ 调用方诚实降级、不喂 normIvFeedback
  const partial = parseFeedbackWire('{"structure":8,"depth":7}');
  assert.equal(projectToSchema(partial, IV_FEEDBACK_SCHEMA).ok, false, '缺 quant ⇒ schema 硬闸拦');
});

test('★iv-feedback.js 零 import(自包含源码守卫)', () => {
  const src = fs.readFileSync(new URL('../web/apps/jobseek/logic/iv-feedback.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\b/m.test(src), 'iv-feedback.js 必须零 import(承重归一化、node 可测真模块导出)');
});
