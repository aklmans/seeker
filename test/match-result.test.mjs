// 智能匹配 · computeMatch 确定性公式 + normMatchResult fail-safe(M1)入库单测。真模块导出、零漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeMatch, normMatchResult, MATCH_REASONING_SCHEMA } from '../web/apps/jobseek/logic/match-result.js';
import { projectToSchema } from '../web/platform/capability/app-tools/validate.js';

const S = (over) => [{ name: 'Go', lvl: 4 }, { name: 'Rust', lvl: 5 }, { name: 'K8s', lvl: 2 }, ...(over || [])];

test('computeMatch:满分/半分/缺 分类 + 分公式(credit/total×10)', () => {
  // need Go(lvl4满)/Rust(lvl5满)/K8s(lvl2半):credit=2+0.5=2.5,total=3 ⇒ 8.3
  const m = computeMatch({ need: ['Go', 'Rust', 'K8s'] }, S());
  assert.equal(m.score, 8.3);
  assert.deepEqual(m.matched, ['Go', 'Rust']);
  assert.deepEqual(m.partial, ['K8s']);
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.gaps, ['K8s'], 'gaps = 非满分,need 序');
});

test('computeMatch:缺失技能 → 0 分贡献 + 入 missing/gaps', () => {
  const m = computeMatch({ need: ['Go', 'GraphQL', 'Kafka'] }, S()); // Go 满,GraphQL/Kafka 缺
  assert.deepEqual(m.matched, ['Go']);
  assert.deepEqual(m.missing, ['GraphQL', 'Kafka']);
  assert.deepEqual(m.gaps, ['GraphQL', 'Kafka']);
  // credit=1,total=3 ⇒ round(1/3*10,1)=3.3
  assert.equal(m.score, 3.3);
});

test('★gaps 保持 need 序(= topGapsOf 等价,含 partial+missing 交织)', () => {
  const m = computeMatch({ need: ['Go', 'K8s', 'GraphQL', 'Rust'] }, S()); // Go满 K8s半 GraphQL缺 Rust满
  assert.deepEqual(m.gaps, ['K8s', 'GraphQL'], 'need 序:K8s(半)在 GraphQL(缺)前');
  assert.deepEqual(m.matched, ['Go', 'Rust']);
});

test('computeMatch:全满 → 10、全缺 → 0、空 need → 0', () => {
  assert.equal(computeMatch({ need: ['Go', 'Rust'] }, S()).score, 10, '全 lvl≥3 ⇒ 10');
  assert.equal(computeMatch({ need: ['X', 'Y'] }, []).score, 0, '全缺 ⇒ 0');
  assert.equal(computeMatch({ need: [] }, S()).score, 0, '空 need ⇒ 0(不除零)');
  assert.equal(computeMatch({}, S()).score, 0, '无 need 字段 ⇒ 0');
});

test('computeMatch:skill lvl 钳制(缺省/越界/非整)', () => {
  const m = computeMatch({ need: ['A', 'B', 'C'] }, [{ name: 'A' }, { name: 'B', lvl: 9 }, { name: 'C', lvl: 2.9 }]);
  assert.deepEqual(m.partial, ['A', 'C'], 'A 缺 lvl→1(半)、C 2.9→floor 2(半)');
  assert.deepEqual(m.matched, ['B'], 'B 9→钳 5(满)');
});

test('★normMatchResult fail-safe:garbage → 合规、绝不抛(承重排序不 NaN)', () => {
  for (const bad of [null, undefined, {}, 'x', 42]) {
    const r = normMatchResult(bad);
    assert.equal(r.score, 0);
    assert.deepEqual(r.matched, []);
    assert.equal('reasoning' in r, false);
  }
  assert.equal(normMatchResult({ score: 99 }).score, 10, '钳上限');
  assert.equal(normMatchResult({ score: -5 }).score, 0, '钳下限');
  assert.equal(normMatchResult({ score: 'nan' }).score, 0, '非数→0');
  assert.deepEqual(normMatchResult({ matched: ['a', 1, '', 'b'] }).matched, ['a', 'b'], '强制字符串数组');
  assert.equal(normMatchResult({ reasoning: '  好  ' }).reasoning, '好', 'reasoning 去空');
});

test('MATCH_REASONING_SCHEMA 校验 AI reasoning wire(M3 prep)', () => {
  assert.equal(projectToSchema({ reasoning: '技能高度吻合' }, MATCH_REASONING_SCHEMA).ok, true);
  assert.equal(projectToSchema({ reasoning: 123 }, MATCH_REASONING_SCHEMA).ok, false, 'reasoning 非 string ⇒ 拒');
});

test('★match-result.js 零 import(自包含源码守卫)', () => {
  const src = fs.readFileSync(new URL('../web/apps/jobseek/logic/match-result.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\b/m.test(src), 'match-result.js 必须零 import(computeMatch 将来注入沙箱须自包含)');
});
