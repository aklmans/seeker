// @ts-check
/**
 * app-tool 前端编排(T2b-2)—— 平台层,业务无关:只按 app-tool 契约驱动,**不识任何 app 符号**。
 *
 * 收到 Rust 的 `ai_app_tool { callId, name, input }` 事件后,平台壳(不是应用)按契约执行链跑一遍:
 *   ① 按 name 查 `SeekerShell.appTools()`(未知/已下架 ⇒ fail-closed 报错)
 *   ② **D3 取数**:按 `tool.reads` 走既有 `query_data` 闸(静态 QUERYABLE ∩ 运行时可读集 ∩ reads)——
 *      任一集合被后端 D3 拒 ⇒ reject ⇒ fail-closed(这就是「调用硬拒」运行期强制点)
 *   ③ **隔离 compute + 投影**:compute 源码字符串注入三墙沙箱(I1 无 rt/profile),output 经 projectToSchema
 *      投影(I4,只留声明字段)——见 sandbox.js
 *   ④ **render**:前端渲染器产 widget(tt 可用 ⇒ #6 债消失),投画布(仍进三墙沙箱)
 *   ⑤ 结果回程 `appToolResult`(Rust 再 Untrusted 框定喂模型)
 *
 * ★I1 profile 结构不可达:compute 只拿到 `(input, rows)`,rows **只来自 tool.reads 的 query_data**;
 *   而 query_data 的 QUERYABLE 硬底**永不含 profile** ⇒ 无论工具怎么声明,profile 都进不了 compute。
 * ★一切失败面(未知工具/取数被拒/沙箱失败/异常)一律 fail-closed:如实报错给模型,绝不半真结果。
 */
import { runComputeSandbox } from './sandbox.js';

/**
 * @param {{ callId:string, name:string, input:any }} ev
 * @param {{
 *   queryData: (collection:string) => Promise<any>,
 *   result: (callId:string, ok:boolean, output:any, error:string|null) => Promise<any>,
 *   onWidget?: (w:any) => void,
 * }} rt
 * @returns {Promise<void>}
 */
export async function runAppTool(ev, rt) {
  const { callId, name, input } = ev || /** @type {any} */ ({});
  try {
    const S = /** @type {any} */ (window).SeekerShell;
    const tool = S && typeof S.appTools === 'function'
      ? S.appTools().find((/** @type {any} */ t) => t && t.name === name)
      : null;
    // fail-closed:未知 / 运行时已关应用而下架的工具 ⇒ 如实报错,绝不猜。
    if (!tool) {
      await rt.result(callId, false, null, '未知或已下架的 app-tool:' + name);
      return;
    }

    // ★D3 取数:平台按 reads 逐集合走 query_data;后端 invoke 强制 QUERYABLE ∩ 运行时可读集 ∩(此处的 reads)。
    //   任一集合不可读 ⇒ query_data reject ⇒ 落到 catch ⇒ fail-closed(「调用硬拒」)。
    /** @type {{[c:string]:any[]}} */
    const rows = {};
    const reads = Array.isArray(tool.reads) ? tool.reads : [];
    for (const c of reads) {
      const res = await rt.queryData(c); // { collection, count, records } | reject
      rows[c] = res && Array.isArray(res.records) ? res.records : [];
    }

    // ★隔离 compute + 投影(sandbox 内建 projectToSchema)。compute 源码注入三墙沙箱(无 rt/profile/网络)。
    const out = await runComputeSandbox({
      computeSource: String(tool.compute),
      input,
      rows,
      output: tool.output,
    });
    if (!out.ok) {
      await rt.result(callId, false, null, out.error);
      return;
    }

    // render(前端,tt 可用):据**已投影** output 产 widget 投画布;仍进三墙沙箱渲染。
    //   render 失败只影响呈现,**不阻断**给模型的结果回程(工具算成功了,画布没画出来不该让模型以为失败)。
    try {
      if (rt.onWidget && typeof tool.render === 'function') {
        const w = tool.render(out.output);
        if (w && typeof w.html === 'string') {
          rt.onWidget({ id: 'apptool-' + callId, html: w.html, title: (w.title || name), minHeight: w.minHeight });
        }
      }
    } catch (_e) {
      // 呈现失败不影响结果;吞掉(§4-4:render 产物本就进沙箱,异常已隔离)。
    }

    // 投影后的 output 回程;Rust 侧 frame_app_tool_result 再 Untrusted 框定喂模型(T2-5)。
    await rt.result(callId, true, out.output, null);
  } catch (e) {
    // 取数被 D3 拒 / 任何异常 ⇒ fail-closed:如实报错(模型看到工具失败,不会拿到半真结果)。
    const msg = e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e);
    try {
      await rt.result(callId, false, null, msg);
    } catch (_e) {
      // 结果通道也断了(前端将关闭 / Rust 已超时清挂起),无能为力。
    }
  }
}
