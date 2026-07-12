// 平台 Project · normProject fail-safe 入库单测(proposal-project PJ1)。
// ★红线锚:「永不注册可写 platform_projects 的工具」契约注释在场断言(缺席钉成有形物,同 schedule-model)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normProject } from '../web/platform/shell/project-model.js';

test('normProject:良构往返 + 缺字段安全默认,绝不抛', () => {
  const rec = { id: 'pj_1', name: '找工作', instructions: '聚焦后端岗', archived: false, created_at: 1, updated_at: 2 };
  assert.deepEqual(normProject(rec), rec);
  assert.deepEqual(normProject({ id: 'pj_2' }), { id: 'pj_2', name: '', instructions: '', archived: false, created_at: 0, updated_at: 0 });
  for (const bad of [null, undefined, 'str', 42, [], NaN]) {
    const n = normProject(bad);
    assert.equal(typeof n.name, 'string');
    assert.equal(n.archived, false, `坏输入 ${String(bad)} → 不归档(可见侧)`);
  }
});

test('★normProject:archived 须显式 true(垃圾值→可见 —— 错误隐藏=用户以为内容丢了;显示无害)', () => {
  assert.equal(normProject({ archived: 'yes' }).archived, false, 'truthy 垃圾 ≠ 归档');
  assert.equal(normProject({ archived: 1 }).archived, false);
  assert.equal(normProject({ archived: true }).archived, true, '显式 true = 归档');
  assert.equal(normProject({ instructions: 42 }).instructions, '', '非串 instructions → 空(不喂垃圾给注入位)');
});

test('★源守卫:project-model.js 零 import + 「永不注册可写 platform_projects」红线注释在场(自我提示注入通路缺席的有形锚)', () => {
  const src = fs.readFileSync(new URL('../web/platform/shell/project-model.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bimport\s/.test(code), '零 import(node 可测)');
  assert.ok(src.includes('永不注册任何可写'), '契约注释在场(删注释=本断言红)');
  assert.ok(src.includes('自我提示注入'), '红线理由在场');
});
