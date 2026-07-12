// 平台 Skill 模型 · normSkill fail-safe 归一化 + skillRunnable 可运行判据(proposal-skills.md S1)入库单测。
// 承第80轮 [建议]:S2 的 prompt→instruction 依赖 normSkill 的 fail-safe ⇒ 在 S1(code 新鲜)就抽+测,别悬到 S2。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normSkill, skillRunnable } from '../web/platform/shell/skill-model.js';

test('normSkill:良构记录原样往返(含 tools/imported/reviewed)', () => {
  const rec = { id: 'sk_1', name: '拆 JD', description: '硬性/软性', prompt: '把 JD 拆两列', updated_at: 1720000000000, tools: ['tool_a'], imported: false, reviewed: true };
  assert.deepEqual(normSkill(rec), rec);
});

test('normSkill:缺字段 → 安全默认(空串 / 0 / tools undefined / 本地可信),不抛', () => {
  assert.deepEqual(normSkill({ id: 'sk_2' }), { id: 'sk_2', name: '', description: '', prompt: '', updated_at: 0, tools: undefined, imported: false, reviewed: true });
  assert.deepEqual(normSkill({ prompt: '只有指令' }), { id: '', name: '', description: '', prompt: '只有指令', updated_at: 0, tools: undefined, imported: false, reviewed: true });
});

test('normSkill:类型漂移强制字符串(number/boolean → String)', () => {
  const n = normSkill({ id: 42, name: 7, description: true, prompt: 3.14 });
  assert.equal(n.id, '42');
  assert.equal(n.name, '7');
  assert.equal(n.description, 'true');
  assert.equal(n.prompt, '3.14');
  assert.equal(typeof n.prompt, 'string', 'prompt 必为字符串 —— S2 喂 ai_chat instruction 的承重保证');
});

test('★normSkill:fail-safe —— 非对象/畸形绝不抛,回全默认', () => {
  for (const bad of [null, undefined, 'str', 42, true, [], NaN]) {
    const n = normSkill(bad);
    assert.deepEqual(n, { id: '', name: '', description: '', prompt: '', updated_at: 0, tools: undefined, imported: false, reviewed: true }, `坏输入 ${String(bad)} 应回默认`);
  }
});

test('★normSkill:tools 三态保真(F1 工具 scoping)—— undefined ≠ [](语义不同,不可塌)', () => {
  assert.equal(normSkill({ prompt: 'x' }).tools, undefined, '缺 tools 键 → undefined(未声明 = 全可读 app-tool、雏形零回归)');
  assert.deepEqual(normSkill({ prompt: 'x', tools: [] }).tools, [], '[] 保真(声明空 = 无 app-tool,区别于未声明)');
  assert.deepEqual(normSkill({ prompt: 'x', tools: ['a', 'b'] }).tools, ['a', 'b'], '具名 → string[]');
  // ★承重:scoping 据「undefined vs []」裁「全工具 vs 无 app-tool」,二者绝不可等同(塌了 = 三态崩成两态)
  assert.notDeepEqual(
    normSkill({ prompt: 'x' }).tools,
    normSkill({ prompt: 'x', tools: [] }).tools,
    'undefined ≠ [](三态承重:未声明=全 / 声明空=无 app-tool)'
  );
});

test('★normSkill:tools 畸形归一(非数组 → undefined、剔非空串,不抛)', () => {
  for (const bad of [null, 'str', 42, true, {}, NaN]) {
    assert.equal(normSkill({ prompt: 'x', tools: bad }).tools, undefined, `非数组 tools(${String(bad)})→ undefined(不塌成 [])`);
  }
  assert.deepEqual(
    normSkill({ prompt: 'x', tools: ['ok', '', 42, null, 'y'] }).tools,
    ['ok', 'y'],
    '剔非串 / 空串,保留非空串'
  );
});

test('normSkill:updated_at 非有限数 → 0(NaN/Infinity/字符串)', () => {
  assert.equal(normSkill({ updated_at: NaN }).updated_at, 0);
  assert.equal(normSkill({ updated_at: Infinity }).updated_at, 0);
  assert.equal(normSkill({ updated_at: '123' }).updated_at, 0);
  assert.equal(normSkill({ updated_at: 5 }).updated_at, 5);
});

test('skillRunnable:prompt 去空白非空 → 可运行', () => {
  assert.equal(skillRunnable({ prompt: '做点事' }), true);
  assert.equal(skillRunnable({ name: '有名但无正文', prompt: '' }), false, '只填名的草稿不可运行');
  assert.equal(skillRunnable({ prompt: '   \n\t ' }), false, '纯空白不可运行');
});

test('★skillRunnable:fail-safe —— 畸形/非对象输入不可运行且不抛', () => {
  for (const bad of [null, undefined, 'str', 42, {}, { prompt: null }]) {
    assert.equal(skillRunnable(bad), false, `坏输入 ${String(bad)} 应不可运行`);
  }
});

test('★源守卫:skill-model.js 零 import(node 可测 + 无浏览器依赖,path-independent)', () => {
  const src = fs.readFileSync(new URL('../web/platform/shell/skill-model.js', import.meta.url), 'utf8');
  // 剥注释后不得含 import/require(与 iv-feedback/match-result 同纪律:承重归一化模块自包含)。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bimport\s/.test(code), 'skill-model.js 不应含 import');
  assert.ok(!/\brequire\s*\(/.test(code), 'skill-model.js 不应含 require');
});
