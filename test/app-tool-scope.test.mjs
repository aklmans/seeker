// 平台 · Skills 完整版 F1(工具 scoping · 最小权限)scopeAppTools 纯函数单测。
// ★承重结构闸(gate A · 工具表收窄):Skill.tools 三态 → app-tool 描述符表按声明取子集。
//   **减权不增权**:结果恒 ⊆ 入参 readableTools(已过 D3 上架 filter)⇒ Skill 永不能拿到用户不可读的工具、无提权面。
// ★平台 Rust 能力(query_data / memory / show_widget / doc)**不在本列表**:它们由后端 ai.rs `registry.tool_schemas()`
//   恒加、与前端携带的 app_tools 无关(ai.rs:720 独立于 app_tools;744 才叠加 app-tool)⇒ scoping 不动平台能力、恒在。
// ★gate B(dispatch)在后端:ai.rs:815 `app_tool_names.contains(call.name)` 从**同一** app_tools 派生 ⇒ 本函数收窄
//   app_tools 后,工具表与 dispatch 白名单**同源同步收窄**,模型幻调声明外工具不匹配、不执行(Rust 侧已测)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeAppTools, filterReadableTools } from '../web/platform/capability/app-tools/readable.js';

// 三个「已上架」readable 描述符(已过 D3 filterReadableTools);scoping 只按 name 取子集。
const READABLE = [
  { name: 'jobseek_market_value', description: 'mv', parameters: {} },
  { name: 'jobseek_match', description: 'm', parameters: {} },
  { name: 'assets_summary', description: 's', parameters: {} },
];
const names = (arr) => arr.map((t) => t.name);

test('scopeAppTools 三态① · undefined(未声明)= 全 readable(雏形/用户打字零回归)', () => {
  assert.deepEqual(names(scopeAppTools(READABLE, undefined)), ['jobseek_market_value', 'jobseek_match', 'assets_summary']);
});

test('scopeAppTools 三态② · [](声明空)= 空(无 app-tool;平台 Rust 能力不在此列、恒在)', () => {
  assert.deepEqual(scopeAppTools(READABLE, []), [], '声明空 → 一个 app-tool 也不给(区别于 undefined=全)');
});

test("scopeAppTools 三态③ · ['x'] = 仅 x(∩ readable;声明外结构性够不到)", () => {
  assert.deepEqual(names(scopeAppTools(READABLE, ['jobseek_match'])), ['jobseek_match'], '只留声明的 jobseek_match、其余 app-tool 被排除');
});

test('★scopeAppTools:减权不增权 —— 结果恒 ⊆ readable(声明超出集绝不无中生有)', () => {
  // 声明含 readable 里没有的名(含 profile/secrets 这类**永不可读**的诱饵)+ 一个真实的 → 只留真实的
  const out = scopeAppTools(READABLE, ['jobseek_match', 'profile_dump', 'secrets_read', 'assets_summary']);
  assert.deepEqual(names(out), ['jobseek_match', 'assets_summary'], '超出 readable 的声明部分被丢弃(⊆ readable)');
  // 空 readable + 任意声明 → 空(不能凭声明造出工具 = 提权面为零)
  assert.deepEqual(scopeAppTools([], ['anything', 'profile_dump']), [], '空可读集 + 声明 → 空(无从提权)');
});

test('scopeAppTools:入参防御(readableTools 非数组 → []、不抛;含 null 元素跳过)', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) {
    assert.deepEqual(scopeAppTools(bad, undefined), [], `readableTools=${String(bad)} → []`);
    assert.deepEqual(scopeAppTools(bad, ['a']), [], `readableTools=${String(bad)} + 声明 → []`);
  }
  assert.deepEqual(names(scopeAppTools([null, { name: 'ok' }, undefined], undefined)), ['ok'], 'readable 内 null/undefined 元素被跳过');
});

test('★scopeAppTools:与 filterReadableTools 叠加(D3 上架 ∩ Skill 声明)—— 双闸不能被声明旁路', () => {
  // 全量 app-tool(含 reads 不可读的)+ 运行时可读集 → filterReadableTools 先按 D3 上架 → scopeAppTools 再按 Skill 收窄。
  const ALL = [
    { name: 'jobseek_market_value', description: 'mv', parameters: {}, reads: ['jobs', 'skills'] },
    { name: 'jobseek_secret_tool', description: 'x', parameters: {}, reads: ['secrets'] }, // secrets 不可读 → D3 不上架
  ];
  const readable = filterReadableTools(ALL, ['jobs', 'skills']); // 上架:仅 market_value
  assert.deepEqual(names(readable), ['jobseek_market_value'], 'D3:reads 含 secrets 的工具不上架');
  // ★即便 Skill 声明了 D3 没上架的 secret_tool,scoping 也够不到(scope ∩ readable = D3 之内)
  assert.deepEqual(names(scopeAppTools(readable, ['jobseek_secret_tool'])), [], 'Skill 声明不能把 D3 拦下的工具捞回来');
  assert.deepEqual(names(scopeAppTools(readable, ['jobseek_market_value'])), ['jobseek_market_value']);
});
