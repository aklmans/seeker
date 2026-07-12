// jobseek · 简历解析承重契约入库单测(schema-first,真化前置)。真模块导出、零 import。
// ★承重:normResumeParse 的输出写入 SKILLS(computeMatch/市场价值/匹配全读)⇒ fail-safe 归一化 + schema 硬闸先测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normResumeParse, parseResumeWire, RESUME_PARSE_SCHEMA } from '../web/apps/jobseek/logic/resume-parse.js';
import { projectToSchema } from '../web/platform/capability/app-tools/validate.js';

test('normResumeParse:良构 wire → 归一(lvl/evidence/years/summary)', () => {
  const r = normResumeParse({
    skills: [{ name: 'Go', lvl: 4, evidence: ['美团后端', '网关'] }, { name: 'K8s', lvl: 1, evidence: [] }],
    years: 8,
    summary: '8 年后端',
  });
  assert.deepEqual(r.skills, [{ name: 'Go', lvl: 4, evidence: ['美团后端', '网关'] }, { name: 'K8s', lvl: 1, evidence: [] }]);
  assert.equal(r.years, 8);
  assert.equal(r.summary, '8 年后端');
});

test('normResumeParse:lvl 钳制(缺/非有限→0、越界钳 5、取整)', () => {
  const r = normResumeParse({ skills: [
    { name: 'A' },            // 缺 lvl → 0
    { name: 'B', lvl: 9 },    // → 5
    { name: 'C', lvl: -2 },   // <0 → 0
    { name: 'D', lvl: 3.9 },  // → 3(floor)
    { name: 'E', lvl: 'x' },  // 非数 → 0
  ] });
  assert.deepEqual(r.skills.map((s) => s.lvl), [0, 5, 0, 3, 0]);
});

test('normResumeParse:丢无名 + 去重名 + evidence 只留非空串', () => {
  const r = normResumeParse({ skills: [
    { name: 'Go', lvl: 4 },
    { name: '', lvl: 5 },              // 无名 → 剔
    { lvl: 3 },                        // 无名 → 剔
    { name: 'Go', lvl: 2 },            // 重名 → 剔(保首个)
    { name: 'K8s', lvl: 1, evidence: ['真', '', '  ', 42, '证据'] }, // 非空串留 2
  ] });
  assert.deepEqual(r.skills.map((s) => s.name), ['Go', 'K8s']);
  assert.deepEqual(r.skills[0], { name: 'Go', lvl: 4, evidence: [] });
  assert.deepEqual(r.skills[1].evidence, ['真', '证据']);
});

test('★normResumeParse:fail-safe —— 非对象/畸形绝不抛,回安全默认', () => {
  for (const bad of [null, undefined, 'str', 42, [], NaN, { skills: 'nope' }, { skills: [null, 7, 'x'] }]) {
    const r = normResumeParse(bad);
    assert.ok(Array.isArray(r.skills), 'skills 恒数组');
    assert.equal(typeof r.years, 'number');
    assert.equal(typeof r.summary, 'string');
  }
  assert.deepEqual(normResumeParse(null), { skills: [], years: 0, summary: '' });
});

test('parseResumeWire:抽第一个平衡 {…} JSON 块(串内花括号不计)', () => {
  assert.deepEqual(parseResumeWire('前言\n{"skills":[{"name":"Go","lvl":4}],"years":8} 尾'), { skills: [{ name: 'Go', lvl: 4 }], years: 8 });
  assert.deepEqual(parseResumeWire('{"summary":"含 } 花括号在串内","years":3}'), { summary: '含 } 花括号在串内', years: 3 });
  assert.equal(parseResumeWire('无 JSON'), null);
  assert.equal(parseResumeWire('{ 坏 json'), null);
});

test('归一化输出经 projectToSchema 硬闸(合 RESUME_PARSE_SCHEMA)', () => {
  const out = normResumeParse({ skills: [{ name: 'Go', lvl: 4, evidence: ['x'] }], years: 8, summary: 's' });
  const p = projectToSchema(out, RESUME_PARSE_SCHEMA);
  assert.equal(p.ok, true, '归一后合 schema(硬闸放行)');
});

test('★resume-parse.js 零 import(自包含源码守卫)', () => {
  const src = fs.readFileSync(new URL('../web/apps/jobseek/logic/resume-parse.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\b/m.test(src), 'resume-parse.js 必须零 import(node 可测、真模块导出)');
});
