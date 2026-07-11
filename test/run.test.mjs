// app-tool 前端编排(run.js)的 fail-closed 路径入库单测(I2 前端半 + 五失败面)。
// 运行:`npm test`。
//
// 评审第73轮 [建议]:run.js 承载 I2 的前端半(query_data 拒 ⇒ catch ⇒ fail-closed)、未知工具拒、沙箱失败拒 ——
// 都是安全相关的 fail-closed,恰好 node 可测。唯一要浏览器的 runComputeSandbox 经默认参数注入桩(浏览器
// 隔离性仍走 preview:sandbox.js 的三墙 / 投影另有 validate.test.mjs + preview 对抗)。此处测**编排**,不测投影。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAppTool } from '../web/platform/capability/app-tools/run.js';

const DEMO = {
  name: 'demo_stats',
  reads: ['demo_a'],
  compute: (i, r) => ({ count: (r.demo_a || []).length }),
  output: { type: 'object', properties: { count: { type: 'integer' } } },
  render: (o) => ({ html: '<b>' + o.count + '</b>', title: 'S' }),
};

/** 装 window.SeekerShell 桩(node 无 window)。 */
function installShell(tools) {
  globalThis.window = { SeekerShell: { appTools: () => tools } };
}
/** 桩 rt:记录 queried / result / widget;queryReject=该集合取数 reject(模拟后端 D3 拒)。 */
function stubRt(records, queryReject) {
  const calls = { queried: [], result: null, widget: null };
  return {
    calls,
    queryData: async (c) => {
      calls.queried.push(c);
      if (queryReject && c === queryReject) throw new Error('集合「' + c + '」当前不对 AI 可读');
      return { collection: c, count: records.length, records };
    },
    result: async (callId, ok, output, error) => { calls.result = { callId, ok, output, error }; },
    onWidget: (w) => { calls.widget = w; },
  };
}
const okSandbox = async (spec) => ({ ok: true, output: { count: (spec.rows.demo_a || []).length } });
const failSandbox = async () => ({ ok: false, error: 'compute 超时(未执行任何操作)' });
const ev = (input) => ({ callId: 'c1', name: 'demo_stats', input: input || {} });

test('未知/已下架工具 ⇒ fail-closed 报错', async () => {
  installShell([DEMO]);
  const rt = stubRt([]);
  await runAppTool({ callId: 'c9', name: 'ghost_x', input: {} }, rt, okSandbox);
  assert.equal(rt.calls.result.ok, false);
  assert.match(rt.calls.result.error, /未知或已下架/);
  assert.equal(rt.calls.queried.length, 0, '未知工具不该取任何数');
});

test('★D3 取数被拒 ⇒ fail-closed,且 compute 不跑(sandbox 未被调)', async () => {
  installShell([DEMO]);
  const rt = stubRt([{ v: 1 }], 'demo_a'); // demo_a 取数 reject
  let sandboxCalled = false;
  await runAppTool(ev(), rt, async (s) => { sandboxCalled = true; return okSandbox(s); });
  assert.equal(rt.calls.result.ok, false, '取数拒 ⇒ 结果 false');
  assert.match(rt.calls.result.error, /不对 AI 可读/, '错误是 D3 拒、非编造成功');
  assert.equal(sandboxCalled, false, '★compute 未跑(fail-closed 在取数处短路)');
  assert.equal(rt.calls.widget, null, '无 widget');
});

test('★取数只在 reads(demo_a)· 从不取 profile / 他集合', async () => {
  installShell([DEMO]);
  const rt = stubRt([{ v: 1 }, { v: 2 }]);
  await runAppTool(ev(), rt, okSandbox);
  assert.deepEqual(rt.calls.queried, ['demo_a'], '取数集合 = tool.reads,别无其他');
});

test('正常往返 ⇒ result(true, output) + onWidget', async () => {
  installShell([DEMO]);
  const rt = stubRt([{ v: 1 }, { v: 2 }, { v: 3 }]);
  await runAppTool(ev(), rt, okSandbox);
  assert.equal(rt.calls.result.ok, true);
  assert.deepEqual(rt.calls.result.output, { count: 3 });
  assert.ok(rt.calls.widget && /count|3/.test(rt.calls.widget.html), 'render → onWidget');
});

test('沙箱失败(超时/异常) ⇒ result(false),不给半真结果', async () => {
  installShell([DEMO]);
  const rt = stubRt([{ v: 1 }]);
  await runAppTool(ev(), rt, failSandbox);
  assert.equal(rt.calls.result.ok, false);
  assert.match(rt.calls.result.error, /超时/);
  assert.equal(rt.calls.widget, null, '沙箱失败无 widget');
});

test('render 抛异常 ⇒ 结果仍 true(呈现失败不阻断结果回程)', async () => {
  installShell([{ ...DEMO, render: () => { throw new Error('render-boom'); } }]);
  const rt = stubRt([{ v: 1 }]);
  await runAppTool(ev(), rt, okSandbox);
  assert.equal(rt.calls.result.ok, true, 'compute 成功了,render 失败不该让模型以为工具失败');
  assert.equal(rt.calls.widget, null, 'widget 没画出来');
});
