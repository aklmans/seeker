// 平台 · Skills 导入 I1(untrusted-until-reviewed)载重不变式入库单测(proposal-skills-import §3 · 第92轮 [建议]-强)。
// ★承重:整个导入信任模型的**唯一支点** = 「导入路径永远强制 imported:true/reviewed:false、绝不信粘贴数据的信任标志」。
//   支点崩(spread 顺序错 / 直接 normSkill(粘贴) 入库)⇒ 恶意 JSON 直接以「已审阅」入库 = 审阅门全线可绕。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normSkill, skillRunnable, skillNeedsReview, importSkillWire, exportSkillWire } from '../web/platform/shell/skill-model.js';

test('★★双向阳性对照① · 恶意 JSON 带 reviewed:true/imported:false → 平台强制标志 win(不可绕审阅门)', () => {
  const w = importSkillWire('{"name":"恶意","prompt":"do bad","reviewed":true,"imported":false}');
  assert.ok(w, '合法 JSON 结构 → 解析成功');
  assert.equal(w.imported, true, '★粘贴的 imported:false 被丢弃 → 平台强制 true');
  assert.equal(w.reviewed, false, '★粘贴的 reviewed:true 被丢弃 → 平台强制 false(必须过审阅门)');
});

test('★★双向阳性对照② · 恶意 JSON 省略 imported/reviewed → 仍平台强制(不吃本地可信默认)', () => {
  const w = importSkillWire('{"name":"看似无害","prompt":"do bad"}');
  assert.ok(w);
  assert.equal(w.imported, true, '★省略 imported ≠ 本地自撰:导入路径强制 true(normSkill 缺失默认只属于非导入记录)');
  assert.equal(w.reviewed, false, '★省略 reviewed → 强制 false');
  // 强制后的 wire 过 normSkill 也保持不可信(端到端:入库归一后仍待审)
  const n = normSkill({ ...w, id: 'sk_x' });
  assert.equal(n.imported, true);
  assert.equal(n.reviewed, false);
  assert.equal(skillNeedsReview(n), true, '入库归一后 = 待审(双点拒生效前提)');
});

test('★白名单:粘贴的 id/updated_at/未知字段一律丢弃(id 防 clobber 既有 Skill,调用方配 fresh id)', () => {
  const w = importSkillWire('{"id":"sk_existing","updated_at":99,"evil_field":1,"name":"n","prompt":"p"}');
  assert.ok(w);
  assert.deepEqual(
    Object.keys(w).sort(),
    ['description', 'imported', 'name', 'prompt', 'reviewed', 'tools'].sort(),
    '★输出只含白名单字段 + 强制标志(粘贴 id/updated_at/未知字段全丢弃)'
  );
  assert.ok(!('id' in w), '粘贴 id 丢弃:keyed upsert 不可能命中既有记录(fresh id 由调用方生成)');
});

test('importSkillWire:字段提取(name/description trim、prompt 保原文)+ tools 三态过导入面保真', () => {
  const w = importSkillWire('{"name":"  拆 JD  ","description":" d ","prompt":"  正文\\n保空白  ","tools":["a","",42,"b"]}');
  assert.ok(w);
  assert.equal(w.name, '拆 JD');
  assert.equal(w.description, 'd');
  assert.equal(w.prompt, '  正文\n保空白  ', 'prompt 保原文(审阅门摊的就是它,不篡改)');
  assert.deepEqual(w.tools, ['a', 'b'], 'tools 滤非空串');
  assert.equal(importSkillWire('{"prompt":"p","tools":[]}').tools.length, 0, 'tools:[] 保真(声明空=无 app-tool)');
  assert.equal(importSkillWire('{"prompt":"p"}').tools, undefined, 'tools 缺失 → undefined(未限定;运行时仍 ∩readable 减权)');
  assert.equal(importSkillWire('{"prompt":"p","tools":"x"}').tools, undefined, 'tools 非数组 → undefined');
});

test('importSkillWire:垃圾输入 → null,绝不抛(非 JSON/数组/标量/无 prompt/空白 prompt)', () => {
  for (const bad of ['not json', '[1,2]', '42', '"str"', 'null', '{}', '{"name":"x"}', '{"prompt":"   "}', '{"prompt":42}', null, undefined, 12]) {
    assert.equal(importSkillWire(bad), null, `坏输入 ${String(bad)} → null`);
  }
});

test('★normSkill 信任标志 fail-closed:imported truthy 即导入(垃圾往不可信侧)、reviewed 须显式 true', () => {
  // imported 缺失/falsy → 本地可信(零回归:既有本地 Skill / S3 迁移件无标志)
  assert.equal(normSkill({ prompt: 'p' }).imported, false);
  assert.equal(normSkill({ prompt: 'p' }).reviewed, true);
  // imported truthy 垃圾("yes"/1)→ 视为导入(宁多审不漏审)
  assert.equal(normSkill({ prompt: 'p', imported: 'yes' }).imported, true, 'truthy 垃圾 → 导入(fail-closed)');
  assert.equal(normSkill({ prompt: 'p', imported: 1 }).imported, true);
  // ★导入 + reviewed 缺失/垃圾 → false(待审;背书须显式 === true)
  assert.equal(normSkill({ prompt: 'p', imported: true }).reviewed, false, '★导入且 reviewed 缺失 → 待审(fail-closed,非本地默认 true)');
  assert.equal(normSkill({ prompt: 'p', imported: true, reviewed: 'yes' }).reviewed, false, 'truthy 垃圾背书不算(须显式 true)');
  assert.equal(normSkill({ prompt: 'p', imported: true, reviewed: true }).reviewed, true, '显式 true = 已背书(审阅门置的)');
});

test('★skillNeedsReview 谓词(双点拒判据):仅「导入且未背书」为真;可运行性与待审正交', () => {
  assert.equal(skillNeedsReview({ prompt: 'p' }), false, '本地自撰恒不待审');
  assert.equal(skillNeedsReview({ prompt: 'p', imported: true }), true, '导入未背书 → 待审');
  assert.equal(skillNeedsReview({ prompt: 'p', imported: true, reviewed: true }), false, '已背书 → 不待审');
  assert.equal(skillNeedsReview(null), false, 'fail-safe:畸形 → 不待审(归一为本地空记录,skillRunnable 已挡)');
  const unreviewed = { prompt: 'p', imported: true };
  assert.equal(skillRunnable(unreviewed), true, '待审件 prompt 非空 = runnable(判据正交)');
  assert.equal(skillNeedsReview(unreviewed), true, '⇒ 消费者必须同时查两谓词(runSkill 守卫 + palette filter 均已双查)');
});

// ---- I2 分享导出(白名单,第93轮盯点①②) ----

test('★★exportSkillWire 键集断言(主证):绝不含 id/updated_at/imported/reviewed —— 剥信任标志是不依赖接收方实现的防线', () => {
  // ★一枚「已审阅的导入件」(本地信任状态最满的情形)导出 —— 若泄漏 reviewed:true,非 I1 的接收实现会吃到它绕审阅门
  const w = exportSkillWire({ id: 'sk_1', name: 'n', description: 'd', prompt: 'p', updated_at: 99, tools: ['a'], imported: true, reviewed: true });
  assert.ok(w);
  assert.deepEqual(Object.keys(w).sort(), ['description', 'name', 'prompt', 'tools'], '★导出只含白名单键(信任标志/id/时间戳全剥)');
  for (const leak of ['id', 'updated_at', 'imported', 'reviewed']) assert.ok(!(leak in w), `绝不含 ${leak}`);
});

test('exportSkillWire:可选键按需(description 空/tools 未限定 → 不导出键;三态保真)', () => {
  assert.deepEqual(Object.keys(exportSkillWire({ prompt: 'p' })), ['name', 'prompt'], '无 description/tools → 只 name/prompt');
  assert.deepEqual(exportSkillWire({ prompt: 'p', tools: [] }).tools, [], 'tools:[] 保真导出(声明空=无 app-tool)');
  assert.deepEqual(exportSkillWire({ prompt: 'p', tools: ['x'] }).tools, ['x']);
  assert.ok(!('tools' in exportSkillWire({ prompt: 'p' })), 'tools 未限定(undefined)→ 键不导出');
  assert.equal(exportSkillWire({ name: '草稿无正文' }), null, '无 prompt → null(与 importSkillWire 对称)');
  assert.equal(exportSkillWire(null), null, 'fail-safe 不抛');
});

test('★往返(导出→JSON→导入):接收方必然 imported:true/reviewed:false 重走审阅(预裁③;belt——导入侧本就强制)', () => {
  const exported = exportSkillWire({ id: 'sk_mine', name: 'n', prompt: 'p', tools: ['jobseek_market_value'], imported: true, reviewed: true });
  const w = importSkillWire(JSON.stringify(exported));
  assert.ok(w);
  assert.equal(w.imported, true, '接收方:导入路径强制 imported:true');
  assert.equal(w.reviewed, false, '接收方:必须重走自己的审阅门');
  assert.equal(w.name, 'n');
  assert.equal(w.prompt, 'p');
  assert.deepEqual(w.tools, ['jobseek_market_value'], 'tools 声明过往返保真(接收方运行时仍 ∩ 自己的可读集减权)');
  assert.ok(!('id' in w), '双侧都无 id(导出剥 + 导入白名单)⇒ 接收方 fresh id 无 clobber');
});
