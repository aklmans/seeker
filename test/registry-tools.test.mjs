// app-tool 注册期校验(I2 静态半:reads ⊆ collections、name 前缀、全字段 default-deny)的入库单测。
// 运行:`npm test`(node --test)。
//
// registry.js 是**经典 IIFE**(载序原因:单体 INIT 解析期同步消费 window.SeekerShell,ES module 赶不上),
// 不能被 ESM `import`。为避免「抽出纯函数 → 与 registry 内的实现漂移」或「把 registry 改成 module」的风险,
// 本测试**直接 eval 真 registry.js**(最小 window/localStorage 桩)、经 register() 驱动 validateTools ——
// 测的就是出厂代码本身,零漂移。这是第71轮 [建议]2 / 第72轮 [应改] 要的「让会后即逝的 harness 变持久」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** eval 真 registry.js,返回 window.SeekerShell(每次全新 localStorage 桩,避免用例间偏好串扰)。 */
function loadShell() {
  const store = {};
  const sandbox = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    window: {},
    console,
  };
  const src = fs.readFileSync(new URL('../web/platform/shell/registry.js', import.meta.url), 'utf8');
  // 经典 IIFE 引用 window/localStorage/console —— 用 Function 注入桩作用域(比污染 globalThis 干净)。
  new Function('window', 'localStorage', 'console', src)(sandbox.window, sandbox.localStorage, sandbox.console);
  return sandbox.window.SeekerShell;
}

const PAGE = { id: 'p', label: 'P', en: 'P', group: 'g', render: () => {} };
const baseTool = () => ({ name: 'demo_x', description: 'do x', parameters: { type: 'object' }, reads: ['demo_a'], compute: (i, r) => ({}), output: { type: 'object' }, render: (o) => ({ html: '' }) });
const mk = (over = {}) => ({ id: 'demo', name: { zh: 'D', en: 'D' }, icon: '', blurb: { zh: '', en: '' }, collections: ['demo_a', 'demo_b'], aiReadable: 'default-on', groups: { g: { zh: 'G', en: 'G' } }, pages: [PAGE], ...over });

test('validateTools default-deny:11 条违规各自拒注册', () => {
  const S = loadShell();
  const rejects = (over, why) => assert.throws(
    () => S.register(mk(over)),
    (e) => { assert.match(String(e.message), /app-tool|tools/, 'app-tool 相关报错: ' + e.message); return true; },
    '应拒: ' + why,
  );
  rejects({ tools: {} }, 'tools 非数组');
  rejects({ tools: [{ ...baseTool(), name: 'nope_x' }] }, 'name 无 <appId>_ 前缀');
  rejects({ tools: [{ ...baseTool(), description: '' }] }, 'description 空');
  rejects({ tools: [{ ...baseTool(), parameters: null }] }, 'parameters 非对象');
  rejects({ tools: [{ ...baseTool(), reads: undefined }] }, 'reads 省略(必填)');
  rejects({ tools: [{ ...baseTool(), reads: 'demo_a' }] }, 'reads 非数组');
  rejects({ tools: [{ ...baseTool(), reads: ['demo_a', 'jobs'] }] }, 'reads ⊄ collections(jobs 越界)');
  rejects({ tools: [{ ...baseTool(), compute: 'x' }] }, 'compute 非函数');
  rejects({ tools: [{ ...baseTool(), output: undefined }] }, 'output 缺失');
  rejects({ tools: [{ ...baseTool(), render: null }] }, 'render 非函数');
  rejects({ tools: [baseTool(), baseTool()] }, 'name 应用内重复');
});

test('null tools 抛(不当「无 tools」放过)', () => {
  const S = loadShell();
  assert.throws(() => S.register(mk({ tools: null })), /tools 必须是数组/);
});

test('合法工具注册通过 + appTools() 并集', () => {
  const S = loadShell();
  S.register(mk({ tools: [baseTool()] }));
  const t = S.appTools();
  assert.equal(t.length, 1);
  assert.equal(t[0].name, 'demo_x');
});

test('两应用工具并集', () => {
  const S = loadShell();
  S.register(mk({ tools: [baseTool()] }));
  S.register({ id: 'shop', name: { zh: 'S', en: 'S' }, icon: '', blurb: { zh: '', en: '' }, collections: ['shop_z'], aiReadable: 'default-on', groups: { g: { zh: 'G', en: 'G' } }, pages: [PAGE], tools: [{ name: 'shop_y', description: 'y', parameters: {}, reads: ['shop_z'], compute: () => ({}), output: { type: 'object' }, render: () => ({ html: '' }) }] });
  assert.equal(S.appTools().length, 2);
});

test('★关应用 ⇒ 其工具即刻下架', () => {
  const S = loadShell();
  S.register(mk({ tools: [baseTool()] }));
  assert.equal(S.appTools().length, 1);
  S.setEnabled('demo', false);
  assert.equal(S.appTools().length, 0, '关 demo 后并集为空');
});

test('无 tools 的应用不破坏 appTools()', () => {
  const S = loadShell();
  S.register(mk({ id: 'bare', collections: [], tools: undefined }));
  assert.doesNotThrow(() => S.appTools());
  assert.equal(S.appTools().length, 0);
});
